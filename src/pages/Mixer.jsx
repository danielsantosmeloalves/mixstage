import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

// Carrega SoundTouch uma vez
async function loadSoundTouch() {
  if (window._ST) return window._ST
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/soundtouchjs@0.1.30/dist/soundtouch.min.js'
    s.onload = () => { window._ST = window.SoundTouch; resolve(window._ST) }
    s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
}

// Processa um AudioBuffer com pitch shift OFFLINE usando SoundTouch
// Retorna um novo AudioBuffer com o pitch aplicado, velocidade intacta
async function processarPitch(buffer, semitons, ctx, ST) {
  if (!semitons || !ST?.SoundTouch || !ST?.SimpleFilter) return buffer

  try {
    const sampleRate = buffer.sampleRate
    const channels = buffer.numberOfChannels
    const leftData = buffer.getChannelData(0)
    const rightData = channels > 1 ? buffer.getChannelData(1) : leftData

    const st = new ST.SoundTouch(sampleRate)
    st.pitchSemitones = semitons
    st.tempo = 1.0

    let pos = 0
    const src = {
      extract: (target, numFrames, position) => {
        let count = 0
        for (let i = 0; i < numFrames; i++) {
          const idx = pos + position + i
          if (idx >= leftData.length) break
          target[i * 2] = leftData[idx]
          target[i * 2 + 1] = rightData[idx]
          count++
        }
        return count
      }
    }

    const filter = new ST.SimpleFilter(src, st)
    const blockSize = 4096
    const totalFrames = leftData.length
    const outputL = []
    const outputR = []

    // Processa em blocos
    let extracted = 0
    while (true) {
      const n = filter.extract(blockSize)
      if (n === 0) break
      const samples = filter.vector
      for (let i = 0; i < n; i++) {
        outputL.push(samples[i * 2] || 0)
        outputR.push(samples[i * 2 + 1] || 0)
      }
      extracted += n
      pos += blockSize
      if (pos > totalFrames + sampleRate * 2) break
    }

    if (outputL.length === 0) return buffer

    const newBuf = ctx.createBuffer(2, outputL.length, sampleRate)
    newBuf.getChannelData(0).set(outputL)
    newBuf.getChannelData(1).set(outputR)
    return newBuf
  } catch(e) {
    console.warn('Erro no pitch shift, usando buffer original:', e)
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
  const [progressos, setProgressos] = useState([])
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [erro, setErro] = useState('')
  const [pitch, setPitch] = useState(0)
  const [pitchAplicado, setPitchAplicado] = useState(0)
  const [processando, setProcessando] = useState(false)
  const [progressoProcessamento, setProgressoProcessamento] = useState(0)

  const audioCtxRef = useRef(null)
  const masterGainRef = useRef(null)
  const bufferOriginaisRef = useRef([])  // buffers originais sem pitch
  const bufferProcessadosRef = useRef([]) // buffers com pitch aplicado
  const sourcesRef = useRef([])
  const gainNodesRef = useRef([])
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const maxDurRef = useRef(0)
  const prontoRef = useRef(false)
  const playingRef = useRef(false)
  const STRef = useRef(null)

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

    // Carrega SoundTouch
    try { STRef.current = await loadSoundTouch() } catch(e) {}

    setProgressos(new Array(trilhas.length).fill(0))
    const buffers = await Promise.all(trilhas.map((tr, i) => carregarTrilha(tr.url, i)))

    const validos = buffers.filter(Boolean)
    if (validos.length === 0) {
      setErro('Não foi possível carregar as trilhas.')
      setPrecarregando(false)
      return
    }

    bufferOriginaisRef.current = buffers
    bufferProcessadosRef.current = [...buffers] // começa igual aos originais
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

  // Nomes de trilhas que não devem ter pitch alterado
  const NOMES_SEM_PITCH = ['drums', 'drum', 'bateria', 'click', 'guia']
  function isPitchExcluida(nomeTrilha) {
    if (!nomeTrilha) return false
    const nome = nomeTrilha.toLowerCase().trim()
    return NOMES_SEM_PITCH.some(n => nome === n || nome.includes(n))
  }

  // Aplica pitch offline em todos os buffers
  async function aplicarPitch() {
    if (pitch === pitchAplicado) return
    const wasPlaying = playingRef.current

    if (wasPlaying) {
      offsetRef.current = audioCtxRef.current.currentTime - startedAtRef.current
      stopSources()
      playingRef.current = false
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }

    setProcessando(true)
    setProgressoProcessamento(0)

    const ctx = audioCtxRef.current
    const processados = []

    for (let i = 0; i < bufferOriginaisRef.current.length; i++) {
      const buf = bufferOriginaisRef.current[i]
      if (!buf) { processados.push(null); continue }

      // Pula pitch em trilhas de percussão/guia
      const excluida = isPitchExcluida(trilhas[i]?.nome)
      const resultado = excluida
        ? bufferOriginaisRef.current[i]
        : await processarPitch(buf, pitch, ctx, STRef.current)

      processados.push(resultado)
      setProgressoProcessamento(Math.round(((i + 1) / bufferOriginaisRef.current.length) * 100))

      await new Promise(r => setTimeout(r, 10))
    }

    bufferProcessadosRef.current = processados
    maxDurRef.current = Math.max(...processados.filter(Boolean).map(b => b.duration), 0)
    setTempos(t => ({ ...t, total: maxDurRef.current }))
    setPitchAplicado(pitch)
    setProcessando(false)

    // Retoma se estava tocando
    if (wasPlaying) {
      iniciarSources(Math.min(offsetRef.current, maxDurRef.current))
      playingRef.current = true
      setPlaying(true)
      iniciarTick()
    }
  }

  function iniciarSources(offset) {
    const ctx = audioCtxRef.current
    if (!ctx) return
    stopSources()

    const sources = bufferProcessadosRef.current.map((buf, i) => {
      if (!buf || !gainNodesRef.current[i]) return null
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gainNodesRef.current[i])
      src.start(0, Math.min(offset, buf.duration))
      return src
    })

    sourcesRef.current = sources
    startedAtRef.current = ctx.currentTime - offset
  }

  function iniciarTick() {
    const ctx = audioCtxRef.current
    const tick = () => {
      const elapsed = ctx.currentTime - startedAtRef.current
      setTempos({ atual: elapsed, total: maxDurRef.current })
      if (elapsed < maxDurRef.current + 1) {
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
    const ctx = audioCtxRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()

    if (playingRef.current) {
      offsetRef.current = ctx.currentTime - startedAtRef.current
      stopSources()
      playingRef.current = false
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    } else {
      iniciarSources(offsetRef.current)
      playingRef.current = true
      setPlaying(true)
      iniciarTick()
    }
  }

  function seek(pct) {
    const newOffset = Math.max(0, pct * maxDurRef.current)
    offsetRef.current = newOffset
    setTempos(t => ({ ...t, atual: newOffset }))
    if (playingRef.current) {
      iniciarSources(newOffset)
      startedAtRef.current = audioCtxRef.current.currentTime - newOffset
    }
  }

  function applyGain(idx, lista) {
    if (!gainNodesRef.current[idx] || !audioCtxRef.current) return
    const t = lista[idx]
    const soloActive = lista.some(x => x.soloed)
    const v = t.muted ? 0 : (soloActive && !t.soloed ? 0 : t.vol)
    gainNodesRef.current[idx].gain.setTargetAtTime(v, audioCtxRef.current.currentTime, 0.02)
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
  const tomAplicado = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitchAplicado) : null
  const pitchMudou = pitch !== pitchAplicado
  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']
  const totalPct = progressos.length ? Math.round(progressos.reduce((a, b) => a + b, 0) / progressos.length) : 0

  if (carregando) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <button onClick={() => { cleanup(); navigate('/catalogo') }} style={{ background: 'none', color: 'var(--text2)', fontSize: 20, padding: '0 8px 0 0', border: 'none', cursor: 'pointer' }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{musica?.titulo}</div>
            {tomOriginal && (
              <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0, background: 'rgba(232,255,60,0.12)', color: 'var(--accent)', border: '1px solid rgba(232,255,60,0.25)', borderRadius: 4, padding: '2px 7px' }}>{tomOriginal}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>

        {/* Tela inicial */}
        {!pronto && !precarregando && (
          <div className="fade-in" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🎛️</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              {trilhas.length} trilha{trilhas.length !== 1 ? 's' : ''}
            </div>
            {tomOriginal && (
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 13, background: 'rgba(232,255,60,0.12)', color: 'var(--accent)', border: '1px solid rgba(232,255,60,0.25)', borderRadius: 6, padding: '4px 12px' }}>
                  Tom original: {tomOriginal}
                </span>
              </div>
            )}
            <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 28 }}>
              Carregue todas as trilhas para garantir sincronização perfeita.
            </div>
            {erro && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16, padding: 10, background: 'rgba(255,68,68,0.1)', borderRadius: 'var(--radius)' }}>{erro}</div>}
            <button onClick={precarregar} style={{
              padding: '16px 40px', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, letterSpacing: 3,
              border: 'none', cursor: 'pointer',
            }}>▶ CARREGAR</button>
          </div>
        )}

        {/* Carregando trilhas */}
        {precarregando && (
          <div className="fade-in" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Carregando trilhas...</div>
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

        {/* Mixer */}
        {pronto && (
          <>
            {/* Transport */}
            <div className="fade-in" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 16 }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <button onClick={togglePlay} disabled={processando} style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: playing ? 'var(--accent)' : 'var(--bg3)',
                  color: playing ? '#000' : 'var(--text)',
                  fontSize: 18, flexShrink: 0, border: '1px solid var(--border2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: processando ? 'not-allowed' : 'pointer',
                  opacity: processando ? 0.5 : 1,
                }}>{playing ? '⏸' : '▶'}</button>

                <div style={{ flex: 1 }}>
                  <div onClick={e => { if (processando) return; const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width) }}
                    style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, cursor: processando ? 'not-allowed' : 'pointer' }}>
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

              {/* Pitch control */}
              <div style={{ padding: '14px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>

                {/* Linha de controles */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: pitchMudou || processando ? 12 : 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', letterSpacing: 2, textTransform: 'uppercase', flexShrink: 0 }}>Tom</div>

                  <button onClick={() => setPitch(p => Math.max(-6, p - 1))} disabled={pitch <= -6 || processando} style={{
                    width: 28, height: 28, borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                    background: 'var(--bg2)', color: pitch <= -6 ? 'var(--text3)' : 'var(--text)',
                    fontSize: 16, cursor: pitch <= -6 || processando ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>−</button>

                  <input type="range" min="-6" max="6" step="1" value={pitch}
                    onChange={e => setPitch(parseInt(e.target.value))}
                    disabled={processando}
                    style={{ flex: 1 }} />

                  <button onClick={() => setPitch(p => Math.min(6, p + 1))} disabled={pitch >= 6 || processando} style={{
                    width: 28, height: 28, borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                    background: 'var(--bg2)', color: pitch >= 6 ? 'var(--text3)' : 'var(--text)',
                    fontSize: 16, cursor: pitch >= 6 || processando ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>+</button>

                  {/* Display tom atual */}
                  <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 80 }}>
                    {tomAtual ? (
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: pitchAplicado === 0 ? 'var(--text)' : 'var(--accent)', lineHeight: 1 }}>
                          {tomAplicado || tomAtual}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                          {pitchAplicado === 0 ? 'tom original' : `+${pitchAplicado > 0 ? '' : ''}${pitchAplicado} st`}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: pitchAplicado === 0 ? 'var(--text2)' : 'var(--accent)' }}>
                          {pitchAplicado > 0 ? '+' : ''}{pitchAplicado} st
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>aplicado</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Barra de processamento */}
                {processando && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                      <span>Processando pitch shift real...</span>
                      <span style={{ color: 'var(--accent)' }}>{progressoProcessamento}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${progressoProcessamento}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}

                {/* Botões aplicar/reset */}
                {!processando && pitchMudou && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={aplicarPitch} style={{
                      flex: 1, padding: '9px 0', borderRadius: 'var(--radius)',
                      background: 'var(--accent)', color: '#000',
                      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: 2,
                      border: 'none', cursor: 'pointer',
                    }}>
                      ✓ APLICAR {tomAtual ? `(${tomAtual})` : `(${pitch > 0 ? '+' : ''}${pitch} st)`}
                    </button>
                    <button onClick={() => setPitch(pitchAplicado)} style={{
                      padding: '9px 14px', borderRadius: 'var(--radius)',
                      background: 'none', color: 'var(--text3)', fontSize: 12,
                      border: '1px solid var(--border)', cursor: 'pointer',
                    }}>cancelar</button>
                  </div>
                )}

                {!processando && !pitchMudou && pitchAplicado !== 0 && (
                  <button onClick={() => { setPitch(0); }} style={{
                    padding: '6px 12px', borderRadius: 'var(--radius)',
                    background: 'none', color: 'var(--text3)', fontSize: 11,
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}>↺ resetar tom</button>
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
                  opacity: bufferOriginaisRef.current[i] ? 1 : 0.4,
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
