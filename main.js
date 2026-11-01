const { app, BrowserWindow, session, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { execFile } = require('child_process')

let tray = null
let quitting = false

// 主进程代取 /ice 打洞配置（渲染进程跨域受限）
ipcMain.handle('get-ice-config', async (e, serverUrl) => {
  try {
    let origin
    if (serverUrl) {
      const u = new URL(serverUrl)
      origin = (u.protocol === 'wss:' ? 'https://' : 'http://') + u.host
    } else {
      origin = 'https://moyu.summersol.dpdns.org'
    }
    const r = await fetch(origin + '/ice', { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const j = await r.json()
    return j && Array.isArray(j.iceServers) && j.iceServers.length ? j : null
  } catch {
    return null
  }
})

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    backgroundColor: '#0e1013',
    title: '摸鱼小队',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  })
  const query = {}
  const room = arg('room'), name = arg('name')
  if (room) query.room = room
  if (name) query.name = name
  win.loadFile('index.html', { query })
  win.on('close', e => {
    // 开黑语音挂着不掉线：点关闭 = 最小化到托盘
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  return win
}

// 自定义标题栏的窗口控制
ipcMain.on('win-minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('win-maximize', e => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('win-close', e => BrowserWindow.fromWebContents(e.sender)?.close())

// ── 应用内更新：git pull + 重启 ──
const REPO_URL = 'https://github.com/frankshare/moyu-squad.git'
function run(cmd, args, cwd) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err: err ? (err.message || String(err)) : null, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}
ipcMain.handle('app-update', async () => {
  const repoDir = detectRepoDir()
  const lines = []
  if (!repoDir) {
    return {
      ok: false, changed: false, needsInstaller: true,
      log: '当前是安装版，没有源码目录，无法直接拉取代码。\n\n' +
           '请点「检查更新」下载新版安装包覆盖安装：\n' + RELEASES_PAGE +
           '\n（覆盖安装不会影响你的设置和聊天记录）'
    }
  }
  lines.push('仓库目录: ' + repoDir)
  // --autostash：本地有改动时 Git 自动暂存并恢复，避免 pull --rebase 直接失败
  const pull = await run('git', ['pull', '--rebase', '--autostash', 'origin', 'master'], repoDir)
  lines.push((pull.stdout || '').trim())
  if (pull.stderr.trim()) lines.push(pull.stderr.trim())
  if (pull.err) return { ok: false, changed: false, log: lines.join('\n') }
  const changed = !/Already up to date|已经是最新|up[- ]to[- ]date/i.test(pull.stdout)
  const head = await run('git', ['log', '-1', '--pretty=format:%h %s'], repoDir)
  lines.push('当前版本: ' + (head.stdout || '').trim())
  return { ok: true, changed, log: lines.join('\n') }
})
ipcMain.on('app-restart', () => {
  quitting = true
  app.relaunch()
  app.exit(0)
})

// 用系统默认浏览器打开下载链接
ipcMain.on('app-open-url', (e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) {
    require('electron').shell.openExternal(url)
  }
})

// ── 应用内下载安装包（不跳浏览器） ──
ipcMain.handle('app-download', async (e, url) => {
  const fs = require('fs')
  const { shell } = require('electron')
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { ok: false, msg: '非法地址' }
  try {
    const dl = await electron_download(url)
    if (!dl.ok) return dl
    // 下载完成 → 直接启动安装程序
    try {
      shell.openPath(dl.path)
    } catch {}
    return dl
  } catch (err) {
    return { ok: false, msg: '下载失败：' + (err.message || err) }
  }
})

async function electron_download(url) {
  const fs = require('fs')
  const path = require('path')
  const { app } = require('electron')
  // 多源重试：GitHub 下载地址会先走自家 Worker 代理（国内直连 objects.githubusercontent.com 基本必挂），
  // 代理失败再退回直连；非 GitHub 地址直接下。
  // 每条线路先试多连接分片（国内出口单连接限速 ~0.1MB/s，8 连接能到 ~0.8MB/s），失败退单流。
  let lastErr = '下载失败'
  for (const cand of downloadCandidates(url)) {
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'moyu-squad-setup.exe'
    const dir = path.join(app.getPath('temp'), 'moyu-update')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    // ① 多连接分片（仅代理线路——直连 GitHub 的 CDN 连 TLS 都过不了，分片无意义）
    if (cand !== url) {
      try {
        const r = await parallelDownload(cand, file)
        if (r && r.ok) return { ok: true, path: file, size: r.size, total: r.total }
      } catch (err) {
        lastErr = '分片下载失败：' + (err.message || err)
        try { fs.unlinkSync(file) } catch {}
      }
    }
    // ② 单流兜底（直连线路 / 分片不支持的源）
    try {
      const r = await fetch(cand, { redirect: 'follow', signal: AbortSignal.timeout(20 * 60 * 1000) })
      if (!r.ok) { lastErr = '下载失败 HTTP ' + r.status + (cand !== url ? '（代理线路）' : '（直连线路）'); continue }
      const total = Number(r.headers.get('content-length') || 0)
      const ws = fs.createWriteStream(file)
      let got = 0
      const reader = r.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        got += value.length
        if (!ws.write(Buffer.from(value))) await new Promise(res => ws.once('drain', res))
      }
      await new Promise(res => ws.end(res))
      // 完整性校验：GitHub 声明了大小但拿到的字节数明显不符 → 换线路重试
      if (total && got && Math.abs(got - total) > 1024) {
        ws.close(); try { fs.unlinkSync(file) } catch {}
        lastErr = '下载不完整（' + got + '/' + total + '）'
        continue
      }
      return { ok: true, path: file, size: got, total }
    } catch (err) {
      lastErr = (err && err.name === 'TimeoutError') ? '下载超时' : (err.message || String(err))
    }
  }
  return { ok: false, msg: lastErr }
}

/* ─────────── 多连接分片下载器 ───────────
   国内到 Cloudflare 边缘的单 TCP 连接被限速在 ~0.1MB/s（实测 12 个 IP 一致），
   出口按连接数限速 → 用 N 条 Range 分片并行，吞吐近似 ×N。
   边缘 IP 在本机也可能时好时坏（有的 IP TLS 直接超时），所以先并发探测选最快的几颗。 */
const DL_HOST = 'moyu.summersol.dpdns.org'
const CF_IP_POOL = [
  '104.18.32.7', '172.64.80.10', '104.20.32.48', '104.17.32.10', '188.114.96.3',
  '104.21.27.22', '172.67.140.236', '162.159.135.42', '104.19.195.21', '104.16.132.229'
]

// 用 node:https 手动指定连接 IP：host=IP、servername=域名（SNI/证书校验都按域名走）
function httpsProbe(ip, path, timeoutMs) {
  const https = require('https')
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip, port: 443, servername: DL_HOST, path,
      method: 'GET',
      headers: { Host: DL_HOST, 'User-Agent': 'moyu-squad-edge-probe', 'Accept-Encoding': 'identity' },
      timeout: timeoutMs
    }, res => {
      res.resume()
      let bytes = 0
      const t0 = Date.now()
      res.on('data', c => { bytes += c.length })
      res.on('end', () => resolve({ ip, bytes, ms: Date.now() - t0 }))
    })
    req.on('timeout', () => { req.destroy(new Error('probe timeout')) })
    req.on('error', reject)
    req.end()
  })
}

// 并发探测 IP 池，按「探测期吞吐」排序取前 n 个（探测下载 128KB，2 个并行批次足够）
async function pickFastIPs(n) {
  const { dns } = require('dns').promises ? require('dns').promises : require('dns')
  const ips = [...CF_IP_POOL]
  try {
    const a = await require('dns').promises.resolve4(DL_HOST)
    for (const ip of a) if (!ips.includes(ip)) ips.unshift(ip)   // 官方解析的优先测
  } catch {}
  const results = await Promise.allSettled(ips.map(ip => httpsProbe(ip, '/speedtest', 6000)))
  const ok = results.filter(r => r.status === 'fulfilled' && r.value.bytes > 65536)
    .map(r => ({ ip: r.value.ip, speed: r.value.bytes / Math.max(1, r.value.ms) }))
    .sort((a, b) => b.speed - a.speed)
  return ok.slice(0, n).map(r => r.ip)
}

// 单分片：Range 请求 + 按偏移写文件，自带 1 次重试
async function downloadSegment(ip, urlPath, start, end, fd, file, attempts) {
  const fs = require('fs')
  const https = require('https')
  for (let i = 0; i < attempts; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const req = https.request({
          host: ip, port: 443, servername: DL_HOST, path: urlPath,
          method: 'GET',
          headers: { Host: DL_HOST, 'User-Agent': 'moyu-squad-update', 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` },
          timeout: 120000
        }, res => {
          if (res.statusCode !== 206 && res.statusCode !== 200) { res.resume(); return reject(new Error('分片 HTTP ' + res.statusCode)) }
          let pos = start
          res.on('data', c => {
            const buf = Buffer.from(c)
            fs.writeSync(fd, buf, 0, buf.length, pos)
            pos += buf.length
          })
          res.on('end', () => pos >= end + 1 ? resolve(pos - start) : reject(new Error(`分片不完整 ${pos - start}/${end - start + 1}`)))
        })
        req.on('timeout', () => req.destroy(new Error('分片超时')))
        req.on('error', reject)
        req.end()
      })
    } catch (err) {
      if (i === attempts - 1) throw err
      await new Promise(r => setTimeout(r, 800))
    }
  }
}

// 主流程：探测 IP → 取总大小 → 8 分片并行 → 校验
async function parallelDownload(proxyUrl, file) {
  const fs = require('fs')
  const SEGS = 8
  const ips = await pickFastIPs(Math.min(6, SEGS))
  if (!ips.length) throw new Error('无可用边缘节点')
  const urlObj = new URL(proxyUrl)
  const urlPath = urlObj.pathname + urlObj.search
  // 总大小：Range 0-0 拿 content-range（206 响应）
  let total = 0
  {
    const https = require('https')
    total = await new Promise((resolve, reject) => {
      const req = https.request({
        host: ips[0], port: 443, servername: DL_HOST, path: urlPath, method: 'GET',
        headers: { Host: DL_HOST, 'User-Agent': 'moyu-squad-update', Range: 'bytes=0-0' }, timeout: 15000
      }, res => {
        res.resume()
        const cr = res.headers['content-range']
        if (res.statusCode === 206 && cr) return resolve(Number(cr.split('/')[1]))
        reject(new Error('源不支持 Range（HTTP ' + res.statusCode + '）'))
      })
      req.on('timeout', () => req.destroy(new Error('取大小超时')))
      req.on('error', reject)
      req.end()
    })
  }
  if (!total) throw new Error('总大小未知')
  fs.closeSync(fs.openSync(file, 'w'))  // 预创建/清空
  const fd = fs.openSync(file, 'r+')
  try {
    const segSize = Math.ceil(total / SEGS)
    const jobs = []
    for (let i = 0; i < SEGS; i++) {
      const start = i * segSize
      const end = Math.min(total - 1, start + segSize - 1)
      if (start > end) break
      jobs.push({ start, end })
    }
    // 分片轮转分配到最快的几颗 IP 上
    await Promise.all(jobs.map((j, i) =>
      downloadSegment(ips[i % ips.length], urlPath, j.start, j.end, fd, file, 2)
    ))
    const size = fs.fstatSync(fd).size
    if (Math.abs(size - total) > 1024) throw new Error(`大小校验失败 ${size}/${total}`)
    return { ok: true, size, total }
  } finally {
    fs.closeSync(fd)
  }
}

// ── 检查更新（GitHub Releases，无需 git / 无需代理） ──
const RELEASES_API = 'https://api.github.com/repos/frankshare/moyu-squad/releases/latest'
const RELEASES_PAGE = 'https://github.com/frankshare/moyu-squad/releases/latest'
// 更新包下载代理：国内直连 objects.githubusercontent.com 基本必挂，
// 走自家 Cloudflare Worker 中转（信令同域，国内可达），失败再退直连。
const DOWNLOAD_PROXY = 'https://moyu.summersol.dpdns.org/gh-proxy?url='

// 把 GitHub 下载地址包成候选列表：代理优先，直连兜底
function downloadCandidates(url) {
  const list = []
  try {
    const u = new URL(url)
    const isGh = (u.hostname === 'github.com' && u.pathname.includes('/releases/download/')) ||
      u.hostname.endsWith('.githubusercontent.com')
    if (isGh) list.push(DOWNLOAD_PROXY + encodeURIComponent(url))
  } catch {}
  list.push(url)
  return list
}

// 运行环境探测：安装版（无 .git）vs 源码版（有 .git）
function detectRepoDir() {
  const fs = require('fs')
  const candidates = [
    app.getAppPath(),                                   // 源码运行：项目根
    path.join(app.getAppPath(), '..'),                   // asar 内 → 项目根
    path.join(path.dirname(process.execPath), '..', '..') // 安装目录：Programs/moyu-squad
  ]
  for (const d of candidates) {
    try {
      if (fs.existsSync(path.join(d, '.git')) && fs.existsSync(path.join(d, 'package.json'))) return d
    } catch {}
  }
  return null
}
ipcMain.handle('app-env', () => ({ isRepo: !!detectRepoDir() }))

ipcMain.handle('app-check-update', async () => {
  try {
    const r = await fetch(RELEASES_API, {
      headers: { 'User-Agent': 'moyu-squad', 'Accept': 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000)
    })
    if (!r.ok) {
      return { ok: false, msg: '查询失败 HTTP ' + r.status + '（GitHub API 限流，稍后再试）' }
    }
    const rel = await r.json()
    const latest = String(rel.tag_name || '').replace(/^v/, '')
    const cur = app.getVersion()
    const cmp = (a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return 1; if ((pa[i] || 0) < (pb[i] || 0)) return -1 }
      return 0
    }
    const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name))
    return {
      ok: true,
      latest, current: cur,
      hasUpdate: cmp(latest, cur) > 0,
      url: asset ? asset.browser_download_url : RELEASES_PAGE,
      size: asset ? asset.size : 0,
      notes: (rel.body || '').trim().slice(0, 800),
      pageUrl: rel.html_url || RELEASES_PAGE
    }
  } catch (e) {
    return { ok: false, msg: '查询失败：' + (e.message || e) }
  }
})

function showMain() {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.show()
    win.focus()
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', showMain)

  app.whenReady().then(() => {
    const allow = p => p === 'media' || p === 'audioCapture' || p === 'notifications'
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allow(permission)))
    session.defaultSession.setPermissionCheckHandler((wc, permission) => allow(permission))
    createWindow()

    // 托盘
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')))
      tray.setToolTip('摸鱼小队 — 点击显示主界面')
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示主界面', click: showMain },
        { type: 'separator' },
        { label: '退出摸鱼小队', click: () => { quitting = true; app.quit() } }
      ]))
      tray.on('double-click', showMain)
    } catch (e) {
      console.error('托盘创建失败', e)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showMain()
    })
  })

  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
