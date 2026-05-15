import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TONS_SELECT } from '../lib/pitch'

const KIT_TIPOS = ['geral', 'guitarras', 'soprano', 'teclados', 'tenor', 'baixo', 'bateria', 'contralto']
const KIT_LABELS = { geral:'Geral', guitarras:'Guitarras', soprano:'Soprano', teclados:'Teclados', tenor:'Tenor', baixo:'Baixo', bateria:'Bateria', contralto:'Contralto' }

function parseTimecode(texto) {
  const linhas = texto.trim().split('\n').map(l => l.trim()).filter(Boolean)
  const secoes = []
  let i = 0
  while (i < linhas.length) {
    const nome = linhas[i]
    const tempo = linhas[i + 1]
    if (tempo && /^\d+$/.test(tempo)) {
      secoes.push({ nome, tempoMs: parseInt(tempo) })
      i += 2
    } else {
      i++
    }
  }
  return secoes
}

export default function Admin() {
  const navigate = useNavigate()
  const [musicas, setMusicas] = useState([])
  const [titulo, setTitulo] = useState('')
  const [artista, setArtista] = useState('')
  const [tomSelecionado, setTomSelecionado] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [musicaSelecionada, setMusicaSelecionada] = useState(null)
  const [aba, setAba] = useState('multitrack')

  // Multitrack
  const [arquivos, setArquivos] = useState([])
  const [uploadando, setUploadando] = useState(false)
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 })
  const [trilhas, setTrilhas] = useState([])
  const [msgMulti, setMsgMulti] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef()

  // Kit Ensaio
  const [kitArquivos, setKitArquivos] = useState({})
  const [kitExistente, setKitExistente] = useState({})
  const [uploadandoKit, setUploadandoKit] = useState(false)
  const [progressoKit, setProgressoKit] = useState({ atual: 0, total: 0 })
  const [msgKit, setMsgKit] = useState('')
  const kitRefs = Object.fromEntries(KIT_TIPOS.map(t => [t, useRef()]))

  // Cifras
  const [cifras, setCifras] = useState({})
  const [cifraEditando, setCifraEditando] = useState(null)
  const [cifraTexto, setCifraTexto] = useState('')
  const [cifrasTom, setCifrasTom] = useState('')
  const [cifraPdf, setCifraPdf] = useState(null)
  const [salvandoCifra, setSalvandoCifra] = useState(false)
  const [msgCifra, setMsgCifra] = useState('')
  const pdfRef = useRef()

  // Timecode
  const [timecodeArquivo, setTimecodeArquivo] = useState(null)
  const [timecodeExistente, setTimecodeExistente] = useState(null)
  const [uploadandoTc, setUploadandoTc] = useState(false)
  const [msgTc, setMsgTc] = useState('')
  const tcRef = useRef()

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
    if (data) data.forEach(k => { mapa[k.tipo] = k })
    setKitExistente(mapa)
  }

  async function carregarCifras(musicaId) {
    const { data } = await supabase.from('cifras').select('*').eq('musica_id', musicaId)
    const mapa = {}
    if (data) data.forEach(c => { mapa[c.tom] = c })
    setCifras(mapa)
  }

  async function carregarTimecode(musicaId) {
    const { data } = await supabase.from('timecodes').select('*').eq('musica_id', musicaId).single()
    setTimecodeExistente(data || null)
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
    }
    setSalvando(false)
  }

  function selecionarMusica(m) {
    setMusicaSelecionada(m)
    carregarTrilhas(m.id)
    carregarKit(m.id)
    carregarCifras(m.id)
    carregarTimecode(m.id)
    setMsgMulti(''); setMsgKit(''); setMsgCifra(''); setMsgTc('')
    setArquivos([]); setKitArquivos({}); setTimecodeArquivo(null)
    setCifraEditando(null); setCifraTexto(''); setCifrasTom('')
  }

  // --- Multitrack ---
  function nomeDoArquivo(filename) {
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  }

  function handleArquivos(files) {
    const audios = Array.from(files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|flac|ogg|m4a|aac)$/i))
    if (!audios.length) { setMsgMulti('Nenhum arquivo de áudio encontrado.'); return }
    setArquivos(audios); setMsgMulti('')
  }

  async function uploadMultitrack(e) {
    e.preventDefault()
    if (!arquivos.length || !musicaSelecionada) return
    setUploadando(true); setMsgMulti('')
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
    setMsgMulti(erros > 0 ? `Concluído com ${erros} erro(s).` : `${arquivos.length} trilha(s) adicionada(s)!`)
    setUploadando(false); setProgresso({ atual: 0, total: 0 })
  }

  async function deletarTrilha(trilhaId, url) {
    const path = url.split('/audio/')[1]
    await supabase.storage.from('audio').remove([path])
    await supabase.from('trilhas').delete().eq('id', trilhaId)
    await carregarTrilhas(musicaSelecionada.id)
  }

  // --- Kit Ensaio ---
  async function uploadKit(e) {
    e.preventDefault()
    const tiposParaUpload = Object.keys(kitArquivos).filter(t => kitArquivos[t])
    if (!tiposParaUpload.length || !musicaSelecionada) return
    setUploadandoKit(true); setMsgKit('')
    setProgressoKit({ atual: 0, total: tiposParaUpload.length })
    let erros = 0
    for (let i = 0; i < tiposParaUpload.length; i++) {
      const tipo = tiposParaUpload[i]
      const arquivo = kitArquivos[tipo]
      if (kitExistente[tipo]) {
        const oldPath = kitExistente[tipo].url.split('/audio/')[1]
        await supabase.storage.from('audio').remove([oldPath])
        await supabase.from('kit_ensaio').delete().eq('id', kitExistente[tipo].id)
      }
      const ext = arquivo.name.split('.').pop()
      const path = `${musicaSelecionada.id}/kit-${tipo}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('audio').upload(path, arquivo)
      if (upErr) { erros++; setProgressoKit(p => ({ ...p, atual: i+1 })); continue }
      const { data: urlData } = supabase.storage.from('audio').getPublicUrl(path)
      await supabase.from('kit_ensaio').insert({ musica_id: musicaSelecionada.id, tipo, url: urlData.publicUrl })
      setProgressoKit({ atual: i+1, total: tiposParaUpload.length })
    }
    await carregarKit(musicaSelecionada.id)
    setKitArquivos({})
    KIT_TIPOS.forEach(t => { if (kitRefs[t]?.current) kitRefs[t].current.value = '' })
    setMsgKit(erros > 0 ? `Concluído com ${erros} erro(s).` : 'Kit ensaio atualizado!')
    setUploadandoKit(false); setProgressoKit({ atual: 0, total: 0 })
  }

  async function deletarKitTipo(tipo) {
    const k = kitExistente[tipo]
    if (!k) return
    await supabase.storage.from('audio').remove([k.url.split('/audio/')[1]])
    await supabase.from('kit_ensaio').delete().eq('id', k.id)
    await carregarKit(musicaSelecionada.id)
  }

  // --- Cifras ---
  function iniciarEdicaoCifra(tom) {
    setCifraEditando(tom)
    setCifrasTom(tom)
    setCifraTexto(cifras[tom]?.conteudo || '')
    setCifraPdf(null)
    setMsgCifra('')
  }

  async function salvarCifra(e) {
    e.preventDefault()
    if (!cifrasTom || (!cifraTexto.trim() && !cifraPdf) || !musicaSelecionada) return
    setSalvandoCifra(true); setMsgCifra('')

    // Upload PDF se houver
    let pdfUrl = cifras[cifrasTom]?.pdf_url || null
    if (cifraPdf) {
      const path = `${musicaSelecionada.id}/${cifrasTom}-${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('cifras').upload(path, cifraPdf)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('cifras').getPublicUrl(path)
        pdfUrl = urlData.publicUrl
      }
    }

    const payload = {
      conteudo: cifraTexto.trim() || null,
      pdf_url: pdfUrl,
    }

    if (cifras[cifrasTom]) {
      await supabase.from('cifras').update(payload).eq('id', cifras[cifrasTom].id)
    } else {
      await supabase.from('cifras').insert({ musica_id: musicaSelecionada.id, tom: cifrasTom, ...payload })
    }
    await carregarCifras(musicaSelecionada.id)
    setCifraEditando(null); setCifraTexto(''); setCifrasTom(''); setCifraPdf(null)
    if (pdfRef.current) pdfRef.current.value = ''
    setMsgCifra('Cifra salva!')
    setSalvandoCifra(false)
    setTimeout(() => setMsgCifra(''), 2000)
  }

  async function deletarCifra(tom) {
    const c = cifras[tom]
    if (!c) return
    await supabase.from('cifras').delete().eq('id', c.id)
    await carregarCifras(musicaSelecionada.id)
  }

  // --- Timecode ---
  async function uploadTimecode(e) {
    e.preventDefault()
    if (!timecodeArquivo || !musicaSelecionada) return
    setUploadandoTc(true); setMsgTc('')
    try {
      const texto = await timecodeArquivo.text()
      const secoes = parseTimecode(texto)
      if (secoes.length === 0) { setMsgTc('Arquivo inválido — nenhuma seção encontrada.'); setUploadandoTc(false); return }
      if (timecodeExistente) {
        await supabase.from('timecodes').update({ secoes }).eq('id', timecodeExistente.id)
      } else {
        await supabase.from('timecodes').insert({ musica_id: musicaSelecionada.id, secoes })
      }
      await carregarTimecode(musicaSelecionada.id)
      setTimecodeArquivo(null)
      if (tcRef.current) tcRef.current.value = ''
      setMsgTc(`${secoes.length} seções importadas!`)
    } catch(e) { setMsgTc('Erro ao processar o arquivo.') }
    setUploadandoTc(false)
  }

  async function deletarTimecode() {
    if (!timecodeExistente) return
    await supabase.from('timecodes').delete().eq('id', timecodeExistente.id)
    setTimecodeExistente(null)
  }

  async function deletarMusica(musicaId) {
    if (!confirm('Deletar esta música e todo o conteúdo?')) return
    const { data: ts } = await supabase.from('trilhas').select('url').eq('musica_id', musicaId)
    const { data: ks } = await supabase.from('kit_ensaio').select('url').eq('musica_id', musicaId)
    const paths = [...(ts||[]), ...(ks||[])].map(t => t.url.split('/audio/')[1])
    if (paths.length) await supabase.storage.from('audio').remove(paths)
    await supabase.from('musicas').delete().eq('id', musicaId)
    setMusicaSelecionada(null); setTrilhas([]); setKitExistente({}); setCifras({}); setTimecodeExistente(null)
    setArquivos([]); setKitArquivos({})
    await carregarMusicas()
  }

  const trackColors = ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff']
  const pct = progresso.total ? Math.round((progresso.atual/progresso.total)*100) : 0
  const pctKit = progressoKit.total ? Math.round((progressoKit.atual/progressoKit.total)*100) : 0
  const totalKitSel = Object.keys(kitArquivos).filter(t => kitArquivos[t]).length

  const ABAS = [
    { key: 'multitrack', label: 'Multitrack' },
    { key: 'kit', label: 'Kit Ensaio' },
    { key: 'cifras', label: 'Cifras' },
    { key: 'timecode', label: 'Time Code' },
  ]

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:20, letterSpacing:4, color:'var(--accent)' }}>
          MIXSTAGE <span style={{ fontSize:12, color:'var(--text2)', letterSpacing:2 }}>/ ADMIN</span>
        </div>
        <button onClick={() => navigate('/catalogo')} style={{ padding:'8px 16px', borderRadius:'var(--radius)', background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)', fontSize:12, cursor:'pointer' }}>← Catálogo</button>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'40px 24px', display:'grid', gridTemplateColumns:'360px 1fr', gap:32, alignItems:'start' }}>

        {/* Coluna esquerda */}
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
                  <button key={t} type="button" onClick={() => setTomSelecionado(prev => prev === t ? '' : t)} style={{ padding:'5px 10px', borderRadius:'var(--radius)', fontSize:11, background: tomSelecionado===t ? 'var(--accent)' : 'var(--bg3)', color: tomSelecionado===t ? '#000' : 'var(--text2)', border:`1px solid ${tomSelecionado===t ? 'var(--accent)' : 'var(--border)'}`, cursor:'pointer', fontFamily:'var(--font-mono)' }}>{t}</button>
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
              <div key={m.id} onClick={() => selecionarMusica(m)} style={{ background: musicaSelecionada?.id===m.id ? 'var(--bg3)' : 'var(--bg2)', border:`1px solid ${musicaSelecionada?.id===m.id ? 'var(--accent)' : 'var(--border)'}`, borderRadius:'var(--radius)', padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
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

        {/* Coluna direita */}
        <div className="fade-in" style={{ animationDelay:'0.1s' }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, marginBottom:24 }}>
            Conteúdo {musicaSelecionada && <span style={{ color:'var(--accent)', fontSize:16 }}>— {musicaSelecionada.titulo}</span>}
          </h2>

          {!musicaSelecionada ? (
            <div style={{ color:'var(--text2)', fontSize:13, padding:24, textAlign:'center', border:'1px dashed var(--border)', borderRadius:'var(--radius-lg)' }}>
              Selecione uma música para gerenciar o conteúdo
            </div>
          ) : (
            <>
              {/* Abas */}
              <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', marginBottom:20 }}>
                {ABAS.map(a => (
                  <button key={a.key} onClick={() => setAba(a.key)} style={{ flex:1, padding:'10px 0', fontSize:11, letterSpacing:1, background: aba===a.key ? 'var(--accent)' : 'transparent', color: aba===a.key ? '#000' : 'var(--text2)', fontWeight: aba===a.key ? 700 : 400, textTransform:'uppercase', border:'none', cursor:'pointer', fontFamily:'var(--font-mono)' }}>{a.label}</button>
                ))}
              </div>

              {/* Multitrack */}
              {aba === 'multitrack' && (
                <>
                  <form onSubmit={uploadMultitrack} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20, marginBottom:20, display:'flex', flexDirection:'column', gap:12 }}>
                    <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase' }}>Upload de trilhas</div>
                    <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); handleArquivos(e.dataTransfer.files) }} onClick={() => fileInputRef.current?.click()}
                      style={{ border:`2px dashed ${dragOver ? 'var(--accent)' : 'var(--border2)'}`, borderRadius:'var(--radius)', padding:'28px 16px', textAlign:'center', cursor:'pointer', background: dragOver ? 'rgba(232,255,60,0.05)' : 'transparent', transition:'all 0.15s' }}>
                      <div style={{ fontSize:28, marginBottom:8 }}>🎵</div>
                      <div style={{ fontSize:13, color:'var(--text2)' }}>Solte os arquivos aqui ou clique</div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>Vários arquivos — cada um vira uma trilha</div>
                    </div>
                    <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display:'none' }} onChange={e => handleArquivos(e.target.files)} />
                    {arquivos.length > 0 && (
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {arquivos.map((f, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'8px 12px', fontSize:12 }}>
                            <div style={{ width:3, height:20, borderRadius:1, background:trackColors[i%6], flexShrink:0 }} />
                            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nomeDoArquivo(f.name)}</span>
                            <span style={{ color:'var(--text3)' }}>{(f.size/1024/1024).toFixed(1)} MB</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {uploadando && (
                      <div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text2)', marginBottom:6 }}><span>Enviando {progresso.atual}/{progresso.total}...</span><span>{pct}%</span></div>
                        <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', background:'var(--accent)', width:`${pct}%`, transition:'width 0.3s' }} /></div>
                      </div>
                    )}
                    {msgMulti && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background: msgMulti.includes('erro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)', color: msgMulti.includes('erro') ? 'var(--danger)' : 'var(--success)' }}>{msgMulti}</div>}
                    <button type="submit" disabled={uploadando || !arquivos.length} style={{ padding:'11px 0', borderRadius:'var(--radius)', background: arquivos.length && !uploadando ? 'var(--accent)' : 'var(--bg3)', color: arquivos.length && !uploadando ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2, border:'1px solid var(--border)', cursor: arquivos.length && !uploadando ? 'pointer' : 'not-allowed' }}>
                      {uploadando ? `ENVIANDO ${pct}%...` : `↑ UPLOAD ${arquivos.length ? `(${arquivos.length})` : ''}`}
                    </button>
                  </form>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {trilhas.map((t, i) => (
                      <div key={t.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
                        <div style={{ width:3, height:32, borderRadius:2, background:trackColors[i%6], flexShrink:0 }} />
                        <div style={{ flex:1 }}><div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:13 }}>{t.nome}</div><div style={{ fontSize:11, color:'var(--text3)' }}>Trilha {i+1}</div></div>
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

              {/* Kit Ensaio */}
              {aba === 'kit' && (
                <form onSubmit={uploadKit} style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {KIT_TIPOS.map((tipo, i) => {
                    const existente = kitExistente[tipo]
                    const selecionado = kitArquivos[tipo]
                    return (
                      <div key={tipo} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'14px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: (existente || selecionado) ? 8 : 0 }}>
                          <div style={{ width:3, height:18, borderRadius:1, background:trackColors[i%6] }} />
                          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, flex:1 }}>{KIT_LABELS[tipo]}</div>
                          {existente && !selecionado && <span style={{ fontSize:10, color:'var(--success)', background:'rgba(60,255,143,0.1)', border:'1px solid rgba(60,255,143,0.3)', borderRadius:3, padding:'2px 6px' }}>✓ cadastrado</span>}
                          {selecionado && <span style={{ fontSize:10, color:'var(--accent)', background:'rgba(232,255,60,0.1)', border:'1px solid rgba(232,255,60,0.3)', borderRadius:3, padding:'2px 6px' }}>novo</span>}
                          <button type="button" onClick={() => kitRefs[tipo].current?.click()} style={{ padding:'5px 10px', borderRadius:'var(--radius)', fontSize:11, background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)', cursor:'pointer' }}>{existente ? '↺ Substituir' : '+ Arquivo'}</button>
                          <input ref={kitRefs[tipo]} type="file" accept="audio/*" style={{ display:'none' }} onChange={e => { const f = e.target.files[0]; if (f) setKitArquivos(prev => ({ ...prev, [tipo]: f })); e.target.value='' }} />
                          {existente && !selecionado && <button type="button" onClick={() => deletarKitTipo(tipo)} style={{ background:'none', color:'var(--text3)', fontSize:14, padding:4, cursor:'pointer', border:'none' }} onMouseEnter={e => e.currentTarget.style.color='var(--danger)'} onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>✕</button>}
                        </div>
                        {selecionado && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'7px 10px', fontSize:12 }}>
                            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selecionado.name}</span>
                            <span style={{ color:'var(--text3)' }}>{(selecionado.size/1024/1024).toFixed(1)} MB</span>
                            <button type="button" onClick={() => setKitArquivos(prev => { const n={...prev}; delete n[tipo]; return n })} style={{ background:'none', color:'var(--text3)', border:'none', cursor:'pointer', fontSize:14 }} onMouseEnter={e => e.currentTarget.style.color='var(--danger)'} onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>✕</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {uploadandoKit && (
                    <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text2)', marginBottom:8 }}><span>Enviando {progressoKit.atual}/{progressoKit.total}...</span><span style={{ color:'var(--accent)' }}>{pctKit}%</span></div>
                      <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', background:'var(--accent)', width:`${pctKit}%`, transition:'width 0.3s' }} /></div>
                    </div>
                  )}
                  {msgKit && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background: msgKit.includes('erro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)', color: msgKit.includes('erro') ? 'var(--danger)' : 'var(--success)' }}>{msgKit}</div>}
                  <button type="submit" disabled={uploadandoKit || totalKitSel===0} style={{ padding:'12px 0', borderRadius:'var(--radius)', background: totalKitSel>0 && !uploadandoKit ? 'var(--accent)' : 'var(--bg3)', color: totalKitSel>0 && !uploadandoKit ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2, border:'1px solid var(--border)', cursor: totalKitSel>0 && !uploadandoKit ? 'pointer' : 'not-allowed' }}>
                    {uploadandoKit ? `ENVIANDO ${pctKit}%...` : `↑ SALVAR KIT ${totalKitSel>0 ? `(${totalKitSel})` : ''}`}
                  </button>
                </form>
              )}

              {/* Cifras */}
              {aba === 'cifras' && (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20 }}>
                    <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase', marginBottom:16 }}>Cifras por tom</div>
                    <div style={{ fontSize:13, color:'var(--text2)', marginBottom:16 }}>
                      Adicione a cifra em cada tom. Na tela do player, a cifra do tom atual será exibida automaticamente.
                    </div>

                    {/* Lista de cifras existentes */}
                    {Object.keys(cifras).length > 0 && (
                      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
                        <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:1, textTransform:'uppercase', marginBottom:4 }}>Cifras cadastradas:</div>
                        {Object.keys(cifras).map(tom => (
                          <div key={tom} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'10px 14px' }}>
                            <span style={{ fontSize:11, fontWeight:700, background:'rgba(232,255,60,0.15)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.3)', borderRadius:4, padding:'2px 8px' }}>{tom}</span>
                            <div style={{ flex:1, display:'flex', gap:6 }}>
                              {cifras[tom].conteudo && <span style={{ fontSize:10, color:'var(--text3)', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 6px' }}>📝 texto</span>}
                              {cifras[tom].pdf_url && <span style={{ fontSize:10, color:'var(--text3)', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 6px' }}>📄 PDF</span>}
                            </div>
                            <button onClick={() => iniciarEdicaoCifra(tom)} style={{ background:'none', color:'var(--accent)', fontSize:12, cursor:'pointer', border:'1px solid rgba(232,255,60,0.3)', borderRadius:'var(--radius)', padding:'3px 8px' }}>editar</button>
                            <button onClick={() => deletarCifra(tom)} style={{ background:'none', color:'var(--text3)', fontSize:14, padding:4, cursor:'pointer', border:'none' }} onMouseEnter={e => e.currentTarget.style.color='var(--danger)'} onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Form para adicionar/editar cifra */}
                    {cifraEditando !== null || true ? (
                      <form onSubmit={salvarCifra} style={{ display:'flex', flexDirection:'column', gap:12 }}>
                        <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', marginBottom:4 }}>
                          {cifraEditando ? `Editando cifra — ${cifraEditando}` : 'Adicionar nova cifra'}
                        </div>
                        <div>
                          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:6, letterSpacing:1, textTransform:'uppercase' }}>Tom</label>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                            {TONS_SELECT.map(t => (
                              <button key={t} type="button" onClick={() => setCifrasTom(t)} style={{ padding:'5px 10px', borderRadius:'var(--radius)', fontSize:11, background: cifrasTom===t ? 'var(--accent)' : 'var(--bg3)', color: cifrasTom===t ? '#000' : 'var(--text2)', border:`1px solid ${cifrasTom===t ? 'var(--accent)' : 'var(--border)'}`, cursor:'pointer', fontFamily:'var(--font-mono)' }}>{t}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:6, letterSpacing:1, textTransform:'uppercase' }}>Cifra em texto (opcional)</label>
                          <textarea value={cifraTexto} onChange={e => setCifraTexto(e.target.value)} placeholder="Cole a cifra aqui..." rows={8} style={{ width:'100%', fontFamily:'var(--font-mono)', fontSize:13, resize:'vertical', background:'var(--bg3)', border:'1px solid var(--border2)', color:'var(--text)', borderRadius:'var(--radius)', padding:12 }} />
                        </div>
                        <div>
                          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:6, letterSpacing:1, textTransform:'uppercase' }}>Cifra em PDF (opcional)</label>
                          {cifraEditando && cifras[cifraEditando]?.pdf_url && !cifraPdf && (
                            <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'8px 12px', marginBottom:8, fontSize:12 }}>
                              <span style={{ fontSize:16 }}>📄</span>
                              <span style={{ flex:1, color:'var(--success)' }}>PDF cadastrado</span>
                              <a href={cifras[cifraEditando].pdf_url} target="_blank" rel="noreferrer" style={{ color:'var(--accent)', fontSize:11, textDecoration:'none' }}>ver</a>
                            </div>
                          )}
                          <div onClick={() => pdfRef.current?.click()} style={{ border:`2px dashed ${cifraPdf ? 'var(--accent)' : 'var(--border2)'}`, borderRadius:'var(--radius)', padding:'16px', textAlign:'center', cursor:'pointer', background: cifraPdf ? 'rgba(232,255,60,0.05)' : 'transparent', transition:'all 0.15s' }}>
                            <div style={{ fontSize:20, marginBottom:4 }}>📄</div>
                            <div style={{ fontSize:12, color: cifraPdf ? 'var(--accent)' : 'var(--text2)' }}>{cifraPdf ? cifraPdf.name : 'Clique para selecionar um PDF'}</div>
                            {cifraPdf && <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>{(cifraPdf.size/1024/1024).toFixed(2)} MB</div>}
                          </div>
                          <input ref={pdfRef} type="file" accept="application/pdf" style={{ display:'none' }} onChange={e => { setCifraPdf(e.target.files[0] || null); e.target.value='' }} />
                          {cifraPdf && <button type="button" onClick={() => { setCifraPdf(null); if(pdfRef.current) pdfRef.current.value='' }} style={{ marginTop:6, padding:'4px 10px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:11, border:'1px solid var(--border)', cursor:'pointer' }}>✕ remover PDF</button>}
                        </div>
                        {msgCifra && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background:'rgba(60,255,143,0.1)', color:'var(--success)' }}>{msgCifra}</div>}
                        <div style={{ display:'flex', gap:8 }}>
                          <button type="submit" disabled={salvandoCifra || !cifrasTom || (!cifraTexto.trim() && !cifraPdf && !cifras[cifrasTom]?.pdf_url)} style={{ flex:1, padding:'11px 0', borderRadius:'var(--radius)', background: cifrasTom && (cifraTexto.trim() || cifraPdf || cifras[cifrasTom]?.pdf_url) ? 'var(--accent)' : 'var(--bg3)', color: cifrasTom && (cifraTexto.trim() || cifraPdf || cifras[cifrasTom]?.pdf_url) ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2, border:'none', cursor:'pointer' }}>
                            {salvandoCifra ? 'SALVANDO...' : '✓ SALVAR CIFRA'}
                          </button>
                          {cifraEditando && <button type="button" onClick={() => { setCifraEditando(null); setCifraTexto(''); setCifrasTom(''); setCifraPdf(null) }} style={{ padding:'11px 16px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:12, border:'1px solid var(--border)', cursor:'pointer' }}>cancelar</button>}
                        </div>
                      </form>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Time Code */}
              {aba === 'timecode' && (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20 }}>
                    <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:3, fontWeight:600, textTransform:'uppercase', marginBottom:12 }}>Time Code</div>
                    <div style={{ fontSize:13, color:'var(--text2)', marginBottom:16, lineHeight:1.6 }}>
                      Importe o arquivo de time code (.txt) com o formato:<br/>
                      <code style={{ background:'var(--bg3)', padding:'2px 6px', borderRadius:4, fontSize:12 }}>Nome da Seção</code> seguido de <code style={{ background:'var(--bg3)', padding:'2px 6px', borderRadius:4, fontSize:12 }}>0000000</code> (tempo em ms, 7 dígitos)
                    </div>

                    {timecodeExistente && (
                      <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:16, marginBottom:16 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                          <span style={{ fontSize:12, color:'var(--success)', fontWeight:600 }}>✓ Time code cadastrado — {timecodeExistente.secoes?.length || 0} seções</span>
                          <button onClick={deletarTimecode} style={{ background:'none', color:'var(--text3)', fontSize:12, cursor:'pointer', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'3px 8px' }} onMouseEnter={e => e.currentTarget.style.color='var(--danger)'} onMouseLeave={e => e.currentTarget.style.color='var(--text3)'}>deletar</button>
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                          {(timecodeExistente.secoes || []).map((s, i) => (
                            <span key={i} style={{ fontSize:11, background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:4, padding:'3px 8px', color:'var(--text2)' }}>
                              {s.nome} <span style={{ color:'var(--text3)' }}>{Math.floor(s.tempoMs/1000/60)}:{String(Math.floor(s.tempoMs/1000%60)).padStart(2,'0')}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <form onSubmit={uploadTimecode} style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      <div style={{ border:'2px dashed var(--border2)', borderRadius:'var(--radius)', padding:'20px 16px', textAlign:'center', cursor:'pointer' }} onClick={() => tcRef.current?.click()}>
                        <div style={{ fontSize:24, marginBottom:8 }}>📄</div>
                        <div style={{ fontSize:13, color:'var(--text2)' }}>{timecodeArquivo ? timecodeArquivo.name : 'Clique para selecionar o arquivo .txt'}</div>
                      </div>
                      <input ref={tcRef} type="file" accept=".txt,text/plain" style={{ display:'none' }} onChange={e => { setTimecodeArquivo(e.target.files[0] || null); e.target.value='' }} />
                      {msgTc && <div style={{ padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, background: msgTc.includes('nválido') || msgTc.includes('rro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)', color: msgTc.includes('nválido') || msgTc.includes('rro') ? 'var(--danger)' : 'var(--success)' }}>{msgTc}</div>}
                      <button type="submit" disabled={uploadandoTc || !timecodeArquivo} style={{ padding:'11px 0', borderRadius:'var(--radius)', background: timecodeArquivo && !uploadandoTc ? 'var(--accent)' : 'var(--bg3)', color: timecodeArquivo && !uploadandoTc ? '#000' : 'var(--text3)', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:2, border:'none', cursor: timecodeArquivo && !uploadandoTc ? 'pointer' : 'not-allowed' }}>
                        {uploadandoTc ? 'IMPORTANDO...' : '↑ IMPORTAR TIME CODE'}
                      </button>
                    </form>
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
