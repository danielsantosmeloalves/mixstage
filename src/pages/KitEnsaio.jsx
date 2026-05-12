import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

import {
  SoundTouch,
  SimpleFilter,
  getWebAudioNode,
} from 'soundtouchjs'

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

  const [tempos, setTempos] = useState({
    atual: 0,
    total: 0,
  })

  const [volume, setVolume] = useState(1)

  const [pitch, setPitch] = useState(0)
  const [pitchAplicado, setPitchAplicado] = useState(0)

  const [processando, setProcessando] = useState(false)

  const [tfSalvo, setTfSalvo] = useState(null)

  const ctxRef = useRef(null)

  const gainRef = useRef(null)

  const bufOriginalRef = useRef(null)

  const nodeRef = useRef(null)

  const rafRef = useRef(null)

  const startedAtRef = useRef(0)

  const offsetRef = useRef(0)

  const playingRef = useRef(false)

  const pitchRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase
        .from('musicas')
        .select('*')
        .eq('id', id)
        .single()

      const { data: k } = await supabase
        .from('kit_ensaio')
        .select('*')
        .eq('musica_id', id)

      setMusica(m)

      const mapa = {}

      if (k) {
        k.forEach(item => {
          mapa[item.tipo] = item
        })
      }

      setKitDisponivel(mapa)

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
          setPitchAplicado(tf.tom)
          pitchRef.current = tf.tom
        }
      }

      setCarregando(false)
    }

    carregar()

    return () => {
      pararTudo()
    }
  }, [id])

  async function criarCtx() {
    if (ctxRef.current) {
      if (ctxRef.current.state === 'suspended') {
        await ctxRef.current.resume()
      }

      return ctxRef.current
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)()

    ctxRef.current = ctx

    const gain = ctx.createGain()

    gain.gain.value = volume

    gain.connect(ctx.destination)

    gainRef.current = gain

    return ctx
  }

  function pararTudo() {
    try {
      nodeRef.current?.disconnect()
    } catch(e) {}

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
  }

  async function criarPipelineAudio(buffer, semitons = 0, offset = 0) {
    const ctx = ctxRef.current

    if (!ctx) return

    try {
      if (nodeRef.current) {
        try {
          nodeRef.current.disconnect()
        } catch(e) {}
      }

      const soundTouch = new SoundTouch(buffer.sampleRate)

      soundTouch.pitch = Math.pow(2, semitons / 12)

      soundTouch.tempo = 1

      soundTouch.rate = 1

      const source = {
        extract: function(target, numFrames, position) {
          const l = buffer.getChannelData(0)

          const r = buffer.numberOfChannels > 1
            ? buffer.getChannelData(1)
            : l

          for (let i = 0; i < numFrames; i++) {
            const idx = position + i

            if (idx >= l.length) break

            target[i * 2] = l[idx]

            target[i * 2 + 1] = r[idx]
          }

          return Math.min(numFrames, l.length - position)
        }
      }

      const filter = new SimpleFilter(source, soundTouch)

      filter.sourcePosition = Math.floor(
        offset * buffer.sampleRate
      )

      const node = getWebAudioNode(ctx, filter)

      node.connect(gainRef.current)

      nodeRef.current = node

    } catch(e) {
      console.error(e)
    }
  }

  async function handleCarregar() {
    if (!tipoSelecionado) return

    setPrecarregando(true)

    const ctx = await criarCtx()

    try {
      const res = await fetch(
        kitDisponivel[tipoSelecionado].url
      )

      const arrayBuf = await res.arrayBuffer()

      const decoded = await ctx.decodeAudioData(arrayBuf)

      bufOriginalRef.current = decoded

      await criarPipelineAudio(
        decoded,
        pitchRef.current,
        0
      )

      setTempos({
        atual: 0,
        total: decoded.duration,
      })

      setPronto(true)

    } catch(e) {
      console.error(e)
    }

    setPrecarregando(false)
  }

  async function iniciarSource(offset) {
    const ctx = ctxRef.current

    if (!ctx) return

    const buffer = bufOriginalRef.current

    if (!buffer) return

    await criarPipelineAudio(
      buffer,
      pitchAplicado,
      offset
    )

    startedAtRef.current =
      ctx.currentTime - offset
  }

  function iniciarTick() {
    const tick = () => {
      const ctx = ctxRef.current

      if (!ctx) return

      const elapsed =
        ctx.currentTime - startedAtRef.current

      setTempos({
        atual: elapsed,
        total: bufOriginalRef.current.duration,
      })

      rafRef.current =
        requestAnimationFrame(tick)
    }

    tick()
  }

  async function togglePlay() {
    const ctx = ctxRef.current

    if (!ctx) return

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    if (playingRef.current) {
      offsetRef.current =
        ctx.currentTime - startedAtRef.current

      pararTudo()

      playingRef.current = false

      setPlaying(false)

    } else {
      await iniciarSource(offsetRef.current)

      playingRef.current = true

      setPlaying(true)

      iniciarTick()
    }
  }

  async function aplicarPitch() {
    if (!bufOriginalRef.current) return

    const ctx = ctxRef.current

    if (!ctx) return

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    setProcessando(true)

    const wasPlaying = playingRef.current

    const currentOffset = wasPlaying
      ? ctx.currentTime - startedAtRef.current
      : offsetRef.current

    offsetRef.current = currentOffset

    try {
      if (nodeRef.current) {
        try {
          nodeRef.current.disconnect()
        } catch(e) {}
      }

      await criarPipelineAudio(
        bufOriginalRef.current,
        pitch,
        currentOffset
      )

      setPitchAplicado(pitch)

      pitchRef.current = pitch

      startedAtRef.current =
        ctx.currentTime - currentOffset

      if (wasPlaying) {
        playingRef.current = true

        setPlaying(true)

        iniciarTick()
      }

    } catch(e) {
      console.error(e)
    }

    setProcessando(false)
  }

  async function seek(e) {
    const rect =
      e.currentTarget.getBoundingClientRect()

    const clientX =
      e.touches
        ? e.touches[0].clientX
        : e.clientX

    const pct = Math.max(
      0,
      Math.min(
        (clientX - rect.left) / rect.width,
        1
      )
    )

    const newOffset =
      pct * bufOriginalRef.current.duration

    offsetRef.current = newOffset

    setTempos(t => ({
      ...t,
      atual: newOffset,
    }))

    if (playingRef.current) {
      await iniciarSource(newOffset)
    }
  }

  function changeVolume(val) {
    const v = parseFloat(val)

    setVolume(v)

    if (gainRef.current && ctxRef.current) {
      gainRef.current.gain.setTargetAtTime(
        v,
        ctxRef.current.currentTime,
        0.02
      )
    }
  }

  function fmt(s) {
    if (!s || isNaN(s) || s < 0) {
      return '0:00'
    }

    return `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`
  }

  const tiposDisponiveis =
    KIT_TIPOS.filter(
      t => kitDisponivel[t.key]
    )

  if (carregando) {
    return <div>Carregando...</div>
  }

  return (
    <div>
      <button
        onClick={() => navigate(`/escolha/${id}`)}
      >
        Voltar
      </button>

      {!pronto && (
        <div>
          {tiposDisponiveis.map(tipo => (
            <button
              key={tipo.key}
              onClick={() =>
                setTipoSelecionado(tipo.key)
              }
            >
              {tipo.label}
            </button>
          ))}

          <button onClick={handleCarregar}>
            Carregar
          </button>
        </div>
      )}

      {pronto && (
        <div>
          <button
            onClick={togglePlay}
          >
            {playing ? 'Pause' : 'Play'}
          </button>

          <div
            onClick={seek}
            style={{
              height: 20,
              background: '#333',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${
                  tempos.total
                    ? (tempos.atual /
                        tempos.total) *
                      100
                    : 0
                }%`,
                background: '#0f0',
              }}
            />
          </div>

          <div>
            {fmt(tempos.atual)} /
            {fmt(tempos.total)}
          </div>

          <input
            type="range"
            min="-6"
            max="6"
            step="1"
            value={pitch}
            onChange={e =>
              setPitch(
                parseInt(e.target.value)
              )
            }
          />

          <button
            onClick={aplicarPitch}
            disabled={processando}
          >
            Aplicar Tom
          </button>

          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={volume}
            onChange={e =>
              changeVolume(e.target.value)
            }
          />
        </div>
      )}
    </div>
  )
}
