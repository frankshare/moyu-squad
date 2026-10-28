// 摸鱼小队线上信令往返测试：两个客户端连真实服务器，验证完整协议
// 用法: node test-signal.mjs [wss地址，默认线上]
const base = process.argv[2] || 'wss://moyu.summersol.dpdns.org/ws'
const room = 'ZT' + Math.random().toString(36).slice(2, 6).toUpperCase()
const seen = { A: [], B: [] }
const done = { fn: null }

function client(name, onReady) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}?room=${room}`)
    const timer = setTimeout(() => reject(new Error(name + ' 超时')), 20000)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name: '小队' + name }))
    ws.onmessage = e => {
      const m = JSON.parse(e.data)
      seen[name].push(m)
      onReady && onReady(m, ws)
      if (name === 'A' && m.t === 'peer-state') {
        clearTimeout(timer)
        resolve()
      }
      if (name === 'B' && m.t === 'welcome') {
        // B 后进房：向 A 发 relay + 文字消息，再广播静音状态
        ws.send(JSON.stringify({ t: 'relay', to: m.peers[0].id, data: { ping: 'from B' } }))
        setTimeout(() => {
          ws.send(JSON.stringify({ t: 'msg', text: 'hello from B' }))
          ws.send(JSON.stringify({ t: 'state', muted: true }))
          clearTimeout(timer)
          resolve()
        }, 400)
      }
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error(name + ' 连接失败')) }
  })
}

const a = client('A', () => {}).catch(e => { console.error('A:', e.message); process.exit(1) })
await new Promise(r => setTimeout(r, 1200))
const b = client('B', () => {})
await b
await new Promise(r => setTimeout(r, 800))

const wa = seen.A.find(m => m.t === 'welcome')
const pj = seen.A.find(m => m.t === 'peer-join')
const rl = seen.A.find(m => m.t === 'relay')
const ps = seen.A.find(m => m.t === 'peer-state')
const cm = seen.A.find(m => m.t === 'msg')
const wb = seen.B.find(m => m.t === 'welcome')

const checks = [
  ['A 收到 welcome 且房里初始 0 人', wa && wa.peers.length === 0],
  ['B 收到 welcome 且看到 A 在房里', wb && wb.peers.length === 1 && wb.peers[0].name === '小队A'],
  ['A 收到 B 的 peer-join', pj && pj.name === '小队B'],
  ['A 收到 B 的 relay 消息', rl && rl.from === wb.id && rl.data.ping === 'from B'],
  ['A 收到 B 的静音状态广播', ps && ps.id === wb.id && ps.muted === true],
  ['A 收到 B 的文字消息', cm && cm.from === wb.id && cm.name === '小队B' && cm.text === 'hello from B']
]
let fail = 0
for (const [label, ok] of checks) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + label)
  if (!ok) fail++
}
console.log(`\n房间 ${room} @ ${base}`)
console.log(fail === 0 ? '全部通过 — 线上信令链路正常 ✅' : `${fail} 项未通过 ❌`)
process.exit(fail === 0 ? 0 : 1)
