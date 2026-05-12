import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom, NOTAS, NOTA_INDEX } from '../lib/pitch'

export default function Mixer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [progressos, setProgressos] = useState([])
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [erro, setErro] = useState('')
  const [pitch, setPitch] = useState(0)

  const audioCtxRef = useRef(null)
  const masterGainRef = useRef(null)
  const bufferRef = useRef([])
  const sourcesRef = useRef([])
  const gainNodesRef = useRef([])
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)
  const prontoRef = useRef(false)
  const pitchRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: t } = await supabase.from('trilhas').select('*').eq('musica_id', id).order('ordem')
      setMusica(m)
      const lista = (t || []).map(tr => ({ ...tr, vol: 1, muted: false, soloed: false }))
      setTrilhas(lista)
      setProgressos(new Array(lista.length).fill(0))
      setCarregando(false)
    }
    carregar()
    return () => cleanup()
  }, [id])

  function criarCtx() {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      masterGainRef.current = ctx.createGain()
      masterGainRef.current.connect(ctx.destination)
    }
    return audioCtxRef.current
  }

  function cleanup() {
    stopSources()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  function stopSources() {
    sourcesRef.current.forEach(s => { try { s?.stop() } catch(e){} })
    sourcesRef.current = []
  }

  function carregarTrilha(url, idx) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.responseType = 'arraybuffer'
      xhr.onprogress = e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100)
          setProgressos(prev => { const next = [...prev]; next[idx] = pct; return next })
        }
      }
      xhr.onload = async () => {
        try {
          const decoded = await audioCtxRef.current.decodeAudioData(xhr.response)
          setProgressos(prev => { const next = [...prev]; next[idx] = 100; return next })
          resolve(decoded)
        } catch(e) { resolve(null) }
      }
      xhr.onerror = () => resolve(null)
      xhr.send()
    })
  }

  async function precarregar() {
    if (prontoRef.current) return
    setPrecarregando(true)
    setErro('')

    const ctx = criarCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    setProgressos(new Array(trilhas.length).fill(0))

    const buffers = await Promise.all(trilhas.map((tr, i) => carregarTrilha(tr.url, i)))

    const validos = buffers.filter(Boolean)
    if (validos.length === 0) {
      setErro('Não foi possível carregar as trilhas. Verifique sua conexão.')
      setPrecarregando(false)
      return
    }

    bufferRef.current = buffers
    maxDurRef.current = Math.max(...validos.map(b => b.duration), 0)
    setTempos({ atual: 0, total: maxDurRef.current })

    gainNodesRef.current = trilhas.map(() => {
      const gain = ctx.createGain()
      gain.gain.value = 1
      gain.connect(masterGainRef.current)
      return gain
    })

    prontoRef.current = true
    setPronto(true)
    setPrecarregando(false)
  }

  function iniciarSources(offset, semitons) {
    const ctx = audioCtxRef.current
    if (!ctx) return
    stopSources()
    const sources = bufferRef.current.map((buf, i) => {
      if (!buf || !gainNodesRef.current[i]) return null
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gainNodesRef.current[i])
      src.detune.value = semitons * 100
      src.start(0, Math.min(offset, buf.duration))
      return src
    })
    sourcesRef.current = sources
    startedAtRef.current = ctx.currentTime - offset
  }

  async function togglePlay() {
    const ctx = audioCtxRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()

    if (playing) {
      offsetRef.current = ctx.currentTime - startedAtRef.current
      stopSources()
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    } else {
      iniciarSources(offsetRef.current, pitchRef.current)
      setPlaying(true)
      const tick = () => {
        const elapsed = ctx.currentTime - startedAtRef.current
        setTempos({ atual: elapsed, total: maxDurRef.current })
        if (elapsed < maxDurRef.current) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          setPlaying(false)
          offsetRef.current = 0
          setTempos({ atual: 0, total: maxDurRef.current })
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  function seek(pct) {
    const newOffset = pct * maxDurRef.current
    offsetRef.current = newOffset
    setTempos(t => ({ ...t, atual: newOffset }))
    if (playing) {
      iniciarSources(newOffset, pitchRef.current)
      startedAtRef.current = audioCtxRef.current.currentTime - newOffset
    }
  }

  function changePitch(val) {
    const semitons = parseInt(val)
    setPitch(semitons)
    pitchRef.current = semitons
    // Aplica em tempo real nas sources ativas
    sourcesRef.current.forEach(src => {
      if (src) src.detune.value = semitons * 100
    })
  }

  function applyGain(idx, trilhasList) {
    if (!gainNodesRef.current[idx] || !audioCtxRef.current) return
    const t = trilhasList[idx]
    const soloActive = trilhasList.some(x => x.soloed)
    const effective = t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol)
    gainNodesRef.current[idx].gain.setTargetAtTime(effective, audioCtxRef.current.currentTime, 0.02)
  }

  function updateVol(idx, vol) {
    setTrilhas(prev => { const next = [...prev]; next[idx] = { ...next[idx], vol }; applyGain(idx, next); return next })
  }

  function toggleMute(idx) {
    setTrilhas(prev => { const next = [...prev]; next[idx] = { ...next[idx], muted: !next[idx].muted }; applyGain(idx, next); return next })
  }

  function toggleSolo(idx) {
    setTrilhas(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], soloed: !next[idx].soloed }
      next.forEach((_, i) => applyGain(i, next))
      return next
    })
  }

  function fmt(s) {
    if (!s || isNaN(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Calcula tom atual baseado no tom original + pitch alterado
  const tomOriginal = musica?.tom || null
  const tomAtual = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitch) : null
  const tomOriginalDisplay = tomOriginal || null

  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']
  const totalPct = progressos.length ? Math.round(progressos.reduce((a, b) => a + b, 0) / progressos.length) : 0

  if (carregando) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <button onClick={() => { cleanup(); navigate('/catalogo') }} style={{ background: 'none', color: 'var(--text2)', fontSize: 20, padding: '0 8px 0 0', border: 'none', cursor: 'pointer' }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{musica?.titulo}</div>
            {tomOriginalDisplay && (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 1, flexShrink: 0,
                background: 'rgba(232,255,60,0.12)', color: 'var(--accent)',
                border: '1px solid rgba(232,255,60,0.25)',
                borderRadius: 4, padding: '2px 7px',
              }}>{tomOriginalDisplay}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>

        {/* Tela inicial */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '48px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🎛️</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              {trilhas.length} trilha{trilhas.length !== 1 ? 's' : ''}
            </div>
            {tomOriginalDisplay && (
              <div style={{ marginBottom: 16 }}>
                <span style={{
                  fontSize: 13, fontFamily: 'var(--font-mono)',
                  background: 'rgba(232,255,60,0.12)', color: 'var(--accent)',
                  border: '1px solid rgba(232,255,60,0.25)',
                  borderRadius: 6, padding: '4px 12px',
                }}>Tom original: {tomOriginalDisplay}</span>
              </div>
            )}
            <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 28 }}>
              Carregue todas as trilhas para garantir sincronização perfeita.
            </div>
            {erro && (
              <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16, padding: 10, background: 'rgba(255,68,68,0.1)', borderRadius: 'var(--radius)' }}>{erro}</div>
            )}
            <button onClick={precarregar} style={{
              padding: '16px 40px', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, letterSpacing: 3,
              border: 'none', cursor: 'pointer',
            }}>▶ CARREGAR</button>
          </div>
        )}

        {/* Carregando */}
        {precarregando && (
          <div className="fade-in" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Carregando...</div>
              <div style={{ color: 'var(--accent)', fontWeight: 600 }}>{totalPct}%</div>
            </div>
            <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 3, width: `${totalPct}%`, transition: 'width 0.2s' }} />
            </div>
            {trilhas.map((tr, i) => (
              <div key={tr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 3, height: 16, borderRadius: 1, background: trackColors[i % trackColors.length], flexShrink: 0 }} />
                <div style={{ fontSize: 12, color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.nome}</div>
                <div style={{ width: 80, height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: trackColors[i % trackColors.length], width: `${progressos[i] || 0}%`, transition: 'width 0.2s' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', minWidth: 28, textAlign: 'right' }}>{progressos[i] || 0}%</div>
              </div>
            ))}
          </div>
        )}

        {/* Mixer pronto */}
        {pronto && (
          <>
            {/* Transport + Pitch */}
            <div className="fade-in" style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 16,
            }}>
              {/* Linha 1: play + progress + tempo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <button onClick={togglePlay} style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: playing ? 'var(--accent)' : 'var(--bg3)',
                  color: playing ? '#000' : 'var(--text)',
                  fontSize: 18, flexShrink: 0, border: '1px solid var(--border2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}>{playing ? '⏸' : '▶'}</button>

                <div style={{ flex: 1 }}>
                  <div onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width) }}
                    style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, cursor: 'pointer' }}>
                    <div style={{
                      height: '100%', borderRadius: 3, background: 'var(--accent)',
                      width: `${tempos.total ? Math.min((tempos.atual / tempos.total) * 100, 100) : 0}%`,
                      transition: 'width 0.1s linear', pointerEvents: 'none',
                    }} />
                  </div>
                </div>

                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)', minWidth: 80, textAlign: 'right' }}>
                  {fmt(tempos.atual)} / {fmt(tempos.total)}
                </div>
              </div>

              {/* Linha 2: Pitch control */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '12px 16px', background: 'var(--bg3)',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', letterSpacing: 2, textTransform: 'uppercase', flexShrink: 0 }}>Tom</div>

                {/* Botão - */}
                <button onClick={() => changePitch(Math.max(-6, pitch - 1))} disabled={pitch <= -6} style={{
                  width: 28, height: 28, borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                  background: 'var(--bg2)', color: pitch <= -6 ? 'var(--text3)' : 'var(--text)',
                  fontSize: 16, cursor: pitch <= -6 ? 'default' : 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>−</button>

                <input
                  type="range" min="-6" max="6" step="1" value={pitch}
                  onChange={e => changePitch(e.target.value)}
                  style={{ flex: 1 }}
                />

                {/* Botão + */}
                <button onClick={() => changePitch(Math.min(6, pitch + 1))} disabled={pitch >= 6} style={{
                  width: 28, height: 28, borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                  background: 'var(--bg2)', color: pitch >= 6 ? 'var(--text3)' : 'var(--text)',
                  fontSize: 16, cursor: pitch >= 6 ? 'default' : 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>+</button>

                {/* Display do tom */}
                <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 100 }}>
                  {tomAtual ? (
                    <div>
                      <div style={{
                        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
                        color: pitch === 0 ? 'var(--text)' : 'var(--accent)',
                        lineHeight: 1,
                      }}>{tomAtual}</div>
                      {pitch !== 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                          original: {tomOriginalDisplay} · {pitch > 0 ? '+' : ''}{pitch} st
                        </div>
                      )}
                      {pitch === 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>tom original</div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: pitch === 0 ? 'var(--text2)' : 'var(--accent)' }}>
                        {pitch > 0 ? '+' : ''}{pitch} st
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>semitons</div>
                    </div>
                  )}
                </div>

                {/* Reset */}
                {pitch !== 0 && (
                  <button onClick={() => changePitch(0)} style={{
                    padding: '4px 8px', borderRadius: 'var(--radius)',
                    background: 'none', color: 'var(--text3)', fontSize: 11,
                    border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0,
                  }}>reset</button>
                )}
              </div>
            </div>

            {/* Trilhas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trilhas.map((tr, i) => (
                <div key={tr.id} className="fade-in" style={{
                  animationDelay: `${i * 0.04}s`,
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  opacity: bufferRef.current[i] ? 1 : 0.4,
                }}>
                  <div style={{ width: 3, height: 36, borderRadius: 2, background: trackColors[i % trackColors.length], flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.nome}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, letterSpacing: 1 }}>TRILHA {i + 1}</div>
                  </div>
                  <button onClick={() => toggleMute(i)} style={{
                    width: 30, height: 30, borderRadius: 'var(--radius)', cursor: 'pointer',
                    background: tr.muted ? 'rgba(255,68,68,0.2)' : 'var(--bg3)',
                    color: tr.muted ? 'var(--danger)' : 'var(--text2)',
                    border: `1px solid ${tr.muted ? 'rgba(255,68,68,0.4)' : 'var(--border)'}`,
                    fontSize: 10, fontWeight: 600,
                  }}>M</button>
                  <button onClick={() => toggleSolo(i)} style={{
                    width: 30, height: 30, borderRadius: 'var(--radius)', cursor: 'pointer',
                    background: tr.soloed ? 'rgba(232,255,60,0.2)' : 'var(--bg3)',
                    color: tr.soloed ? 'var(--accent)' : 'var(--text2)',
                    border: `1px solid ${tr.soloed ? 'rgba(232,255,60,0.4)' : 'var(--border)'}`,
                    fontSize: 10, fontWeight: 600,
                  }}>S</button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <input type="range" min="0" max="1.5" step="0.01" value={tr.vol}
                      onChange={e => updateVol(i, parseFloat(e.target.value))}
                      style={{ width: 90 }} />
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
                      {Math.round(tr.vol * 100)}%
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
