// 摸鱼小队信令服务器 — Cloudflare Workers + Durable Objects 版
// 免费档运行：SQLite-backed DO + Hibernatable WebSockets，空闲连接休眠几乎零开销
//
// 协议与本地 Node 版 (server/index.js) 完全一致：
//   客户端 → {t:'join', room, name} {t:'relay', to, data} {t:'state', muted}
//   服务端 → {t:'welcome', id, peers} {t:'peer-join'} {t:'peer-leave'}
//            {t:'relay', from, data} {t:'peer-state'} {t:'err'}
//
// WebSocket 连接地址：wss://<域名>/ws?room=<房间号>

// 每个房间一个 Durable Object 实例，全球唯一，跨机房连接都汇聚到它
export class Room {
  constructor(state, env) { this.state = state }

  async fetch() {
    // 只处理 WebSocket 升级：挂上连接、绑定附件（peer 元数据），join 消息随后到达
    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    const id = 'p' + crypto.randomUUID().slice(0, 8)
    pair[1].serializeAttachment({ id, name: null, muted: false })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  safeSend(ws, o) { try { ws.send(JSON.stringify(o)) } catch {} }

  broadcast(msg, exceptId) {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment()
      if (a && a.id !== exceptId) this.safeSend(ws, msg)
    }
  }

  async webSocketMessage(ws, message) {
    let m
    try { m = JSON.parse(message) } catch { return }
    const a = ws.deserializeAttachment()
    if (!a) return

    if (m.t === 'join') {
      if (this.state.getWebSockets().length > 8) {
        this.safeSend(ws, { t: 'err', msg: '房间已满（最多 8 人）' })
        ws.close(1008, 'room full')
        return
      }
      a.name = String(m.name || '摸鱼人').slice(0, 16)
      a.muted = false
      ws.serializeAttachment(a)
      const peers = this.state.getWebSockets()
        .filter(x => x !== ws)
        .map(x => x.deserializeAttachment())
        .filter(x => x && x.name)
        .map(x => ({ id: x.id, name: x.name, muted: !!x.muted }))
      this.safeSend(ws, { t: 'welcome', id: a.id, peers })
      this.broadcast({ t: 'peer-join', id: a.id, name: a.name }, a.id)
    } else if (m.t === 'ping') {
      this.safeSend(ws, { t: 'pong' })
    } else if (m.t === 'relay') {
      const target = this.state.getWebSockets().find(x => {
        const ta = x.deserializeAttachment()
        return ta && ta.id === m.to
      })
      if (target) this.safeSend(target, { t: 'relay', from: a.id, data: m.data })
    } else if (m.t === 'msg') {
      // 房间内文字消息：限长、带昵称广播给全房
      const text = String(m.text || '').trim().slice(0, 200)
      if (text && a.name) this.broadcast({ t: 'msg', from: a.id, name: a.name, text })
    } else if (m.t === 'img') {
      // 贴图/表情图片：① data URI（≤280KB）② 内置贴图 ID（/stickers/*.gif，走 CDN 不占流量）
      const sid = String(m.sid || '')
      if (sid && /^[a-z0-9_-]{1,40}$/i.test(sid) && a.name) {
        this.broadcast({ t: 'img', from: a.id, name: a.name, sid })
      } else {
        const data = String(m.data || '')
        if (data.length <= 280000 && data.startsWith('data:image/') && a.name) {
          this.broadcast({ t: 'img', from: a.id, name: a.name, data })
        }
      }
    } else if (m.t === 'state') {
      a.muted = !!m.muted
      ws.serializeAttachment(a)
      this.broadcast({ t: 'peer-state', id: a.id, muted: a.muted })
    }
  }

  webSocketClose(ws) {
    const a = ws.deserializeAttachment()
    if (a && a.name) this.broadcast({ t: 'peer-leave', id: a.id })
  }
}

// /ice 端点：向客户端下发打洞配置。
// 配置了 TURN_KEY_ID + TURN_KEY_SECRET（secrets，即 Realtime TURN key 的 Token ID/API Token）后，
// 经 rtc.live.cloudflare.com 热签发 24 小时临时凭据（缓存 1 小时）；
// 未配置或调用失败时降级为静态兜底（含免费公共 TURN）。
function json404(msg) {
  return new Response(msg, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
}
const STATIC_ICE = {
  iceServers: [
    // 国内 STUN 常驻：UDP 3478 常被拦，只有部分（如小米）可达；
    // 缺了它会拿不到 srflx 候选，只能退化走 TURN 中继 → 延迟 400ms+
    { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.qq.com:3478'] },
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
}
let iceCache = { data: null, expires: 0 }

async function buildIce(env) {
  const keyId = env.TURN_KEY_ID, keySecret = env.TURN_KEY_SECRET
  if (!keyId || !keySecret) return STATIC_ICE
  const now = Date.now()
  if (iceCache.data && iceCache.expires > now) return iceCache.data
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keySecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 })
    })
    if (r.status !== 201) throw new Error('turn api ' + r.status)
    const creds = await r.json()
    const ice = creds && creds.iceServers
    if (!ice || !Array.isArray(ice.urls) || !ice.username || !ice.credential) throw new Error('turn shape')
    const data = { iceServers: [
      // 国内 STUN 常驻（UDP 3478 常被拦，只有小米等可达；缺它会退化走 TURN → 400ms+）
      { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.qq.com:3478'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: ice.urls, username: ice.username, credential: ice.credential }
    ] }
    iceCache = { data, expires: now + 3600_000 }
    return data
  } catch (e) {
    return STATIC_ICE
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const isWS = (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket'

    if (!isWS) {
      if (url.pathname === '/ice') {
        const ice = await buildIce(env)
        return new Response(JSON.stringify(ice), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        })
      }
      // /gh-proxy/*：GitHub Releases 下载代理。国内直连 objects.githubusercontent.com 基本必挂，
      // 应用内更新下载走这里中转（Worker 与 GitHub 之间在国际骨干上，快且稳）。
      // 用法：/gh-proxy?url=<encodeURIComponent(完整 GitHub 下载地址)>
      if (url.pathname === '/gh-proxy') {
        const target = url.searchParams.get('url') || ''
        // 只放行本仓库的 Releases 下载地址，防止被当公共代理滥用
        let t
        try { t = new URL(target) } catch { return json404('bad url') }
        const hostOk = t.hostname === 'github.com' || t.hostname === 'api.github.com' ||
          t.hostname.endsWith('.githubusercontent.com') || t.hostname === 'codeload.github.com'
        const repoOk = t.pathname.startsWith('/frankshare/moyu-squad')
        if (!hostOk || !repoOk) return json404('blocked')
        const upstream = await fetch(t.href, {
          redirect: 'follow',
          headers: { 'User-Agent': 'moyu-squad-update-proxy' },
          cf: { cacheTtl: 0 }
        })
        if (!upstream.ok) {
          return new Response('upstream ' + upstream.status, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } })
        }
        const h = new Headers()
        const len = upstream.headers.get('content-length')
        if (len) h.set('Content-Length', len)
        const type = upstream.headers.get('content-type')
        if (type) h.set('Content-Type', type)
        h.set('Access-Control-Allow-Origin', '*')
        h.set('Cache-Control', 'no-cache')
        return new Response(upstream.body, { status: 200, headers: h })
      }
      // 静态资源禁缓存：每次部署即刻生效，客户端不会拿到旧版页面
      const res = await env.ASSETS.fetch(req)
      const headers = new Headers(res.headers)
      headers.set('Cache-Control', 'no-cache')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    }

    const room = (url.searchParams.get('room') || '')
      .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    if (!room) {
      // 无效房间号也先完成握手，再走客户端已支持的带内错误协议
      const pair = new WebSocketPair()
      pair[1].accept()
      pair[1].send(JSON.stringify({ t: 'err', msg: '房间号无效' }))
      pair[1].close(1008, 'bad room')
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    const id = env.ROOM.idFromName(room)
    return env.ROOM.get(id).fetch(req)
  }
}
