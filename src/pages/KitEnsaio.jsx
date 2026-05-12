/*
===========================================
ANTES DE USAR ESTE ARQUIVO
===========================================

1. Rode no terminal:

npm install tone

2. Depois faça:

git add .
git commit -m "fix pitch shift"
git push

===========================================
*/

import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as Tone from 'tone'
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

const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff','#ff6bd6','#6bffd6']

export default function KitEnsaio({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()

  const [musica, setMusica] = useState(null)
  const [kitDisponivel, setKitDisponivel] = useState({})
  const [tipoSelecionado, setTipoSelecionado] = useState(null)
  const [pitchSelecionado, setPitchSelecionado] = useState(0)
  const [tfSalvo, setTfSalvo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [volume, setVolume] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [pitchAplicado, setPitchAplicado] = useState(0)
  const [processando, setProcessando] = useState(false)
  const [salvandoTf, setSalvandoTf] = useState(false)
  const [tfMsg, setTfMsg] = useState('')
  const [erro, setErro] = useState('')

  const playerRef = useRef(null)
  const pitchShiftRef = useRef(null)
  const volumeRef = useRef(null)
  const rafRef = useRef(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const playingRef = useRef(false)
  const durationRef = useRef(0)
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
          setTfSalvo(tf.tom)
          setPitchSelecionado(tf.tom)
        }
      }
      setCarregando(false)
    }
    carregar()
    return () => {
      pararTudo()
      playerRef.current?.dispose()
      pitchShiftRef.current?.dispose()
      volumeRef.current?.dispose()
    }
  }, [id])

  async function criarAudio() {
    await Tone.start()
    if (pitchShiftRef.current) return
    const pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.03,  // janela menor = menos chorus/flanging
      delayTime: 0,
      feedback: 0,
      wet: 1,
    })
    const volumeNode = new Tone.Volume(0)
    pitchShift.connect(volumeNode)
    volumeNode.toDestination()
    pitchShiftRef.current = pitchShift
    volumeRef.current = volumeNode
  }

  function pararTudo() {
    try { playerRef.current?.stop() } catch(e) {}
    playingRef.current = false
    setPlaying(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  async function handleCarregar() {
    if (!tipoSelecionado) return
    setPrecarregando(true)
    setErro('')
    try {
      await criarAudio()

      // Aplica pitch pré-selecionado
      if (pitchShiftRef.current) {
        pitchShiftRef.current.pitch = pitchSelecionado
        setPitch(pitchSelecionado)
        setPitchAplicado(pitchSelecionado)
        pitchRef.current = pitchSelecionado
      }

      const url = kitDisponivel[tipoSelecionado].url
      if (playerRef.current) playerRef.current.dispose()

      const player = new Tone.Player({ url, autostart: false })
      player.connect(pitchShiftRef.current)
      await Tone.loaded()

      durationRef.current = player.buffer.duration
      playerRef.current = player
      setTempos({ atual: 0, total: durationRef.current })
      setupMediaSession()
      setPronto(true)
    } catch(e) {
      console.error(e)
      setErro('Erro ao carregar áudio.')
    }
    setPrecarregando(false)
  }

  function iniciarTick() {
    const tick = () => {
      if (!playingRef.current) return
      const elapsed = Tone.now() - startedAtRef.current
      setTempos({ atual: Math.max(0, elapsed), total: durationRef.current })
      if (elapsed < durationRef.current) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        playingRef.current = false
        setPlaying(false)
        offsetRef.current = 0
        setTempos({ atual: 0, total: durationRef.current })
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
      }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }

  async function togglePlay() {
    const player = playerRef.current
    if (!player) return
    if (playingRef.current) {
      offsetRef.current = Tone.now() - startedAtRef.current
      player.stop()
      playingRef.current = false
      setPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    } else {
      player.start(undefined, offsetRef.current)
      startedAtRef.current = Tone.now() - offsetRef.current
      playingRef.current = true
      setPlaying(true)
      iniciarTick()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }
  }

  async function aplicarPitch() {
    if (!pitchShiftRef.current) return
    setProcessando(true)
    try {
      pitchShiftRef.current.pitch = pitch
      setPitchAplicado(pitch)
      pitchRef.current = pitch
    } catch(e) { console.error(e) }
    setProcessando(false)
  }

  function changeVolume(val) {
    const v = parseFloat(val)
    setVolume(v)
    if (volumeRef.current) {
      volumeRef.current.volume.value = Tone.gainToDb(v <= 0 ? 0.0001 : v)
    }
  }

  function seek(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const pct = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1))
    const newOffset = pct * durationRef.current
    offsetRef.current = newOffset
    setTempos(t => ({ ...t, atual: newOffset }))
    if (playingRef.current) {
      playerRef.current.stop()
      playerRef.current.start(undefined, newOffset)
      startedAtRef.current = Tone.now() - newOffset
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
  const tomSelecionadoDisplay = tomOriginal ? calcularTom(tomOriginal.split('/')[0], pitchSelecionado) : null
  const pitchMudou = pitch !== pitchAplicado
  const tiposDisponiveis = KIT_TIPOS.filter(t => kitDisponivel[t.key])

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      {/* Header */}
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => { pararTudo(); navigate(`/escolha/${id}`) }} style={{ background:'none', color:'var(--text2)', fontSize:20, padding:'0 8px 0 0', border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{musica?.titulo}</div>
            {tomOriginal && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'2px 7px' }}>{tomOriginal}</span>}
            {tfDisplay !== null && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(60,255,143,0.12)', color:'var(--success)', border:'1px solid rgba(60,255,143,0.25)', borderRadius:4, padding:'2px 7px' }}>TF: {tfDisplay}</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>Kit Ensaio{pronto ? ` — ${KIT_TIPOS.find(t=>t.key===tipoSelecionado)?.label}` : ''}</div>
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

            {/* Trilha */}
            <div>
              <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase', marginBottom:10 }}>Trilha</div>
              {tiposDisponiveis.length === 0 ? (
                <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13, padding:16 }}>Nenhuma trilha do Kit Ensaio cadastrada.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {tiposDisponiveis.map((tipo) => {
                    const sel = tipoSelecionado === tipo.key
                    const idx = KIT_TIPOS.findIndex(t => t.key === tipo.key)
                    return (
                      <div key={tipo.key} onClick={() => setTipoSelecionado(tipo.key)}
                        style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:'var(--radius)', background: sel ? 'rgba(232,255,60,0.08)' : 'var(--bg3)', border:`1px solid ${sel ? 'rgba(232,255,60,0.3)' : 'var(--border)'}`, cursor:'pointer', transition:'all 0.15s' }}>
                        <div style={{ width:16, height:16, borderRadius:'50%', flexShrink:0, background: sel ? 'var(--accent)' : 'var(--bg2)', border:`2px solid ${sel ? 'var(--accent)' : 'var(--border2)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {sel && <div style={{ width:6, height:6, borderRadius:'50%', background:'#000' }} />}
                        </div>
                        <div style={{ width:3, height:18, borderRadius:1, background:trackColors[idx%8], flexShrink:0 }} />
                        <div style={{ fontSize:14, fontFamily:'var(--font-display)', fontWeight:600, color: sel ? 'var(--text)' : 'var(--text2)' }}>{tipo.label}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Tom */}
            <div>
              <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase', marginBottom:10 }}>
                Tom — {tomSelecionadoDisplay || (pitchSelecionado !== 0 ? `${pitchSelecionado > 0 ? '+' : ''}${pitchSelecionado} st` : 'original')}
              </div>

              {tfSalvo !== null && (
                <button onClick={() => setPitchSelecionado(tfSalvo)} style={{
                  padding:'6px 12px', borderRadius:'var(--radius)', fontSize:11, marginBottom:10,
                  background: pitchSelecionado === tfSalvo ? 'rgba(60,255,143,0.15)' : 'var(--bg3)',
                  color: pitchSelecionado === tfSalvo ? 'var(--success)' : 'var(--text2)',
                  border:`1px solid ${pitchSelecionado === tfSalvo ? 'rgba(60,255,143,0.3)' : 'var(--border)'}`,
                  cursor:'pointer', letterSpacing:1,
                }}>★ Tom Favorito {tfDisplay ? `(${tfDisplay})` : `(${tfSalvo > 0 ? '+' : ''}${tfSalvo} st)`}</button>
              )}

              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <button onClick={() => setPitchSelecionado(p => Math.max(-4, p-1))} disabled={pitchSelecionado <= -4} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitchSelecionado <= -4 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitchSelecionado <= -4 ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>−</button>
                <input type="range" min="-4" max="4" step="1" value={pitchSelecionado} onChange={e => setPitchSelecionado(parseInt(e.target.value))} style={{ flex:1 }} />
                <button onClick={() => setPitchSelecionado(p => Math.min(4, p+1))} disabled={pitchSelecionado >= 4} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitchSelecionado >= 4 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitchSelecionado >= 4 ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>+</button>
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
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:20 }}>Carregando...</div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden', maxWidth:240, margin:'0 auto' }}>
              <div style={{ height:'100%', background:'var(--accent)', borderRadius:3, width:'60%', animation:'pulse 1s ease-in-out infinite' }} />
            </div>
          </div>
        )}

        {/* Player */}
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
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, padding:'10px 14px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Vol</div>
                <input type="range" min="0" max="1.5" step="0.01" value={volume} onChange={e => changeVolume(e.target.value)} style={{ flex:1 }} />
                <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', minWidth:36, textAlign:'right' }}>{Math.round(volume*100)}%</div>
              </div>

              {/* Pitch */}
              <div style={{ padding:'14px 16px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                  <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Tom</div>
                  <button onClick={() => setPitch(p => Math.max(-4, p-1))} disabled={pitch <= -4 || processando} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitch <= -4 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitch <= -4 || processando ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>−</button>
                  <input type="range" min="-4" max="4" step="1" value={pitch} onChange={e => setPitch(parseInt(e.target.value))} disabled={processando} style={{ flex:1 }} />
                  <button onClick={() => setPitch(p => Math.min(4, p+1))} disabled={pitch >= 4 || processando} style={{ width:32, height:32, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color: pitch >= 4 ? 'var(--text3)' : 'var(--text)', fontSize:18, cursor: pitch >= 4 || processando ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>+</button>
                  <div style={{ flexShrink:0, textAlign:'center', minWidth:80 }}>
                    {tomAplicadoDisplay ? (
                      <div>
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:18, color: pitchAplicado === 0 ? 'var(--text)' : 'var(--accent)', lineHeight:1 }}>{tomAplicadoDisplay}</div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>{pitchAplicado === 0 ? 'original' : `${pitchAplicado > 0 ? '+' : ''}${pitchAplicado} st`}</div>
                      </div>
                    ) : (
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:14, color: pitchAplicado === 0 ? 'var(--text2)' : 'var(--accent)' }}>{pitchAplicado > 0 ? '+' : ''}{pitchAplicado} st</div>
                    )}
                  </div>
                </div>

                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {!processando && pitchMudou && (
                    <>
                      <button onClick={aplicarPitch} style={{ flex:1, padding:'9px 0', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, letterSpacing:2, border:'none', cursor:'pointer' }}>
                        ✓ APLICAR {tomAtual ? `(${tomAtual})` : `(${pitch > 0 ? '+' : ''}${pitch} st)`}
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
