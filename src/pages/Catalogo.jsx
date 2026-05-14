import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

const DIAS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']

export default function Catalogo({ session, isAdmin }) {
  const navigate = useNavigate()
  const [minhasPlaylists, setMinhasPlaylists] = useState([])
  const [playlistsCompartilhadas, setPlaylistsCompartilhadas] = useState([])
  const [musicas, setMusicas] = useState([])
  const [perfil, setPerfil] = useState(null)
  const [busca, setBusca] = useState('')
  const [aba, setAba] = useState('minhas')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    async function carregar() {
      const [perfilRes, minhasRes, compartiRes, musicasRes] = await Promise.all([
        supabase.from('perfis').select('*').eq('id', session.user.id).single(),
        supabase.from('playlists').select('*').eq('user_id', session.user.id).order('criado_em', { ascending: false }),
        supabase.from('playlists').select('*, perfil:perfis(nome_completo)').eq('privada', false).order('criado_em', { ascending: false }),
        supabase.from('musicas').select('*').order('titulo'),
      ])

      if (!perfilRes.data) { navigate('/perfil'); return }
      setPerfil(perfilRes.data)
      setMinhasPlaylists(minhasRes.data || [])
      console.log('Compartilhadas raw:', compartiRes.data, compartiRes.error)
      setPlaylistsCompartilhadas(compartiRes.data || [])
      setMusicas(musicasRes.data || [])
      setCarregando(false)
    }
    carregar()
  }, [])

  function nomePlaylistCompartilhada(pl) {
    const nomeUsuario = pl.perfil?.nome_completo || 'Usuário'
    const data = pl.data_evento ? new Date(pl.data_evento + 'T12:00:00') : null
    const dia = data ? DIAS[data.getDay()] : ''
    const dataFmt = data ? `${String(data.getDate()).padStart(2,'0')}/${String(data.getMonth()+1).padStart(2,'0')}` : ''
    return [nomeUsuario, dia, dataFmt, pl.nome].filter(Boolean).join(' — ')
  }

  function nomeMinhaPlaylist(pl) {
    if (pl.nome) return pl.nome
    if (!pl.privada && pl.data_evento) {
      const d = new Date(pl.data_evento + 'T12:00:00')
      return `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
    }
    return 'Playlist sem nome'
  }

  async function deletarPlaylist(plId) {
    if (!confirm('Deletar esta playlist?')) return
    await supabase.from('playlists').delete().eq('id', plId)
    setMinhasPlaylists(prev => prev.filter(p => p.id !== plId))
  }

  const musicasFiltradas = musicas.filter(m =>
    m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
    (m.artista || '').toLowerCase().includes(busca.toLowerCase())
  )

  const playlistsFiltradas = [...minhasPlaylists, ...playlistsCompartilhadas].filter(pl => {
    const nome = nomeMinhaPlaylist(pl) + nomePlaylistCompartilhada(pl)
    return nome.toLowerCase().includes(busca.toLowerCase())
  })

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:28, letterSpacing:4, color:'var(--accent)', marginBottom:8 }}>MIXSTAGE</div>
        <div style={{ color:'var(--text3)', fontSize:13 }}>Carregando...</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      {/* Header */}
      <div style={{ borderBottom:'1px solid var(--border)', padding:'14px 24px', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:20, letterSpacing:4, color:'var(--accent)', flex:1 }}>MIXSTAGE</div>
        <div style={{ display:'flex', gap:8 }}>
          {isAdmin && <button onClick={() => navigate('/admin')} style={{ padding:'8px 14px', borderRadius:'var(--radius)', background:'var(--bg3)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.3)', fontSize:11, cursor:'pointer', letterSpacing:1 }}>ADMIN</button>}
          <button onClick={() => navigate('/perfil')} title={perfil?.nome_completo} style={{ width:36, height:36, borderRadius:'50%', background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {(perfil?.nome_completo || session.user.email || '?')[0].toUpperCase()}
          </button>
        </div>
      </div>

      <div style={{ maxWidth:700, margin:'0 auto', padding:'24px 16px' }}>

        {/* Abas principais */}
        <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', marginBottom:24 }}>
          {[
            { key:'minhas', label:'Minhas Playlists' },
            { key:'compartilhadas', label:'Compartilhadas' },
            { key:'catalogo', label:'Catálogo' },
          ].map(a => (
            <button key={a.key} onClick={() => setAba(a.key)} style={{ flex:1, padding:'11px 0', fontSize:11, letterSpacing:1, background: aba===a.key ? 'var(--accent)' : 'transparent', color: aba===a.key ? '#000' : 'var(--text2)', fontWeight: aba===a.key ? 700 : 400, textTransform:'uppercase', border:'none', cursor:'pointer', fontFamily:'var(--font-mono)' }}>{a.label}</button>
          ))}
        </div>

        {/* Busca geral */}
        {aba === 'catalogo' && (
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar música ou artista..." style={{ width:'100%', marginBottom:16, fontSize:14, padding:'12px 16px' }} />
        )}

        {/* Minhas playlists */}
        {aba === 'minhas' && (
          <div className="fade-in">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontSize:13, color:'var(--text2)' }}>{minhasPlaylists.length}/4 playlists</div>
              {minhasPlaylists.length < 4 && (
                <button onClick={() => navigate('/playlist/nova')} style={{ padding:'8px 16px', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', border:'none', cursor:'pointer', fontWeight:600, fontSize:13 }}>+ Nova playlist</button>
              )}
            </div>

            {minhasPlaylists.length === 0 ? (
              <div style={{ textAlign:'center', padding:48, border:'1px dashed var(--border)', borderRadius:'var(--radius-lg)', color:'var(--text2)' }}>
                <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
                <div style={{ fontSize:14, marginBottom:8 }}>Você ainda não tem playlists</div>
                <div style={{ fontSize:12, color:'var(--text3)', marginBottom:20 }}>Crie uma para organizar seu repertório</div>
                <button onClick={() => navigate('/playlist/nova')} style={{ padding:'10px 24px', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', border:'none', cursor:'pointer', fontWeight:600 }}>+ Criar playlist</button>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {minhasPlaylists.map(pl => (
                  <div key={pl.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'16px 18px', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }} onClick={() => navigate(`/playlist/${pl.id}`)}>
                    <div style={{ fontSize:24 }}>{pl.privada ? '🔒' : '🌐'}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nomeMinhaPlaylist(pl)}</div>
                      <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>
                        {pl.privada ? 'Privada' : `Compartilhada · ${pl.data_evento ? new Date(pl.data_evento+'T12:00:00').toLocaleDateString('pt-BR') : ''}`}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={e => { e.stopPropagation(); navigate(`/playlist/${pl.id}/editar`) }} style={{ padding:'6px 12px', borderRadius:'var(--radius)', background:'var(--bg3)', color:'var(--text2)', border:'1px solid var(--border)', fontSize:11, cursor:'pointer' }}>✏️</button>
                      <button onClick={e => { e.stopPropagation(); deletarPlaylist(pl.id) }} style={{ padding:'6px 12px', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', border:'1px solid var(--border)', fontSize:11, cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.color='var(--danger)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text3)'}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Playlists compartilhadas */}
        {aba === 'compartilhadas' && (
          <div className="fade-in">
            {playlistsCompartilhadas.length === 0 ? (
              <div style={{ textAlign:'center', padding:48, border:'1px dashed var(--border)', borderRadius:'var(--radius-lg)', color:'var(--text2)' }}>
                <div style={{ fontSize:32, marginBottom:12 }}>📅</div>
                <div style={{ fontSize:14 }}>Nenhuma playlist compartilhada ainda</div>
                <div style={{ fontSize:12, color:'var(--text3)', marginTop:8 }}>Playlists compartilhadas por você também aparecem aqui</div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {playlistsCompartilhadas.map(pl => (
                  <div key={pl.id} onClick={() => navigate(`/playlist/${pl.id}`)} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'16px 18px', cursor:'pointer', display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ fontSize:24 }}>📅</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nomePlaylistCompartilhada(pl)}</div>
                      <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>
                        {pl.data_evento ? new Date(pl.data_evento+'T12:00:00').toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' }) : ''}
                      </div>
                    </div>
                    <div style={{ color:'var(--text3)', fontSize:18 }}>›</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Catálogo */}
        {aba === 'catalogo' && (
          <div className="fade-in">
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {musicasFiltradas.map(m => (
                <div key={m.id} onClick={() => navigate(`/escolha/${m.id}`)} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'14px 18px', cursor:'pointer', display:'flex', alignItems:'center', gap:12, transition:'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
                >
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.titulo}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{m.artista || 'Sem artista'}</div>
                  </div>
                  {m.tom && <span style={{ fontSize:11, fontWeight:700, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'3px 8px', flexShrink:0 }}>{m.tom}</span>}
                  <div style={{ color:'var(--text3)', fontSize:18 }}>›</div>
                </div>
              ))}
              {musicasFiltradas.length === 0 && (
                <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13, padding:32 }}>Nenhuma música encontrada.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
