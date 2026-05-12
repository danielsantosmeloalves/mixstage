/*
===========================================
DEPENDÊNCIA: npm install tone
===========================================
*/
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as Tone from 'tone'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'
import CifraViewer from '../components/CifraViewer'
import TimeCodeNav from '../components/TimeCodeNav'

const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
const LIMITE_MOBILE = 15
const EXCLUIR_PITCH = ['bateria', 'drum', 'drums', 'click', 'guia']

function deveExcluirPitch(nome) {
  if (!nome) return false
  return EXCLUIR_PITCH.some(p => nome.toLowerCase().includes(p))
}

export default function Mixer({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()

  const [musica, setMusica] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [cifras, setCifras] = useState({})
  const [secoes, setSecoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [precarregando, setPrecarregando] = useState(false)
  const [trilhaAtual, setTrilhaAtual] = useState(0)
  const [selecionadas, setSelecionadas] = useState(new Set())
  const [avisoLimite, setAvisoLimite] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [tempos, setTempos] = useState({ atual: 0, total: 0 })
  const [erro, setErro] = useState('')
  const [pitch, setPitch] = useState(0)
  const [tfSalvo, setTfSalvo] = useState(null)
  const [salvandoTf, setSalvandoTf] = useState(false)
  const [tfMsg, setTfMsg] = useState('')

  const playersRef = useRef([])
  const pitchNodeRef = useRef(null)
  const gainNodesRef = useRef([])
  const masterVolRef = useRef(null)
  const audioElRef = useRef(null)
  const heartbeatRef = useRef(null)
  const rafRef = useRef(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const maxDurRef = useRef(0)
  const prontoRef = useRef(false)
  const playingRef = useRef(false)
  const pitchRef = useRef(0)
  const trilhasRef = useRef([])
  const loopRef = useRef(null)

  useEffect(() => {
    async function carregar() {
      const [mRes, tRes, cRes, tcRes, tfRes] = await Promise.all([
        supabase.from('musicas').select('*').eq('id', id).single(),
        supabase.from('trilhas').select('*').eq('musica_id', id).order('ordem'),
        supabase.from('cifras').select('*').eq('musica_id', id),
        supabase.from('timecodes').select('*').eq('musica_id', id).single(),
        session?.user?.id ? supabase.from('tons_favoritos').select('tom').eq('user_id', session.user.id).eq('musica_id', id).single() : Promise.resolve({ data: null }),
      ])

      setMusica(mRes.data)
      const lista = (tRes.data || []).map(tr => ({ ...tr, vol: 1, muted: false, soloed: false }))
      setTrilhas(lista)
      trilhasRef.current = lista

      const cifrasMapa = {}
      if (cRes.data) cRes.data.forEach(c => { cifrasMapa[c.tom] = c })
      setCifras(cifrasMapa)

      if (tcRes.data?.secoes) setSecoes(tcRes.data.secoes)

      if (tfRes.data) {
        setTfSalvo(tfRes.data.tom)
        setPitch(tfRes.data.tom)
        pitchRef.current = tfRes.data.tom
      }

      const todas = new Set(lista.map((_, i) => i))
      if (IS_MOBILE && todas.size > LIMITE_MOBILE) {
        setSelecionadas(new Set([...todas].slice(0, LIMITE_MOBILE)))
      } else {
        setSelecionadas(todas)
      }
      setCarregando(false)
    }
    carregar()
    return () => pararTudo()
  }, [id])

  // Loop por seção
  useEffect(() => {
    if (!loopRef.current || !playingRef.current) return
    const { inicio, fim } = loopRef.current
    if (fim && tempos.atual >= fim) {
      seekTo(inicio)
    }
  }, [tempos.atual])

  function toggleSelecionada(i) {
    setSelecionadas(prev => {
      const next = new Set(prev)
      if (next.has(i)) { next.delete(i); setAvisoLimite(false) }
      else {
        if (IS_MOBILE && next.size >= LIMITE_MOBILE) { setAvisoLimite(true); return prev }
        next.add(i); setAvisoLimite(false)
      }
      return next
    })
  }

  function selecionarTodas() {
    const todas = trilhas.map((_, i) => i)
    if (IS_MOBILE && todas.length > LIMITE_MOBILE) {
      setSelecionadas(new Set(todas.slice(0, LIMITE_MOBILE)))
      setAvisoLimite(true)
    } else {
      setSelecionadas(new Set(todas))
      setAvisoLimite(false)
    }
  }

  function criarAudioSilencioso() {
    if (audioElRef.current) return audioElRef.current
    const sr = 44100, dataSize = sr * 2
    const buf = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buf)
    const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
    ws(0,'RIFF'); view.setUint32(4,36+dataSize,true); ws(8,'WAVE'); ws(12,'fmt ')
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
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    heartbeatRef.current = setInterval(async () => {
      if (Tone.context.state === 'suspended') await Tone.context.resume()
    }, 25000)
  }

  function pararTudo() {
    playersRef.current.forEach(p => { try { p?.stop(); p?.dispose() } catch(e){} })
    playersRef.current = []
    pitchNodeRef.current?.dispose(); pitchNodeRef.current = null
    gainNodesRef.current.forEach(g => { try { g?.dispose() } catch(e){} })
    gainNodesRef.current = []
    masterVolRef.current?.dispose(); masterVolRef.current = null
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    playingRef.current = false
    setPlaying(false)
  }

  async function handleCarregar() {
    if (prontoRef.current) return
    setPrecarregando(true); setErro('')

    const audioEl = criarAudioSilencioso()
    try { await audioEl.play() } catch(e) {}
    await Tone.start()
    iniciarHeartbeat()

    const lista = trilhasRef.current
    const selecionadasArr = [...selecionadas].sort((a, b) => a - b)

    // PitchShift global com parâmetros otimizados
    const pitchNode = new Tone.PitchShift({
      pitch: pitchRef.current,
      windowSize: 0.01,
      delayTime: 0,
      feedback: 0,
      wet: 1,
    })

    const masterVol = new Tone.Volume(0)
    pitchNode.connect(masterVol)
    masterVol.toDestination()
    pitchNodeRef.current = pitchNode
    masterVolRef.current = masterVol

    const players = new Array(lista.length).fill(null)
    const gains = new Array(lista.length).fill(null)

    for (let idx = 0; idx < selecionadasArr.length; idx++) {
      const i = selecionadasArr[idx]
      setTrilhaAtual(idx)
      try {
        const gainNode = new Tone.Volume(0)
        const excluir = deveExcluirPitch(lista[i].nome)
        // Excluídas do pitch vão direto para master (mantém sincronia de tempo)
        gainNode.connect(excluir ? masterVol : pitchNode)
        const player = new Tone.Player({ url: lista[i].url, autostart: false })
        player.connect(gainNode)
        players[i] = player
        gains[i] = gainNode
        await new Promise(r => setTimeout(r, 30))
      } catch(e) { console.warn('Erro trilha', i, e) }
    }

    await Tone.loaded()

    const duracoes = players.filter(Boolean).map(p => p.buffer?.duration || 0)
    if (duracoes.length === 0) {
      setErro('Não foi possível carregar as trilhas.')
      setPrecarregando(false)
      return
    }

    maxDurRef.current = Math.max(...duracoes)
    playersRef.current = players
    gainNodesRef.current = gains
    setTempos({ atual: 0, total: maxDurRef.current })

    trilhasRef.current.forEach((tr, i) => {
      if (gains[i]) gains[i].volume.value = tr.muted ? -Infinity : Tone.gainToDb(tr.vol <= 0 ? 0.0001 : tr.vol)
    })

    setupMediaSession()
    prontoRef.current = true
    setPronto(true)
    setPrecarregando(false)
  }

  function iniciarTick() {
    const tick = () => {
      if (!playingRef.current) return
      const elapsed = Tone.now() - startedAtRef.current
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
    if (Tone.context.state === 'suspended') await Tone.context.resume()
    if (playingRef.current) {
      offsetRef.current = Tone.now() - startedAtRef.current
      playersRef.current.forEach(p => { try { p?.stop() } catch(e){} })
      playingRef.current = false; setPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    } else {
      const offset = offsetRef.current
      playersRef.current.forEach((p, i) => {
        if (!p || !selecionadas.has(i)) return
        try { p.start(undefined, offset) } catch(e) {}
      })
      startedAtRef.current = Tone.now() - offset
      playingRef.current = true; setPlaying(true); iniciarTick()
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }
  }

  function seekTo(newOffset) {
    const safe = Math.max(0, Math.min(newOffset, maxDurRef.current - 0.1))
    offsetRef.current = safe
    setTempos(t => ({ ...t, atual: safe }))
    if (playingRef.current) {
      playersRef.current.forEach(p => { try { p?.stop() } catch(e){} })
      playersRef.current.forEach((p, i) => {
        if (!p || !selecionadas.has(i)) return
        try { p.start(undefined, safe) } catch(e) {}
      })
      startedAtRef.current = Tone.now() - safe
    }
  }

  function seek(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const pct = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1))
    seekTo(pct * maxDurRef.current)
  }

  function reiniciar() { seekTo(0) }
  function pular(seg) { seekTo(Math.max(0, (Tone.now() - startedAtRef.current) + seg)) }

  function changePitch(val) {
    const s = parseInt(val)
    setPitch(s); pitchRef.current = s
    if (pitchNodeRef.current) pitchNodeRef.current.pitch = s
  }

  function applyGainTrilha(idx, lista) {
    const g = gainNodesRef.current[idx]
    if (!g) return
    const t = lista[idx]
    const soloActive = lista.some(x => x.soloed)
    const ativo = !t.muted && !(soloActive && !t.soloed)
    g.volume.value = ativo ? Tone.gainToDb(t.vol <= 0 ? 0.0001 : t.vol) : -Infinity
  }

  function updateVol(idx, vol) {
    setTrilhas(prev => { const n=[...prev]; n[idx]={...n[idx],vol}; applyGainTrilha(idx,n); return n })
  }
  function toggleMute(idx) {
    setTrilhas(prev => { const n=[...prev]; n[idx]={...n[idx],muted:!n[idx].muted}; applyGainTrilha(idx,n); return n })
  }
  function toggleSolo(idx) {
    setTrilhas(prev => { const n=[...prev]; n[idx]={...n[idx],soloed:!n[idx].soloed}; n.forEach((_,i)=>applyGainTrilha(i,n)); return n })
  }

  async function salvarTf() {
    if (!session?.user?.id) return
    setSalvandoTf(true); setTfMsg('')
    const { error } = await supabase.from('tons_favoritos').upsert({ user_id:session.user.id, musica_id:id, tom:pitch }, { onConflict:'user_id,musica_id' })
    if (!error) { setTfSalvo(pitch); setTfMsg('TF salvo!'); setTimeout(()=>setTfMsg(''),2000) }
    setSalvandoTf(false)
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: musica?.titulo||'MixStage', artist: musica?.artista||'', album: musica?.tom?`Tom: ${musica.tom}`:'MixStage' })
    navigator.mediaSession.setActionHandler('play', ()=>{ if(!playingRef.current) togglePlay() })
    navigator.mediaSession.setActionHandler('pause', ()=>{ if(playingRef.current) togglePlay() })
  }

  function fmt(s) {
    if (!s||isNaN(s)||s<0) return '0:00'
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`
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
        <button onClick={() => { pararTudo(); navigate(`/escolha/${id}`) }} style={{ background:'none', color:'var(--text2)', fontSize:20, padding:'0 8px 0 0', border:'none', cursor:'pointer' }}>←</button>
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
              <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, marginBottom:6 }}>{trilhas.length} trilha{trilhas.length!==1?'s':''}</div>
              {tomOriginal && <span style={{ fontSize:13, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:6, padding:'4px 12px' }}>Tom original: {tomOriginal}{tfDisplay?` · TF: ${tfDisplay}`:''}</span>}
            </div>

            <div style={{ marginBottom:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <div style={{ fontSize:12, color:'var(--text2)' }}>Faixas: {selecionadas.size}{IS_MOBILE?` / ${LIMITE_MOBILE}`:''}</div>
                <div style={{ display:'flex', gap:12 }}>
                  <button onClick={selecionarTodas} style={{ fontSize:11, color:'var(--accent)', background:'none', border:'none', cursor:'pointer' }}>todas</button>
                  <button onClick={() => { setSelecionadas(new Set()); setAvisoLimite(false) }} style={{ fontSize:11, color:'var(--text3)', background:'none', border:'none', cursor:'pointer' }}>nenhuma</button>
                </div>
              </div>
              {avisoLimite && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background:'rgba(255,68,68,0.1)', color:'var(--danger)', marginBottom:10 }}>Limite de {LIMITE_MOBILE} trilhas no celular.</div>}
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {trilhas.map((tr, i) => {
                  const sel = selecionadas.has(i)
                  return (
                    <div key={tr.id} onClick={() => toggleSelecionada(i)}
                      style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:'var(--radius)', background: sel?'rgba(232,255,60,0.08)':'var(--bg3)', border:`1px solid ${sel?'rgba(232,255,60,0.3)':'var(--border)'}`, cursor:'pointer', transition:'all 0.15s' }}>
                      <div style={{ width:18, height:18, borderRadius:4, flexShrink:0, background:sel?'var(--accent)':'var(--bg2)', border:`1px solid ${sel?'var(--accent)':'var(--border2)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {sel && <span style={{ fontSize:11, color:'#000', fontWeight:700 }}>✓</span>}
                      </div>
                      <div style={{ width:3, height:20, borderRadius:1, background:trackColors[i%8], flexShrink:0 }} />
                      <div style={{ flex:1, fontSize:13, color:sel?'var(--text)':'var(--text2)', fontFamily:'var(--font-display)', fontWeight:600 }}>{tr.nome}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {erro && <div style={{ color:'var(--danger)', fontSize:13, marginBottom:16, padding:10, background:'rgba(255,68,68,0.1)', borderRadius:'var(--radius)' }}>{erro}</div>}
            <button onClick={handleCarregar} disabled={selecionadas.size===0} style={{ width:'100%', padding:'16px 0', borderRadius:'var(--radius)', background:selecionadas.size>0?'var(--accent)':'var(--bg3)', color:selecionadas.size>0?'#000':'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:3, border:'none', cursor:selecionadas.size>0?'pointer':'not-allowed' }}>
              ▶ CARREGAR ({selecionadas.size})
            </button>
          </div>
        )}

        {/* Carregando */}
        {precarregando && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'32px 24px', textAlign:'center' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:8 }}>Carregando trilhas...</div>
            <div style={{ color:'var(--text2)', fontSize:13, marginBottom:20 }}>{trilhaAtual+1} de {selecionadas.size} — {trilhasRef.current[[...selecionadas].sort((a,b)=>a-b)[trilhaAtual]]?.nome}</div>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden', marginBottom:20, maxWidth:300, margin:'0 auto 20px' }}>
              <div style={{ height:'100%', background:'var(--accent)', borderRadius:3, width:`${Math.round((trilhaAtual/selecionadas.size)*100)}%`, transition:'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Mixer */}
        {pronto && (
          <>
            <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'16px 20px', marginBottom:16 }}>

              {/* Barra de progresso */}
              <div style={{ marginBottom:12 }}>
                <div onClick={seek} onTouchEnd={seek} style={{ height:6, background:'var(--bg3)', borderRadius:3, cursor:'pointer', marginBottom:6 }}>
                  <div style={{ height:'100%', borderRadius:3, background:'var(--accent)', width:`${tempos.total?Math.min((tempos.atual/tempos.total)*100,100):0}%`, transition:'width 0.1s linear', pointerEvents:'none' }} />
                </div>
                <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text2)', textAlign:'right' }}>{fmt(tempos.atual)} / {fmt(tempos.total)}</div>
              </div>

              {/* Controles de transporte */}
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
                {/* Voltar ao início */}
                <button onClick={reiniciar} title="Voltar ao início" style={{ width:36, height:36, borderRadius:'var(--radius)', background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text2)', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>⏮</button>

                {/* Voltar 5s */}
                <button onClick={() => pular(-5)} title="-5 segundos" style={{ width:36, height:36, borderRadius:'var(--radius)', background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text2)', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontFamily:'var(--font-mono)' }}>-5s</button>

                {/* Play/Pause */}
                <button onClick={togglePlay} style={{ width:48, height:48, borderRadius:'50%', background:playing?'var(--accent)':'var(--bg3)', color:playing?'#000':'var(--text)', fontSize:18, flexShrink:0, border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                  {playing ? '⏸' : '▶'}
                </button>

                {/* Avançar 5s */}
                <button onClick={() => pular(5)} title="+5 segundos" style={{ width:36, height:36, borderRadius:'var(--radius)', background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text2)', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontFamily:'var(--font-mono)' }}>+5s</button>

                <div style={{ flex:1 }} />
              </div>

              {/* Pitch */}
              <div style={{ padding:'12px 16px', background:'var(--bg3)', borderRadius:'var(--radius)', border:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', flexShrink:0 }}>Tom</div>
                  <button onClick={() => changePitch(Math.max(-4, pitch-1))} disabled={pitch<=-4} style={{ width:30, height:30, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color:pitch<=-4?'var(--text3)':'var(--text)', fontSize:16, cursor:pitch<=-4?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>−</button>
                  <input type="range" min="-4" max="4" step="1" value={pitch} onChange={e => changePitch(e.target.value)} style={{ flex:1 }} />
                  <button onClick={() => changePitch(Math.min(4, pitch+1))} disabled={pitch>=4} style={{ width:30, height:30, borderRadius:'var(--radius)', border:'1px solid var(--border)', background:'var(--bg2)', color:pitch>=4?'var(--text3)':'var(--text)', fontSize:16, cursor:pitch>=4?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>+</button>
                  <div style={{ flexShrink:0, textAlign:'center', minWidth:80 }}>
                    {tomAtual ? (
                      <div>
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:18, color:pitch===0?'var(--text)':'var(--accent)', lineHeight:1 }}>{tomAtual}</div>
                        <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>{pitch===0?'original':`${pitch>0?'+':''}${pitch} st`}</div>
                      </div>
                    ) : (
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:14, color:pitch===0?'var(--text2)':'var(--accent)' }}>{pitch>0?'+':''}{pitch} st</div>
                    )}
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                  {pitch !== 0 && <button onClick={() => changePitch(0)} style={{ padding:'5px 10px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:11, border:'1px solid var(--border)', cursor:'pointer' }}>↺ reset</button>}
                  {tfSalvo !== null && pitch !== tfSalvo && <button onClick={() => changePitch(tfSalvo)} style={{ padding:'5px 10px', borderRadius:'var(--radius)', background:'rgba(60,255,143,0.1)', color:'var(--success)', fontSize:11, border:'1px solid rgba(60,255,143,0.3)', cursor:'pointer' }}>↩ TF {tfDisplay?`(${tfDisplay})`:''}</button>}
                  <div style={{ flex:1 }} />
                  <button onClick={salvarTf} disabled={salvandoTf} style={{ padding:'5px 12px', borderRadius:'var(--radius)', background:tfSalvo===pitch?'rgba(60,255,143,0.15)':'var(--bg2)', color:tfSalvo===pitch?'var(--success)':'var(--text2)', fontSize:11, border:`1px solid ${tfSalvo===pitch?'rgba(60,255,143,0.3)':'var(--border)'}`, cursor:salvandoTf?'not-allowed':'pointer', letterSpacing:1, fontWeight:600 }}>
                    {salvandoTf?'...':tfMsg||(tfSalvo===pitch?'★ TF salvo':'☆ Salvar TF')}
                  </button>
                </div>
              </div>

              {/* Time Code Nav */}
              <TimeCodeNav
                secoes={secoes}
                tempoAtual={tempos.atual}
                onSeek={seekTo}
                onLoopChange={loop => { loopRef.current = loop }}
              />

              {/* Cifra */}
              <CifraViewer cifras={cifras} tomAtual={tomAtual} tomOriginal={tomOriginal} />
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
                    <button onClick={() => toggleMute(i)} style={{ width:30, height:30, borderRadius:'var(--radius)', cursor:'pointer', background:tr.muted?'rgba(255,68,68,0.2)':'var(--bg3)', color:tr.muted?'var(--danger)':'var(--text2)', border:`1px solid ${tr.muted?'rgba(255,68,68,0.4)':'var(--border)'}`, fontSize:10, fontWeight:600 }}>M</button>
                    <button onClick={() => toggleSolo(i)} style={{ width:30, height:30, borderRadius:'var(--radius)', cursor:'pointer', background:tr.soloed?'rgba(232,255,60,0.2)':'var(--bg3)', color:tr.soloed?'var(--accent)':'var(--text2)', border:`1px solid ${tr.soloed?'rgba(232,255,60,0.4)':'var(--border)'}`, fontSize:10, fontWeight:600 }}>S</button>
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
