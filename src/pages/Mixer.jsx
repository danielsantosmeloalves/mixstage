import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Mixer({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })

  const audioCtxRef = useRef(null)
  const masterGainRef = useRef(null)
  const trilhasRef = useRef([])
  const rafRef = useRef(null)
  const offsetRef = useRef(0)
  const startedAtRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: t } = await supabase.from('trilhas').select('*').eq('musica_id', id).order('ordem')
      setMusica(m)
      setTrilhas((t || []).map(tr => ({ ...tr, vol: 1, muted: false, soloed: false })))
      setLoading(false)
    }
    carregar()
    return () => { stopAll(); if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [id])

  function getCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      masterGainRef.current = audioCtxRef.current.createGain()
      masterGainRef.current.connect(audioCtxRef.current.destination)
    }
    return audioCtxRef.current
  }

  function stopAll() {
    trilhasRef.current.forEach(t => { try { t.source?.stop() } catch(e){} })
    trilhasRef.current = []
  }

  async function togglePlay() {
    const ctx = getCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    if (playing) {
      offsetRef.current = ctx.currentTime - startedAtRef.current + offsetRef.current
      stopAll()
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    } else {
      stopAll()
      const offset = offsetRef.current
      const loaded = []

      await Promise.all(trilhas.map(async (tr, i) => {
        try {
          const res = await fetch(tr.url)
          const buf = await res.arrayBuffer()
          const decoded = await ctx.decodeAudioData(buf)

          const gainNode = ctx.createGain()
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 64
          gainNode.connect(analyser)
          analyser.connect(masterGainRef.current)

          const soloActive = trilhas.some(t => t.soloed)
          gainNode.gain.value = tr.muted ? 0 : (soloActive && !tr.soloed ? 0 : tr.vol)

          const source = ctx.createBufferSource()
          source.buffer = decoded
          source.connect(gainNode)
          source.start(0, Math.min(offset, decoded.duration))

          loaded[i] = { source, gainNode, analyser, duration: decoded.duration }
        } catch(e) { loaded[i] = null }
      }))

      trilhasRef.current = loaded
      startedAtRef.current = ctx.currentTime - offset
      setPlaying(true)

      const maxDur = Math.max(...loaded.filter(Boolean).map(t => t.duration), 0)
      setTempos(t => ({ ...t, total: maxDur }))

      const tick = () => {
        const elapsed = ctx.currentTime - startedAtRef.current
        setTempos({ atual: elapsed, total: maxDur })
        if (elapsed < maxDur) rafRef.current = requestAnimationFrame(tick)
        else { setPlaying(false); offsetRef.current = 0 }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  function seek(pct) {
    const total = tempos.total
    const newOffset = pct * total
    offsetRef.current = newOffset
    setTempos(t => ({ ...t, atual: newOffset }))
    if (playing) {
      stopAll()
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      setTimeout(() => togglePlay(), 50)
    }
  }

  function updateVol(idx, vol) {
    setTrilhas(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], vol }
      const soloActive = next.some(t => t.soloed)
      if (trilhasRef.current[idx]) {
        trilhasRef.current[idx].gainNode.gain.setTargetAtTime(
          next[idx].muted ? 0 : (soloActive && !next[idx].soloed ? 0 : vol),
          audioCtxRef.current?.currentTime || 0, 0.02
        )
      }
      return next
    })
  }

  function toggleMute(idx) {
    setTrilhas(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], muted: !next[idx].muted }
      const soloActive = next.some(t => t.soloed)
      if (trilhasRef.current[idx]) {
        const t = next[idx]
        trilhasRef.current[idx].gainNode.gain.setTargetAtTime(
          t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol),
          audioCtxRef.current?.currentTime || 0, 0.02
        )
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
        if (trilhasRef.current[i]) {
          trilhasRef.current[i].gainNode.gain.setTargetAtTime(
            t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol),
            audioCtxRef.current?.currentTime || 0, 0.02
          )
        }
      })
      return next
    })
  }

  function fmt(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>
      Carregando mixer...
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
        <button onClick={() => navigate('/catalogo')} style={{
          background: 'none', color: 'var(--text2)', fontSize: 20, padding: '0 8px 0 0',
        }}>←</button>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{musica?.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
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
            }}>
              {/* Color bar */}
              <div style={{ width: 3, height: 40, borderRadius: 2, background: trackColors[i % trackColors.length], flexShrink: 0 }} />

              {/* Nome */}
              <div style={{ minWidth: 120, flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{tr.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, letterSpacing: 1 }}>TRILHA {i + 1}</div>
              </div>

              {/* Mute */}
              <button onClick={() => toggleMute(i)} style={{
                width: 32, height: 32, borderRadius: 'var(--radius)',
                background: tr.muted ? 'rgba(255,68,68,0.2)' : 'var(--bg3)',
                color: tr.muted ? 'var(--danger)' : 'var(--text2)',
                border: `1px solid ${tr.muted ? 'rgba(255,68,68,0.4)' : 'var(--border)'}`,
                fontSize: 11, fontWeight: 600, letterSpacing: 1,
              }}>M</button>

              {/* Solo */}
              <button onClick={() => toggleSolo(i)} style={{
                width: 32, height: 32, borderRadius: 'var(--radius)',
                background: tr.soloed ? 'rgba(232,255,60,0.2)' : 'var(--bg3)',
                color: tr.soloed ? 'var(--accent)' : 'var(--text2)',
                border: `1px solid ${tr.soloed ? 'rgba(232,255,60,0.4)' : 'var(--border)'}`,
                fontSize: 11, fontWeight: 600, letterSpacing: 1,
              }}>S</button>

              {/* Volume slider */}
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

        {trilhas.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text2)', padding: 60 }}>
            Nenhuma trilha cadastrada para esta música.
          </div>
        )}
      </div>
    </div>
  )
}
