import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

const DIAS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']

export default function PlaylistDetalhe({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [playlist, setPlaylist] = useState(null)
  const [dono, setDono] = useState(null)
  const [musicas, setMusicas] = useState([])
  const [comentarios, setComentarios] = useState([])
  const [novoComentario, setNovoComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [meuPerfil, setMeuPerfil] = useState(null)
  const comentariosRef = useRef(null)

  useEffect(() => {
    async function carregar() {
      const [plRes, meRes] = await Promise.all([
        supabase.from('playlists').select('*').eq('id', id).single(),
        supabase.from('perfis').select('*').eq('id', session.user.id).single(),
      ])
      if (!plRes.data) { navigate('/'); return }
      setPlaylist(plRes.data)
      setMeuPerfil(meRes.data)

      const [donoRes, musicasRes, comentRes] = await Promise.all([
        supabase.from('perfis').select('*').eq('id', plRes.data.user_id).single(),
        supabase.from('playlist_musicas').select('*, musica:musicas(*)').eq('playlist_id', id).order('ordem'),
        supabase.from('playlist_comentarios').select('*, perfil:perfis(nome_completo)').eq('playlist_id', id).order('criado_em'),
      ])
      setDono(donoRes.data)
      setMusicas(musicasRes.data || [])
      setComentarios(comentRes.data || [])
      setCarregando(false)
    }
    carregar()

    // Realtime para comentários
    const channel = supabase.channel('comentarios-' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'playlist_comentarios', filter: `playlist_id=eq.${id}` },
        async (payload) => {
          const { data } = await supabase.from('playlist_comentarios').select('*, perfil:perfis(nome_completo)').eq('id', payload.new.id).single()
          if (data) setComentarios(prev => [...prev, data])
        }
      ).subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id])

  useEffect(() => {
    if (comentariosRef.current) {
      comentariosRef.current.scrollTop = comentariosRef.current.scrollHeight
    }
  }, [comentarios])

  function nomePlaylist() {
    if (!playlist || !dono) return ''
    if (playlist.privada) return playlist.nome || 'Playlist privada'
    const data = playlist.data_evento ? new Date(playlist.data_evento + 'T12:00:00') : null
    const dia = data ? DIAS[data.getDay()] : ''
    const dataFmt = data ? `${String(data.getDate()).padStart(2,'0')}/${String(data.getMonth()+1).padStart(2,'0')}/${data.getFullYear()}` : ''
    const partes = [dono.nome_completo, dia, dataFmt, playlist.nome].filter(Boolean)
    return partes.join(' - ')
  }

  function tomDisplay(pm) {
    const tomOriginal = pm.musica?.tom
    if (!tomOriginal) return pm.tom !== 0 ? `${pm.tom > 0 ? '+' : ''}${pm.tom} st` : 'Original'
    return calcularTom(tomOriginal.split('/')[0], pm.tom)
  }

  async function enviarComentario(e) {
    e.preventDefault()
    if (!novoComentario.trim()) return
    setEnviando(true)
    await supabase.from('playlist_comentarios').insert({
      playlist_id: id,
      user_id: session.user.id,
      texto: novoComentario.trim(),
    })
    setNovoComentario('')
    setEnviando(false)
  }

  async function deletarComentario(comentId) {
    await supabase.from('playlist_comentarios').delete().eq('id', comentId)
    setComentarios(prev => prev.filter(c => c.id !== comentId))
  }

  async function removerMusica(pmId) {
    await supabase.from('playlist_musicas').delete().eq('id', pmId)
    setMusicas(prev => prev.filter(m => m.id !== pmId))
  }

  async function mudarTom(pmId, delta) {
    const pm = musicas.find(m => m.id === pmId)
    if (!pm) return
    const novoTom = Math.max(-6, Math.min(6, pm.tom + delta))
    await supabase.from('playlist_musicas').update({ tom: novoTom }).eq('id', pmId)
    setMusicas(prev => prev.map(m => m.id === pmId ? { ...m, tom: novoTom } : m))
  }

  function fmtData(dataStr) {
    if (!dataStr) return ''
    const d = new Date(dataStr + 'T12:00:00')
    return `${DIAS[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
  }

  function fmtHora(isoStr) {
    const d = new Date(isoStr)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  const isDono = session.user.id === playlist?.user_id

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => navigate('/')} style={{ background:'none', color:'var(--text2)', fontSize:20, border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nomePlaylist()}</div>
          <div style={{ fontSize:12, color:'var(--text2)', display:'flex', gap:8, alignItems:'center', marginTop:2 }}>
            {!playlist.privada && playlist.data_evento && <span>{fmtData(playlist.data_evento)}</span>}
            <span style={{ fontSize:10, padding:'1px 6px', borderRadius:3, background: playlist.privada ? 'rgba(255,255,255,0.06)' : 'rgba(60,255,143,0.1)', color: playlist.privada ? 'var(--text3)' : 'var(--success)', border: `1px solid ${playlist.privada ? 'var(--border)' : 'rgba(60,255,143,0.3)'}` }}>
              {playlist.privada ? '🔒 Privada' : '🌐 Compartilhada'}
            </span>
          </div>
        </div>
        {isDono && (
          <button onClick={() => navigate(`/playlist/${id}/editar`)} style={{ padding:'7px 14px', borderRadius:'var(--radius)', background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)', fontSize:12, cursor:'pointer' }}>✏️ Editar</button>
        )}
      </div>

      <div style={{ maxWidth:700, margin:'0 auto', padding:'24px 16px', display:'flex', flexDirection:'column', gap:20 }}>

        {/* Músicas */}
        <div className="fade-in">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16 }}>
              Músicas <span style={{ color:'var(--text3)', fontSize:13, fontWeight:400 }}>{musicas.length}/20</span>
            </div>
            {isDono && musicas.length < 20 && (
              <button onClick={() => navigate(`/playlist/${id}/adicionar`)} style={{ padding:'7px 14px', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', border:'none', fontSize:12, cursor:'pointer', fontWeight:600 }}>+ Adicionar</button>
            )}
          </div>

          {musicas.length === 0 ? (
            <div style={{ textAlign:'center', padding:32, color:'var(--text2)', fontSize:13, border:'1px dashed var(--border)', borderRadius:'var(--radius-lg)' }}>
              Nenhuma música ainda.{isDono ? ' Clique em + Adicionar.' : ''}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {musicas.map((pm, idx) => (
                <div key={pm.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'14px 16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text3)', minWidth:20, textAlign:'center' }}>{idx+1}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pm.musica?.titulo}</div>
                      <div style={{ fontSize:12, color:'var(--text2)' }}>{pm.musica?.artista || 'Sem artista'}</div>
                    </div>

                    {/* Tom */}
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      {isDono && <button onClick={() => mudarTom(pm.id, -1)} disabled={pm.tom <= -6} style={{ width:24, height:24, borderRadius:4, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>}
                      <span style={{ fontSize:12, fontWeight:700, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'3px 8px', minWidth:36, textAlign:'center' }}>{tomDisplay(pm)}</span>
                      {isDono && <button onClick={() => mudarTom(pm.id, 1)} disabled={pm.tom >= 6} style={{ width:24, height:24, borderRadius:4, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>}
                    </div>

                    {isDono && <button onClick={() => removerMusica(pm.id)} style={{ background:'none', color:'var(--text3)', fontSize:16, border:'none', cursor:'pointer', padding:4 }} onMouseEnter={e=>e.currentTarget.style.color='var(--danger)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text3)'}>✕</button>}
                  </div>

                  {/* Botões de acesso */}
                  <div style={{ display:'flex', gap:8, marginTop:10 }}>
                    <button onClick={() => navigate(`/escolha/${pm.musica_id}`)} style={{ flex:1, padding:'8px 0', borderRadius:'var(--radius)', background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)', fontSize:12, cursor:'pointer', fontFamily:'var(--font-mono)' }}>
                      🎛️ Multitrack / Kit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat — apenas playlists compartilhadas */}
        {!playlist.privada && (
          <div className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20 }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, marginBottom:4 }}>💬 Comentários</div>
            <div style={{ fontSize:11, color:'var(--danger)', marginBottom:16, padding:'6px 10px', background:'rgba(255,68,68,0.08)', borderRadius:'var(--radius)', border:'1px solid rgba(255,68,68,0.2)' }}>
              ⚠️ Os comentários são públicos e visíveis para todos os usuários do MixStage.
            </div>

            {/* Lista de comentários */}
            <div ref={comentariosRef} style={{ maxHeight:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
              {comentarios.length === 0 ? (
                <div style={{ textAlign:'center', color:'var(--text3)', fontSize:13, padding:16 }}>Nenhum comentário ainda.</div>
              ) : (
                comentarios.map(c => (
                  <div key={c.id} style={{ display:'flex', gap:10 }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--bg3)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>
                      {(c.perfil?.nome_completo || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex:1, background:'var(--bg3)', borderRadius:'var(--radius)', padding:'8px 12px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{c.perfil?.nome_completo || 'Usuário'}</span>
                        <span style={{ fontSize:10, color:'var(--text3)' }}>{fmtHora(c.criado_em)}</span>
                        {c.user_id === session.user.id && (
                          <button onClick={() => deletarComentario(c.id)} style={{ background:'none', color:'var(--text3)', border:'none', cursor:'pointer', fontSize:11, marginLeft:'auto' }}
                            onMouseEnter={e=>e.currentTarget.style.color='var(--danger)'}
                            onMouseLeave={e=>e.currentTarget.style.color='var(--text3)'}
                          >✕</button>
                        )}
                      </div>
                      <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.5 }}>{c.texto}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input comentário */}
            <form onSubmit={enviarComentario} style={{ display:'flex', gap:8 }}>
              <input value={novoComentario} onChange={e => setNovoComentario(e.target.value)} placeholder="Escreva um comentário..." style={{ flex:1 }} maxLength={500} />
              <button type="submit" disabled={enviando || !novoComentario.trim()} style={{ padding:'10px 16px', borderRadius:'var(--radius)', background: novoComentario.trim() ? 'var(--accent)' : 'var(--bg3)', color: novoComentario.trim() ? '#000' : 'var(--text3)', border:'none', cursor:'pointer', fontWeight:600, fontSize:13 }}>
                {enviando ? '...' : '→'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
