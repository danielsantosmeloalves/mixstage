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

import React, {
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  useNavigate,
  useParams,
} from 'react-router-dom'

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

export default function KitEnsaio({
  session,
}) {
  const { id } = useParams()

  const navigate = useNavigate()

  const [musica, setMusica] =
    useState(null)

  const [
    kitDisponivel,
    setKitDisponivel,
  ] = useState({})

  const [
    tipoSelecionado,
    setTipoSelecionado,
  ] = useState(null)

  const [carregando, setCarregando] =
    useState(true)

  const [
    precarregando,
    setPrecarregando,
  ] = useState(false)

  const [pronto, setPronto] =
    useState(false)

  const [playing, setPlaying] =
    useState(false)

  const [tempos, setTempos] =
    useState({
      atual: 0,
      total: 0,
    })

  const [volume, setVolume] =
    useState(1)

  const [pitch, setPitch] =
    useState(0)

  const [
    pitchAplicado,
    setPitchAplicado,
  ] = useState(0)

  const [
    processando,
    setProcessando,
  ] = useState(false)

  const [erro, setErro] =
    useState('')

  const playerRef = useRef(null)

  const pitchShiftRef =
    useRef(null)

  const volumeRef = useRef(null)

  const rafRef = useRef(null)

  const startedAtRef =
    useRef(0)

  const offsetRef = useRef(0)

  const playingRef =
    useRef(false)

  const durationRef =
    useRef(0)

  const pitchRef = useRef(0)

  useEffect(() => {
    async function carregar() {
      const { data: m } =
        await supabase
          .from('musicas')
          .select('*')
          .eq('id', id)
          .single()

      const { data: k } =
        await supabase
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

    const pitchShift =
      new Tone.PitchShift({
        pitch: 0,
        windowSize: 0.1,
        delayTime: 0,
        feedback: 0,
      })

    const volumeNode =
      new Tone.Volume(0)

    pitchShift.connect(volumeNode)

    volumeNode.toDestination()

    pitchShiftRef.current =
      pitchShift

    volumeRef.current =
      volumeNode
  }

  function pararTudo() {
    try {
      playerRef.current?.stop()
    } catch(e) {}

    playingRef.current = false

    setPlaying(false)

    if (rafRef.current) {
      cancelAnimationFrame(
        rafRef.current
      )
    }
  }

  async function handleCarregar() {
    if (!tipoSelecionado) return

    setPrecarregando(true)

    setErro('')

    try {
      await criarAudio()

      const url =
        kitDisponivel[
          tipoSelecionado
        ].url

      if (playerRef.current) {
        playerRef.current.dispose()
      }

      const player =
        new Tone.Player({
          url,
          autostart: false,
        })

      player.connect(
        pitchShiftRef.current
      )

      await Tone.loaded()

      durationRef.current =
        player.buffer.duration

      playerRef.current = player

      setTempos({
        atual: 0,
        total:
          durationRef.current,
      })

      setPronto(true)

    } catch(e) {
      console.error(e)

      setErro(
        'Erro ao carregar áudio.'
      )
    }

    setPrecarregando(false)
  }

  function iniciarTick() {
    const tick = () => {
      if (!playingRef.current)
        return

      const elapsed =
        Tone.now() -
        startedAtRef.current

      setTempos({
        atual: elapsed,
        total:
          durationRef.current,
      })

      if (
        elapsed <
        durationRef.current
      ) {
        rafRef.current =
          requestAnimationFrame(
            tick
          )
      } else {
        playingRef.current = false

        setPlaying(false)

        offsetRef.current = 0
      }
    }

    tick()
  }

  async function togglePlay() {
    const player =
      playerRef.current

    if (!player) return

    if (playingRef.current) {
      offsetRef.current =
        Tone.now() -
        startedAtRef.current

      player.stop()

      playingRef.current = false

      setPlaying(false)

    } else {
      player.start(
        undefined,
        offsetRef.current
      )

      startedAtRef.current =
        Tone.now() -
        offsetRef.current

      playingRef.current = true

      setPlaying(true)

      iniciarTick()
    }
  }

  async function aplicarPitch() {
    if (!pitchShiftRef.current)
      return

    setProcessando(true)

    try {
      pitchShiftRef.current.pitch =
        pitch

      setPitchAplicado(pitch)

      pitchRef.current = pitch

    } catch(e) {
      console.error(e)
    }

    setProcessando(false)
  }

  function changeVolume(val) {
    const v = parseFloat(val)

    setVolume(v)

    if (volumeRef.current) {
      volumeRef.current.volume.value =
        Tone.gainToDb(
          v <= 0
            ? 0.0001
            : v
        )
    }
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
        (clientX - rect.left) /
          rect.width,
        1
      )
    )

    const newOffset =
      pct * durationRef.current

    offsetRef.current =
      newOffset

    setTempos(t => ({
      ...t,
      atual: newOffset,
    }))

    if (playingRef.current) {
      playerRef.current.stop()

      playerRef.current.start(
        undefined,
        newOffset
      )

      startedAtRef.current =
        Tone.now() -
        newOffset
    }
  }

  function fmt(s) {
    if (
      !s ||
      isNaN(s) ||
      s < 0
    ) {
      return '0:00'
    }

    return `${Math.floor(
      s / 60
    )}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`
  }

  const tomOriginal =
    musica?.tom || null

  const tomAtual =
    tomOriginal
      ? calcularTom(
          tomOriginal.split(
            '/'
          )[0],
          pitch
        )
      : null

  const tomAplicadoDisplay =
    tomOriginal
      ? calcularTom(
          tomOriginal.split(
            '/'
          )[0],
          pitchAplicado
        )
      : null

  const tiposDisponiveis =
    KIT_TIPOS.filter(
      t =>
        kitDisponivel[t.key]
    )

  if (carregando) {
    return (
      <div>
        Carregando...
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 24,
      }}
    >
      <button
        onClick={() =>
          navigate(
            `/escolha/${id}`
          )
        }
      >
        Voltar
      </button>

      {!pronto && (
        <div
          style={{
            marginTop: 24,
          }}
        >
          {tiposDisponiveis.map(
            tipo => (
              <button
                key={tipo.key}
                onClick={() =>
                  setTipoSelecionado(
                    tipo.key
                  )
                }
                style={{
                  marginRight: 8,
                }}
              >
                {tipo.label}
              </button>
            )
          )}

          <div
            style={{
              marginTop: 16,
            }}
          >
            <button
              onClick={
                handleCarregar
              }
            >
              Carregar
            </button>
          </div>

          {erro && (
            <div
              style={{
                color: 'red',
                marginTop: 12,
              }}
            >
              {erro}
            </div>
          )}
        </div>
      )}

      {pronto && (
        <div
          style={{
            marginTop: 24,
          }}
        >
          <button
            onClick={togglePlay}
          >
            {playing
              ? 'Pause'
              : 'Play'}
          </button>

          <div
            onClick={seek}
            style={{
              height: 10,
              background:
                '#333',
              marginTop: 20,
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
                background:
                  '#00ff88',
              }}
            />
          </div>

          <div
            style={{
              marginTop: 8,
            }}
          >
            {fmt(
              tempos.atual
            )}{' '}
            /{' '}
            {fmt(
              tempos.total
            )}
          </div>

          <div
            style={{
              marginTop: 24,
            }}
          >
            <input
              type="range"
              min="-6"
              max="6"
              step="1"
              value={pitch}
              onChange={e =>
                setPitch(
                  parseInt(
                    e.target.value
                  )
                )
              }
            />

            <button
              onClick={
                aplicarPitch
              }
              disabled={
                processando
              }
              style={{
                marginLeft: 12,
              }}
            >
              Aplicar Tom
            </button>

            <div
              style={{
                marginTop: 12,
              }}
            >
              Tom atual:{' '}
              {tomAplicadoDisplay ||
                pitchAplicado}
            </div>

            <div>
              Novo tom:{' '}
              {tomAtual ||
                pitch}
            </div>
          </div>

          <div
            style={{
              marginTop: 24,
            }}
          >
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.01"
              value={volume}
              onChange={e =>
                changeVolume(
                  e.target.value
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
