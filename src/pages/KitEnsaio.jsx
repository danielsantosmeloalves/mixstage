import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

const KIT_TIPOS = [
  { key: 'geral', label: 'Geral' },
  { key: 'guitarras', label: 'Guitarras' },
  { key: 'soprano', label: 'Soprano' },
  { key: 'teclados', label: 'Teclados' },
  { key: 'tenor', label: 'Tenor' },
  { key: 'baixo', label: 'Baixo' },
  { key: 'bateria', label: 'Bateria' },
  { key: 'contralto', label: 'Contralto' },
]

async function pitchShiftOffline(buffer, semitons) {
  if (!semitons) return buffer
  try {
    const rate = Math.pow(2, semitons / 12)
    const sr = buffer.sampleRate
    const ch = buffer.numberOfChannels

    const len1 = Math.max(1, Math.round(buffer.length / rate))
    const ctx1 = new OfflineAudioContext(ch, len1, sr)
    const src1 = ctx1.createBufferSource()
    src1.buffer = buffer
    src1.playbackRate.value = rate
    src1.connect(ctx1.destination)
    src1.start(0)
    const buf1 = await ctx1.startRendering()

    const len2 = buffer.length
    const ctx2 = new OfflineAudioContext(ch, len2, sr)
    const src2 = ctx2.createBufferSource()
    src2.buffer = buf1
    src2.playbackRate.value = buf1.duration / buffer.duration
    src2.connect(ctx2.destination)
    src2.start(0)
    return await ctx2.startRendering()
  } catch(e) {
    console.error('pitchShift erro:', e)
    return buffer
  }
}

export default function KitEnsaio({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [kitDisponivel, setKitDisponivel] = useState({})
  const [tipoSelecionado, setTipoSelecionado] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [volume, setVolume] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [pitchAplicado, setPitchAplicado] = useState(0)
  const [processando, setProcessando] = useState(false)
  const [progressoProc, setProgressoProc] = useState(0)
  const [tfSalvo, setTfSalvo] = useState(null)
  const [salvandoTf, setSalvandoTf] = useState(false)
  const [tfMsg, setTfMsg] = useState('')
  const [erro, setErro] = useState('')

  const ctxRef = useRef(null)
  const masterRef = useRef(null)
  const gainRef = useRef(null)
  const bufOriginalRef = useRef(null)
  const bufProcessadoRef = useRef(null)
  const sourceRef = useRef(null)
  const audioElRef = useRef(null)
  const heartbeatRef = useRef(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)
  const playingRef = useRef(false)
  const pitchRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: k } = await supabase.from('kit_ensaio').select('*').eq('musica_id', id)
      setMusica(m)
      const mapa = {}
      if (k) k.forEach(item => { mapa[item.tipo] = item })
      setKitDisponivel(mapa)

      if (session?.user?.id) {
        const { data: tf } = await supabase.from('tons_favoritos').select('tom')
          .eq('user_id', session.user.id).eq('musica_id', id).single()
        if (tf) {
          setTfSalvo(tf.tom); setPitch(tf.tom)
          pitchRef.current = tf.tom; setPitchAplicado(tf.tom)
        }
      }
      setCarregando(false)
    }
    carregar()
    return () => {
      pararTudo()
      pararHeartbeat()
    }
  }, [id])

  // --- Áudio silencioso ---
  function criarAudioSilencioso() {
    if (audioElRef.current) return audioElRef.current
    const sr = 44100, dataSize = sr * 2
    const buf = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buf)
    const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
    ws(0,'RIFF'); view.setUint32(4, 36+dataSize, true); ws(8,'WAVE'); ws(12,'fmt ')
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true)
    view.setUint32(24,sr,true); view.setUint32(28,sr*2,true)
    view.setUint16(32,2,true); view.setUint16(34,16,true)
    ws(36,'data'); view.setUint32(40,dataSize,true)
    const el = document.createElement('audio')
    el.src = URL.createObjectURL(new Blob([buf], { type:'audio/wav' }))
    el.loop = true; el.volume = 0.001
    document.body.appendChild(el)
    audioElRef.current = el
    return el
  }

  // --- Heartbeat: toca buffer silencioso a cada 25s para manter contexto vivo ---
  function iniciarHeartbeat() {
    pararHeartbeat()
    heartbeatRef.current = setInterval(() => {
      const ctx = ctxRef.current
      if (!ctx || ctx.state !== 'running') return
      try {
        const buf = ctx.createBuffer(1, 1, ctx.sampleRate)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start(0)
      } catch(e) {}
    }, 25000)
  }

  function pararHeartbeat() {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }

  // --- Detector de estado do contexto ---
  function monitorarCtx(ctx) {
    ctx.onstatechange = () => {
      if (ctx.state === 'suspended' && playingRef.current) {
        // Tenta resumir automaticamente
        ctx.resume().catch(() => {})
      }
    }
  }

  // --- Cria AudioContext com todas as proteções ---
  async function criarCtx() {
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      if (ctxRef.current.state === 'suspended') await ctxRef.current.resume()
      return ctxRef.current
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx
    masterRef.current = ctx.createGain()
    masterRef.current.connect(ctx.destination)
    gainRef.current = ctx.createGain()
    gainRef.current.gain.value = volume
    gainRef.current.connect(masterRef.current)

    // Toque silencioso imediato
    const silencio = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = silencio; src.connect(ctx.destination); src.start(0)

    monitorarCtx(ctx)
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }

  function pararTudo() {
    try { sourceRef.current?.stop() } catch(e) {}
    sourceRef.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  async function handleCarregar() {
    if (!tipoSelecionado || !kitDisponivel[tipoSelecionado]) return
    setPrecarregando(true); setErro('')

    // Inicia áudio silencioso — dentro do gesto do usuário
    const audioEl = criarAudioSilencioso()
    try { await audioEl.play() } catch(e) {}

    // Cria contexto — dentro do gesto do usuário
    const ctx = await criarCtx()
    iniciarHeartbeat()

    try {
      const res = await fetch(kitDisponivel[tipoSelecionado].url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const arrayBuf = await res.arrayBuffer()
      const decoded = await ctx.decodeAudioData(arrayBuf)
      bufOriginalRef.current = decoded

      if (pitchRef.current !== 0) {
        setProcessando(true); setProgressoProc(0)
        bufProcessadoRef.current = await pitchShiftOffline(decoded, pitchRef.current)
        setProgressoProc(100); setProcessando(false)
      } else {
        bufProcessadoRef.current = decoded
      }

      maxDurRef.current = bufProcessadoRef.current.duration
      setTempos({ atual: 0, total: maxDurRef.current })
      setupMediaSession()
      setPronto(true)
    } catch(e) {
      setErro('Erro ao carregar. Verifique sua conexão.')
    }
    setPrecarregando(false)
  }

  function iniciarSource(offset) {
    const ctx = ctxRef.current
    if (!ctx || ctx.state === 'closed') return
    pararTudo()
    const buf = bufProcessadoRef.current
    if (!buf) return
    try {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gainRef.current)
      src.start(0, Math.min(Math.max(0, offset), buf.duration - 0.01))
      sourceRef.current = src
      startedAtRef.current = ctx.currentTime - offset
    } catch(e) { console.error('iniciarSource erro:', e) }
  }

  // Inicia source com playbackRate temporário (som imediato antes do processamento)
  function iniciarSourceTemporaria(offset, semitons) {
    const ctx = ctxRef.current
    if (!ctx || ctx.state === 'closed') return
    pararTudo()
    const buf = bufOriginalRef.current
    if (!buf) return
    try {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = Math.pow(2, semitons / 12)
      src.connect(gainRef.current)
      src.start(0, Math.min(Math.max(0, offset), buf.duration - 0.01))
      sourceRef.current = src
      startedAtRef.current = ctx.currentTime - (offset * Math.pow(2, semitons / 12))
    } catch(e) {}
  }

  function iniciarTick() {
    const tick = () => {
      const ctx = ctxRef.current
      if (!ctx) return
      const elapsed = ctx.currentTime - startedAtRef.current
      setTempos({ atual: Math.max(0, elapsed), total: maxDurRef.current })
      if (elapsed < maxDurRef.current + 0.5) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        playingRef.current = false; setPlaying(false)
        offsetRef.current = 0
        setTempos({ atual: 0, total: maxDurRef.current })
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
      }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }

  async function togglePlay() {
    const ctx = ctxRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()

    if (playingRef.current) {
      offsetRef.current = ctx.currentTime - startedAtRef.current
      pararTudo(); playingRef.current = false; setPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    } else {
      iniciarSource(offsetRef.current)
      playingRef.current = true; setPlaying(true); iniciarTick()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }
  }

  function seek(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const pct = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1))
    const newOffset = pct * maxDurRef.current
    offsetRef.current = newOffset
    setTempos(t => ({ ...t, atual: newOffset }))
    if (playingRef.current && ctxRef.current) {
      iniciarSource(newOffset)
      startedAtRef.current = ctxRef.current.currentTime - newOffset
    }
  }

  function changeVolume(val) {
    const v = parseFloat(val)
    setVolume(v)
    if (gainRef.current && ctxRef.current) {
      gainRef.current.gain.setTargetAtTime(v, ctxRef.current.currentTime, 0.02)
    }
  }

  async function aplicarPitch() {
    if (pitch === pitchAplicado || processando || !bufOriginalRef.current) return

    const ctx = ctxRef.current
    if (!ctx) return

    // 1. Resume AQUI — dentro do gesto do usuário
    if (ctx.state === 'suspended') await ctx.resume()

    const wasPlaying = playingRef.current

    // 2. Salva offset AGORA antes de qualquer mudança
    const offsetSalvo = wasPlaying
      ? ctx.currentTime - startedAtRef.current
      : offsetRef.current
    offsetRef.current = offsetSalvo

    // 3. Para source atual e inicia source temporária para manter iOS ativo
    pararTudo()
    if (wasPlaying) {
      // Source temporária com playbackRate — som imediato
      const buf = bufOriginalRef.current
      try {
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = Math.pow(2, pitch / 12)
        src.connect(gainRef.current)
        src.start(0, Math.min(Math.max(0, offsetSalvo), buf.duration - 0.01))
        sourceRef.current = src
        // Não atualiza startedAtRef — usamos offsetSalvo fixo para a source final
      } catch(e) {}
    }

    // 4. Processa offline
    setProcessando(true); setProgressoProc(0)
    const novoBuffer = await pitchShiftOffline(bufOriginalRef.current, pitch)
    bufProcessadoRef.current = novoBuffer
    maxDurRef.current = novoBuffer.duration
    setTempos(t => ({ ...t, total: novoBuffer.duration }))
    setPitchAplicado(pitch)
    pitchRef.current = pitch
    setProgressoProc(100)
    setProcessando(false)

    // 5. Para source temporária e inicia source final no offset correto
    if (ctx.state === 'suspended') await ctx.resume()
    const safeOffset = Math.min(Math.max(0, offsetSalvo), novoBuffer.duration - 0.1)
    iniciarSource(safeOffset)
    startedAtRef.current = ctx.currentTime - safeOffset

    if (wasPlaying) {
      playingRef.current = true; setPlaying(true); iniciarTick()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: musica?.titulo || 'MixStage',
      artist: musica?.artista || '',
      album: `Kit Ensaio — ${tipoSelecionado}`,
    })
    navigator.mediaSession.setActionHandler('play', () => { if (!playingRef.current) togglePlay() })
    navigator.mediaSession.setActionHandler('pause', () => { if (playingRef.current) togglePlay() })
    navigator.mediaSession.setActionHandler('seekto', d => {
      if (d.seekTime !== undefined) {
        offsetRef.current = d.seekTime
        setTempos(t => ({ ...t, atual: d.seekTime }))
        if (playingRef.current && ctxRef.current) {
          iniciarSource(d.seekTime)
          startedAtRef.current = ctxRef.current.currentTime - d.seekTime
        }
      }
    })
  }

  async function salvarTf() {
    if (!session?.user?.id) return
    setSalvandoTf(true); setTfMsg('')
    const { error } = await supabase.from('tons_favoritos').upsert({
      user_id: session.user.id, musica_id: id, tom: pitchAplicado,
    }, { onConflict: 'user_id,musica_id' })
    if (!error) { setTfSalvo(pitchAplicado); setTfMsg('TF salvo!'); setTimeout(() => setTfMsg(''), 2000) }
    setSalvandoTf(false)
  }

  function fmt(s) {
    if (!s || isNaN(s) || s < 0) return '0:00'
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`
  }

  const tomOriginal = musica?.tom || null
  const tomAtual = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitch) : null
  const tomAplicadoDisplay = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitchAplicado) : null
  const tfDisplay = tomOriginal && tfSalvo !== null ? calcularTom(tomOriginal.split('/')[0], tfSalvo) : null
  const pitchMudou = pitch !== pitchAplicado
  const tiposDisponiveis = KIT_TIPOS.filter(t => kitDisponivel[t.key])

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => { pararTudo(); pararHeartbeat(); navigate(`/escolha/${id}`) }} style={{ background:'none', color:'var(--text2)', fontSize:20, padding:'0 8px 0 0', border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{musica?.titulo}</div>
            {tomOriginal && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'2px 7px' }}>{tomOriginal}</span>}
            {tfDisplay !== null && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(60,255,143,0.12)', color:'var(--success)', border:'1px solid rgba(60,255,143,0.25)', borderRadius:4, padding:'2px 7px' }}>TF: {tfDisplay}</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>Kit Ensaio{tipoSelecionado && pronto ? ` — ${KIT_TIPOS.find(t=>t.key===tipoSelecionado)?.label}` : ''}</div>
        </div>
      </div>

      <div style={{ maxWidth:600, margin:'0 auto', padding:'24px 16px' }}>

        {/* Seleção do tipo */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'32px 24px' }}>
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🎼</div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, marginBottom:6 }}>Kit Ensaio</div>
              <div style={{ fontSize:13, color:'var(--text2)' }}>Escolha uma trilha para carregar</div>
            </div>

            {tiposDisponiveis.length === 0 ? (
              <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13 }}>Nenhuma trilha do Kit Ensaio cadastrada para esta música.</div>
            ) : (
              <>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
                  {tiposDisponiveis.map((tipo, i) => {
                    const sel = tipoSelecionado === tipo.key
                    const cores = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']
                    return (
                      <div key={tipo.key}
                        onClick={() => setTipoSelecionado(tipo.key)}
                        style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderRadius:'var(--radius)', background: sel ? 'rgba(232,255,60,0.08)' : 'var(--bg3)', border:`1px solid ${sel ? 'rgba(232,255,60,0.3)' : 'var(--border)'}`, cursor:'pointer', transition:'all 0.15s' }}>
                        <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, background: sel ? 'var(--accent)' : 'var(--bg2)', border:`2px solid ${sel ? 'var(--accent)' : 'var(--border2)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {sel && <div style={{ width:8, height:8, borderRadius:'50%', background:'#000' }} />}
                        </div>
                        <div style={{ width:3, height:20, borderRadius:1, background:cores[KIT_TIPOS.findIndex(t=>t.key===tipo.key)%8], flexShrink:0 }} />
                        <div style={{ fontSize:14, fontFamily:'var(--font-display)', fontWeight:600, color: sel ? 'var(--text)' : 'var(--text2)' }}>{tipo.label}</div>
                      </div>
                    )
                  })}
                </div>

                {erro && <div style={{ color:'var(--danger)', fontSize:13, marginBottom:16, padding:10, background:'rgba(255,68,68,0.1)', borderRadius:'var(--radius)' }}>{erro}</div>}
                <button onClick={handleCarregar} disabled={!tipoSelecionado} style={{ width:'100%', padding:'16px 0', borderRadius:'var(--radius)', background: tipoSelecionado ? 'var(--accent)' : 'var(--bg3)', color: tipoSelecionado ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:3, border:'none', cursor: tipoSelecionado ? 'pointer' : 'not-allowed' }}>
                  ▶ CARREGAR {tipoSelecionado ? `(${KIT_TIPOS.find(t=>t.key===tipoSelecionado)?.label})` : ''}
                </button>
              </>
            )}
          </div>
        )}

        {/* Carregando */}
        {precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'48px 24px', textAlign:'center' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:16 }}>
              {processando ? 'Aplicando tom favorito...' : `Carregando ${KIT_TIPOS.find(t=>t.key===tipoSelecionado)?.label}...`}
            </div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden', maxWidth:200, margin:'0 auto' }}>
              <div style={{ height:'100%', background:'var(--accent)', borderRadius:3, width: processando ? `${progressoProc}%` : '60%', transition:'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Player */}
        {pronto && (
          <div className="fade-in" style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'20px 20px' }}>

              {/* Play + barra */}
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
                <button onClick={togglePlay} disabled={processando} style={{ width:56, height:56, borderRadius:'50%', background: playing ? 'var(--accent)' : 'var(--bg3)', color: playing ? '#000' : 'var(--text)', fontSize:22, flexShrink:0, border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', cursor: processando ? 'not-allowed' : 'pointer', opacity: processando ? 0.5 : 1 }}>
                  {playing ? '⏸' : '▶'}
                </button>
                <div style={{ flex:1 }}>
                  <div onClick={seek} onTouchEnd={seek} style={{ height:6, background:'var(--bg3)', borderRadius:3, cursor:'pointer', marginBottom:8 }}>
                    <div style={{ height:'100%', borderRadius:3, background:'var(--accent)', width:`${tempos.total ? Math.min((tempos.atual/tempos.total)*100,100) : 0}%`, transition:'width 0.1s linear', pointerEvents:'none' }} />
                  </div>
                  <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', textAlign:'right' }}>{fmt(tempos.atual)} / {fmt(tempos.total)}</div>
                </div>
              </div>

              {/* Volume */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, padding:'10px 14px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Vol</div>
                <input type="range" min="0" max="1.5" step="0.01" value={volume} onChange={e => changeVolume(e.target.value)} style={{ flex:1 }} />
                <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', minWidth:36, textAlign:'right' }}>{Math.round(volume*100)}%</div>
              </div>

              {/* Pitch */}
              <div style={{ padding:'14px 16px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                  <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Tom</div>
                  <button onClick={() => setPitch(p => Math.max(-6, p-1))} disabled={pitch<=-6||processando} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitch<=-6 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitch<=-6||processando ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>−</button>
                  <input type="range" min="-6" max="6" step="1" value={pitch} onChange={e => setPitch(parseInt(e.target.value))} disabled={processando} style={{ flex:1 }} />
                  <button onClick={() => setPitch(p => Math.min(6, p+1))} disabled={pitch>=6||processando} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitch>=6 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitch>=6||processando ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>+</button>
                  <div style={{ flexShrink:0, textAlign:'center', minWidth:80 }}>
                    {tomAplicadoDisplay ? (
                      <div>
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:18, color: pitchAplicado===0 ? 'var(--text)' : 'var(--accent)', lineHeight:1 }}>{tomAplicadoDisplay}</div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>{pitchAplicado===0 ? 'original' : `${pitchAplicado>0?'+':''}${pitchAplicado} st`}</div>
                      </div>
                    ) : (
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:14, color: pitchAplicado===0 ? 'var(--text2)' : 'var(--accent)' }}>{pitchAplicado>0?'+':''}{pitchAplicado} st</div>
                    )}
                  </div>
                </div>

                {processando && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, color:'var(--text2)', marginBottom:6 }}>Processando pitch shift real...</div>
                    <div style={{ height:4, background:'var(--bg2)', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${progressoProc}%`, transition:'width 0.3s' }} />
                    </div>
                  </div>
                )}

                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {!processando && pitchMudou && (
                    <>
                      <button onClick={aplicarPitch} style={{ flex:1, padding:'9px 0', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, letterSpacing:2, border:'none', cursor:'pointer' }}>
                        ✓ APLICAR {tomAtual ? `(${tomAtual})` : `(${pitch>0?'+':''}${pitch} st)`}
                      </button>
                      <button onClick={() => setPitch(pitchAplicado)} style={{ padding:'9px 14px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:12, border:'1px solid var(--border)', cursor:'pointer' }}>cancelar</button>
                    </>
                  )}
                  {!processando && !pitchMudou && pitchAplicado !== 0 && (
                    <button onClick={() => setPitch(0)} style={{ padding:'6px 12px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:11, border:'1px solid var(--border)', cursor:'pointer' }}>↺ reset</button>
                  )}
                  <div style={{ flex:1 }} />
                  <button onClick={salvarTf} disabled={salvandoTf || pitchMudou} style={{ padding:'6px 14px', borderRadius:'var(--radius)', background: tfSalvo === pitchAplicado ? 'rgba(60,255,143,0.15)' : 'var(--bg2)', color: tfSalvo === pitchAplicado ? 'var(--success)' : 'var(--text2)', fontSize:11, border:`1px solid ${tfSalvo === pitchAplicado ? 'rgba(60,255,143,0.3)' : 'var(--border)'}`, cursor: salvandoTf || pitchMudou ? 'not-allowed' : 'pointer', letterSpacing:1, fontWeight:600, opacity: pitchMudou ? 0.4 : 1 }}>
                    {salvandoTf ? '...' : tfMsg || (tfSalvo === pitchAplicado ? '★ TF salvo' : '☆ Salvar TF')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
