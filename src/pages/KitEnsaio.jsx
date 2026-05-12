import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'
import * as Tone from 'tone' // 🎵 Importação do Tone.js

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
  const [tfSalvo, setTfSalvo] = useState(null)
  const [salvandoTf, setSalvandoTf] = useState(false)
  const [tfMsg, setTfMsg] = useState('')
  const [erro, setErro] = useState('')

  const ctxRef = useRef(null)
  const masterRef = useRef(null)
  const gainRef = useRef(null)
  const pitchShiftRef = useRef(null) // 🎸 "Pedal" de Pitch Shift
  const bufOriginalRef = useRef(null)
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
