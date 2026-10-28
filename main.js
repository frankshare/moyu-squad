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
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20 * 60 * 1000) })
  if (!r.ok) return { ok: false, msg: '下载失败 HTTP ' + r.status }
  const total = Number(r.headers.get('content-length') || 0)
  const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'moyu-squad-setup.exe'
  const dir = path.join(app.getPath('temp'), 'moyu-update')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
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
  return { ok: true, path: file, size: got, total }
}

// ── 检查更新（GitHub Releases，无需 git / 无需代理） ──
const RELEASES_API = 'https://api.github.com/repos/frankshare/moyu-squad/releases/latest'
const RELEASES_PAGE = 'https://github.com/frankshare/moyu-squad/releases/latest'

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
