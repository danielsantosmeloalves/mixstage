import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function PlaylistForm({ session }) {
  const navigate = useNavigate()
  const { id } = useParams() // se tiver id = edição
  const editando = !!id

  const [nome, setNome] = useState('')
  const [privada, setPrivada] = useState(true)
  const [dataEvento, setDataEvento] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [carregando, setCarregando] = useState(editando)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!editando) return
    async function carregar() {
      const { data } = await supabase.from('playlists').select('*').eq('id', id).single()
      if (data) {
        setNome(data.nome || '')
        setPrivada(data.privada)
        setDataEvento(data.data_evento || '')
      }
      setCarregando(false)
    }
    carregar()
  }, [id])

  async function salvar(e) {
    e.preventDefault()
    setErro('')

    if (!privada && !dataEvento) { setErro('Playlists compartilhadas precisam de uma data.'); return }

    setSalvando(true)
    if (editando) {
      const { error } = await supabase.from('playlists').update({
        nome: nome.trim() || null,
        privada,
        data_evento: privada ? null : dataEvento,
      }).eq('id', id)
      if (error) { setErro('Erro: ' + error.message); setSalvando(false); return }
      navigate(`/playlist/${id}`)
    } else {
      // Verifica limite de 4 playlists
      const { count } = await supabase.from('playlists').select('*', { count:'exact', head:true }).eq('user_id', session.user.id)
      if (count >= 4) { setErro('Limite de 4 playlists atingido. Delete uma para criar outra.'); setSalvando(false); return }

      const { data, error } = await supabase.from('playlists').insert({
        user_id: session.user.id,
        nome: nome.trim() || null,
        privada,
        data_evento: privada ? null : dataEvento,
      }).select().single()
      if (error) { setErro('Erro: ' + error.message); setSalvando(false); return }
      navigate(`/playlist/${data.id}`)
    }
    setSalvando(false)
  }

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => navigate(-1)} style={{ background:'none', color:'var(--text2)', fontSize:20, border:'none', cursor:'pointer' }}>←</button>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16 }}>{editando ? 'Editar Playlist' : 'Nova Playlist'}</div>
      </div>

      <div style={{ maxWidth:500, margin:'0 auto', padding:'32px 16px' }}>
        <form onSubmit={salvar} className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:28, display:'flex', flexDirection:'column', gap:20 }}>

          <div>
            <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:8 }}>Nome da playlist <span style={{ color:'var(--text3)', fontWeight:400, textTransform:'none', letterSpacing:0 }}>(opcional)</span></label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Domingo de Manhã, Ensaio Abril..." maxLength={60} />
          </div>

          <div>
            <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:12 }}>Visibilidade</label>
            <div style={{ display:'flex', gap:10 }}>
              {[
                { valor: true, label: '🔒 Privada', desc: 'Só você vê' },
                { valor: false, label: '🌐 Compartilhada', desc: 'Todos veem' },
              ].map(op => (
                <div key={String(op.valor)} onClick={() => setPrivada(op.valor)} style={{ flex:1, padding:'14px 16px', borderRadius:'var(--radius)', background: privada === op.valor ? 'rgba(232,255,60,0.08)' : 'var(--bg3)', border:`1px solid ${privada === op.valor ? 'rgba(232,255,60,0.3)' : 'var(--border)'}`, cursor:'pointer', transition:'all 0.15s', textAlign:'center' }}>
                  <div style={{ fontSize:14, fontWeight:600, color: privada === op.valor ? 'var(--accent)' : 'var(--text)' }}>{op.label}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>{op.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {!privada && (
            <div>
              <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:8 }}>Data do evento *</label>
              <input type="date" value={dataEvento} onChange={e => setDataEvento(e.target.value)} required={!privada} />
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>
                O nome exibido será: <strong style={{ color:'var(--text2)' }}>Seu Nome - Dia da Semana - Data {nome ? `- ${nome}` : ''}</strong>
              </div>
            </div>
          )}

          {erro && <div style={{ padding:'10px 14px', borderRadius:'var(--radius)', fontSize:13, background:'rgba(255,68,68,0.1)', color:'var(--danger)' }}>{erro}</div>}

          <button type="submit" disabled={salvando} style={{ padding:'14px 0', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, letterSpacing:2, border:'none', cursor:'pointer', opacity: salvando ? 0.7 : 1 }}>
            {salvando ? 'SALVANDO...' : editando ? 'SALVAR ALTERAÇÕES' : 'CRIAR PLAYLIST'}
          </button>
        </form>
      </div>
    </div>
  )
}
