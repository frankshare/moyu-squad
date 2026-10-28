// 摸鱼小队客户端：WebRTC P2P mesh 语音 + WebSocket 信令
'use strict'
const $ = s => document.querySelector(s)

// Cloudflare Worker 信令默认节点（免费档，永久在线）；部署地址变了就改这里
const DEFAULT_WSS = 'wss://moyu.summersol.dpdns.org'
function defaultServer() {
  const saved = localStorage.getItem('moyu.server')
  if (saved) return saved
  if (location.protocol === 'https:' || location.protocol === 'http:') {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
  }
  return DEFAULT_WSS
}

// 兜底 ICE：/ice 端点不可用时使用（含免费公共 TURN，严格 NAT 也能应急）
const FALLBACK_ICE = {
  iceServers: [
    { urls: ['stun:stun.qq.com:3478', 'stun:stun.miwifi.com:3478', 'stun:stun.cloudflare.com:3478'] },
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
}
// 国内 STUN（UDP 3478 实测只有小米这个通，必须常驻）
const DOMESTIC_STUN = [
  { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.qq.com:3478'] }
]

/* ═════════ 主题系统（8 套配色） ═════════ */
const BASE_DARK = {
  '--panel': '#151a22', '--card': '#1a2029', '--card-2': '#171c24',
  '--line': '#2a313d', '--line-strong': '#3a4452',
  '--text': '#e6eaf2', '--dim': '#98a2b3', '--faint': '#6b7686',
  '--pri-text': 'rgba(240, 244, 252, .95)',
  '--pri-hi': 'rgba(255, 255, 255, .14)', '--pri-lo': 'rgba(0, 0, 0, .22)',
  '--pri-sa': 'rgba(0, 0, 0, .45)', '--pri-sb': 'rgba(0, 0, 0, .55)',
  '--meter-bg': '#10141b',
  '--ghost-hover': 'rgba(128, 140, 165, .14)', '--ghost-border': 'rgba(128, 140, 165, .3)',
  '--kbd-bg': 'rgba(0, 0, 0, .28)', '--kbd-border': 'rgba(255, 255, 255, .14)',
  '--muted-btn-text': 'rgba(244, 246, 250, .6)',
  '--modal-shadow': '0 1px 0 rgba(255,255,255,.05) inset, 0 18px 60px rgba(0,0,0,.55)'
}
const BASE_LIGHT = {
  '--panel': '#ffffff', '--card': '#f9fafc', '--card-2': '#f2f4f8',
  '--line': '#e2e7ef', '--line-strong': '#c9d2df',
  '--text': '#263041', '--dim': '#5f6b7f', '--faint': '#96a1b3',
  '--pri-text': '#2b3446',
  '--pri-hi': 'rgba(255, 255, 255, .9)', '--pri-lo': 'rgba(16, 24, 40, .07)',
  '--pri-sa': 'rgba(16, 24, 40, .08)', '--pri-sb': 'rgba(16, 24, 40, .13)',
  '--meter-bg': '#e8ecf2',
  '--ghost-hover': 'rgba(38, 48, 65, .07)', '--ghost-border': 'rgba(38, 48, 65, .2)',
  '--kbd-bg': 'rgba(0, 0, 0, .06)', '--kbd-border': 'rgba(0, 0, 0, .12)',
  '--muted-btn-text': 'rgba(43, 52, 70, .5)',
  '--modal-shadow': '0 1px 0 rgba(255,255,255,.8) inset, 0 18px 60px rgba(16,24,40,.18)'
}
const THEMES = [
  {
    id: 'deepblue', name: '深邃蓝', dark: true, vars: {
      '--bg': '#0d1117',
      '--accent': '#4f8cff', '--accent-dim': 'rgba(79,140,255,.16)', '--accent-hi': '#6ea3ff', '--accent-lo': '#2f66d9', '--on-accent': '#ffffff',
      '--pri-face-a': '#33405c', '--pri-face-b': '#232e47', '--pri-face-a-hover': '#3b4a6b', '--pri-face-b-hover': '#28355a',
      '--pri-edge': '#1c2436', '--pri-edge-active': '#141b2b',
      '--sec-face-a': '#ffffff', '--sec-face-b': '#eef1f6', '--sec-edge': '#d5dae4', '--sec-text': '#2b3446',
      '--bad': '#e5484d', '--warn': '#e2b53e', '--good': '#2dd4a7'
    }
  },
  {
    id: 'aurora', name: '极光之夜', dark: true, vars: {
      '--bg': '#0a0f13', '--panel': '#0e161b', '--card': '#121b21', '--card-2': '#0f181e',
      '--line': '#1f2d36', '--line-strong': '#2b3f4a',
      '--text': '#e2ecef', '--dim': '#8fa3ab', '--faint': '#5f7178',
      '--accent': '#2dd4bf', '--accent-dim': 'rgba(45,212,191,.15)', '--accent-hi': '#4fe3cf', '--accent-lo': '#17a08e', '--on-accent': '#04201c',
      '--pri-face-a': '#1f4347', '--pri-face-b': '#142c31', '--pri-face-a-hover': '#275256', '--pri-face-b-hover': '#193740',
      '--pri-edge': '#0e2226', '--pri-edge-active': '#0a1a1e',
      '--sec-face-a': '#ffffff', '--sec-face-b': '#eef4f3', '--sec-edge': '#d3e0de', '--sec-text': '#1c302d',
      '--good': '#2dd4bf'
    }
  },
  {
    id: 'maillard', name: '美拉德', dark: true, vars: {
      '--bg': '#151009', '--panel': '#1d1710', '--card': '#231b13', '--card-2': '#1d1710',
      '--line': '#3a2d1f', '--line-strong': '#4d3c2a',
      '--text': '#efe6db', '--dim': '#b3a18c', '--faint': '#85745f',
      '--accent': '#e0a35c', '--accent-dim': 'rgba(224,163,92,.16)', '--accent-hi': '#f0bc7d', '--accent-lo': '#c1802f', '--on-accent': '#211503',
      '--pri-face-a': '#4a3826', '--pri-face-b': '#33251a', '--pri-face-a-hover': '#5a4430', '--pri-face-b-hover': '#3d2d20',
      '--pri-edge': '#241a10', '--pri-edge-active': '#1a120a',
      '--sec-face-a': '#fffdf9', '--sec-face-b': '#f0e6dc', '--sec-edge': '#dccbb9', '--sec-text': '#3d2f27',
      '--warn': '#e0a35c'
    }
  },
  {
    id: 'dopamine', name: '多巴胺', dark: true, vars: {
      '--bg': '#120d17', '--panel': '#191124', '--card': '#1f1530', '--card-2': '#191124',
      '--line': '#33244b', '--line-strong': '#453062',
      '--text': '#eee6f7', '--dim': '#a892c4', '--faint': '#7a6a94',
      '--accent': '#ff4d8d', '--accent-dim': 'rgba(255,77,141,.16)', '--accent-hi': '#ff7bb0', '--accent-lo': '#e02565', '--on-accent': '#ffffff',
      '--pri-face-a': '#442a5e', '--pri-face-b': '#2e1d42', '--pri-face-a-hover': '#52356f', '--pri-face-b-hover': '#382350',
      '--pri-edge': '#221533', '--pri-edge-active': '#180f26'
    }
  },
  {
    id: 'mica', name: '云母白', dark: false, vars: {
      '--bg': '#f4f6f9',
      '--accent': '#2f6bff', '--accent-dim': 'rgba(47,107,255,.12)', '--accent-hi': '#5c8cff', '--accent-lo': '#1d4fd7', '--on-accent': '#ffffff',
      '--pri-face-a': '#ffffff', '--pri-face-b': '#eef1f6', '--pri-face-a-hover': '#ffffff', '--pri-face-b-hover': '#f7f9fb',
      '--pri-edge': '#d5dae4', '--pri-edge-active': '#c3cbd8',
      '--sec-face-a': '#ffffff', '--sec-face-b': '#eef1f6', '--sec-edge': '#d5dae4', '--sec-text': '#2b3446',
      '--bad': '#d93a3f'
    }
  },
  {
    id: 'mocha', name: '摩卡慕斯', dark: false, vars: {
      '--bg': '#f5efe9', '--panel': '#fffdf9', '--card': '#faf5ef', '--card-2': '#f0e8df',
      '--line': '#e4d8cb', '--line-strong': '#d0bfae',
      '--text': '#3d2f27', '--dim': '#7d6c5e', '--faint': '#a4937f',
      '--accent': '#a47864', '--accent-dim': 'rgba(164,120,100,.15)', '--accent-hi': '#c29b85', '--accent-lo': '#825c4a', '--on-accent': '#ffffff',
      '--pri-face-a': '#fffdf9', '--pri-face-b': '#f0e6dc', '--pri-face-a-hover': '#ffffff', '--pri-face-b-hover': '#f5ece3',
      '--pri-edge': '#d9c8b8', '--pri-edge-active': '#cbb8a6',
      '--sec-face-a': '#fffdf9', '--sec-face-b': '#f0e6dc', '--sec-edge': '#d9c8b8', '--sec-text': '#3d2f27'
    }
  },
  {
    id: 'morandi', name: '莫兰迪', dark: false, vars: {
      '--bg': '#f1f2f0', '--panel': '#fbfcfa', '--card': '#f6f7f4', '--card-2': '#eaede9',
      '--line': '#dde1da', '--line-strong': '#c4ccc2',
      '--text': '#333b36', '--dim': '#6d776e', '--faint': '#97a09a',
      '--accent': '#7d9184', '--accent-dim': 'rgba(125,145,132,.15)', '--accent-hi': '#9ab0a1', '--accent-lo': '#5f7266', '--on-accent': '#ffffff',
      '--pri-face-a': '#fbfcfa', '--pri-face-b': '#eaede9', '--pri-face-a-hover': '#ffffff', '--pri-face-b-hover': '#f0f2ee',
      '--pri-edge': '#c9d1c6', '--pri-edge-active': '#b9c2b8',
      '--sec-face-a': '#fbfcfa', '--sec-face-b': '#eaede9', '--sec-edge': '#c9d1c6', '--sec-text': '#333b36'
    }
  },
  {
    id: 'matcha', name: '抹茶', dark: false, vars: {
      '--bg': '#f2f5ea', '--panel': '#fbfdf4', '--card': '#f6f9ee', '--card-2': '#ecf2e2',
      '--line': '#dde6d2', '--line-strong': '#c6d4b6',
      '--text': '#2e3a2c', '--dim': '#6f7f68', '--faint': '#9aab92',
      '--accent': '#6f9e4f', '--accent-dim': 'rgba(111,158,79,.15)', '--accent-hi': '#93c274', '--accent-lo': '#55803a', '--on-accent': '#ffffff',
      '--pri-face-a': '#fbfdf4', '--pri-face-b': '#ecf2e2', '--pri-face-a-hover': '#ffffff', '--pri-face-b-hover': '#f1f6e8',
      '--pri-edge': '#cbd8bd', '--pri-edge-active': '#b9cab0',
      '--sec-face-a': '#fbfdf4', '--sec-face-b': '#ecf2e2', '--sec-edge': '#cbd8bd', '--sec-text': '#2e3a2c'
    }
  }
]
function applyTheme(id) {
  const t = THEMES.find(x => x.id === id) || THEMES[0]
  const base = t.dark ? BASE_DARK : BASE_LIGHT
  const root = document.documentElement.style
  Object.entries(base).forEach(([k, v]) => root.setProperty(k, v))
  Object.entries(t.vars).forEach(([k, v]) => root.setProperty(k, v))
  localStorage.setItem('moyu.theme', t.id)
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.id === t.id))
}

const state = {
  ws: null,
  myId: null,
  room: null,
  name: '',
  inRoom: false,
  muted: false,
  mode: localStorage.getItem('moyu.mode') || 'free', // free | ptt
  pttDown: false,
  localStream: null,
  testGain: null,
  audioCtx: null,
  localAnalyser: null,
  ice: null,
  peers: new Map(),
  devices: { mics: [], spks: [] },
  micDeviceId: localStorage.getItem('moyu.mic') || 'default',
  spkDeviceId: localStorage.getItem('moyu.spk') || 'default',
  ns: localStorage.getItem('moyu.ns') !== '0',
  aec: localStorage.getItem('moyu.aec') !== '0',
  agc: localStorage.getItem('moyu.agc') !== '0',
  masterVol: Number(localStorage.getItem('moyu.mvol') ?? 100) / 100,
  gateOn: localStorage.getItem('moyu.gate') !== '0',
  gateStrength: localStorage.getItem('moyu.gk') || 'mid',
  hpOn: localStorage.getItem('moyu.hp') !== '0',
  gateFloor: 0.015,
  gateGainVal: 1,
  gateNodes: null,
  chatOpen: false,
  unread: 0,
  pingTimer: null,
  reconAttempts: 0
}
let micTest = null

/* ---------- 工具 ---------- */
function log(...a) { console.log('[moyu]', ...a) }
function setStatus(text, cls) {
  const el = $('#status')
  el.textContent = text
  el.className = 'status' + (cls ? ' ' + cls : '')
}
function setNet(text, cls) {
  $('#netText').textContent = text
  $('#netDot').className = 'dot' + (cls ? ' ' + cls : '')
}
function send(o) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(o)) }

/* ---------- 提示音（WebAudio 合成） ---------- */
function tone(freqFrom, freqTo, dur, vol) {
  try {
    const ctx = ensureAudioCtx()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'sine'
    const t = ctx.currentTime
    o.frequency.setValueAtTime(freqFrom, t)
    o.frequency.exponentialRampToValueAtTime(freqTo, t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06)
    o.connect(g).connect(ctx.destination)
    o.start(t); o.stop(t + dur + 0.08)
  } catch {}
}
const sndJoin = () => tone(520, 780, 0.12, 0.05)
const sndLeave = () => tone(400, 290, 0.12, 0.05)
const sndMsg = () => tone(1150, 1150, 0.05, 0.04)

/* ---------- 麦克风 ---------- */
function audioConstraints(deviceId) {
  const c = { echoCancellation: state.aec, noiseSuppression: state.ns, autoGainControl: state.agc }
  if (deviceId && deviceId !== 'default') c.deviceId = { exact: deviceId }
  return { audio: c }
}
async function getMic() {
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints(state.micDeviceId))
  } catch (e) {
    log('麦克风不可用:', e.name, '→ 启用测试音源')
    $('#micLabel').textContent = '测试音源'
    return makeTestTone()
  }
}
function makeTestTone() {
  const ctx = ensureAudioCtx()
  const osc = ctx.createOscillator(), gain = ctx.createGain(), dst = ctx.createMediaStreamDestination()
  gain.gain.value = 0.04
  osc.frequency.value = 220
  osc.connect(gain).connect(dst)
  osc.start()
  state.testGain = gain
  return dst.stream
}
/* 发送链：原始麦克风流 → （可选）噪声门 → 发送流。
   噪声门只拦「底噪 × 强度」以下的电平：环境音不外传，正常说话不受影响 */
function setupSendChain() {
  const raw = state.localStream
  state.rawStream = raw
  if (state.gateNodes) {
    try { state.gateNodes.src.disconnect() } catch {}
    try { state.gateNodes.proc.disconnect() } catch {}
    try { state.gateNodes.hp && state.gateNodes.hp.disconnect() } catch {}
    state.gateNodes = null
  }
  if (!state.gateOn || state.testGain) {
    state.localStream = raw
    state.localAnalyser = attachAnalyser(raw)
    return
  }
  const ctx = ensureAudioCtx()
  const src = ctx.createMediaStreamSource(raw)
  const proc = ctx.createGain()
  const dest = ctx.createMediaStreamDestination()
  src.connect(proc); proc.connect(dest)
  const an = ctx.createAnalyser()
  an.fftSize = 512
  // 防呼吸低切：110Hz 高通滤掉呼吸/低频轰鸣；分析器接在门控之前避免自激
  if (state.hpOn) {
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 110
    hp.Q.value = 0.7
    src.connect(hp); hp.connect(proc); hp.connect(an)
    state.gateNodes = { src, proc, dest, hp }
  } else {
    src.connect(an)
    state.gateNodes = { src, proc, dest, hp: null }
  }
  state.gateFloor = 0.015
  state.gateGainVal = 1
  state.localStream = dest.stream
  state.localAnalyser = an
}
function gateTick() {
  if (!state.gateNodes || !state.localAnalyser) return
  const r = rms(state.localAnalyser)
  const f = state.gateFloor
  state.gateFloor = r < f ? f + (r - f) * 0.3 : f + (r - f) * 0.0025
  const K = { low: 2.0, mid: 2.8, high: 4.2 }[state.gateStrength] || 2.8
  const open = r > state.gateFloor * K
  const target = open ? 1 : 0
  state.gateGainVal += (target - state.gateGainVal) * 0.35
  state.gateNodes.proc.gain.value = state.gateGainVal
}
function ensureAudioCtx() {
  if (!state.audioCtx || state.audioCtx.state === 'closed') state.audioCtx = new AudioContext()
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {})
  return state.audioCtx
}
function attachAnalyser(stream) {
  try {
    const ctx = ensureAudioCtx()
    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser()
    an.fftSize = 512
    src.connect(an)
    return an
  } catch { return null }
}
function rms(an) {
  if (!an) return 0
  const buf = new Uint8Array(an.fftSize)
  an.getByteTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
  return Math.sqrt(sum / buf.length)
}

/* ---------- 麦克风模式 ---------- */
function applyMuteState() {
  const track = state.localStream && state.localStream.getAudioTracks()[0]
  if (!track) return
  if (state.mode === 'ptt') track.enabled = state.pttDown && !state.muted
  else track.enabled = !state.muted
  if (state.testGain) state.testGain.gain.value = (state.mode === 'ptt' ? (state.pttDown && !state.muted) : !state.muted) ? 0.04 : 0
}
function setMode(mode) {
  state.mode = mode
  localStorage.setItem('moyu.mode', mode)
  $('#modeFree').classList.toggle('active', mode === 'free')
  $('#modePtt').classList.toggle('active', mode === 'ptt')
  $('#pttHint').classList.toggle('hidden', mode !== 'ptt')
  state.muted = false
  state.pttDown = false
  refreshMicUI()
  applyMuteState()
  send({ t: 'state', muted: false })
}
function refreshMicUI() {
  const btn = $('#muteBtn')
  if (state.mode === 'ptt') {
    $('#micLabel').textContent = state.muted ? '已静音' : (state.pttDown ? '说话中…' : '按住说话')
    $('#micIcon').textContent = state.muted ? '🔇' : '🎙️'
    btn.classList.toggle('ptt-live', state.pttDown && !state.muted)
    btn.classList.toggle('muted', state.muted)
  } else {
    $('#micLabel').textContent = state.muted ? '已静音' : '麦克风开'
    $('#micIcon').textContent = state.muted ? '🔇' : '🎙️'
    btn.classList.toggle('ptt-live', false)
    btn.classList.toggle('muted', state.muted)
  }
}

/* ---------- 设备 / 音频增强 ---------- */
async function refreshDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    state.devices.mics = list.filter(d => d.kind === 'audioinput')
    state.devices.spks = list.filter(d => d.kind === 'audiooutput')
    const micSel = $('#micSel'), spkSel = $('#spkSel')
    micSel.innerHTML = ''
    state.devices.mics.forEach((d, i) => {
      const o = document.createElement('option')
      o.value = d.deviceId
      o.textContent = d.label || ('麦克风 ' + (i + 1))
      if (d.deviceId === state.micDeviceId) o.selected = true
      micSel.appendChild(o)
    })
    spkSel.innerHTML = ''
    state.devices.spks.forEach((d, i) => {
      const o = document.createElement('option')
      o.value = d.deviceId
      o.textContent = d.label || ('扬声器 ' + (i + 1))
      if (d.deviceId === state.spkDeviceId) o.selected = true
      spkSel.appendChild(o)
    })
  } catch (e) { log('枚举设备失败', e) }
}
async function switchMic(deviceId) {
  state.micDeviceId = deviceId
  localStorage.setItem('moyu.mic', deviceId)
  if (micTest) stopMicTest()
  if (state.inRoom && state.localStream) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId))
      const old = state.localStream.getAudioTracks()[0]
      if (state.gateNodes) {
        // 换麦克风 = 重建整条发送链（门控接在新流上）
        const oldProcessed = state.localStream.getAudioTracks()[0]
        state.localStream = s
        setupSendChain()
        const newTrack = state.localStream.getAudioTracks()[0]
        state.peers.forEach(p => {
          p.pc.getSenders().forEach(sender => { if (sender.kind === 'audio' && sender.track) sender.replaceTrack(newTrack).catch(() => {}) })
        })
        try { oldProcessed.stop() } catch {}
      } else {
        const newTrack = s.getAudioTracks()[0]
        state.peers.forEach(p => {
          p.pc.getSenders().forEach(sender => { if (sender.kind === 'audio' && sender.track) sender.replaceTrack(newTrack).catch(() => {}) })
        })
        state.localStream.removeTrack(old)
        try { old.stop() } catch {}
        state.localStream.addTrack(newTrack)
        state.localAnalyser = attachAnalyser(state.localStream)
      }
      applyMuteState()
    } catch (e) { log('切换麦克风失败', e) }
  }
  if ($('#micPop') && $('#micPop').open) startMicTest()
}
function switchSpeaker(deviceId) {
  state.spkDeviceId = deviceId
  localStorage.setItem('moyu.spk', deviceId)
  state.peers.forEach(p => { if (p.audio && p.audio.setSinkId) p.audio.setSinkId(deviceId).catch(() => {}) })
}
function applyVolumes() {
  state.peers.forEach(p => { if (p.audio) p.audio.volume = p.volume * state.masterVol })
}

/* ---------- 麦克风测试（房间内直接读当前麦电平，不二次开麦避免电流音） ---------- */
function toggleMicTest() {
  micTest ? stopMicTest() : startMicTest()
}
function startMicTest() {
  stopMicTest()
  const begin = (stream, own) => {
    micTest = { stream: own ? stream : null, own, an: own ? attachAnalyser(stream) : state.localAnalyser, raf: 0, audio: null }
    $('#micTestBtn').textContent = '停止测试'
    $('#micTestMeter').classList.remove('hidden')
    if ($('#monitorToggle').checked) {
      const src = own ? stream : state.rawStream
      if (src) {
        const a = new Audio()
        a.srcObject = src
        a.volume = 0.4
        a.play().catch(() => {})
        micTest.audio = a
      }
    }
    const loop = () => {
      if (!micTest) return
      $('#micTestMeter').querySelector('i').style.width = Math.min(100, rms(micTest.an) * 260) + '%'
      micTest.raf = requestAnimationFrame(loop)
    }
    loop()
  }
  if (state.inRoom && state.localStream) {
    begin(null, false)
  } else {
    navigator.mediaDevices.getUserMedia(audioConstraints(state.micDeviceId))
      .then(s => begin(s, true))
      .catch(e => setStatus('麦克风测试失败：' + e.name, 'bad'))
  }
}
function stopMicTest() {
  if (!micTest) return
  cancelAnimationFrame(micTest.raf)
  if (micTest.own) micTest.stream.getTracks().forEach(t => t.stop())
  if (micTest.audio) { try { micTest.audio.pause(); micTest.audio.srcObject = null } catch {} micTest.audio = null }
  micTest = null
  $('#micTestBtn').textContent = '开始测试'
  $('#micTestMeter').querySelector('i').style.width = '0%'
  $('#micTestMeter').classList.add('hidden')
}

/* ---------- 房间 UI ---------- */
function avatarOf(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?' }
function addCard(id, name, isSelf) {
  const el = document.createElement('div')
  el.className = 'member'
  el.id = 'card-' + id
  el.innerHTML = `
    <div class="m-avatar"></div>
    <div class="m-name"></div>
    <div class="m-sub">${isSelf ? '我' : '连接中…'}</div>
    <div class="m-meter"><i></i></div>
    <div class="m-vol"><span class="vol-ico">🔈</span><input type="range" min="0" max="100" value="100" title="调节音量" /><button class="m-mute" title="单独静音">🔊</button></div>`
  el.querySelector('.m-avatar').textContent = avatarOf(name)
  el.querySelector('.m-name').textContent = name + (isSelf ? '（我）' : '')
  if (!isSelf) {
    el.querySelector('.m-vol input').addEventListener('input', e => {
      const p = state.peers.get(id)
      if (p) { p.volume = e.target.value / 100; if (p.audio) p.audio.volume = p.locMuted ? 0 : p.volume * state.masterVol }
    })
    el.querySelector('.m-mute').addEventListener('click', e => {
      const p = state.peers.get(id)
      if (!p) return
      p.locMuted = !p.locMuted
      e.currentTarget.textContent = p.locMuted ? '🔇' : '🔊'
      e.currentTarget.classList.toggle('on', p.locMuted)
      if (p.audio) p.audio.volume = p.locMuted ? 0 : p.volume * state.masterVol
    })
  } else {
    el.querySelector('.m-vol').style.display = 'none'
  }
  $('#members').appendChild(el)
  updateMemberCount()
}
function updateMemberCount() {
  const el = $('#memberCount')
  if (el && state.inRoom) el.textContent = '👥 ' + (state.peers.size + 1)
}
function cardOf(id) { return document.getElementById('card-' + id) }
function removeCard(id) { cardOf(id)?.remove(); updateMemberCount() }
function setPeerSub(id, text) { const c = cardOf(id); if (c) c.querySelector('.m-sub').textContent = text }
function setPeerMuted(id, muted) {
  const p = state.peers.get(id)
  if (p) p.muted = muted
  const c = cardOf(id)
  if (c) c.querySelector('.m-sub').textContent = muted ? '🔇 已静音' : (p && p.online ? '✅ 声音正常' : '连接中…')
}

/* ---------- ICE 配置 ---------- */
async function loadIceConfig() {
  if (state.ice) return state.ice
  let serverIce = null
  try {
    // 桌面端：主进程代取（绕开 file:// 跨域限制）；网页端：同源直取
    if (window.moyu && window.moyu.getIceConfig) {
      const j = await window.moyu.getIceConfig(normalizeServer($('#server').value))
      if (j && Array.isArray(j.iceServers) && j.iceServers.length) serverIce = j
    }
    if (!serverIce && location.protocol.startsWith('http')) {
      const r = await fetch(location.origin + '/ice', { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const j = await r.json()
        if (j && Array.isArray(j.iceServers) && j.iceServers.length) serverIce = j
      }
    }
  } catch (e) { log('ICE 配置拉取失败，使用本地列表', e) }

  // 关键：服务器配置与本地 STUN 合并而非覆盖。
  // 国内 UDP 3478 常被拦，只有部分 STUN（如小米）可用；若被服务器列表整体覆盖，
  // 会拿不到 srflx 候选 → 只能退化走 TURN 中继 → 延迟飙到 400ms+
  const list = []
  const seen = new Set()
  const push = s => {
    const key = JSON.stringify(s.urls) + (s.username || '')
    if (seen.has(key)) return
    seen.add(key)
    list.push(s)
  }
  DOMESTIC_STUN.forEach(push)
  if (serverIce) serverIce.iceServers.forEach(push)
  else FALLBACK_ICE.iceServers.forEach(push)
  state.ice = { iceServers: list }
  log('ICE 配置:', list.length, '组（国内 STUN + 服务器 TURN）')
  return state.ice
}

/* ---------- 信令 ---------- */
function normalizeServer(url) {
  url = (url || '').trim()
  if (!url) return defaultServer()
  if (!/^wss?:\/\//.test(url)) url = 'ws://' + url
  return url
}
function connect() {
  if (state.ws) {
    state.ws.onclose = null
    state.ws.onmessage = null
    try { state.ws.close() } catch {}
    state.ws = null
  }
  if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null }
  const url = normalizeServer($('#server').value)
  localStorage.setItem('moyu.server', url)
  setNet('连接服务器…', '')
  let opened = false
  const target = new URL(url)
  if (target.pathname === '/' || target.pathname === '') target.pathname = '/ws'
  target.searchParams.set('room', state.room)
  const ws = new WebSocket(target.toString())
  state.ws = ws
  ws.onopen = () => {
    opened = true
    state.reconAttempts = 0
    log('SIGNALING_OPEN')
    setNet('进入房间 ' + state.room + '…', '')
    ws.send(JSON.stringify({ t: 'join', room: state.room, name: state.name }))
    state.pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping' }))
    }, 25000)
  }
  ws.onmessage = e => { try { handleMsg(JSON.parse(e.data)) } catch (err) { log('坏消息', err) } }
  ws.onclose = () => {
    if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null }
    if (!state.inRoom) return
    state.reconAttempts++
    let delay = Math.min(15000, 2000 * state.reconAttempts)
    const cur = normalizeServer($('#server').value)
    // 自定义服务器连续 3 次连不上：自动切回云端默认节点
    if (state.reconAttempts === 3 && cur !== DEFAULT_WSS) {
      localStorage.setItem('moyu.server', DEFAULT_WSS)
      $('#server').value = DEFAULT_WSS
      setNet('与服务器断开', 'bad')
      setStatus('自定义服务器连不上，已自动切回默认节点…', 'bad')
      delay = 1500
    } else {
      setNet('与服务器断开', 'bad')
      setStatus(`连接断开，${Math.round(delay / 1000)} 秒后自动重连（第 ${state.reconAttempts} 次）…`, 'bad')
    }
    setTimeout(() => { if (state.inRoom && state.ws === ws) { teardownPeers(); connect() } }, delay)
  }
  ws.onerror = () => {
    if (!opened) setStatus('连不上服务器 ' + url + ' ，请检查服务器设置', 'bad')
  }
}

function handleMsg(m) {
  switch (m.t) {
    case 'pong':
      break
    case 'welcome':
      state.myId = m.id
      log('WELCOME', m.id, '房间现有', m.peers.length, '人')
      m.peers.forEach(p => createPC(p.id, p.name, true, p.muted))
      setNet('已进房 ' + state.room, 'good')
      break
    case 'peer-join':
      log('PEER_JOIN', m.id, m.name)
      addCard(m.id, m.name, false)
      sndJoin()
      break
    case 'peer-leave':
      log('PEER_LEAVE', m.id)
      state.peers.get(m.id)?.pc?.close()
      state.peers.get(m.id)?.audio?.remove()
      state.peers.delete(m.id)
      removeCard(m.id)
      sndLeave()
      break
    case 'relay':
      onRelay(m.from, m.data).catch(e => log('relay 处理失败', e))
      break
    case 'peer-state':
      setPeerMuted(m.id, m.muted)
      break
    case 'msg':
      if (m.from !== state.myId) {
        appendChat(m.name, m.text, false)
        sndMsg()
        if (!state.chatOpen) {
          state.unread++
          const b = $('#chatBadge')
          b.textContent = state.unread > 9 ? '9+' : state.unread
          b.classList.remove('hidden')
        }
      }
      break
    case 'img':
      if (m.from !== state.myId) {
        // sid = 内置贴图 id（龙图/摸鱼都在 manifest 里），data = 自定义图片 data URI
        let src = m.data || ''
        if (m.sid) {
          const f = LONG_STICKERS.find(s => s.id === m.sid)
          src = f ? stickerUrl(f.file) : ''
        }
        if (src) appendImg(m.name, src, false)
        sndMsg()
        if (!state.chatOpen) {
          state.unread++
          const b = $('#chatBadge')
          b.textContent = state.unread > 9 ? '9+' : state.unread
          b.classList.remove('hidden')
        }
      }
      break
    case 'err':
      setStatus('房间错误：' + m.msg, 'bad')
      setNet('进房失败', 'bad')
      break
  }
}

/* ---------- WebRTC ---------- */
async function onRelay(from, data) {
  if (data.sdp) {
    let p = state.peers.get(from)
    if (data.sdp.type === 'offer') {
      if (!p) p = createPC(from, '?', false, false)
      await p.pc.setRemoteDescription(data.sdp)
      const answer = await p.pc.createAnswer()
      await p.pc.setLocalDescription(answer)
      send({ t: 'relay', to: from, data: { sdp: p.pc.localDescription } })
      log('ANSWER →', from)
    } else if (data.sdp.type === 'answer' && p) {
      await p.pc.setRemoteDescription(data.sdp)
      log('ANSWER ←', from)
    }
  } else if (data.ice) {
    const p = state.peers.get(from)
    if (p && p.pc.signalingState !== 'closed') {
      try { await p.pc.addIceCandidate(data.ice) } catch (e) { log('ice 失败', e) }
    }
  }
}

function createPC(id, name, initiator, muted) {
  const old = state.peers.get(id)
  if (old) { try { old.pc.close() } catch {} old.audio?.remove() }
  const pc = new RTCPeerConnection(state.ice || FALLBACK_ICE)
  const sl = cardOf(id)?.querySelector('.m-vol input')
  const p = { id, name, pc, stream: new MediaStream(), audio: null, analyser: null, muted: !!muted, online: false, volume: sl ? sl.value / 100 : 1 }
  state.peers.set(id, p)

  state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream))

  pc.ontrack = e => {
    e.streams[0].getTracks().forEach(t => {
      if (!p.stream.getTracks().find(x => x.id === t.id)) p.stream.addTrack(t)
    })
    if (!p.audio) {
      p.audio = new Audio()
      p.audio.srcObject = p.stream
      p.audio.autoplay = true
      p.audio.volume = p.volume * state.masterVol
      if (state.spkDeviceId !== 'default' && p.audio.setSinkId) p.audio.setSinkId(state.spkDeviceId).catch(() => {})
      p.audio.play().catch(err => log('播放失败', err))
      p.analyser = attachAnalyser(p.stream)
    }
  }
  pc.onicecandidate = e => {
    if (e.candidate) send({ t: 'relay', to: id, data: { ice: e.candidate.toJSON() } })
  }
  pc.onconnectionstatechange = () => {
    log(id, 'connectionState =', pc.connectionState)
    if (pc.connectionState === 'connected') {
      p.online = true
      console.log('PEER_CONNECTED', id)
      if (!p.muted) setPeerSub(id, '✅ 声音正常')
    } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      p.online = false
      setPeerSub(id, '连接断开')
    }
  }

  if (!cardOf(id)) addCard(id, name, false)
  setPeerMuted(id, p.muted)

  if (initiator) offerTo(p)
  return p
}
async function offerTo(p) {
  const offer = await p.pc.createOffer()
  await p.pc.setLocalDescription(offer)
  send({ t: 'relay', to: p.id, data: { sdp: p.pc.localDescription } })
  log('OFFER →', p.id)
}

function teardownPeers() {
  state.peers.forEach(p => { try { p.pc.close() } catch {}; p.audio?.remove() })
  state.peers.clear()
  $('#members').innerHTML = ''
  updateMemberCount()
}

/* ---------- RTT 连接质量 ---------- */
setInterval(async () => {
  if (!state.inRoom || state.peers.size === 0) return
  let worst = 0
  for (const p of state.peers.values()) {
    if (!p.pc) continue
    try {
      const stats = await p.pc.getStats()
      stats.forEach(r => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null)
          worst = Math.max(worst, r.currentRoundTripTime * 1000)
      })
    } catch {}
  }
  if (worst > 0) {
    const cls = worst < 80 ? 'good' : worst < 160 ? 'warn' : 'bad'
    setNet(Math.round(worst) + ' ms', cls)
  }
}, 3000)

/* ---------- 文字消息 ---------- */
/* ---------- 说话人配色：同一个人始终同色 ---------- */
const NAME_COLORS = ['#4f8cff', '#2dd4a7', '#ff8f4f', '#c084fc', '#ff6b8a', '#fbbf24', '#38bdf8', '#a3e635']
function colorOf(name) {
  if (!name) return NAME_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

/* ---------- 气泡样式（借鉴 QQ 的思路，保持克制） ---------- */
const BUBBLES = [
  { id: 'soft', name: '柔和圆角' },
  { id: 'point', name: 'QQ 尖角' },
  { id: 'outline', name: '描边' },
  { id: 'card', name: '卡片' }
]
function bubbleStyle() { return localStorage.getItem('moyu.bubble') || 'soft' }
function applyBubbleStyle(id) {
  localStorage.setItem('moyu.bubble', id)
  document.body.dataset.bubble = id
}
function appendChat(name, text, self) {
  const log = $('#chatLog')
  log.querySelector('.chat-empty')?.remove()
  const div = document.createElement('div')
  div.className = 'chat-msg ' + (self ? 'self' : 'other')
  if (!self) div.style.setProperty('--cm-color', colorOf(name))
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0')
  div.innerHTML = `<div class="cm-head"><span class="cm-name"></span><span class="cm-time"></span></div><div class="cm-bubble"><span class="cm-text"></span></div>`
  div.querySelector('.cm-name').textContent = self ? '我' : name
  div.querySelector('.cm-time').textContent = hh + ':' + mm
  div.querySelector('.cm-text').textContent = text
  log.appendChild(div)
  log.scrollTop = log.scrollHeight
}
function sendChat() {
  const input = $('#chatInput')
  const text = (input.value || '').trim()
  if (!text || !state.inRoom) return
  appendChat(state.name, text, true)
  send({ t: 'msg', text })
  input.value = ''
}
function toggleChat(open) {
  state.chatOpen = open === undefined ? !state.chatOpen : open
  const p = $('#chatPanel')
  p.classList.toggle('open', state.chatOpen)
  if (state.chatOpen) {
    state.unread = 0
    $('#chatBadge').classList.add('hidden')
    if (!p.style.width) p.style.width = localStorage.getItem('moyu.chatw') || '300px'
    $('#chatInput').focus()
  } else {
    $('#pickerPanel').classList.add('hidden')
  }
}

/* ---------- 表情 / 贴图 / 图片消息 ---------- */
const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😜','🤪','😎',
  '🤔','😐','😑','🙄','😲','😱','😭','🥺','😡','🤬',
  '😳','🥵','🥶','🤡','💀','💩','👍','👎','👏','🙏',
  '💪','🤝','✌️','🤙','🐟','🎉','🔥','💯','❓','❗',
  '💤','🎮','🏆','🍺','🀄','🎲'
]
// 内置摸鱼贴图：SVG 静态资源（stickers/fish/*.svg），随 manifest 一起加载。
// 用静态文件而非 Blob/data URI：Chromium 不渲染 <img src="data:image/svg+xml">，
// 而 Blob URL 是本机地址无法跨端传递；静态资源两端都能直接引用。
let FISH_STICKERS = []
function fishUri(id) {
  const st = LONG_STICKERS.find(s => s.id === id)
  return st ? stickerUrl(st.file) : ''
}
// 熊猫头龙图清单（script 注入，file:// 下 fetch 会被拦）
let LONG_STICKERS = []
// 调试用：暴露状态，便于排查链路质量
window.__moyuState = state
window.__moyuPeerStats = async () => {
  const out = []
  for (const p of state.peers.values()) {
    if (!p.pc) continue
    const rows = []
    const report = await p.pc.getStats()
    report.forEach(r => {
      if (r.type === 'candidate-pair') {
        rows.push({ kind: 'pair', state: r.state, nominated: r.nominated, bytesSent: r.bytesSent, rtt: r.currentRoundTripTime, localId: r.localCandidateId, remoteId: r.remoteCandidateId })
      } else if (r.type === 'local-candidate') {
        rows.push({ kind: 'local', id: r.id, type: r.candidateType, proto: r.protocol })
      } else if (r.type === 'remote-candidate') {
        rows.push({ kind: 'remote', id: r.id, type: r.candidateType, proto: r.protocol })
      }
    })
    out.push({ peer: p.id, rows })
  }
  return out
}
async function loadLongStickers() {
  if (window.MOYU_STICKERS && window.MOYU_STICKERS.length) {
    LONG_STICKERS = window.MOYU_STICKERS
    FISH_STICKERS = LONG_STICKERS.filter(s => s.kind === 'fish')
    return
  }
  try {
    const r = await fetch('stickers/manifest.json', { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      LONG_STICKERS = await r.json()
      FISH_STICKERS = LONG_STICKERS.filter(s => s.kind === 'fish')
    }
  } catch (e) { log('龙图清单加载失败', e) }
}
function appendImg(name, data, self, sid) {
  const log = $('#chatLog')
  log.querySelector('.chat-empty')?.remove()
  const div = document.createElement('div')
  div.className = 'chat-msg ' + (self ? 'self' : 'other')
  if (!self) div.style.setProperty('--cm-color', colorOf(name))
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0')
  div.innerHTML = `<div class="cm-head"><span class="cm-name"></span><span class="cm-time"></span></div><div class="cm-bubble"><img class="cm-img" alt="贴图" /></div>`
  div.querySelector('.cm-name').textContent = self ? '我' : name
  div.querySelector('.cm-time').textContent = hh + ':' + mm
  div.querySelector('img').src = data
  log.appendChild(div)
  log.scrollTop = log.scrollHeight
}
function sendSticker(def) {
  if (!state.inRoom) return
  const uri = fishUri(def.id)
  if (!uri) return
  appendImg(state.name, uri, true)
  send({ t: 'img', sid: def.id })
}// 贴图资源路径：网页版同源，桌面端 file:// 用相对路径
function stickerUrl(file) {
  return 'stickers/' + file
}
function sendLongSticker(st) {
  if (!state.inRoom) return
  const url = stickerUrl(st.file)
  appendImg(state.name, url, true)
  send({ t: 'img', sid: st.id })
}
function sendImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return
  const img = new Image()
  img.onload = () => {
    const max = 320
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const data = c.toDataURL('image/jpeg', 0.82)
    if (data.length > 260000) { setStatus('图片太大，发送失败', 'bad'); return }
    appendImg(state.name, data, true)
    send({ t: 'img', data })
  }
  img.src = URL.createObjectURL(file)
}
function renderPickers() {
  const eg = $('#emojiGrid')
  eg.innerHTML = ''
  EMOJIS.forEach(em => {
    const b = document.createElement('button')
    b.textContent = em
    b.addEventListener('click', () => {
      const input = $('#chatInput')
      input.value += em
      input.focus()
    })
    eg.appendChild(b)
  })
  // 摸鱼贴图（内置 SVG，用 Blob URL 渲染）
  const fg = $('#fishGrid')
  fg.innerHTML = ''
  FISH_STICKERS.forEach(d => {
    const b = document.createElement('button')
    b.title = d.name || d.id
    b.innerHTML = `<img src="${fishUri(d.id)}" alt="${d.id}" />`
    b.addEventListener('click', () => { sendSticker(d); $('#pickerPanel').classList.add('hidden') })
    fg.appendChild(b)
  })
  // 熊猫头龙图（按 ID 发送）
  const sg = $('#stickerGrid')
  sg.innerHTML = ''
  LONG_STICKERS.forEach(s => {
    const b = document.createElement('button')
    b.title = s.name
    b.innerHTML = `<img src="stickers/${s.file}" alt="${s.name}" loading="lazy" />`
    b.addEventListener('click', () => { sendLongSticker(s); $('#pickerPanel').classList.add('hidden') })
    sg.appendChild(b)
  })
}
function togglePicker() {
  const p = $('#pickerPanel')
  p.classList.toggle('hidden')
  if (!p.classList.contains('hidden')) {
    showPickerTab('emoji')
  }
}
function showPickerTab(which) {
  $('#emojiGrid').classList.toggle('hidden', which !== 'emoji')
  $('#stickerGrid').classList.toggle('hidden', which !== 'sticker')
  $('#fishGrid').classList.toggle('hidden', which !== 'fish')
  $('#tabEmoji').classList.toggle('active', which === 'emoji')
  $('#tabSticker').classList.toggle('active', which === 'sticker')
  $('#tabFish').classList.toggle('active', which === 'fish')
}

/* ---------- 音量动画（含噪声门节拍） ---------- */
function levelLoop() {
  gateTick()
  const myCard = document.getElementById('card-self')
  if (myCard) {
    const active = state.mode === 'ptt' ? (state.pttDown && !state.muted) : !state.muted
    const r = active ? rms(state.localAnalyser) : 0
    myCard.querySelector('.m-meter i').style.width = Math.min(100, r * 260) + '%'
    myCard.classList.toggle('speaking', r > 0.06)
  }
  state.peers.forEach(p => {
    const c = cardOf(p.id)
    if (!c) return
    const r = p.muted ? 0 : rms(p.analyser)
    c.querySelector('.m-meter i').style.width = Math.min(100, r * 260) + '%'
    c.classList.toggle('speaking', r > 0.06)
  })
  requestAnimationFrame(levelLoop)
}

/* ---------- 最近房间（可删除） ---------- */
function rememberRoom(room) {
  let list = []
  try { list = JSON.parse(localStorage.getItem('moyu.recent') || '[]') } catch {}
  list = list.filter(r => r.room !== room)
  list.unshift({ room, ts: Date.now() })
  localStorage.setItem('moyu.recent', JSON.stringify(list.slice(0, 6)))
}
function removeRecent(room) {
  let list = []
  try { list = JSON.parse(localStorage.getItem('moyu.recent') || '[]') } catch {}
  list = list.filter(r => r.room !== room)
  localStorage.setItem('moyu.recent', JSON.stringify(list))
  renderRecent()
}
function renderRecent() {
  let list = []
  try { list = JSON.parse(localStorage.getItem('moyu.recent') || '[]') } catch {}
  if (!list.length) { $('#recentWrap').classList.add('hidden'); return }
  $('#recentWrap').classList.remove('hidden')
  const wrap = $('#recentChips')
  wrap.innerHTML = ''
  list.slice(0, 4).forEach(r => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    const join = document.createElement('b')
    join.textContent = r.room
    join.title = '点击进入 ' + r.room
    join.addEventListener('click', () => { $('#roomCode').value = r.room; $('#joinBtn').click() })
    const x = document.createElement('i')
    x.className = 'chip-x'
    x.textContent = '✕'
    x.title = '删除记录'
    x.addEventListener('click', () => removeRecent(r.room))
    chip.appendChild(join)
    chip.appendChild(x)
    wrap.appendChild(chip)
  })
}

/* ---------- 设置面板 ---------- */
function openSettings() {
  refreshDevices()
  renderThemeGrid()
  renderBubbleGrid()
  setupUpdateUI()
  $('#masterVol').value = Math.round(state.masterVol * 100)
  $('#masterVolVal').textContent = Math.round(state.masterVol * 100) + '%'
  $('#nsToggle').checked = state.ns
  $('#aecToggle').checked = state.aec
  $('#agcToggle').checked = state.agc
  $('#gateToggle').checked = state.gateOn
  $('#hpToggle').checked = state.hpOn
  $('#gateStrengthSel').value = state.gateStrength
  $('#settingsModal').classList.remove('hidden')
}
function closeSettings() {
  stopMicTest()
  $('#settingsModal').classList.add('hidden')
}
function renderThemeGrid() {
  const grid = $('#themeGrid')
  grid.innerHTML = ''
  const cur = localStorage.getItem('moyu.theme') || 'deepblue'
  THEMES.forEach(t => {
    const card = document.createElement('button')
    card.className = 'theme-card' + (t.id === cur ? ' active' : '')
    card.dataset.id = t.id
    const bar = t.vars['--accent'] || '#4f8cff'
    const bg = t.vars['--bg'] || '#0d1117'
    const panel = t.vars['--panel'] || '#151a22'
    card.innerHTML = `
      <span class="tc-preview" style="background:${bg}">
        <i class="tc-bar" style="background:${panel}"></i>
        <i class="tc-chip" style="background:${bar}"></i>
        <i class="tc-dot" style="background:${bar}"></i>
      </span>
      <span class="tc-name">${t.name}</span>`
    card.addEventListener('click', () => applyTheme(t.id))
    grid.appendChild(card)
  })
}
function renderBubbleGrid() {
  const grid = $('#bubbleGrid')
  grid.innerHTML = ''
  const cur = bubbleStyle()
  BUBBLES.forEach(b => {
    const card = document.createElement('button')
    card.className = 'bubble-card' + (b.id === cur ? ' active' : '')
    card.innerHTML = `<span class="bubble-demo"><i class="bd-${b.id}"></i></span><span>${b.name}</span>`
    card.addEventListener('click', () => { applyBubbleStyle(b.id); renderBubbleGrid() })
    grid.appendChild(card)
  })
}

/* ---------- 检查更新（GitHub Releases，无需 git / 无需代理） ---------- */
async function doCheckUpdate() {
  const btn = $('#checkBtn')
  const hint = $('#updateHint')
  const log = $('#updateLog')
  btn.disabled = true
  btn.textContent = '检查中…'
  log.classList.remove('hidden')
  const put = (txt, cls) => {
    const d = document.createElement('div')
    if (cls) d.className = cls
    d.textContent = txt
    log.appendChild(d)
    log.scrollTop = log.scrollHeight
  }
  log.innerHTML = ''
  try {
    if (!window.moyuUpdate || !window.moyuUpdate.check) {
      put('网页版不支持直接更新，请到 GitHub 下载：', 'err')
      put('github.com/frankshare/moyu-squad/releases/latest', '')
    } else {
      put('正在查询 GitHub Releases…')
      const r = await window.moyuUpdate.check()
      if (!r.ok) {
        put('查询失败：' + (r.msg || '未知错误'), 'err')
        hint.textContent = '查询失败'
      } else if (!r.hasUpdate) {
        put('✅ 已是最新版本（v' + r.latest + '）', 'ok')
        hint.textContent = '当前已是最新版本'
      } else {
        put('发现新版本：v' + r.latest + '（当前 v' + r.current + '）', 'ok')
        if (r.notes) { put(''); put('更新内容：'); put(r.notes) }
        const sizeMB = r.size ? (r.size / 1048576).toFixed(1) + ' MB' : ''
        put('点击下方按钮直接下载并安装' + (sizeMB ? '（' + sizeMB + '）' : ''))
        const dl = document.createElement('button')
        dl.className = 'btn btn-primary btn-sm'
        dl.style.marginTop = '8px'
        dl.textContent = '⬇ 下载并安装 v' + r.latest
        dl.addEventListener('click', async () => {
          dl.disabled = true
          dl.textContent = '下载中…'
          try {
            const res = await window.moyuUpdate.download(r.url)
            if (res.ok) {
              dl.textContent = '✅ 已下载，正在启动安装程序'
              put('')
              put('安装包已保存：' + res.path, 'ok')
              put('安装程序已启动，安装完成后重新打开即可。', 'ok')
            } else {
              dl.textContent = '下载失败，重试'
              dl.disabled = false
              put(res.msg || '下载失败', 'err')
            }
          } catch (e) {
            dl.textContent = '下载失败，重试'
            dl.disabled = false
            put('下载出错：' + e.message, 'err')
          }
        })
        log.appendChild(dl)
        hint.textContent = '有新版 v' + r.latest + ' 可下载'
      }
    }
  } catch (e) {
    put('出错：' + e.message, 'err')
  }
  btn.disabled = false
  btn.textContent = '检查更新'
}

/* ---------- 按运行环境调整更新按钮 ---------- */
async function setupUpdateUI() {
  // 安装版没有 .git，git pull 注定失败 → 只留「检查更新」
  let isRepo = false
  try {
    if (window.moyuUpdate && window.moyuUpdate.env) {
      const e = await window.moyuUpdate.env()
      isRepo = !!e.isRepo
    }
  } catch {}
  const gitBtn = $('#updateBtn')
  if (!isRepo) {
    gitBtn.classList.add('hidden')
    $('#updateHint').textContent = '点击「检查更新」下载新版安装包'
  } else {
    $('#updateHint').textContent = '源码模式：可原地拉取更新'
  }
}
async function doUpdate() {
  const btn = $('#updateBtn')
  const log = $('#updateLog')
  const hint = $('#updateHint')
  btn.disabled = true
  btn.textContent = '更新中…'
  log.classList.remove('hidden')
  log.innerHTML = ''
  const put = (txt, cls) => {
    const d = document.createElement('div')
    if (cls) d.className = cls
    d.textContent = txt
    log.appendChild(d)
    log.scrollTop = log.scrollHeight
  }
  try {
    if (!window.moyuUpdate) {
      put('当前是网页版，无法直接拉取代码', 'err')
      put('请到 GitHub 仓库下载最新版：github.com/frankshare/moyu-squad', '')
    } else {
      put('正在从 GitHub 拉取最新代码…')
      const r = await window.moyuUpdate.update()
      ;(r.log || '').split('\n').forEach(l => put(l, /error|fatal|失败/i.test(l) ? 'err' : /already up|已是最新|up to date/i.test(l) ? 'ok' : ''))
      if (r.ok && r.changed) {
        put('')
        put('✅ 更新完成，正在重启应用…', 'ok')
        hint.textContent = '已更新到最新版本'
        setTimeout(() => window.moyuUpdate.restart(), 1200)
      } else if (r.ok) {
        put('✅ 已是最新版本', 'ok')
        hint.textContent = '当前已是最新版本'
      } else if (r.needsInstaller) {
        // 安装版没有源码目录，不是错误，是正常情况
        put('')
        put('ℹ️ 请下载新版安装包覆盖安装（不会丢设置）', 'ok')
        hint.textContent = '安装版请到 GitHub 下载新版'
      } else {
        put('更新失败，请检查网络或仓库地址', 'err')
        hint.textContent = '更新失败'
      }
    }
  } catch (e) {
    put('出错：' + e.message, 'err')
  }
  btn.disabled = false
  btn.textContent = '拉取更新'
}

/* ---------- 进入 / 离开 ---------- */
async function joinRoom() {
  const name = ($('#name').value || '').trim() || ('摸鱼' + Math.floor(Math.random() * 90 + 10))
  const room = ($('#roomCode').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') ||
    Math.random().toString(36).slice(2, 7).toUpperCase()
  state.name = name
  state.room = room
  localStorage.setItem('moyu.name', name)
  setStatus('正在获取麦克风…')
  state.localStream = await getMic()
  setupSendChain()
  await loadIceConfig()

  state.inRoom = true
  $('#join').classList.add('hidden')
  $('#roomScreen').classList.remove('hidden')
  $('#pickerPanel').classList.add('hidden')
  $('#roomTitle').textContent = room
  $('#members').innerHTML = ''
  addCard('self', name, true)
  rememberRoom(room)
  setMode(state.mode)
  refreshDevices()
  levelLoop()
  connect()
}
function leaveRoom() {
  state.inRoom = false
  teardownPeers()
  stopMicTest()
  try { state.ws?.close() } catch {}
  state.localStream?.getTracks().forEach(t => t.stop())
  if (state.testGain) state.testGain.gain.value = 0
  if (state.gateNodes) { try { state.gateNodes.src.disconnect() } catch {}; try { state.gateNodes.proc.disconnect() } catch {}; state.gateNodes = null }
  $('#chatLog').innerHTML = '<div class="chat-empty">消息仅存在于当前房间</div>'
  $('#pickerPanel').classList.add('hidden')
  $('#chatPanel').classList.remove('open')
  $('#audioPop').open = false
  $('#roomScreen').classList.add('hidden')
  $('#join').classList.remove('hidden')
  setStatus('已离开房间')
  renderRecent()
}

/* ---------- PTT 键盘 ---------- */
document.addEventListener('keydown', e => {
  if (!state.inRoom || state.mode !== 'ptt' || e.code !== 'Space') return
  const tag = (document.activeElement && document.activeElement.tagName) || ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  e.preventDefault()
  if (e.repeat || state.pttDown) return
  state.pttDown = true
  applyMuteState()
  refreshMicUI()
})
document.addEventListener('keyup', e => {
  if (e.code !== 'Space' || !state.pttDown) return
  state.pttDown = false
  applyMuteState()
  refreshMicUI()
})

/* ---------- 事件绑定 ---------- */
$('#joinBtn').addEventListener('click', joinRoom)
$('#roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom() })
$('#name').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom() })
$('#leaveBtn').addEventListener('click', leaveRoom)

$('#muteBtn').addEventListener('click', () => {
  if (state.mode === 'ptt') { state.muted = !state.muted; applyMuteState(); refreshMicUI(); send({ t: 'state', muted: state.muted }); return }
  state.muted = !state.muted
  applyMuteState()
  refreshMicUI()
  send({ t: 'state', muted: state.muted })
})
$('#modeFree').addEventListener('click', () => setMode('free'))
$('#modePtt').addEventListener('click', () => setMode('ptt'))

$('#copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.room); $('#copyBtn').textContent = '已复制 ✓' }
  catch { $('#copyBtn').textContent = state.room }
  setTimeout(() => { $('#copyBtn').textContent = '复制邀请码' }, 1500)
})

$('#chatBtn').addEventListener('click', () => toggleChat())
$('#chatSend').addEventListener('click', sendChat)
$('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat() })

$('#emojiBtn').addEventListener('click', togglePicker)
$('#tabEmoji').addEventListener('click', () => showPickerTab('emoji'))
$('#tabSticker').addEventListener('click', () => showPickerTab('sticker'))
$('#tabFish').addEventListener('click', () => showPickerTab('fish'))
$('#chatLog').addEventListener('dragover', e => { e.preventDefault(); $('#chatLog').classList.add('dragover') })
$('#chatLog').addEventListener('dragleave', () => $('#chatLog').classList.remove('dragover'))
$('#chatLog').addEventListener('drop', e => { e.preventDefault(); $('#chatLog').classList.remove('dragover'); [...e.dataTransfer.files].forEach(sendImageFile) })
$('#chatInput').addEventListener('paste', e => { [...(e.clipboardData?.files || [])].forEach(sendImageFile) })

$('#gateToggle').addEventListener('change', e => {
  state.gateOn = e.target.checked
  localStorage.setItem('moyu.gate', state.gateOn ? '1' : '0')
  if (state.inRoom && state.localStream) setupSendChain()
})
$('#gateStrengthSel').addEventListener('change', e => {
  state.gateStrength = e.target.value
  localStorage.setItem('moyu.gk', state.gateStrength)
})
$('#hpToggle').addEventListener('change', e => {
  state.hpOn = e.target.checked
  localStorage.setItem('moyu.hp', state.hpOn ? '1' : '0')
  if (state.inRoom && state.localStream) setupSendChain()
})
$('#masterVol').addEventListener('input', e => {
  state.masterVol = e.target.value / 100
  localStorage.setItem('moyu.mvol', e.target.value)
  $('#masterVolVal').textContent = e.target.value + '%'
  applyVolumes()
})

$('#settingsBtn').addEventListener('click', openSettings)
$('#themeBtnJoin').addEventListener('click', openSettings)
$('#settingsClose').addEventListener('click', closeSettings)
$('#settingsDone').addEventListener('click', closeSettings)
$('#settingsModal').addEventListener('click', e => { if (e.target === $('#settingsModal')) closeSettings() })
$('#updateBtn').addEventListener('click', doUpdate)
$('#checkBtn').addEventListener('click', doCheckUpdate)

$('#micTestBtn').addEventListener('click', toggleMicTest)
$('#monitorToggle').addEventListener('change', e => {
  if (!micTest) return
  if (e.target.checked && !micTest.audio) {
    const src = micTest.own ? micTest.stream : state.rawStream
    if (!src) return
    const a = new Audio()
    a.srcObject = src
    a.volume = 0.4
    a.play().catch(() => {})
    micTest.audio = a
  } else if (!e.target.checked && micTest.audio) {
    // 关键：pause 真正停掉回放（remove() 对不在 DOM 的元素无效）
    try { micTest.audio.pause(); micTest.audio.srcObject = null } catch {}
    micTest.audio = null
  }
})
$('#nsToggle').addEventListener('change', e => { state.ns = e.target.checked; localStorage.setItem('moyu.ns', state.ns ? '1' : '0'); if (state.inRoom) switchMic(state.micDeviceId) })
$('#aecToggle').addEventListener('change', e => { state.aec = e.target.checked; localStorage.setItem('moyu.aec', state.aec ? '1' : '0'); if (state.inRoom) switchMic(state.micDeviceId) })
$('#agcToggle').addEventListener('change', e => { state.agc = e.target.checked; localStorage.setItem('moyu.agc', state.agc ? '1' : '0'); if (state.inRoom) switchMic(state.micDeviceId) })

$('#micSel').addEventListener('change', e => switchMic(e.target.value))
$('#spkSel').addEventListener('change', e => switchSpeaker(e.target.value))

$('#server').value = defaultServer()
$('#name').value = localStorage.getItem('moyu.name') || ''
applyTheme(localStorage.getItem('moyu.theme') || 'deepblue')
applyBubbleStyle(bubbleStyle())
setMode(state.mode)
renderRecent()
loadLongStickers().then(renderPickers)

// 桌面端：标题栏窗口控制
if (window.moyuWin) {
  document.body.classList.add('desktop')
  $('#titlebar').classList.remove('hidden')
  $('#tbMin').addEventListener('click', () => window.moyuWin.minimize())
  $('#tbMax').addEventListener('click', () => window.moyuWin.maximizeToggle())
  $('#tbClose').addEventListener('click', () => window.moyuWin.close())
}

// 聊天面板宽度拖拽（最小 280，最大半屏；window 级监听；拖拽期间禁用宽度过渡实现跟手）
{
  const panel = $('#chatPanel')
  const h = panel.querySelector('.chat-resize')
  let drag = null
  const maxW = () => Math.round(window.innerWidth * 0.5)
  h.addEventListener('pointerdown', e => {
    e.preventDefault()
    drag = { sx: e.clientX, sw: panel.getBoundingClientRect().width }
    panel.classList.add('dragging')
  })
  window.addEventListener('pointermove', e => {
    if (!drag) return
    const w = Math.min(Math.max(drag.sw + (drag.sx - e.clientX), 280), maxW())
    panel.style.width = w + 'px'
  })
  window.addEventListener('pointerup', () => {
    if (!drag) return
    drag = null
    panel.classList.remove('dragging')
    localStorage.setItem('moyu.chatw', panel.style.width)
  })
  const savedW = parseInt(localStorage.getItem('moyu.chatw'), 10)
  if (savedW) panel.style.width = Math.min(savedW, maxW()) + 'px'
}

// 贴图悬停预览（气泡跟随鼠标）
function initHoverPreview() {
  const box = $('#hoverPreview')
  const img = box.querySelector('img')
  const nm = box.querySelector('.hp-name')
  let cur = null
  const show = (src, name, x, y) => {
    img.src = src
    nm.textContent = name || ''
    box.classList.remove('hidden')
    const r = box.getBoundingClientRect()
    let left = x + 16, top = y + 16
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 16
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 16
    box.style.left = Math.max(8, left) + 'px'
    box.style.top = Math.max(8, top) + 'px'
    cur = src
  }
  const hide = () => { box.classList.add('hidden'); cur = null }
  document.addEventListener('mouseover', e => {
    const btn = e.target.closest && e.target.closest('#stickerGrid button, #fishGrid button')
    if (!btn) return
    const imgEl = btn.querySelector('img')
    if (!imgEl) return
    show(imgEl.getAttribute('src'), btn.title || '', e.clientX, e.clientY)
  })
  document.addEventListener('mousemove', e => {
    if (!cur) return
    const r = box.getBoundingClientRect()
    let left = e.clientX + 16, top = e.clientY + 16
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 16
    if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 16
    box.style.left = Math.max(8, left) + 'px'
    box.style.top = Math.max(8, top) + 'px'
  })
  document.addEventListener('mouseout', e => {
    const btn = e.target.closest && e.target.closest('#stickerGrid button, #fishGrid button')
    if (btn) hide()
  })
  document.addEventListener('click', hide, true)
}
initHoverPreview()

/* ---------- 点击外部自动收起面板 ---------- */
// 需求：表情面板 / 麦克风测试弹层 / 设置面板，点开后随意点别处就收起
{
  const layers = [
    { get el() { return $('#pickerPanel') }, isOpen: () => !$('#pickerPanel').classList.contains('hidden'), close: () => $('#pickerPanel').classList.add('hidden') },
    { get el() { return $('#audioPop') }, isOpen: () => $('#audioPop').open, close: () => { $('#audioPop').open = false } },
    { get el() { return $('#settingsModal') }, isOpen: () => !$('#settingsModal').classList.contains('hidden'), close: () => closeSettings() }
  ]
  const TRIGGERS = '#emojiBtn, #audioPop > summary, #settingsBtn, #themeBtnJoin'
  // capture 阶段监听：设置面板的全屏遮罩会吞掉冒泡事件，capture 才能先收到
  document.addEventListener('mousedown', e => {
    const t = e.target
    // 点在触发按钮上时不收起（否则点开即关）
    if (t.closest && t.closest(TRIGGERS)) return
    // 点在设置面板遮罩上（面板之外）→ 关闭设置
    if (t.id === 'settingsModal') { closeSettings(); return }
    // 点在某个已打开面板内部时不收起
    for (const l of layers) {
      if (!l.isOpen()) continue
      const el = l.el
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return
    }
    layers.forEach(l => { if (l.isOpen()) l.close() })
  }, true)
  // ESC 也能关
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') layers.forEach(l => { if (l.isOpen()) l.close() })
  })
}

// 自动进房（供测试/邀请链接用）
{
  const q = new URLSearchParams(location.search)
  if (q.get('room')) {
    $('#roomCode').value = q.get('room')
    if (q.get('name')) $('#name').value = q.get('name')
    joinRoom()
  }
}
