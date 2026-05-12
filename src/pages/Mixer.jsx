import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

const EXCLUIR_PITCH = ['drums', 'drum', 'bateria', 'click', 'guia']

function deveExcluirPitch(nome) {
  if (!nome) return false
  const n = nome.toLowerCase()
  return EXCLUIR_PITCH.some(p => n.includes(p))
}

async function pitchShiftNativo(buffer, semitons) {
  if (!semitons) return buffer
  try {
    const rate = Math.pow(2, semitons / 12)
    const sr = buffer.sampleRate
    const ch = buffer.numberOfChannels

    const ctx1 = new OfflineAudioContext(ch, Math.ceil(buffer.length / rate), sr)
    const src1 = ctx1.createBufferSource()
    src1.buffer = buffer
    src1.playbackRate.value = rate
    src1.connect(ctx1.destination)
    src1.start(0)
    const buf1 = await ctx1.startRendering()

    const ctx2 = new OfflineAudioContext(ch, buffer.length, sr)
    const src2 = ctx2.createBufferSource()
    src2.buffer = buf1
    src2.playbackRate.value = 1 / rate
    src2.connect(ctx2.destination)
    src2.start(0)
    const buf2 = await ctx2.startRendering()

    return buf2
  } catch(e) {
    console.warn('pitchShift falhou, usando original:', e)
    return buffer
  }
}

export default function Mixer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [trilhaAtual, setTrilhaAtual] = useState(0)
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [erro, setErro] = useState('')
  const [pitch, setPitch] = useState(0)
  const [pitchAplicado, setPitchAplicado] = useState(0)
  const [processando, setProcessando] = useState(false)
  const [progressoProcessamento, setProgressoProcessamento] = useState(0)

  const ctxRef = useRef(null)
  const masterRef = useRef(null)
  const bufOriginaisRef = useRef([])
  const bufProcessadosRef = useRef([])
  const trilhasRef = useRef([])
  const sourcesRef = useRef([])
  const gainNodesRef = useRef([])
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)
  const prontoRef = useRef(false)
  const playingRef = useRef(false)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: t } = await supabase.from('trilhas').select('*').eq('musica_id', id).order('ordem')
      setMusica(m)
      const lista = (t || []).map(tr => ({ ...tr, vol: 1, muted: false, soloed: false }))
      setTrilhas(lista)
      trilhasRef.current = lista
      setCarregando(false)
    }
    carregar()
    return () => pararTudo()
  }, [id])

  function getCtx() {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      masterRef.current = ctxRef.current.createGain()
      masterRef.current.connect(ctxRef.current.destination)
    }
    return ctxRef.current
  }

  function pararTudo() {
    sourcesRef.current.forEach(s => { try { s?.stop() } catch(e){} })
    sourcesRef.current = []
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  // Carrega UMA trilha por vez (sequencial) — evita crash de memória no iOS
  async function handleCarregar() {
    if (prontoRef.current) return

    const ctx = getCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    setPrecarregando(true)
    setErro('')

    const lista = trilhasRef.current
    const buffers = []

    for (let i = 0; i < lista.length; i++) {
      setTrilhaAtual(i)
      try {
        const res = await fetch(lista[i].url)
        const arrayBuf = await res.arrayBuffer()
        // Pequena pausa para o iOS liberar memória entre decodificações
        await new Promise(r => setTimeout(r, 50))
        const decoded = await ctx.decodeAudioData(arrayBuf)
        buffers.push(decoded)
      } catch(e) {
        console.warn('Erro ao carregar trilha', i, e)
        buffers.push(null)
      }
    }

    const validos = buffers.filter(Boolean)
    if (validos.length === 0) {
      setErro('Não foi possível carregar as trilhas.')
      setPrecarregando(false)
      return
    }

    bufOriginaisRef.current = buffers
    bufProcessadosRef.current = [...buffers]
    maxDurRef.current = Math.max(...validos.map(b => b.duration), 0)
    setTempos({ atual: 0, total: maxDurRef.current })

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
    if (!ctx) return
    pararTudo()

    const sources = bufProcessadosRef.current.map((buf, i) => {
      if (!buf || !gainNodesRef.current[i]) return null
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gainNodesRef.current[i])
      src.start(0, Math.min(offset, buf.duration - 0.01))
      return src
    })

    sourcesRef.current = sources
    startedAtRef.current = ctx.currentTime - offset
  }

  function iniciarTick() {
    const ctx = ctxRef.current
    const tick = () => {
      const elapsed = ctx.currentTime - startedAtRef.current
      setTempos({ atual: elapsed, total: maxDurRef.current })
      if (elapsed < maxDurRef.current + 0.5) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        playingRef.current = false
        setPlaying(false)
        offsetRef.current = 0
        setTempos({ atual: 0, total: maxDurRef.current })
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
      pararTudo()
      playingRef.current = false
      setPlaying(false)
    } else {
      iniciarSources(offsetRef.current)
      playingRef.current = true
      setPlaying(true)
      iniciarTick()
    }
  }

  function seek(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const pct = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1))
    const newOffset = pct * maxDurRef.current
    offsetRef.current = newOffset
    setTempos(t => ({ ...t, atual: newOffset }))
    if (playingRef.current) {
      iniciarSources(newOffset)
      startedAtRef.current = ctxRef.current.currentTime - newOffset
    }
  }

  async function handleAplicarPitch() {
    if (pitch === pitchAplicado || processando) return

    const wasPlaying = playingRef.current
    if (wasPlaying) {
      offsetRef.current = ctxRef.current.currentTime - startedAtRef.current
      pararTudo()
      playingRef.current = false
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }

    setProcessando(true)
    setProgressoProcessamento(0)

    const total = bufOriginaisRef.current.length
    const novos = []

    for (let i = 0; i < total; i++) {
      const buf = bufOriginaisRef.current[i]
      if (!buf) { novos.push(null); continue }

      const excluir = deveExcluirPitch(trilhasRef.current[i]?.nome)
      const resultado = excluir ? buf : await pitchShiftNativo(buf, pitch)
      novos.push(resultado)
      setProgressoProcessamento(Math.round(((i + 1) / total) * 100))
      await new Promise(r => setTimeout(r, 20))
    }

    bufProcessadosRef.current = novos
    const duracoes = novos.filter(Boolean).map(b => b.duration)
    maxDurRef.current = Math.max(...duracoes, 0)
    setTempos(t => ({ ...t, total: maxDurRef.current }))
    setPitchAplicado(pitch)
    setProcessando(false)

    if (wasPlaying) {
      iniciarSources(Math.min(offsetRef.current, maxDurRef.current - 0.1))
      playingRef.current = true
      setPlaying(true)
      iniciarTick()
    }
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
  const tomAplicadoDisplay = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitchAplicado) : null
  const pitchMudou = pitch !== pitchAplicado
  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']
  const totalTrilhas = trilhasRef.current.length

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>
      Carregando...
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      {/* Header */}
      <div style={{
        borderBottom:'1px solid var(--border)', padding:'16px 24px',
        display:'flex', alignItems:'center', gap:16,
        position:'sticky', top:0, background:'var(--bg)', zIndex:10,
      }}>
        <button onClick={() => { pararTudo(); navigate('/catalogo') }}
          style={{ background:'none', color:'var(--text2)', fontSize:20, padding:'0 8px 0 0', border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {musica?.titulo}
            </div>
            {tomOriginal && (
              <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'2px 7px' }}>
                {tomOriginal}
              </span>
            )}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth:800, margin:'0 auto', padding:'24px 16px' }}>

        {/* Tela inicial */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'48px 24px', textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:16 }}>🎛️</div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, marginBottom:8 }}>
              {trilhas.length} trilha{trilhas.length !== 1 ? 's' : ''}
            </div>
            {tomOriginal && (
              <div style={{ marginBottom:16 }}>
                <span style={{ fontSize:13, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:6, padding:'4px 12px' }}>
                  Tom original: {tomOriginal}
                </span>
              </div>
            )}
            <div style={{ color:'var(--text2)', fontSize:13, marginBottom:28 }}>
              Carregue todas as trilhas para garantir sincronização perfeita.
            </div>
            {erro && (
              <div style={{ color:'var(--danger)', fontSize:13, marginBottom:16, padding:10, background:'rgba(255,68,68,0.1)', borderRadius:'var(--radius)' }}>
                {erro}
              </div>
            )}
            <button onClick={handleCarregar} style={{
              padding:'16px 40px', borderRadius:'var(--radius)',
              background:'var(--accent)', color:'#000',
              fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:3,
              border:'none', cursor:'pointer',
            }}>▶ CARREGAR</button>
          </div>
        )}

        {/* Carregando sequencialmente */}
        {precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'32px 24px', textAlign:'center' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:8 }}>
              Carregando trilhas...
            </div>
            <div style={{ color:'var(--text2)', fontSize:13, marginBottom:24 }}>
              {trilhaAtual + 1} de {totalTrilhas} — {trilhasRef.current[trilhaAtual]?.nome}
            </div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden', marginBottom:16, maxWidth:300, margin:'0 auto 16px' }}>
              <div style={{
                height:'100%', background:'var(--accent)', borderRadius:3,
                width:`${Math.round(((trilhaAtual) / totalTrilhas) * 100)}%`,
                transition:'width 0.3s',
              }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, maxWidth:300, margin:'0 auto' }}>
              {trilhasRef.current.map((tr, i) => (
                <div key={tr.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                  <div style={{ width:3, height:14, borderRadius:1, background:trackColors[i%trackColors.length], flexShrink:0 }} />
                  <div style={{ flex:1, color: i < trilhaAtual ? 'var(--success)' : i === trilhaAtual ? 'var(--text)' : 'var(--text3)', textAlign:'left', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {tr.nome}
                  </div>
                  <div style={{ flexShrink:0 }}>
                    {i < trilhaAtual ? '✓' : i === trilhaAtual ? '⟳' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mixer */}
        {pronto && (
          <>
            {/* Transport + Pitch */}
            <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'16px 20px', marginBottom:16 }}>

              {/* Play + barra */}
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
                <button onClick={togglePlay} disabled={processando} style={{
                  width:48, height:48, borderRadius:'50%',
                  background: playing ? 'var(--accent)' : 'var(--bg3)',
                  color: playing ? '#000' : 'var(--text)',
                  fontSize:18, flexShrink:0, border:'1px solid var(--border2)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  cursor: processando ? 'not-allowed' : 'pointer',
                  opacity: processando ? 0.5 : 1,
                }}>{playing ? '⏸' : '▶'}</button>

                <div style={{ flex:1 }}>
                  <div
                    onClick={processando ? undefined : seek}
                    onTouchEnd={processando ? undefined : seek}
                    style={{ height:6, background:'var(--bg3)', borderRadius:3, cursor: processando ? 'default' : 'pointer' }}
                  >
                    <div style={{
                      height:'100%', borderRadius:3, background:'var(--accent)',
                      width:`${tempos.total ? Math.min((tempos.atual/tempos.total)*100,100) : 0}%`,
                      transition:'width 0.1s linear', pointerEvents:'none',
                    }} />
                  </div>
                </div>

                <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', minWidth:80, textAlign:'right' }}>
                  {fmt(tempos.atual)} / {fmt(tempos.total)}
                </div>
              </div>

              {/* Pitch control */}
              <div style={{ padding:'14px 16px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom: (pitchMudou || processando) ? 12 : 0 }}>
                  <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Tom</div>

                  <button onClick={() => setPitch(p => Math.max(-6, p-1))} disabled={pitch<=-6||processando} style={{
                    width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)',
                    background:'var(--bg2)', color: pitch<=-6 ? 'var(--text3)' : 'var(--text)',
                    fontSize:18, cursor: pitch<=-6||processando ? 'default' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  }}>−</button>

                  <input type="range" min="-6" max="6" step="1" value={pitch}
                    onChange={e => setPitch(parseInt(e.target.value))}
                    disabled={processando} style={{ flex:1 }} />

                  <button onClick={() => setPitch(p => Math.min(6, p+1))} disabled={pitch>=6||processando} style={{
                    width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)',
                    background:'var(--bg2)', color: pitch>=6 ? 'var(--text3)' : 'var(--text)',
                    fontSize:18, cursor: pitch>=6||processando ? 'default' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  }}>+</button>

                  {/* Display tom */}
                  <div style={{ flexShrink:0, textAlign:'center', minWidth:80 }}>
                    {tomAplicadoDisplay ? (
                      <div>
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:18, color: pitchAplicado===0 ? 'var(--text)' : 'var(--accent)', lineHeight:1 }}>
                          {tomAplicadoDisplay}
                        </div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>
                          {pitchAplicado===0 ? 'original' : `${pitchAplicado>0?'+':''}${pitchAplicado} st`}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontFamily:'var(--font-mono)', fontSize:14, color: pitchAplicado===0 ? 'var(--text2)' : 'var(--accent)' }}>
                          {pitchAplicado>0?'+':''}{pitchAplicado} st
                        </div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>aplicado</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Barra de processamento */}
                {processando && (
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text2)', marginBottom:6 }}>
                      <span>Processando pitch shift...</span>
                      <span style={{ color:'var(--accent)' }}>{progressoProcessamento}%</span>
                    </div>
                    <div style={{ height:4, background:'var(--bg2)', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${progressoProcessamento}%`, transition:'width 0.3s' }} />
                    </div>
                  </div>
                )}

                {/* Botões Aplicar / Cancelar */}
                {!processando && pitchMudou && (
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={handleAplicarPitch} style={{
                      flex:1, padding:'10px 0', borderRadius:'var(--radius)',
                      background:'var(--accent)', color:'#000',
                      fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, letterSpacing:2,
                      border:'none', cursor:'pointer',
                    }}>
                      ✓ APLICAR {tomAtual ? `(${tomAtual})` : `(${pitch>0?'+':''}${pitch} st)`}
                    </button>
                    <button onClick={() => setPitch(pitchAplicado)} style={{
                      padding:'10px 14px', borderRadius:'var(--radius)',
                      background:'none', color:'var(--text3)', fontSize:12,
                      border:'1px solid var(--border)', cursor:'pointer',
                    }}>cancelar</button>
                  </div>
                )}

                {!processando && !pitchMudou && pitchAplicado !== 0 && (
                  <button onClick={() => setPitch(0)} style={{
                    padding:'6px 12px', borderRadius:'var(--radius)',
                    background:'none', color:'var(--text3)', fontSize:11,
                    border:'1px solid var(--border)', cursor:'pointer',
                  }}>↺ resetar tom</button>
                )}
              </div>
            </div>

            {/* Trilhas */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {trilhas.map((tr, i) => (
                <div key={tr.id} className="fade-in" style={{
                  animationDelay:`${i*0.04}s`,
                  background:'var(--bg2)', border:'1px solid var(--border)',
                  borderRadius:'var(--radius-lg)', padding:'14px 16px',
                  display:'flex', alignItems:'center', gap:12,
                  opacity: bufOriginaisRef.current[i] ? 1 : 0.4,
                }}>
                  <div style={{ width:3, height:36, borderRadius:2, background:trackColors[i%trackColors.length], flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {tr.nome}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                      <div style={{ fontSize:10, color:'var(--text3)', letterSpacing:1 }}>TRILHA {i+1}</div>
                      {deveExcluirPitch(tr.nome) && (
                        <div style={{ fontSize:9, color:'var(--text3)', background:'var(--bg3)', borderRadius:3, padding:'1px 5px', letterSpacing:1 }}>SEM PITCH</div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => toggleMute(i)} style={{
                    width:30, height:30, borderRadius:'var(--radius)', cursor:'pointer',
                    background: tr.muted ? 'rgba(255,68,68,0.2)' : 'var(--bg3)',
                    color: tr.muted ? 'var(--danger)' : 'var(--text2)',
                    border:`1px solid ${tr.muted ? 'rgba(255,68,68,0.4)' : 'var(--border)'}`,
                    fontSize:10, fontWeight:600,
                  }}>M</button>
                  <button onClick={() => toggleSolo(i)} style={{
                    width:30, height:30, borderRadius:'var(--radius)', cursor:'pointer',
                    background: tr.soloed ? 'rgba(232,255,60,0.2)' : 'var(--bg3)',
                    color: tr.soloed ? 'var(--accent)' : 'var(--text2)',
                    border:`1px solid ${tr.soloed ? 'rgba(232,255,60,0.4)' : 'var(--border)'}`,
                    fontSize:10, fontWeight:600,
                  }}>S</button>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                    <input type="range" min="0" max="1.5" step="0.01" value={tr.vol}
                      onChange={e => updateVol(i, parseFloat(e.target.value))}
                      style={{ width:90 }} />
                    <div style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text2)' }}>
                      {Math.round(tr.vol*100)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
