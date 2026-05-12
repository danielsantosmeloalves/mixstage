import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

export default function Mixer({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [trilhaAtual, setTrilhaAtual] = useState(0)
  const [selecionadas, setSelecionadas] = useState(new Set())
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [erro, setErro] = useState('')
  const [pitch, setPitch] = useState(0)
  const [tfSalvo, setTfSalvo] = useState(null)
  const [salvandoTf, setSalvandoTf] = useState(false)
  const [tfMsg, setTfMsg] = useState('')

  const ctxRef = useRef(null)
  const masterRef = useRef(null)
  const audioBuffersRef = useRef([])
  const sourcesRef = useRef([])
  const gainNodesRef = useRef([])
  const trilhasRef = useRef([])
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)
  const prontoRef = useRef(false)
  const playingRef = useRef(false)
  const pitchRef = useRef(0)
  const audioElRef = useRef(null)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: t } = await supabase.from('trilhas').select('*').eq('musica_id', id).order('ordem')

      if (session?.user?.id) {
        const { data: tf } = await supabase
          .from('tons_favoritos')
          .select('tom')
          .eq('user_id', session.user.id)
          .eq('musica_id', id)
          .single()
        if (tf) {
          setTfSalvo(tf.tom)
          setPitch(tf.tom)
          pitchRef.current = tf.tom
        }
      }

      setMusica(m)
      const lista = (t || []).map(tr => ({ ...tr, vol: 1, muted: false, soloed: false }))
      setTrilhas(lista)
      trilhasRef.current = lista
      setSelecionadas(new Set(lista.map((_, i) => i)))
      setCarregando(false)
    }
    carregar()
    return () => pararTudo()
  }, [id])

  function pararTudo() {
    sourcesRef.current.forEach(s => { try { s?.stop() } catch(e){} })
    sourcesRef.current = []
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  // Gera WAV silencioso de 1s e cria elemento <audio> que mantém sessão iOS ativa
  function criarAudioSilencioso() {
    if (audioElRef.current) return audioElRef.current

    // Gera WAV PCM silencioso de 1 segundo via código
    const sr = 44100, ch = 1, bits = 16
    const numSamples = sr
    const dataSize = numSamples * ch * (bits / 8)
    const buf = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buf)
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true)
    writeStr(8, 'WAVE'); writeStr(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true)
    view.setUint16(22, ch, true); view.setUint32(24, sr, true)
    view.setUint32(28, sr * ch * bits / 8, true)
    view.setUint16(32, ch * bits / 8, true); view.setUint16(34, bits, true)
    writeStr(36, 'data'); view.setUint32(40, dataSize, true)
    // Dados já são zero (silêncio)

    const blob = new Blob([buf], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)

    const el = document.createElement('audio')
    el.src = url
    el.loop = true
    el.volume = 0.001
    document.body.appendChild(el)
    audioElRef.current = el
    return el
  }

  // Cria AudioContext e faz toque silencioso para iOS não suspender
  async function criarCtxComToqueSilencioso() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx

    // Toque silencioso de 0.001s — "acorda" o iOS e mantém o contexto ativo
    const silencio = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = silencio
    src.connect(ctx.destination)
    src.start(0)

    masterRef.current = ctx.createGain()
    masterRef.current.connect(ctx.destination)

    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }

  // Carrega E decodifica tudo — chamado no botão "Baixar"
  async function handleCarregar() {
    if (prontoRef.current) return
    setPrecarregando(true)
    setErro('')

    // Inicia áudio silencioso — mantém sessão ativa no iOS com tela bloqueada
    const audioEl = criarAudioSilencioso()
    try { await audioEl.play() } catch(e) { console.warn('silent audio:', e) }

    // Cria AudioContext com toque silencioso AQUI — dentro do gesto do usuário
    const ctx = await criarCtxComToqueSilencioso()

    const lista = trilhasRef.current
    const selecionadasArr = [...selecionadas].sort((a, b) => a - b)
    const buffers = new Array(lista.length).fill(null)

    for (let idx = 0; idx < selecionadasArr.length; idx++) {
      const i = selecionadasArr[idx]
      setTrilhaAtual(idx)
      try {
        const res = await fetch(lista[i].url)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const arrayBuf = await res.arrayBuffer()
        // Decodifica aqui mesmo — dentro do mesmo contexto
        buffers[i] = await ctx.decodeAudioData(arrayBuf)
        // Pausa mínima para iOS não throttlear
        await new Promise(r => setTimeout(r, 30))
      } catch(e) {
        console.warn('Erro trilha', i, e)
      }
    }

    const validos = buffers.filter(Boolean)
    if (validos.length === 0) {
      setErro('Não foi possível carregar as trilhas.')
      setPrecarregando(false)
      return
    }

    audioBuffersRef.current = buffers
    maxDurRef.current = Math.max(...validos.map(b => b.duration), 0)
    setTempos({ atual: 0, total: maxDurRef.current })

    // Cria gain nodes
    gainNodesRef.current = buffers.map(() => {
      const g = ctx.createGain()
      g.gain.value = 1
      g.connect(masterRef.current)
      return g
    })

    prontoRef.current = true
    setPronto(true)
    setPrecarregando(false)
  }

  function iniciarSources(offset) {
    const ctx = ctxRef.current
    if (!ctx || ctx.state === 'closed') return
    pararTudo()

    const rate = Math.pow(2, pitchRef.current / 12)

    const sources = audioBuffersRef.current.map((buf, i) => {
      if (!buf || !gainNodesRef.current[i]) return null
      if (!selecionadas.has(i)) return null
      try {
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = rate
        src.connect(gainNodesRef.current[i])
        src.start(0, Math.min(Math.max(0, offset), buf.duration - 0.01))
        return src
      } catch(e) {
        console.warn('Erro source', i, e)
        return null
      }
    })

    sourcesRef.current = sources
    startedAtRef.current = ctx.currentTime - offset
  }

  function iniciarTick() {
    let lastPositionUpdate = 0
    const tick = () => {
      const ctx = ctxRef.current
      if (!ctx) return
      const elapsed = ctx.currentTime - startedAtRef.current
      setTempos({ atual: Math.max(0, elapsed), total: maxDurRef.current })

      // Atualiza posição na tela de bloqueio a cada 1 segundo
      const now = Date.now()
      if (now - lastPositionUpdate > 1000) {
        updatePositionState()
        lastPositionUpdate = now
      }

      if (elapsed < maxDurRef.current + 0.5) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        playingRef.current = false
        setPlaying(false)
        offsetRef.current = 0
        setTempos({ atual: 0, total: maxDurRef.current })
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'none'
        }
      }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    const m = musica
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m?.titulo || 'MixStage',
      artist: m?.artista || '',
      album: m?.tom ? `Tom: ${m.tom}` : 'MixStage',
      artwork: [
        { src: 'https://placehold.co/512x512/0a0a0a/e8ff3c?text=MS', sizes: '512x512', type: 'image/png' }
      ]
    })
    navigator.mediaSession.setActionHandler('play', () => {
      if (!playingRef.current) togglePlay()
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      if (playingRef.current) togglePlay()
    })
    navigator.mediaSession.setActionHandler('stop', () => {
      if (playingRef.current) togglePlay()
      offsetRef.current = 0
      setTempos(t => ({ ...t, atual: 0 }))
    })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        const newOffset = details.seekTime
        offsetRef.current = newOffset
        setTempos(t => ({ ...t, atual: newOffset }))
        if (playingRef.current && ctxRef.current) {
          iniciarSources(newOffset)
          startedAtRef.current = ctxRef.current.currentTime - newOffset
        }
      }
    })
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !maxDurRef.current) return
    try {
      const ctx = ctxRef.current
      if (!ctx) return
      const position = ctx.currentTime - startedAtRef.current
      const rate = Math.pow(2, pitchRef.current / 12)
      navigator.mediaSession.setPositionState({
        duration: maxDurRef.current,
        playbackRate: rate,
        position: Math.max(0, Math.min(position, maxDurRef.current)),
      })
    } catch(e) {}
  }

  async function togglePlay() {
    const ctx = ctxRef.current
    if (!ctx) return

    if (ctx.state === 'suspended') await ctx.resume()

    if (playingRef.current) {
      offsetRef.current = ctx.currentTime - startedAtRef.current
      pararTudo()
      playingRef.current = false
      setPlaying(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
      // Mantém audio silencioso tocando para manter sessão iOS ativa
    } else {
      setupMediaSession()
      iniciarSources(offsetRef.current)
      playingRef.current = true
      setPlaying(true)
      iniciarTick()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
      updatePositionState()
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
      iniciarSources(newOffset)
      startedAtRef.current = ctxRef.current.currentTime - newOffset
    }
  }

  function changePitch(val) {
    const s = parseInt(val)
    setPitch(s)
    pitchRef.current = s
    if (playingRef.current && ctxRef.current?.state === 'running') {
      const currentOffset = ctxRef.current.currentTime - startedAtRef.current
      offsetRef.current = currentOffset
      iniciarSources(currentOffset)
      startedAtRef.current = ctxRef.current.currentTime - currentOffset
    }
  }

  async function salvarTf() {
    if (!session?.user?.id) return
    setSalvandoTf(true)
    setTfMsg('')
    const { error } = await supabase.from('tons_favoritos').upsert({
      user_id: session.user.id, musica_id: id, tom: pitch,
    }, { onConflict: 'user_id,musica_id' })
    if (!error) {
      setTfSalvo(pitch)
      setTfMsg('TF salvo!')
      setTimeout(() => setTfMsg(''), 2000)
    }
    setSalvandoTf(false)
  }

  function applyGain(idx, lista) {
    if (!gainNodesRef.current[idx] || !ctxRef.current) return
    const t = lista[idx]
    const soloActive = lista.some(x => x.soloed)
    const v = t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol)
    gainNodesRef.current[idx].gain.setTargetAtTime(v, ctxRef.current.currentTime, 0.02)
  }

  function updateVol(idx, vol) {
    setTrilhas(prev => { const n = [...prev]; n[idx] = { ...n[idx], vol }; applyGain(idx, n); return n })
  }
  function toggleMute(idx) {
    setTrilhas(prev => { const n = [...prev]; n[idx] = { ...n[idx], muted: !n[idx].muted }; applyGain(idx, n); return n })
  }
  function toggleSolo(idx) {
    setTrilhas(prev => { const n = [...prev]; n[idx] = { ...n[idx], soloed: !n[idx].soloed }; n.forEach((_, i) => applyGain(i, n)); return n })
  }

  function fmt(s) {
    if (!s || isNaN(s) || s < 0) return '0:00'
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  const tomOriginal = musica?.tom || null
  const tomAtual = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitch) : null
  const tfDisplay = tomOriginal && tfSalvo !== null ? calcularTom(tomOriginal.split('/')[0], tfSalvo) : null
  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      {/* Header */}
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => { pararTudo(); navigate('/catalogo') }} style={{ background:'none', color:'var(--text2)', fontSize:20, padding:'0 8px 0 0', border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{musica?.titulo}</div>
            {tomOriginal && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'2px 7px' }}>{tomOriginal}</span>}
            {tfDisplay !== null && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(60,255,143,0.12)', color:'var(--success)', border:'1px solid rgba(60,255,143,0.25)', borderRadius:4, padding:'2px 7px' }}>TF: {tfDisplay}</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth:800, margin:'0 auto', padding:'24px 16px' }}>

        {/* Tela inicial */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'32px 24px' }}>
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🎛️</div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, marginBottom:6 }}>
                {trilhas.length} trilha{trilhas.length !== 1 ? 's' : ''}
              </div>
              {tomOriginal && (
                <span style={{ fontSize:13, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:6, padding:'4px 12px' }}>
                  Tom original: {tomOriginal}{tfDisplay ? ` · TF: ${tfDisplay}` : ''}
                </span>
              )}
            </div>

            {/* Seleção de faixas */}
            <div style={{ marginBottom:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:12, color:'var(--text2)' }}>Escolha as faixas:</div>
                <div style={{ display:'flex', gap:12 }}>
                  <button onClick={() => setSelecionadas(new Set(trilhas.map((_,i)=>i)))} style={{ fontSize:11, color:'var(--accent)', background:'none', border:'none', cursor:'pointer' }}>todas</button>
                  <button onClick={() => setSelecionadas(new Set())} style={{ fontSize:11, color:'var(--text3)', background:'none', border:'none', cursor:'pointer' }}>nenhuma</button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {trilhas.map((tr, i) => {
                  const sel = selecionadas.has(i)
                  return (
                    <div key={tr.id} onClick={() => setSelecionadas(prev => { const n = new Set(prev); sel ? n.delete(i) : n.add(i); return n })}
                      style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:'var(--radius)', background: sel ? 'rgba(232,255,60,0.08)' : 'var(--bg3)', border:`1px solid ${sel ? 'rgba(232,255,60,0.3)' : 'var(--border)'}`, cursor:'pointer', transition:'all 0.15s' }}>
                      <div style={{ width:18, height:18, borderRadius:4, flexShrink:0, background: sel ? 'var(--accent)' : 'var(--bg2)', border:`1px solid ${sel ? 'var(--accent)' : 'var(--border2)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {sel && <span style={{ fontSize:11, color:'#000', fontWeight:700 }}>✓</span>}
                      </div>
                      <div style={{ width:3, height:20, borderRadius:1, background:trackColors[i%8], flexShrink:0 }} />
                      <div style={{ flex:1, fontSize:13, color: sel ? 'var(--text)' : 'var(--text2)', fontFamily:'var(--font-display)', fontWeight:600 }}>{tr.nome}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {erro && <div style={{ color:'var(--danger)', fontSize:13, marginBottom:16, padding:10, background:'rgba(255,68,68,0.1)', borderRadius:'var(--radius)' }}>{erro}</div>}
            <button onClick={handleCarregar} disabled={selecionadas.size === 0} style={{ width:'100%', padding:'16px 0', borderRadius:'var(--radius)', background: selecionadas.size > 0 ? 'var(--accent)' : 'var(--bg3)', color: selecionadas.size > 0 ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:3, border:'none', cursor: selecionadas.size > 0 ? 'pointer' : 'not-allowed' }}>
              ▶ CARREGAR {selecionadas.size > 0 ? `(${selecionadas.size})` : ''}
            </button>
          </div>
        )}

        {/* Carregando */}
        {precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'32px 24px', textAlign:'center' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:8 }}>Carregando trilhas...</div>
            <div style={{ color:'var(--text2)', fontSize:13, marginBottom:20 }}>
              {trilhaAtual + 1} de {selecionadas.size} — {trilhasRef.current[[...selecionadas].sort((a,b)=>a-b)[trilhaAtual]]?.nome}
            </div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden', marginBottom:20, maxWidth:300, margin:'0 auto 20px' }}>
              <div style={{ height:'100%', background:'var(--accent)', borderRadius:3, width:`${Math.round((trilhaAtual / selecionadas.size) * 100)}%`, transition:'width 0.3s' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, maxWidth:300, margin:'0 auto' }}>
              {[...selecionadas].sort((a,b)=>a-b).map((i, idx) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                  <div style={{ width:3, height:14, borderRadius:1, background:trackColors[i%8], flexShrink:0 }} />
                  <div style={{ flex:1, color: idx < trilhaAtual ? 'var(--success)' : idx === trilhaAtual ? 'var(--text)' : 'var(--text3)', textAlign:'left' }}>{trilhasRef.current[i]?.nome}</div>
                  <div style={{ flexShrink:0 }}>{idx < trilhaAtual ? '✓' : idx === trilhaAtual ? '⟳' : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mixer */}
        {pronto && (
          <>
            {erro && <div style={{ color:'var(--danger)', fontSize:13, marginBottom:12, padding:10, background:'rgba(255,68,68,0.1)', borderRadius:'var(--radius)' }}>{erro}</div>}

            <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'16px 20px', marginBottom:16 }}>

              {/* Play + progress */}
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
                <button onClick={togglePlay} style={{ width:48, height:48, borderRadius:'50%', background: playing ? 'var(--accent)' : 'var(--bg3)', color: playing ? '#000' : 'var(--text)', fontSize:18, flexShrink:0, border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                  {playing ? '⏸' : '▶'}
                </button>
                <div style={{ flex:1 }}>
                  <div onClick={seek} onTouchEnd={seek} style={{ height:6, background:'var(--bg3)', borderRadius:3, cursor:'pointer' }}>
                    <div style={{ height:'100%', borderRadius:3, background:'var(--accent)', width:`${tempos.total ? Math.min((tempos.atual/tempos.total)*100,100) : 0}%`, transition:'width 0.1s linear', pointerEvents:'none' }} />
                  </div>
                </div>
                <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', minWidth:80, textAlign:'right' }}>{fmt(tempos.atual)} / {fmt(tempos.total)}</div>
              </div>

              {/* Pitch + TF */}
              <div style={{ padding:'14px 16px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                  <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Tom</div>
                  <button onClick={() => changePitch(Math.max(-6, pitch-1))} disabled={pitch<=-6} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitch<=-6 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitch<=-6 ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>−</button>
                  <input type="range" min="-6" max="6" step="1" value={pitch} onChange={e => changePitch(e.target.value)} style={{ flex:1 }} />
                  <button onClick={() => changePitch(Math.min(6, pitch+1))} disabled={pitch>=6} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitch>=6 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitch>=6 ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>+</button>
                  <div style={{ flexShrink:0, textAlign:'center', minWidth:80 }}>
                    {tomAtual ? (
                      <div>
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:18, color: pitch===0 ? 'var(--text)' : 'var(--accent)', lineHeight:1 }}>{tomAtual}</div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>{pitch===0 ? 'original' : `${pitch>0?'+':''}${pitch} st`}</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontFamily:'var(--font-mono)', fontSize:14, color: pitch===0 ? 'var(--text2)' : 'var(--accent)' }}>{pitch>0?'+':''}{pitch} st</div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>semitons</div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {pitch !== 0 && <button onClick={() => changePitch(0)} style={{ padding:'6px 12px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:11, border:'1px solid var(--border)', cursor:'pointer' }}>↺ reset</button>}
                  {tfSalvo !== null && pitch !== tfSalvo && <button onClick={() => changePitch(tfSalvo)} style={{ padding:'6px 12px', borderRadius:'var(--radius)', background:'rgba(60,255,143,0.1)', color:'var(--success)', fontSize:11, border:'1px solid rgba(60,255,143,0.3)', cursor:'pointer' }}>↩ TF {tfDisplay ? `(${tfDisplay})` : `(${tfSalvo>0?'+':''}${tfSalvo} st)`}</button>}
                  <div style={{ flex:1 }} />
                  <button onClick={salvarTf} disabled={salvandoTf} style={{ padding:'6px 14px', borderRadius:'var(--radius)', background: tfSalvo === pitch ? 'rgba(60,255,143,0.15)' : 'var(--bg2)', color: tfSalvo === pitch ? 'var(--success)' : 'var(--text2)', fontSize:11, border:`1px solid ${tfSalvo === pitch ? 'rgba(60,255,143,0.3)' : 'var(--border)'}`, cursor: salvandoTf ? 'not-allowed' : 'pointer', letterSpacing:1, fontWeight:600 }}>
                    {salvandoTf ? '...' : tfMsg || (tfSalvo === pitch ? '★ TF salvo' : '☆ Salvar TF')}
                  </button>
                </div>
              </div>
            </div>

            {/* Trilhas */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {trilhas.map((tr, i) => {
                if (!selecionadas.has(i)) return null
                return (
                  <div key={tr.id} className="fade-in" style={{ animationDelay:`${i*0.04}s`, background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:3, height:36, borderRadius:2, background:trackColors[i%8], flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tr.nome}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:2, letterSpacing:1 }}>TRILHA {i+1}</div>
                    </div>
                    <button onClick={() => toggleMute(i)} style={{ width:30, height:30, borderRadius:'var(--radius)', cursor:'pointer', background: tr.muted ? 'rgba(255,68,68,0.2)' : 'var(--bg3)', color: tr.muted ? 'var(--danger)' : 'var(--text2)', border:`1px solid ${tr.muted ? 'rgba(255,68,68,0.4)' : 'var(--border)'}`, fontSize:10, fontWeight:600 }}>M</button>
                    <button onClick={() => toggleSolo(i)} style={{ width:30, height:30, borderRadius:'var(--radius)', cursor:'pointer', background: tr.soloed ? 'rgba(232,255,60,0.2)' : 'var(--bg3)', color: tr.soloed ? 'var(--accent)' : 'var(--text2)', border:`1px solid ${tr.soloed ? 'rgba(232,255,60,0.4)' : 'var(--border)'}`, fontSize:10, fontWeight:600 }}>S</button>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                      <input type="range" min="0" max="1.5" step="0.01" value={tr.vol} onChange={e => updateVol(i, parseFloat(e.target.value))} style={{ width:90 }} />
                      <div style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text2)' }}>{Math.round(tr.vol*100)}%</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
