// 摸鱼小队信令服务器：HTTP 静态托管 + WebSocket 信令同端口
// 用法: node server/index.js  (PORT 环境变量可改端口，默认 7788)
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')

const ROOT = path.join(__dirname, '..')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/ice') {
    // 与 Worker 版 /ice 相同的兜底配置（本地版不做 TURN 凭据热签发）
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    return res.end(JSON.stringify({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.qq.com:3478', 'stun:stun.miwifi.com:3478'] },
        {
          urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    }))
  }
  if (p === '/') p = '/index.html'
  const file = path.join(ROOT, p)
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
})

// room -> Map(id -> {ws, name, muted})
const rooms = new Map()
const wss = new WebSocketServer({ server })
let seq = 0

wss.on('connection', ws => {
  const id = 'p' + (++seq) + crypto.randomBytes(2).toString('hex')
  let room = null
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', buf => {
    let m
    try { m = JSON.parse(buf) } catch { return }

    if (m.t === 'join') {
      const name = String(m.name || '摸鱼人').slice(0, 16)
      const r = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      if (!r) return send(ws, { t: 'err', msg: '房间号无效' })
      if (!rooms.has(r)) rooms.set(r, new Map())
      const rm = rooms.get(r)
      if (rm.size >= 8 && !rm.has(id)) return send(ws, { t: 'err', msg: '房间已满（最多 8 人）' })
      room = r
      rm.set(id, { ws, name, muted: false })
      send(ws, {
        t: 'welcome', id,
        peers: [...rm.entries()].filter(([k]) => k !== id).map(([k, v]) => ({ id: k, name: v.name, muted: v.muted }))
      })
      broadcast(r, { t: 'peer-join', id, name }, id)
      console.log(`[room ${r}] ${name} 进房 (${rm.size} 人在线)`)
    } else if (m.t === 'relay') {
      const rm = room && rooms.get(room)
      const target = rm && rm.get(m.to)
      if (target && target.ws.readyState === 1) target.ws.send(JSON.stringify({ t: 'relay', from: id, data: m.data }))
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong' })
    } else if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 200)
      const me = room && rooms.get(room) && rooms.get(room).get(id)
      if (text && me) broadcast(room, { t: 'msg', from: id, name: me.name, text })
    } else if (m.t === 'img') {
      const me = room && rooms.get(room) && rooms.get(room).get(id)
      const sid = String(m.sid || '')
      if (sid && /^[a-z0-9_-]{1,40}$/i.test(sid) && me) {
        broadcast(room, { t: 'img', from: id, name: me.name, sid })
      } else {
        const data = String(m.data || '')
        if (data.length <= 280000 && data.startsWith('data:image/') && me) {
          broadcast(room, { t: 'img', from: id, name: me.name, data })
        }
      }
    } else if (m.t === 'state') {
      const rm = room && rooms.get(room)
      const me = rm && rm.get(id)
      if (me) { me.muted = !!m.muted; broadcast(room, { t: 'peer-state', id, muted: me.muted }) }
    }
  })

  ws.on('close', () => {
    if (!room || !rooms.has(room)) return
    const rm = rooms.get(room)
    const me = rm.get(id)
    rm.delete(id)
    broadcast(room, { t: 'peer-leave', id })
    if (!rm.size) rooms.delete(room)
    if (me) console.log(`[room ${room}] ${me.name} 离开`)
  })

  function broadcast(r, msg, except) {
    const rm = rooms.get(r)
    if (!rm) return
    for (const [k, v] of rm) {
      if (k !== except && v.ws.readyState === 1) v.ws.send(JSON.stringify(msg))
    }
  }
  function send(w, o) { if (w.readyState === 1) w.send(JSON.stringify(o)) }
})

setInterval(() => {
  wss.clients.forEach(c => {
    if (!c.isAlive) return c.terminate()
    c.isAlive = false
    c.ping()
  })
}, 30000)

const PORT = process.env.PORT || 7788
server.listen(PORT, () => console.log(`摸鱼小队信令服务器已启动: http://0.0.0.0:${PORT}`))
