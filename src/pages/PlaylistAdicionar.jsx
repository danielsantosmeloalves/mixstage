import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

export default function PlaylistAdicionar({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  const [musicas, setMusicas] = useState([])
  const [musicasNaPlaylist, setMusicasNaPlaylist] = useState([])
  const [tonsEscolhidos, setTonsEscolhidos] = useState({})
  const [tfs, setTfs] = useState({})
  const [adicionando, setAdicionando] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    async function carregar() {
      const [musicasRes, plMusicasRes, tfsRes] = await Promise.all([
        supabase.from('musicas').select('*').order('titulo'),
        supabase.from('playlist_musicas').select('musica_id').eq('playlist_id', id),
        session?.user?.id ? supabase.from('tons_favoritos').select('musica_id, tom').eq('user_id', session.user.id) : Promise.resolve({ data: [] }),
      ])
      setMusicas(musicasRes.data || [])
      setMusicasNaPlaylist((plMusicasRes.data || []).map(m => m.musica_id))
      const tfsMap = {}
      if (tfsRes.data) tfsRes.data.forEach(t => { tfsMap[t.musica_id] = t.tom })
      setTfs(tfsMap)
      // Inicializa tons com TF ou 0
      const tons = {}
      if (musicasRes.data) musicasRes.data.forEach(m => { tons[m.id] = tfsMap[m.id] || 0 })
      setTonsEscolhidos(tons)
      setCarregando(false)
    }
    carregar()
  }, [id])

  async function adicionar(musica) {
    if (musicasNaPlaylist.length >= 20) return
    setAdicionando(musica.id)
    await supabase.from('playlist_musicas').insert({
      playlist_id: id,
      musica_id: musica.id,
      tom: tonsEscolhidos[musica.id] || 0,
      ordem: musicasNaPlaylist.length,
    })
    setMusicasNaPlaylist(prev => [...prev, musica.id])
    setAdicionando(null)
  }

  const musicasFiltradas = musicas.filter(m =>
    m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
    (m.artista || '').toLowerCase().includes(busca.toLowerCase())
  )

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => navigate(`/playlist/${id}`)} style={{ background:'none', color:'var(--text2)', fontSize:20, border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16 }}>Adicionar músicas</div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>{musicasNaPlaylist.length}/20 músicas</div>
        </div>
        <button onClick={() => navigate(`/playlist/${id}`)} style={{ padding:'8px 16px', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', border:'none', cursor:'pointer', fontWeight:600, fontSize:13 }}>Concluir</button>
      </div>

      <div style={{ maxWidth:600, margin:'0 auto', padding:'24px 16px' }}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar música ou artista..." style={{ width:'100%', marginBottom:16, fontSize:14, padding:'12px 16px' }} />

        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {musicasFiltradas.map(m => {
            const naPlaylist = musicasNaPlaylist.includes(m.id)
            const tomAtual = tonsEscolhidos[m.id] || 0
            const tomDisplay = m.tom ? calcularTom(m.tom.split('/')[0], tomAtual) : (tomAtual !== 0 ? `${tomAtual > 0 ? '+' : ''}${tomAtual} st` : 'Original')

            return (
              <div key={m.id} style={{ background:'var(--bg2)', border:`1px solid ${naPlaylist ? 'rgba(60,255,143,0.3)' : 'var(--border)'}`, borderRadius:'var(--radius-lg)', padding:'14px 16px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:14 }}>{m.titulo}</div>
                    <div style={{ fontSize:12, color:'var(--text2)' }}>{m.artista || 'Sem artista'}{m.tom ? ` · ${m.tom}` : ''}</div>
                  </div>

                  {/* Tom */}
                  {!naPlaylist && (
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <button onClick={() => setTonsEscolhidos(prev => ({ ...prev, [m.id]: Math.max(-6, (prev[m.id]||0) - 1) }))} style={{ width:24, height:24, borderRadius:4, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                      <span style={{ fontSize:11, fontWeight:700, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'2px 8px', minWidth:36, textAlign:'center' }}>{tomDisplay}</span>
                      <button onClick={() => setTonsEscolhidos(prev => ({ ...prev, [m.id]: Math.min(6, (prev[m.id]||0) + 1) }))} style={{ width:24, height:24, borderRadius:4, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                    </div>
                  )}

                  {naPlaylist ? (
                    <span style={{ fontSize:11, color:'var(--success)', background:'rgba(60,255,143,0.1)', border:'1px solid rgba(60,255,143,0.3)', borderRadius:4, padding:'4px 10px', flexShrink:0 }}>✓ adicionada</span>
                  ) : (
                    <button onClick={() => adicionar(m)} disabled={adicionando === m.id || musicasNaPlaylist.length >= 20} style={{ padding:'7px 14px', borderRadius:'var(--radius)', background: musicasNaPlaylist.length >= 20 ? 'var(--bg3)' : 'var(--accent)', color: musicasNaPlaylist.length >= 20 ? 'var(--text3)' : '#000', border:'none', cursor: musicasNaPlaylist.length >= 20 ? 'not-allowed' : 'pointer', fontSize:12, fontWeight:600, flexShrink:0 }}>
                      {adicionando === m.id ? '...' : '+ Add'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {musicasFiltradas.length === 0 && (
            <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13, padding:32 }}>Nenhuma música encontrada.</div>
          )}
        </div>
      </div>
    </div>
  )
}
