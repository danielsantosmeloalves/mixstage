import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TONS_SELECT } from '../lib/pitch'

const GRUPOS = [
  { key: 'teclados', label: 'Teclados', fundir: true, cor: '#6bb3ff' },
  { key: 'guitarras', label: 'Guitarras', fundir: true, cor: '#e8ff3c' },
  { key: 'sintetizadores', label: 'Sintetizadores', fundir: true, cor: '#c46bff' },
  { key: 'outros', label: 'Outros', fundir: false, cor: '#3cffb0' },
]

// Mistura múltiplos AudioBuffers em um único (sobreposição)
async function mixarBuffers(buffers) {
  if (buffers.length === 0) return null
  if (buffers.length === 1) return buffers[0]

  const maxLen = Math.max(...buffers.map(b => b.length))
  const sr = buffers[0].sampleRate
  const ch = Math.max(...buffers.map(b => b.numberOfChannels))

  const offCtx = new OfflineAudioContext(ch, maxLen, sr)

  buffers.forEach(buf => {
    const src = offCtx.createBufferSource()
    src.buffer = buf
    src.connect(offCtx.destination)
    src.start(0)
  })

  const mixed = await offCtx.startRendering()

  // Normaliza para evitar clipping
  const dataL = mixed.getChannelData(0)
  const dataR = ch > 1 ? mixed.getChannelData(1) : dataL
  let peak = 0
  for (let i = 0; i < dataL.length; i++) {
    peak = Math.max(peak, Math.abs(dataL[i]), Math.abs(dataR[i]))
  }
  if (peak > 0.95) {
    const factor = 0.95 / peak
    for (let i = 0; i < dataL.length; i++) {
      dataL[i] *= factor
      if (ch > 1) dataR[i] *= factor
    }
  }

  return mixed
}

// Converte AudioBuffer para Blob MP3-like (WAV)
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16
  const numSamples = buffer.length
  const blockAlign = numChannels * (bitDepth / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = numSamples * blockAlign
  const wavSize = 44 + dataSize

  const wav = new ArrayBuffer(wavSize)
  const view = new DataView(wav)

  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, wavSize - 8, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }

  return new Blob([wav], { type: 'audio/wav' })
}

// Decodifica um File para AudioBuffer
async function decodeFile(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const buf = await file.arrayBuffer()
  const decoded = await ctx.decodeAudioData(buf)
  await ctx.close()
  return decoded
}

export default function Admin() {
  const navigate = useNavigate()
  const [musicas, setMusicas] = useState([])
  const [titulo, setTitulo] = useState('')
  const [artista, setArtista] = useState('')
  const [tomSelecionado, setTomSelecionado] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [musicaSelecionada, setMusicaSelecionada] = useState(null)
  const [trilhas, setTrilhas] = useState([])
  const [msg, setMsg] = useState('')

  // Arquivos por grupo
  const [grupos, setGrupos] = useState({
    teclados: [], guitarras: [], sintetizadores: [], outros: []
  })
  const [uploadando, setUploadando] = useState(false)
  const [progressoUpload, setProgressoUpload] = useState({ etapa: '', pct: 0 })

  const fileRefs = { teclados: useRef(), guitarras: useRef(), sintetizadores: useRef(), outros: useRef() }

  useEffect(() => { carregarMusicas() }, [])

  async function carregarMusicas() {
    const { data } = await supabase.from('musicas').select('*').order('criado_em', { ascending: false })
    setMusicas(data || [])
  }

  async function carregarTrilhas(musicaId) {
    const { data } = await supabase.from('trilhas').select('*').eq('musica_id', musicaId).order('ordem')
    setTrilhas(data || [])
  }

  async function criarMusica(e) {
    e.preventDefault()
    if (!titulo.trim()) return
    setSalvando(true)
    const { data, error } = await supabase.from('musicas').insert({
      titulo: titulo.trim(), artista: artista.trim(), tom: tomSelecionado || null,
    }).select().single()
    if (!error) {
      setTitulo(''); setArtista(''); setTomSelecionado('')
      await carregarMusicas()
      selecionarMusica(data)
      setMsg('Música criada!')
    }
    setSalvando(false)
  }

  function selecionarMusica(m) {
    setMusicaSelecionada(m)
    carregarTrilhas(m.id)
    setMsg('')
    setGrupos({ teclados: [], guitarras: [], sintetizadores: [], outros: [] })
  }

  function addArquivos(grupo, files) {
    const audios = Array.from(files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|flac|ogg|m4a|aac)$/i))
    setGrupos(prev => ({ ...prev, [grupo]: [...prev[grupo], ...audios] }))
  }

  function removeArquivo(grupo, idx) {
    setGrupos(prev => ({ ...prev, [grupo]: prev[grupo].filter((_, i) => i !== idx) }))
  }

  function totalArquivos() {
    return Object.values(grupos).reduce((a, b) => a + b.length, 0)
  }

  async function uploadTrilhas(e) {
    e.preventDefault()
    if (!musicaSelecionada || totalArquivos() === 0) return
    setUploadando(true)
    setMsg('')

    let ordem = trilhas.length
    let erros = 0

    for (const grupo of GRUPOS) {
      const arquivos = grupos[grupo.key]
      if (arquivos.length === 0) continue

      try {
        let blob, nomeArquivo

        if (grupo.fundir && arquivos.length > 1) {
          // Decodifica e mixa todos os arquivos do grupo
          setProgressoUpload({ etapa: `Mixando ${grupo.label}...`, pct: 10 })
          const decoded = await Promise.all(arquivos.map(f => decodeFile(f)))
          const mixed = await mixarBuffers(decoded)
          blob = audioBufferToWav(mixed)
          nomeArquivo = grupo.label
        } else if (grupo.fundir && arquivos.length === 1) {
          blob = arquivos[0]
          nomeArquivo = grupo.label
        } else {
          // Grupo "outros" — sobe individualmente
          for (let i = 0; i < arquivos.length; i++) {
            const f = arquivos[i]
            setProgressoUpload({ etapa: `Enviando ${f.name}...`, pct: Math.round((i / arquivos.length) * 100) })
            const ext = f.name.split('.').pop()
            const path = `${musicaSelecionada.id}/${Date.now()}-${i}.${ext}`
            const { error: upErr } = await supabase.storage.from('audio').upload(path, f)
            if (upErr) { erros++; continue }
            const { data: urlData } = supabase.storage.from('audio').getPublicUrl(path)
            await supabase.from('trilhas').insert({
              musica_id: musicaSelecionada.id,
              nome: f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
              url: urlData.publicUrl, ordem: ordem++,
            })
          }
          continue
        }

        // Upload do arquivo (fundido ou único)
        setProgressoUpload({ etapa: `Enviando ${grupo.label}...`, pct: 50 })
        const ext = grupo.fundir && arquivos.length > 1 ? 'wav' : arquivos[0].name.split('.').pop()
        const path = `${musicaSelecionada.id}/${Date.now()}-${grupo.key}.${ext}`
        const { error: upErr } = await supabase.storage.from('audio').upload(path, blob)
        if (upErr) { erros++; continue }
        const { data: urlData } = supabase.storage.from('audio').getPublicUrl(path)
        await supabase.from('trilhas').insert({
          musica_id: musicaSelecionada.id,
          nome: nomeArquivo, url: urlData.publicUrl, ordem: ordem++,
        })
      } catch(err) {
        console.error('Erro no grupo', grupo.key, err)
        erros++
      }
    }

    setProgressoUpload({ etapa: '', pct: 0 })
    await carregarTrilhas(musicaSelecionada.id)
    setGrupos({ teclados: [], guitarras: [], sintetizadores: [], outros: [] })
    setMsg(erros > 0 ? `Concluído com ${erros} erro(s).` : 'Trilhas adicionadas com sucesso!')
    setUploadando(false)
  }

  async function deletarTrilha(trilhaId, url) {
    const path = url.split('/audio/')[1]
    await supabase.storage.from('audio').remove([path])
    await supabase.from('trilhas').delete().eq('id', trilhaId)
    await carregarTrilhas(musicaSelecionada.id)
  }

  async function deletarMusica(musicaId) {
    if (!confirm('Deletar esta música e todas as trilhas?')) return
    const { data: ts } = await supabase.from('trilhas').select('url').eq('musica_id', musicaId)
    if (ts?.length) await supabase.storage.from('audio').remove(ts.map(t => t.url.split('/audio/')[1]))
    await supabase.from('musicas').delete().eq('id', musicaId)
    setMusicaSelecionada(null); setTrilhas([])
    setGrupos({ teclados: [], guitarras: [], sintetizadores: [], outros: [] })
    await carregarMusicas()
  }

  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff']

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{
        borderBottom:'1px solid var(--border)', padding:'16px 32px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        position:'sticky', top:0, background:'var(--bg)', zIndex:10,
      }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:20, letterSpacing:4, color:'var(--accent)' }}>
          MIXSTAGE <span style={{ fontSize:12, color:'var(--text2)', letterSpacing:2 }}> / ADMIN</span>
        </div>
        <button onClick={() => navigate('/catalogo')} style={{ padding:'8px 16px', borderRadius:'var(--radius)', background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)', fontSize:12, cursor:'pointer' }}>← Catálogo</button>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'40px 24px', display:'grid', gridTemplateColumns:'1fr 1.4fr', gap:32, alignItems:'start' }}>

        {/* Coluna esquerda — músicas */}
        <div className="fade-in">
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, marginBottom:24 }}>Músicas</h2>

          <form onSubmit={criarMusica} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20, marginBottom:20, display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase' }}>Nova música</div>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título da música" required />
            <input value={artista} onChange={e => setArtista(e.target.value)} placeholder="Artista (opcional)" />
            <div>
              <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:8 }}>Tom original (opcional)</label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {TONS_SELECT.map(t => (
                  <button key={t} type="button" onClick={() => setTomSelecionado(prev => prev === t ? '' : t)} style={{
                    padding:'5px 10px', borderRadius:'var(--radius)', fontSize:11,
                    background: tomSelecionado === t ? 'var(--accent)' : 'var(--bg3)',
                    color: tomSelecionado === t ? '#000' : 'var(--text2)',
                    border:`1px solid ${tomSelecionado === t ? 'var(--accent)' : 'var(--border)'}`,
                    cursor:'pointer', fontFamily:'var(--font-mono)',
                  }}>{t}</button>
                ))}
              </div>
              {tomSelecionado && (
                <div style={{ fontSize:12, color:'var(--accent)', marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                  Tom: <strong>{tomSelecionado}</strong>
                  <button type="button" onClick={() => setTomSelecionado('')} style={{ background:'none', color:'var(--text3)', fontSize:12, cursor:'pointer', border:'none' }}>✕</button>
                </div>
              )}
            </div>
            <button type="submit" disabled={salvando} style={{ padding:'11px 0', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2, border:'none', cursor:'pointer', opacity: salvando ? 0.6 : 1 }}>+ CRIAR</button>
          </form>

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {musicas.map(m => (
              <div key={m.id} onClick={() => selecionarMusica(m)} style={{
                background: musicaSelecionada?.id === m.id ? 'var(--bg3)' : 'var(--bg2)',
                border:`1px solid ${musicaSelecionada?.id === m.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius:'var(--radius)', padding:'14px 16px',
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between',
              }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:14 }}>{m.titulo}</div>
                    {m.tom && <span style={{ fontSize:10, fontWeight:700, background:'rgba(232,255,60,0.15)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.3)', borderRadius:4, padding:'2px 6px' }}>{m.tom}</span>}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>{m.artista || 'Sem artista'}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); deletarMusica(m.id) }} style={{ background:'none', color:'var(--text3)', fontSize:16, padding:4, cursor:'pointer', border:'none', transition:'color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                  onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                >✕</button>
              </div>
            ))}
            {musicas.length === 0 && <div style={{ color:'var(--text2)', fontSize:13, textAlign:'center', padding:24 }}>Nenhuma música ainda</div>}
          </div>
        </div>

        {/* Coluna direita — trilhas por instrumento */}
        <div className="fade-in" style={{ animationDelay:'0.1s' }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, marginBottom:24 }}>
            Trilhas {musicaSelecionada && <span style={{ color:'var(--accent)', fontSize:16 }}>— {musicaSelecionada.titulo}</span>}
          </h2>

          {!musicaSelecionada ? (
            <div style={{ color:'var(--text2)', fontSize:13, padding:24, textAlign:'center', border:'1px dashed var(--border)', borderRadius:'var(--radius-lg)' }}>
              Selecione uma música para adicionar trilhas
            </div>
          ) : (
            <>
              <form onSubmit={uploadTrilhas} style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:24 }}>

                {GRUPOS.map(grupo => (
                  <div key={grupo.key} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:16 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:3, height:18, borderRadius:1, background:grupo.cor }} />
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:14 }}>{grupo.label}</div>
                        {grupo.fundir && grupos[grupo.key].length > 1 && (
                          <span style={{ fontSize:10, color:grupo.cor, background:`${grupo.cor}20`, border:`1px solid ${grupo.cor}40`, borderRadius:3, padding:'2px 6px', letterSpacing:1 }}>
                            SERÁ FUNDIDO
                          </span>
                        )}
                      </div>
                      <button type="button" onClick={() => fileRefs[grupo.key].current?.click()} style={{
                        padding:'5px 10px', borderRadius:'var(--radius)', fontSize:11,
                        background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)',
                        cursor:'pointer', letterSpacing:1,
                      }}>+ Adicionar</button>
                      <input ref={fileRefs[grupo.key]} type="file" accept="audio/*" multiple style={{ display:'none' }}
                        onChange={e => { addArquivos(grupo.key, e.target.files); e.target.value='' }} />
                    </div>

                    {grupos[grupo.key].length === 0 ? (
                      <div
                        onClick={() => fileRefs[grupo.key].current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); addArquivos(grupo.key, e.dataTransfer.files) }}
                        style={{ border:'1px dashed var(--border2)', borderRadius:'var(--radius)', padding:'14px', textAlign:'center', cursor:'pointer', color:'var(--text3)', fontSize:12 }}
                      >
                        Arraste arquivos ou clique em Adicionar
                      </div>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {grupos[grupo.key].map((f, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'7px 10px' }}>
                            <div style={{ flex:1, fontSize:12, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {f.name.replace(/\.[^.]+$/, '')}
                            </div>
                            <span style={{ fontSize:11, color:'var(--text3)', flexShrink:0 }}>{(f.size/1024/1024).toFixed(1)} MB</span>
                            <button type="button" onClick={() => removeArquivo(grupo.key, i)} style={{ background:'none', color:'var(--text3)', border:'none', cursor:'pointer', fontSize:14, padding:'0 2px' }}
                              onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                              onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                            >✕</button>
                          </div>
                        ))}
                        {grupo.fundir && grupos[grupo.key].length > 1 && (
                          <div style={{ fontSize:11, color:grupo.cor, marginTop:2, paddingLeft:4 }}>
                            ↳ {grupos[grupo.key].length} arquivos serão mixados em uma única trilha "{grupo.label}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Barra de progresso */}
                {uploadando && progressoUpload.etapa && (
                  <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 16px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text2)', marginBottom:8 }}>
                      <span>{progressoUpload.etapa}</span>
                      <span style={{ color:'var(--accent)' }}>{progressoUpload.pct}%</span>
                    </div>
                    <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${progressoUpload.pct}%`, transition:'width 0.3s' }} />
                    </div>
                  </div>
                )}

                {msg && (
                  <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background: msg.includes('erro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)', color: msg.includes('erro') ? 'var(--danger)' : 'var(--success)' }}>{msg}</div>
                )}

                <button type="submit" disabled={uploadando || totalArquivos() === 0} style={{
                  padding:'12px 0', borderRadius:'var(--radius)',
                  background: totalArquivos() > 0 && !uploadando ? 'var(--accent)' : 'var(--bg3)',
                  color: totalArquivos() > 0 && !uploadando ? '#000' : 'var(--text3)',
                  fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2,
                  border:'1px solid var(--border)', cursor: totalArquivos() > 0 && !uploadando ? 'pointer' : 'not-allowed',
                }}>
                  {uploadando ? progressoUpload.etapa || 'PROCESSANDO...' : `↑ ENVIAR TRILHAS ${totalArquivos() > 0 ? `(${totalArquivos()})` : ''}`}
                </button>
              </form>

              {/* Lista de trilhas cadastradas */}
              {trilhas.length > 0 && (
                <div>
                  <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>Trilhas cadastradas</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {trilhas.map((t, i) => (
                      <div key={t.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
                        <div style={{ width:3, height:32, borderRadius:2, background:trackColors[i%trackColors.length], flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:13 }}>{t.nome}</div>
                          <div style={{ fontSize:11, color:'var(--text3)' }}>Trilha {i+1}</div>
                        </div>
                        <button onClick={() => deletarTrilha(t.id, t.url)} style={{ background:'none', color:'var(--text3)', fontSize:16, padding:4, cursor:'pointer', border:'none', transition:'color 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                          onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
