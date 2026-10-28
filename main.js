const { app, BrowserWindow, session, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')

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
