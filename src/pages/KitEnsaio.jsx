import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom, TONS_SELECT } from '../lib/pitch'

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

    const ctx2 = new OfflineAudioContext(ch, buffer.length, sr)
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
  const [pitchSelecionado, setPitchSelecionado] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [etapaCarregamento, setEtapaCarregamento] = useState('')
  const [progressoProc, setProgressoProc] = useState(0)
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [volume, setVolume] = useState(1)
  const [tfSalvo, setTfSalvo] = useState(null)
  const [erro, setErro] = useState('')

  const ctxRef = useRef(null)
  const masterRef = useRef(null)
  const gainRef = useRef(null)
  const bufRef = useRef(null)
  const sourceRef = useRef(null)
  const audioElRef = useRef(null)
  const heartbeatRef = useRef(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)
  const playingRef = useRef(false)
  const pitchAplicadoRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: k } = await supabase.from('kit_ensaio').select('*').eq('musica_id', id)
      setMusica(m)
      const mapa = {}
      if (k) k.forEach(item => { mapa[item.tipo] = item })
      setKitDisponivel(mapa)

      // Carrega TF salvo
      if (session?.user?.id) {
        const { data: tf } = await supabase.from('tons_favoritos').select('tom')
          .eq('user_id', session.user.id).eq('musica_id', id).single()
        if (tf) {
          setTfSalvo(tf.tom)
          setPitchSelecionado(tf.tom)
        }
      }
      setCarregando(false)
    }
    carregar()
    return () => { pararTudo(); pararHeartbeat() }
  }, [id])

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

  function iniciarHeartbeat() {
    pararHeartbeat()
    heartbeatRef.current = setInterval(() => {
      const ctx = ctxRef.current
      if (!ctx || ctx.state !== 'running') return
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate)
        const s = ctx.createBufferSource()
        s.buffer = b; s.connect(ctx.destination); s.start(0)
      } catch(e) {}
    }, 25000)
  }

  function pararHeartbeat() {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
  }

  function pararTudo() {
    try { sourceRef.current?.stop() } catch(e) {}
    sourceRef.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  async function handleCarregar() {
    if (!tipoSelecionado || !kitDisponivel[tipoSelecionado]) return
    setPrecarregando(true); setErro('')

    // Inicia sessão de áudio dentro do gesto
    const audioEl = criarAudioSilencioso()
    try { await audioEl.play() } catch(e) {}

    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx
    masterRef.current = ctx.createGain()
    masterRef.current.connect(ctx.destination)
    gainRef.current = ctx.createGain()
    gainRef.current.gain.value = volume
    gainRef.current.connect(masterRef.current)

    // Toque silencioso para acordar iOS
    const s = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = s; src.connect(ctx.destination); src.start(0)
    if (ctx.state === 'suspended') await ctx.resume()

    ctx.onstatechange = () => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    }

    iniciarHeartbeat()

    try {
      // Baixa o arquivo
      setEtapaCarregamento('Baixando...')
      setProgressoProc(10)
      const res = await fetch(kitDisponivel[tipoSelecionado].url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const arrayBuf = await res.arrayBuffer()

      setEtapaCarregamento('Decodificando...')
      setProgressoProc(30)
      const decoded = await ctx.decodeAudioData(arrayBuf)

      // Aplica pitch se necessário
      let finalBuffer = decoded
      if (pitchSelecionado !== 0) {
        setEtapaCarregamento(`Aplicando tom ${tomSelecionadoDisplay || pitchSelecionado > 0 ? `+${pitchSelecionado}` : pitchSelecionado} st...`)
        setProgressoProc(50)
        finalBuffer = await pitchShiftOffline(decoded, pitchSelecionado)
        pitchAplicadoRef.current = pitchSelecionado
      } else {
        pitchAplicadoRef.current = 0
      }

      setProgressoProc(100)
      bufRef.current = finalBuffer
      maxDurRef.current = finalBuffer.duration
      setTempos({ atual: 0, total: finalBuffer.duration })
      setupMediaSession()
      setPronto(true)
    } catch(e) {
      console.error(e)
      setErro('Erro ao carregar. Verifique sua conexão.')
    }
    setPrecarregando(false)
    setEtapaCarregamento('')
  }

  function iniciarSource(offset) {
    const ctx = ctxRef.current
    if (!ctx || ctx.state === 'closed' || !bufRef.current) return
    pararTudo()
    try {
      const src = ctx.createBufferSource()
      src.buffer = bufRef.current
      src.connect(gainRef.current)
      src.start(0, Math.min(Math.max(0, offset), bufRef.current.duration - 0.01))
      sourceRef.current = src
      startedAtRef.current = ctx.currentTime - offset
    } catch(e) { console.error('iniciarSource:', e) }
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

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    const tipoLabel = KIT_TIPOS.find(t => t.key === tipoSelecionado)?.label || ''
    navigator.mediaSession.metadata = new MediaMetadata({
      title: musica?.titulo || 'MixStage',
      artist: musica?.artista || '',
      album: `Kit Ensaio — ${tipoLabel}`,
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

  function fmt(s) {
    if (!s || isNaN(s) || s < 0) return '0:00'
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`
  }

  const tomOriginal = musica?.tom || null
  const tomSelecionadoDisplay = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitchSelecionado) : null
  const tfDisplay = tomOriginal && tfSalvo !== null ? calcularTom(tomOriginal.split('/')[0], tfSalvo) : null
  const tomFinal = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitchAplicadoRef.current) : null
  const tiposDisponiveis = KIT_TIPOS.filter(t => kitDisponivel[t.key])
  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']

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
            {pronto && tomFinal && tomFinal !== tomOriginal && (
              <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(60,255,143,0.12)', color:'var(--success)', border:'1px solid rgba(60,255,143,0.25)', borderRadius:4, padding:'2px 7px' }}>{tomFinal}</span>
            )}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>
            Kit Ensaio{pronto ? ` — ${KIT_TIPOS.find(t=>t.key===tipoSelecionado)?.label}` : ''}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:600, margin:'0 auto', padding:'24px 16px' }}>

        {/* Tela de seleção */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'28px 24px', display:'flex', flexDirection:'column', gap:24 }}>

            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:10 }}>🎼</div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, marginBottom:4 }}>Kit Ensaio</div>
              <div style={{ fontSize:13, color:'var(--text2)' }}>Escolha a trilha e o tom antes de carregar</div>
            </div>

            {/* Seleção do tipo */}
            <div>
              <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase', marginBottom:10 }}>Trilha</div>
              {tiposDisponiveis.length === 0 ? (
                <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13, padding:16 }}>Nenhuma trilha do Kit Ensaio cadastrada.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {tiposDisponiveis.map((tipo, i) => {
                    const sel = tipoSelecionado === tipo.key
                    return (
                      <div key={tipo.key} onClick={() => setTipoSelecionado(tipo.key)}
                        style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:'var(--radius)', background: sel ? 'rgba(232,255,60,0.08)' : 'var(--bg3)', border:`1px solid ${sel ? 'rgba(232,255,60,0.3)' : 'var(--border)'}`, cursor:'pointer', transition:'all 0.15s' }}>
                        <div style={{ width:16, height:16, borderRadius:'50%', flexShrink:0, background: sel ? 'var(--accent)' : 'var(--bg2)', border:`2px solid ${sel ? 'var(--accent)' : 'var(--border2)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {sel && <div style={{ width:6, height:6, borderRadius:'50%', background:'#000' }} />}
                        </div>
                        <div style={{ width:3, height:18, borderRadius:1, background:trackColors[KIT_TIPOS.findIndex(t=>t.key===tipo.key)%8], flexShrink:0 }} />
                        <div style={{ fontSize:14, fontFamily:'var(--font-display)', fontWeight:600, color: sel ? 'var(--text)' : 'var(--text2)' }}>{tipo.label}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Seleção do tom */}
            <div>
              <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase', marginBottom:10 }}>
                Tom {tomSelecionadoDisplay ? `— ${tomSelecionadoDisplay}` : pitchSelecionado !== 0 ? `— ${pitchSelecionado > 0 ? '+' : ''}${pitchSelecionado} st` : '— original'}
              </div>

              {/* Botão TF */}
              {tfSalvo !== null && (
                <button onClick={() => setPitchSelecionado(tfSalvo)} style={{
                  padding:'6px 12px', borderRadius:'var(--radius)', fontSize:11, marginBottom:10,
                  background: pitchSelecionado === tfSalvo ? 'rgba(60,255,143,0.15)' : 'var(--bg3)',
                  color: pitchSelecionado === tfSalvo ? 'var(--success)' : 'var(--text2)',
                  border:`1px solid ${pitchSelecionado === tfSalvo ? 'rgba(60,255,143,0.3)' : 'var(--border)'}`,
                  cursor:'pointer', letterSpacing:1,
                }}>
                  ★ Tom Favorito {tfDisplay ? `(${tfDisplay})` : `(${tfSalvo > 0 ? '+' : ''}${tfSalvo} st)`}
                </button>
              )}

              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <button onClick={() => setPitchSelecionado(p => Math.max(-6, p-1))} disabled={pitchSelecionado <= -6} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitchSelecionado <= -6 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitchSelecionado <= -6 ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>−</button>
                <input type="range" min="-6" max="6" step="1" value={pitchSelecionado} onChange={e => setPitchSelecionado(parseInt(e.target.value))} style={{ flex:1 }} />
                <button onClick={() => setPitchSelecionado(p => Math.min(6, p+1))} disabled={pitchSelecionado >= 6} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitchSelecionado >= 6 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitchSelecionado >= 6 ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>+</button>
                <div style={{ flexShrink:0, textAlign:'center', minWidth:72 }}>
                  {tomSelecionadoDisplay ? (
                    <div>
                      <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:18, color: pitchSelecionado === 0 ? 'var(--text)' : 'var(--accent)', lineHeight:1 }}>{tomSelecionadoDisplay}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{pitchSelecionado === 0 ? 'original' : `${pitchSelecionado > 0 ? '+' : ''}${pitchSelecionado} st`}</div>
                    </div>
                  ) : (
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:14, color: pitchSelecionado === 0 ? 'var(--text2)' : 'var(--accent)' }}>
                      {pitchSelecionado > 0 ? '+' : ''}{pitchSelecionado} st
                    </div>
                  )}
                </div>
              </div>
              {pitchSelecionado !== 0 && (
                <button onClick={() => setPitchSelecionado(0)} style={{ marginTop:8, padding:'4px 10px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:11, border:'1px solid var(--border)', cursor:'pointer' }}>↺ reset</button>
              )}
            </div>

            {erro && <div style={{ color:'var(--danger)', fontSize:13, padding:10, background:'rgba(255,68,68,0.1)', borderRadius:'var(--radius)' }}>{erro}</div>}

            <button onClick={handleCarregar} disabled={!tipoSelecionado} style={{ width:'100%', padding:'16px 0', borderRadius:'var(--radius)', background: tipoSelecionado ? 'var(--accent)' : 'var(--bg3)', color: tipoSelecionado ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:3, border:'none', cursor: tipoSelecionado ? 'pointer' : 'not-allowed' }}>
              ▶ CARREGAR {tipoSelecionado ? `(${KIT_TIPOS.find(t=>t.key===tipoSelecionado)?.label}${pitchSelecionado !== 0 ? ` · ${tomSelecionadoDisplay || `${pitchSelecionado > 0 ? '+' : ''}${pitchSelecionado} st`}` : ''})` : ''}
            </button>
          </div>
        )}

        {/* Carregando */}
        {precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'48px 24px', textAlign:'center' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:20 }}>
              {etapaCarregamento || 'Carregando...'}
            </div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden', maxWidth:240, margin:'0 auto 12px' }}>
              <div style={{ height:'100%', background:'var(--accent)', borderRadius:3, width:`${progressoProc}%`, transition:'width 0.4s' }} />
            </div>
            <div style={{ fontSize:12, color:'var(--text2)' }}>{progressoProc}%</div>
          </div>
        )}

        {/* Player simples */}
        {pronto && (
          <div className="fade-in" style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'24px 20px' }}>

              {/* Play + barra */}
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
                <button onClick={togglePlay} style={{ width:56, height:56, borderRadius:'50%', background: playing ? 'var(--accent)' : 'var(--bg3)', color: playing ? '#000' : 'var(--text)', fontSize:22, flexShrink:0, border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
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
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Vol</div>
                <input type="range" min="0" max="1.5" step="0.01" value={volume} onChange={e => changeVolume(e.target.value)} style={{ flex:1 }} />
                <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', minWidth:36, textAlign:'right' }}>{Math.round(volume*100)}%</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
