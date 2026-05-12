import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TONS_SELECT } from '../lib/pitch'

const KIT_TIPOS = [
  { key: 'geral', label: 'Geral', cor: '#e8ff3c' },
  { key: 'guitarras', label: 'Guitarras', cor: '#3cffb0' },
  { key: 'soprano', label: 'Soprano', cor: '#ff6b6b' },
  { key: 'teclados', label: 'Teclados', cor: '#6bb3ff' },
  { key: 'tenor', label: 'Tenor', cor: '#ff9f3c' },
  { key: 'baixo', label: 'Baixo', cor: '#c46bff' },
  { key: 'bateria', label: 'Bateria', cor: '#ff6bd6' },
  { key: 'contralto', label: 'Contralto', cor: '#6bffd6' },
]

export default function Admin() {
  const navigate = useNavigate()
  const [musicas, setMusicas] = useState([])
  const [titulo, setTitulo] = useState('')
  const [artista, setArtista] = useState('')
  const [tomSelecionado, setTomSelecionado] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [musicaSelecionada, setMusicaSelecionada] = useState(null)
  const [abaAtiva, setAbaAtiva] = useState('multitrack') // 'multitrack' | 'kit'

  // Multitrack
  const [arquivos, setArquivos] = useState([])
  const [uploadando, setUploadando] = useState(false)
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 })
  const [trilhas, setTrilhas] = useState([])
  const [msg, setMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef()

  // Kit Ensaio
  const [kitArquivos, setKitArquivos] = useState({})
  const [kitUploadando, setKitUploadando] = useState(false)
  const [kitMsg, setKitMsg] = useState('')
  const [kitExistente, setKitExistente] = useState({})
  const kitRefs = useRef({})

  useEffect(() => { carregarMusicas() }, [])

  async function carregarMusicas() {
    const { data } = await supabase.from('musicas').select('*').order('criado_em', { ascending: false })
    setMusicas(data || [])
  }

  async function carregarTrilhas(musicaId) {
    const { data } = await supabase.from('trilhas').select('*').eq('musica_id', musicaId).order('ordem')
    setTrilhas(data || [])
  }

  async function carregarKit(musicaId) {
    const { data } = await supabase.from('kit_ensaio').select('*').eq('musica_id', musicaId)
    const mapa = {}
    ;(data || []).forEach(k => { mapa[k.tipo] = k })
    setKitExistente(mapa)
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
    carregarKit(m.id)
    setMsg(''); setKitMsg('')
    setArquivos([]); setKitArquivos({})
  }

  function nomeDoArquivo(filename) {
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  }

  function handleArquivos(files) {
    const audios = Array.from(files).filter(f =>
      f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|flac|ogg|m4a|aac)$/i)
    )
    if (!audios.length) { setMsg('Nenhum arquivo de áudio.'); return }
    setArquivos(audios); setMsg('')
  }

  async function uploadTrilhas(e) {
    e.preventDefault()
    if (!arquivos.length || !musicaSelecionada) return
    setUploadando(true); setMsg('')
    setProgresso({ atual: 0, total: arquivos.length })
    let erros = 0
    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i]
      const ext = arquivo.name.split('.').pop()
      const path = `${musicaSelecionada.id}/${Date.now()}-${i}.${ext}`
      const { error: upErr } = await supabase.storage.from('audio').upload(path, arquivo)
      if (upErr) { erros++; setProgresso(p => ({ ...p, atual: i+1 })); continue }
      const { data: urlData } = supabase.storage.from('audio').getPublicUrl(path)
      await supabase.from('trilhas').insert({
        musica_id: musicaSelecionada.id, nome: nomeDoArquivo(arquivo.name),
        url: urlData.publicUrl, ordem: trilhas.length + i,
      })
      setProgresso({ atual: i+1, total: arquivos.length })
    }
    await carregarTrilhas(musicaSelecionada.id)
    setArquivos([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    setMsg(erros > 0 ? `Concluído com ${erros} erro(s).` : `${arquivos.length} trilha(s) adicionada(s)!`)
    setUploadando(false)
    setProgresso({ atual: 0, total: 0 })
  }

  async function deletarTrilha(trilhaId, url) {
    const path = url.split('/audio/')[1]
    await supabase.storage.from('audio').remove([path])
    await supabase.from('trilhas').delete().eq('id', trilhaId)
    await carregarTrilhas(musicaSelecionada.id)
  }

  // Kit Ensaio upload
  async function uploadKit(e) {
    e.preventDefault()
    if (!musicaSelecionada) return
    const tipos = Object.keys(kitArquivos).filter(k => kitArquivos[k])
    if (!tipos.length) { setKitMsg('Nenhum arquivo selecionado.'); return }
    setKitUploadando(true); setKitMsg('')

    let erros = 0
    for (const tipo of tipos) {
      const arquivo = kitArquivos[tipo]
      const ext = arquivo.name.split('.').pop()
      const path = `kit/${musicaSelecionada.id}/${tipo}-${Date.now()}.${ext}`

      // Remove kit anterior desse tipo se existir
      if (kitExistente[tipo]) {
        const oldPath = kitExistente[tipo].url.split('/audio/')[1]
        await supabase.storage.from('audio').remove([oldPath])
        await supabase.from('kit_ensaio').delete().eq('id', kitExistente[tipo].id)
      }

      const { error: upErr } = await supabase.storage.from('audio').upload(path, arquivo)
      if (upErr) { erros++; continue }
      const { data: urlData } = supabase.storage.from('audio').getPublicUrl(path)
      await supabase.from('kit_ensaio').insert({
        musica_id: musicaSelecionada.id, tipo, url: urlData.publicUrl,
      })
    }

    await carregarKit(musicaSelecionada.id)
    setKitArquivos({})
    KIT_TIPOS.forEach(t => { if (kitRefs.current[t.key]) kitRefs.current[t.key].value = '' })
    setKitMsg(erros > 0 ? `Concluído com ${erros} erro(s).` : 'Kit atualizado!')
    setKitUploadando(false)
  }

  async function deletarKitTipo(tipo) {
    const k = kitExistente[tipo]
    if (!k) return
    const path = k.url.split('/audio/')[1]
    await supabase.storage.from('audio').remove([path])
    await supabase.from('kit_ensaio').delete().eq('id', k.id)
    await carregarKit(musicaSelecionada.id)
  }

  async function deletarMusica(musicaId) {
    if (!confirm('Deletar esta música e todas as trilhas?')) return
    const { data: ts } = await supabase.from('trilhas').select('url').eq('musica_id', musicaId)
    const { data: ks } = await supabase.from('kit_ensaio').select('url').eq('musica_id', musicaId)
    const paths = [...(ts||[]), ...(ks||[])].map(t => t.url.split('/audio/')[1])
    if (paths.length) await supabase.storage.from('audio').remove(paths)
    await supabase.from('musicas').delete().eq('id', musicaId)
    setMusicaSelecionada(null); setTrilhas([]); setArquivos([])
    setKitExistente({}); setKitArquivos({})
    await carregarMusicas()
  }

  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff']
  const pct = progresso.total ? Math.round((progresso.atual / progresso.total) * 100) : 0
  const kitNovos = Object.keys(kitArquivos).filter(k => kitArquivos[k]).length

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:20, letterSpacing:4, color:'var(--accent)' }}>
          MIXSTAGE <span style={{ fontSize:12, color:'var(--text2)', letterSpacing:2 }}>/ ADMIN</span>
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
              <div key={m.id} onClick={() => selecionarMusica(m)} style={{ background: musicaSelecionada?.id === m.id ? 'var(--bg3)' : 'var(--bg2)', border:`1px solid ${musicaSelecionada?.id === m.id ? 'var(--accent)' : 'var(--border)'}`, borderRadius:'var(--radius)', padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:14 }}>{m.titulo}</div>
                    {m.tom && <span style={{ fontSize:10, fontWeight:700, background:'rgba(232,255,60,0.15)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.3)', borderRadius:4, padding:'2px 6px' }}>{m.tom}</span>}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>{m.artista || 'Sem artista'}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); deletarMusica(m.id) }} style={{ background:'none', color:'var(--text3)', fontSize:16, padding:4, cursor:'pointer', border:'none' }}
                  onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                  onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                >✕</button>
              </div>
            ))}
            {musicas.length === 0 && <div style={{ color:'var(--text2)', fontSize:13, textAlign:'center', padding:24 }}>Nenhuma música ainda</div>}
          </div>
        </div>

        {/* Coluna direita — trilhas */}
        <div className="fade-in" style={{ animationDelay:'0.1s' }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, marginBottom:24 }}>
            Trilhas {musicaSelecionada && <span style={{ color:'var(--accent)', fontSize:16 }}>— {musicaSelecionada.titulo}</span>}
          </h2>

          {!musicaSelecionada ? (
            <div style={{ color:'var(--text2)', fontSize:13, padding:24, textAlign:'center', border:'1px dashed var(--border)', borderRadius:'var(--radius-lg)' }}>
              Selecione uma música para gerenciar as trilhas
            </div>
          ) : (
            <>
              {/* Abas */}
              <div style={{ display:'flex', marginBottom:20, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                {[{ key:'multitrack', label:'Multitrack' }, { key:'kit', label:'Kit Ensaio' }].map(aba => (
                  <button key={aba.key} onClick={() => setAbaAtiva(aba.key)} style={{
                    flex:1, padding:'10px 0', fontSize:13, fontWeight:600, letterSpacing:1,
                    background: abaAtiva === aba.key ? 'var(--accent)' : 'transparent',
                    color: abaAtiva === aba.key ? '#000' : 'var(--text2)',
                    border:'none', cursor:'pointer', fontFamily:'var(--font-mono)',
                  }}>{aba.label}</button>
                ))}
              </div>

              {/* ABA MULTITRACK */}
              {abaAtiva === 'multitrack' && (
                <>
                  <form onSubmit={uploadTrilhas} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20, marginBottom:20, display:'flex', flexDirection:'column', gap:12 }}>
                    <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase' }}>Upload de trilhas</div>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); handleArquivos(e.dataTransfer.files) }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{ border:`2px dashed ${dragOver ? 'var(--accent)' : 'var(--border2)'}`, borderRadius:'var(--radius)', padding:'28px 16px', textAlign:'center', cursor:'pointer', background: dragOver ? 'rgba(232,255,60,0.05)' : 'transparent', transition:'all 0.15s' }}
                    >
                      <div style={{ fontSize:28, marginBottom:8 }}>🎵</div>
                      <div style={{ fontSize:13, color:'var(--text2)' }}>Solte os arquivos aqui ou clique para selecionar</div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>Vários arquivos de uma vez — cada um vira uma trilha</div>
                    </div>
                    <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display:'none' }} onChange={e => handleArquivos(e.target.files)} />

                    {arquivos.length > 0 && (
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        <div style={{ fontSize:11, color:'var(--text2)' }}>{arquivos.length} arquivo(s):</div>
                        {arquivos.map((f, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'8px 12px', fontSize:12 }}>
                            <div style={{ width:3, height:20, borderRadius:1, background:trackColors[i%trackColors.length], flexShrink:0 }} />
                            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nomeDoArquivo(f.name)}</span>
                            <span style={{ color:'var(--text3)', flexShrink:0 }}>{(f.size/1024/1024).toFixed(1)} MB</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {uploadando && (
                      <div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text2)', marginBottom:6 }}>
                          <span>Enviando {progresso.atual} de {progresso.total}...</span>
                          <span>{pct}%</span>
                        </div>
                        <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
                          <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${pct}%`, transition:'width 0.3s' }} />
                        </div>
                      </div>
                    )}

                    {msg && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background: msg.includes('erro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)', color: msg.includes('erro') ? 'var(--danger)' : 'var(--success)' }}>{msg}</div>}

                    <button type="submit" disabled={uploadando || !arquivos.length} style={{ padding:'11px 0', borderRadius:'var(--radius)', background: arquivos.length && !uploadando ? 'var(--accent)' : 'var(--bg3)', color: arquivos.length && !uploadando ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2, border:'1px solid var(--border)', cursor: arquivos.length && !uploadando ? 'pointer' : 'not-allowed' }}>
                      {uploadando ? `ENVIANDO ${pct}%...` : `↑ UPLOAD ${arquivos.length ? `(${arquivos.length})` : ''}`}
                    </button>
                  </form>

                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {trilhas.map((t, i) => (
                      <div key={t.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
                        <div style={{ width:3, height:32, borderRadius:2, background:trackColors[i%trackColors.length], flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:13 }}>{t.nome}</div>
                          <div style={{ fontSize:11, color:'var(--text3)' }}>Trilha {i+1}</div>
                        </div>
                        <button onClick={() => deletarTrilha(t.id, t.url)} style={{ background:'none', color:'var(--text3)', fontSize:16, padding:4, cursor:'pointer', border:'none' }}
                          onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                          onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                        >✕</button>
                      </div>
                    ))}
                    {trilhas.length === 0 && <div style={{ color:'var(--text2)', fontSize:13, textAlign:'center', padding:20 }}>Nenhuma trilha ainda</div>}
                  </div>
                </>
              )}

              {/* ABA KIT ENSAIO */}
              {abaAtiva === 'kit' && (
                <form onSubmit={uploadKit} style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4 }}>
                    Cada campo aceita um arquivo. O arquivo existente será substituído ao salvar.
                  </div>

                  {KIT_TIPOS.map(tipo => {
                    const existente = kitExistente[tipo.key]
                    const novo = kitArquivos[tipo.key]
                    return (
                      <div key={tipo.key} style={{ background:'var(--bg2)', border:`1px solid ${existente || novo ? tipo.cor + '40' : 'var(--border)'}`, borderRadius:'var(--radius)', padding:'12px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: existente ? 8 : 0 }}>
                          <div style={{ width:3, height:18, borderRadius:1, background:tipo.cor, flexShrink:0 }} />
                          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, flex:1 }}>{tipo.label}</div>
                          {existente && !novo && (
                            <span style={{ fontSize:10, color:tipo.cor, background:`${tipo.cor}20`, border:`1px solid ${tipo.cor}40`, borderRadius:3, padding:'2px 6px', letterSpacing:1 }}>✓ CADASTRADO</span>
                          )}
                          {novo && (
                            <span style={{ fontSize:10, color:'var(--accent)', background:'rgba(232,255,60,0.1)', border:'1px solid rgba(232,255,60,0.3)', borderRadius:3, padding:'2px 6px', letterSpacing:1 }}>NOVO</span>
                          )}
                        </div>

                        {existente && !novo && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:'var(--text2)', marginBottom:8 }}>
                            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {existente.url.split('/').pop().replace(/%20/g, ' ')}
                            </span>
                            <button type="button" onClick={() => deletarKitTipo(tipo.key)} style={{ background:'none', color:'var(--text3)', fontSize:13, cursor:'pointer', border:'none', flexShrink:0 }}
                              onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                              onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                            >✕</button>
                          </div>
                        )}

                        {novo && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:'var(--text)', marginBottom:8 }}>
                            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{novo.name}</span>
                            <span style={{ color:'var(--text3)', flexShrink:0 }}>{(novo.size/1024/1024).toFixed(1)} MB</span>
                            <button type="button" onClick={() => {
                              setKitArquivos(prev => { const n = {...prev}; delete n[tipo.key]; return n })
                              if (kitRefs.current[tipo.key]) kitRefs.current[tipo.key].value = ''
                            }} style={{ background:'none', color:'var(--text3)', fontSize:13, cursor:'pointer', border:'none' }}
                              onMouseEnter={e => e.currentTarget.style.color='var(--danger)'}
                              onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}
                            >✕</button>
                          </div>
                        )}

                        <button type="button" onClick={() => kitRefs.current[tipo.key]?.click()} style={{
                          width:'100%', padding:'7px 0', borderRadius:'var(--radius)',
                          background:'var(--bg3)', color:'var(--text2)',
                          border:'1px solid var(--border)', fontSize:11, cursor:'pointer', letterSpacing:1,
                        }}>
                          {existente ? '↻ Substituir arquivo' : '+ Selecionar arquivo'}
                        </button>
                        <input
                          ref={el => kitRefs.current[tipo.key] = el}
                          type="file" accept="audio/*" style={{ display:'none' }}
                          onChange={e => {
                            const f = e.target.files[0]
                            if (f) setKitArquivos(prev => ({ ...prev, [tipo.key]: f }))
                            e.target.value = ''
                          }}
                        />
                      </div>
                    )
                  })}

                  {kitMsg && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background: kitMsg.includes('erro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)', color: kitMsg.includes('erro') ? 'var(--danger)' : 'var(--success)' }}>{kitMsg}</div>}

                  <button type="submit" disabled={kitUploadando || kitNovos === 0} style={{
                    padding:'12px 0', borderRadius:'var(--radius)',
                    background: kitNovos > 0 && !kitUploadando ? 'var(--accent)' : 'var(--bg3)',
                    color: kitNovos > 0 && !kitUploadando ? '#000' : 'var(--text3)',
                    fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2,
                    border:'1px solid var(--border)', cursor: kitNovos > 0 && !kitUploadando ? 'pointer' : 'not-allowed',
                  }}>
                    {kitUploadando ? 'ENVIANDO...' : `↑ SALVAR KIT ${kitNovos > 0 ? `(${kitNovos})` : ''}`}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
