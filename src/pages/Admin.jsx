import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Admin() {
  const navigate = useNavigate()
  const [musicas, setMusicas] = useState([])
  const [titulo, setTitulo] = useState('')
  const [artista, setArtista] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [musicaSelecionada, setMusicaSelecionada] = useState(null)
  const [trilhaNome, setTrilhaNome] = useState('')
  const [trilhaArquivo, setTrilhaArquivo] = useState(null)
  const [uploadando, setUploadando] = useState(false)
  const [trilhas, setTrilhas] = useState([])
  const [msg, setMsg] = useState('')

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
    const { data, error } = await supabase.from('musicas').insert({ titulo: titulo.trim(), artista: artista.trim() }).select().single()
    if (!error) {
      setTitulo('')
      setArtista('')
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
  }

  async function uploadTrilha(e) {
    e.preventDefault()
    if (!trilhaNome.trim() || !trilhaArquivo || !musicaSelecionada) return
    setUploadando(true)
    setMsg('')

    const ext = trilhaArquivo.name.split('.').pop()
    const path = `${musicaSelecionada.id}/${Date.now()}.${ext}`

    const { error: upErr } = await supabase.storage.from('audio').upload(path, trilhaArquivo)
    if (upErr) { setMsg('Erro no upload: ' + upErr.message); setUploadando(false); return }

    const { data: urlData } = supabase.storage.from('audio').getPublicUrl(path)

    const { error: dbErr } = await supabase.from('trilhas').insert({
      musica_id: musicaSelecionada.id,
      nome: trilhaNome.trim(),
      url: urlData.publicUrl,
      ordem: trilhas.length,
    })

    if (dbErr) { setMsg('Erro ao salvar trilha: ' + dbErr.message) }
    else {
      setTrilhaNome('')
      setTrilhaArquivo(null)
      document.getElementById('file-input').value = ''
      await carregarTrilhas(musicaSelecionada.id)
      setMsg('Trilha adicionada!')
    }
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
    if (ts?.length) {
      const paths = ts.map(t => t.url.split('/audio/')[1])
      await supabase.storage.from('audio').remove(paths)
    }
    await supabase.from('musicas').delete().eq('id', musicaId)
    setMusicaSelecionada(null)
    setTrilhas([])
    await carregarMusicas()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '16px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, letterSpacing: 4, color: 'var(--accent)' }}>
          MIXSTAGE <span style={{ fontSize: 12, color: 'var(--text2)', letterSpacing: 2 }}>/ ADMIN</span>
        </div>
        <button onClick={() => navigate('/catalogo')} style={{
          padding: '8px 16px', borderRadius: 'var(--radius)',
          background: 'var(--bg3)', color: 'var(--text2)',
          border: '1px solid var(--border)', fontSize: 12, letterSpacing: 1,
        }}>← Catálogo</button>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'start' }}>

        {/* Coluna esquerda — músicas */}
        <div className="fade-in">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Músicas</h2>

          <form onSubmit={criarMusica} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Nova música</div>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título da música" required />
            <input value={artista} onChange={e => setArtista(e.target.value)} placeholder="Artista (opcional)" />
            <button type="submit" disabled={salvando} style={{
              padding: '11px 0', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: 2,
              opacity: salvando ? 0.6 : 1,
            }}>+ CRIAR</button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {musicas.map(m => (
              <div key={m.id} onClick={() => selecionarMusica(m)} style={{
                background: musicaSelecionada?.id === m.id ? 'var(--bg3)' : 'var(--bg2)',
                border: `1px solid ${musicaSelecionada?.id === m.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', padding: '14px 16px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{m.titulo}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{m.artista || 'Sem artista'}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); deletarMusica(m.id) }} style={{
                  background: 'none', color: 'var(--text3)', fontSize: 16, padding: 4,
                  transition: 'color 0.15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                >✕</button>
              </div>
            ))}
            {musicas.length === 0 && <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', padding: 24 }}>Nenhuma música ainda</div>}
          </div>
        </div>

        {/* Coluna direita — trilhas */}
        <div className="fade-in" style={{ animationDelay: '0.1s' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
            Trilhas {musicaSelecionada && <span style={{ color: 'var(--accent)', fontSize: 16 }}>— {musicaSelecionada.titulo}</span>}
          </h2>

          {!musicaSelecionada ? (
            <div style={{ color: 'var(--text2)', fontSize: 13, padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
              Selecione uma música para gerenciar as trilhas
            </div>
          ) : (
            <>
              <form onSubmit={uploadTrilha} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Adicionar trilha</div>
                <input value={trilhaNome} onChange={e => setTrilhaNome(e.target.value)} placeholder="Nome da trilha (ex: Guitarra, Voz...)" required />
                <input id="file-input" type="file" accept="audio/*" required
                  onChange={e => setTrilhaArquivo(e.target.files[0])}
                  style={{ cursor: 'pointer' }}
                />
                {msg && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12,
                    background: msg.includes('Erro') ? 'rgba(255,68,68,0.1)' : 'rgba(60,255,143,0.1)',
                    color: msg.includes('Erro') ? 'var(--danger)' : 'var(--success)',
                  }}>{msg}</div>
                )}
                <button type="submit" disabled={uploadando} style={{
                  padding: '11px 0', borderRadius: 'var(--radius)',
                  background: 'var(--accent)', color: '#000',
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: 2,
                  opacity: uploadando ? 0.6 : 1,
                }}>{uploadando ? 'ENVIANDO...' : '↑ UPLOAD'}</button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trilhas.map((t, i) => (
                  <div key={t.id} style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ width: 3, height: 32, borderRadius: 2, background: ['#e8ff3c','#3cffb0','#ff6b6b','#6bb3ff','#ff9f3c','#c46bff'][i % 6], flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{t.nome}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Trilha {i + 1}</div>
                    </div>
                    <button onClick={() => deletarTrilha(t.id, t.url)} style={{
                      background: 'none', color: 'var(--text3)', fontSize: 16, padding: 4,
                      transition: 'color 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                    >✕</button>
                  </div>
                ))}
                {trilhas.length === 0 && <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', padding: 20 }}>Nenhuma trilha ainda</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
