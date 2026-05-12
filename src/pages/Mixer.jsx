import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Mixer({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 })
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })

  const audioCtxRef = useRef(null)
  const masterGainRef = useRef(null)
  const bufferRef = useRef([])       // AudioBuffers decodificados
  const sourcesRef = useRef([])      // BufferSourceNodes ativos
  const gainNodesRef = useRef([])    // GainNodes por trilha
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: t } = await supabase.from('trilhas').select('*').eq('musica_id', id).order('ordem')
      setMusica(m)
      setTrilhas((t || []).map(tr => ({ ...tr, vol: 1, muted: false, soloed: false })))
      setCarregando(false)
    }
    carregar()
    return () => cleanup()
  }, [id])

  function getCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      masterGainRef.current = audioCtxRef.current.createGain()
      masterGainRef.current.connect(audioCtxRef.current.destination)
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

  // Pré-carrega todos os buffers antes de permitir o play
  async function precarregar() {
    setPrecarregando(true)
    setProgresso({ atual: 0, total: trilhas.length })
    const ctx = getCtx()
    const buffers = []

    for (let i = 0; i < trilhas.length; i++) {
      try {
        const res = await fetch(trilhas[i].url)
        const arrayBuf = await res.arrayBuffer()
        const decoded = await ctx.decodeAudioData(arrayBuf)
        buffers[i] = decoded
      } catch(e) {
        buffers[i] = null
      }
      setProgresso({ atual: i + 1, total: trilhas.length })
    }

    bufferRef.current = buffers
    maxDurRef.current = Math.max(...buffers.filter(Boolean).map(b => b.duration), 0)
    setTempos({ atual: 0, total: maxDurRef.current })

    // Cria os gain nodes
    gainNodesRef.current = trilhas.map((tr, i) => {
      const gain = ctx.createGain()
      gain.gain.value = tr.vol
      gain.connect(masterGainRef.current)
      return gain
    })

    setPronto(true)
    setPrecarregando(false)
  }

  function iniciarSources(offset) {
    const ctx = audioCtxRef.current
    stopSources()
    const sources = bufferRef.current.map((buf, i) => {
      if (!buf) return null
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gainNodesRef.current[i])
      src.start(0, Math.min(offset, buf.duration))
      return src
    })
    sourcesRef.current = sources
    startedAtRef.current = ctx.currentTime - offset
  }

  async function togglePlay() {
    const ctx = getCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    if (playing) {
      // Pausa: salva posição atual
      offsetRef.current = ctx.currentTime - startedAtRef.current
      stopSources()
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    } else {
      // Play: inicia todas as trilhas exatamente ao mesmo tempo
      iniciarSources(offsetRef.current)
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
      iniciarSources(newOffset)
      startedAtRef.current = audioCtxRef.current.currentTime - newOffset
    }
  }

  function updateVol(idx, vol) {
    setTrilhas(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], vol }
      const soloActive = next.some(t => t.soloed)
      if (gainNodesRef.current[idx]) {
        const t = next[idx]
        const effective = t.muted ? 0 : (soloActive && !t.soloed ? 0 : vol)
        gainNodesRef.current[idx].gain.setTargetAtTime(effective, audioCtxRef.current?.currentTime || 0, 0.02)
      }
      return next
    })
  }

  function toggleMute(idx) {
    setTrilhas(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], muted: !next[idx].muted }
      const soloActive = next.some(t => t.soloed)
      if (gainNodesRef.current[idx]) {
        const t = next[idx]
        const effective = t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol)
        gainNodesRef.current[idx].gain.setTargetAtTime(effective, audioCtxRef.current?.currentTime || 0, 0.02)
      }
      return next
    })
  }

  function toggleSolo(idx) {
    setTrilhas(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], soloed: !next[idx].soloed }
      const soloActive = next.some(t => t.soloed)
      next.forEach((t, i) => {
        if (gainNodesRef.current[i]) {
          const effective = t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol)
          gainNodesRef.current[i].gain.setTargetAtTime(effective, audioCtxRef.current?.currentTime || 0, 0.02)
        }
      })
      return next
    })
  }

  function fmt(s) {
    if (!s || isNaN(s)) return '0:00'
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']
  const pct = progresso.total ? Math.round((progresso.atual / progresso.total) * 100) : 0

  if (carregando) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>
      Carregando...
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '16px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <button onClick={() => { cleanup(); navigate('/catalogo') }} style={{
          background: 'none', color: 'var(--text2)', fontSize: 20, padding: '0 8px 0 0',
        }}>←</button>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{musica?.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>

        {/* Estado: não carregado ainda */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '40px 24px',
            textAlign: 'center', marginBottom: 24,
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🎛️</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {trilhas.length} trilha{trilhas.length !== 1 ? 's' : ''} encontrada{trilhas.length !== 1 ? 's' : ''}
            </div>
            <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 24 }}>
              As trilhas precisam ser carregadas antes de tocar para garantir sincronização perfeita.
            </div>
            <button onClick={precarregar} style={{
              padding: '13px 32px', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, letterSpacing: 3,
            }}>CARREGAR TRILHAS</button>
          </div>
        )}

        {/* Estado: carregando */}
        {precarregando && (
          <div className="fade-in" style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '40px 24px',
            textAlign: 'center', marginBottom: 24,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              Carregando trilhas...
            </div>
            <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginBottom: 12, maxWidth: 300, margin: '0 auto 12px' }}>
              <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 3, width: `${pct}%`, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              {progresso.atual} de {progresso.total} trilhas — {pct}%
            </div>
          </div>
        )}

        {/* Mixer — aparece após carregamento */}
        {pronto && (
          <>
            {/* Transport */}
            <div className="fade-in" style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '20px 24px',
              display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24,
            }}>
              <button onClick={togglePlay} style={{
                width: 52, height: 52, borderRadius: '50%',
                background: playing ? 'var(--accent)' : 'var(--bg3)',
                color: playing ? '#000' : 'var(--text)',
                fontSize: 20, flexShrink: 0,
                border: '1px solid var(--border2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{playing ? '⏸' : '▶'}</button>

              <div style={{ flex: 1 }}>
                <div
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    seek((e.clientX - rect.left) / rect.width)
                  }}
                  style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, cursor: 'pointer', position: 'relative' }}
                >
                  <div style={{
                    height: '100%', borderRadius: 3, background: 'var(--accent)',
                    width: `${tempos.total ? (tempos.atual / tempos.total) * 100 : 0}%`,
                    transition: 'width 0.1s linear',
                    pointerEvents: 'none',
                  }} />
                </div>
              </div>

              <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text2)', minWidth: 90, textAlign: 'right' }}>
                {fmt(tempos.atual)} / {fmt(tempos.total)}
              </div>
            </div>

            {/* Trilhas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {trilhas.map((tr, i) => (
                <div key={tr.id} className="fade-in" style={{
                  animationDelay: `${i * 0.06}s`,
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                  display: 'flex', alignItems: 'center', gap: 16,
                  opacity: bufferRef.current[i] ? 1 : 0.4,
                }}>
                  <div style={{ width: 3, height: 40, borderRadius: 2, background: trackColors[i % trackColors.length], flexShrink: 0 }} />

                  <div style={{ minWidth: 120, flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{tr.nome}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, letterSpacing: 1 }}>
                      {bufferRef.current[i] ? `TRILHA ${i + 1}` : 'ERRO AO CARREGAR'}
                    </div>
                  </div>

                  <button onClick={() => toggleMute(i)} style={{
                    width: 32, height: 32, borderRadius: 'var(--radius)',
                    background: tr.muted ? 'rgba(255,68,68,0.2)' : 'var(--bg3)',
                    color: tr.muted ? 'var(--danger)' : 'var(--text2)',
                    border: `1px solid ${tr.muted ? 'rgba(255,68,68,0.4)' : 'var(--border)'}`,
                    fontSize: 11, fontWeight: 600, letterSpacing: 1,
                  }}>M</button>

                  <button onClick={() => toggleSolo(i)} style={{
                    width: 32, height: 32, borderRadius: 'var(--radius)',
                    background: tr.soloed ? 'rgba(232,255,60,0.2)' : 'var(--bg3)',
                    color: tr.soloed ? 'var(--accent)' : 'var(--text2)',
                    border: `1px solid ${tr.soloed ? 'rgba(232,255,60,0.4)' : 'var(--border)'}`,
                    fontSize: 11, fontWeight: 600, letterSpacing: 1,
                  }}>S</button>

                  <input
                    type="range" min="0" max="1.5" step="0.01"
                    value={tr.vol}
                    onChange={e => updateVol(i, parseFloat(e.target.value))}
                    style={{ width: 120 }}
                  />
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)', minWidth: 36, textAlign: 'right' }}>
                    {Math.round(tr.vol * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {trilhas.length === 0 && !carregando && (
          <div style={{ textAlign: 'center', color: 'var(--text2)', padding: 60 }}>
            Nenhuma trilha cadastrada para esta música.
          </div>
        )}
      </div>
    </div>
  )
}
