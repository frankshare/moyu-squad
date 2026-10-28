const { contextBridge, ipcRenderer } = require('electron')

// 渲染进程（file:// 页面）无法跨域 fetch /ice，由主进程代取
contextBridge.exposeInMainWorld('moyu', {
  getIceConfig: serverUrl => ipcRenderer.invoke('get-ice-config', serverUrl),
  isDesktop: true
})

// 自定义标题栏的窗口控制
contextBridge.exposeInMainWorld('moyuWin', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximizeToggle: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close')
})

// 应用内更新：检查 Release / 下载安装包 / 拉取 git / 重启
contextBridge.exposeInMainWorld('moyuUpdate', {
  env: () => ipcRenderer.invoke('app-env'),
  check: () => ipcRenderer.invoke('app-check-update'),
  download: url => ipcRenderer.invoke('app-download', url),
  update: () => ipcRenderer.invoke('app-update'),
  restart: () => ipcRenderer.send('app-restart'),
  openDownload: url => ipcRenderer.send('app-open-url', url)
})
