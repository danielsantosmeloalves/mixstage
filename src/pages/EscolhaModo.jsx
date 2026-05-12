import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcularTom } from '../lib/pitch'

export default function EscolhaModo({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [musica, setMusica] = useState(null)
  const [temMultitrack, setTemMultitrack] = useState(false)
  const [temKit, setTemKit] = useState(false)
  const [tfSalvo, setTfSalvo] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    async function carregar() {
      const { data: m } = await supabase.from('musicas').select('*').eq('id', id).single()
      const { data: t } = await supabase.from('trilhas').select('id').eq('musica_id', id).limit(1)
      const { data: k } = await supabase.from('kit_ensaio').select('id').eq('musica_id', id).limit(1)

      if (session?.user?.id) {
        const { data: tf } = await supabase.from('tons_favoritos').select('tom')
          .eq('user_id', session.user.id).eq('musica_id', id).single()
        if (tf) setTfSalvo(tf.tom)
      }

      setMusica(m)
      setTemMultitrack((t || []).length > 0)
      setTemKit((k || []).length > 0)
      setCarregando(false)
    }
    carregar()
  }, [id])

  const tomOriginal = musica?.tom || null
  const tfDisplay = tomOriginal && tfSalvo !== null ? calcularTom(tomOriginal.split('/')[0], tfSalvo) : null

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => navigate('/catalogo')} style={{ background:'none', color:'var(--text2)', fontSize:20, padding:'0 8px 0 0', border:'none', cursor:'pointer' }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{musica?.titulo}</div>
            {tomOriginal && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(232,255,60,0.12)', color:'var(--accent)', border:'1px solid rgba(232,255,60,0.25)', borderRadius:4, padding:'2px 7px' }}>{tomOriginal}</span>}
            {tfDisplay && <span style={{ fontSize:11, fontWeight:700, flexShrink:0, background:'rgba(60,255,143,0.12)', color:'var(--success)', border:'1px solid rgba(60,255,143,0.25)', borderRadius:4, padding:'2px 7px' }}>TF: {tfDisplay}</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)' }}>{musica?.artista || 'Sem artista'}</div>
        </div>
      </div>

      <div style={{ maxWidth:500, margin:'0 auto', padding:'48px 24px' }}>
        <div className="fade-in" style={{ textAlign:'center', marginBottom:40 }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, marginBottom:8 }}>Como quer ensaiar?</div>
          <div style={{ fontSize:13, color:'var(--text2)' }}>Escolha o modo de reprodução</div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Multitrack */}
          <button
            onClick={() => navigate(`/mixer/${id}`)}
            disabled={!temMultitrack}
            className="fade-in"
            style={{
              animationDelay: '0.05s',
              background: temMultitrack ? 'var(--bg2)' : 'var(--bg3)',
              border:`1px solid ${temMultitrack ? 'var(--border)' : 'var(--border)'}`,
              borderRadius:'var(--radius-lg)', padding:'28px 24px',
              textAlign:'left', cursor: temMultitrack ? 'pointer' : 'not-allowed',
              opacity: temMultitrack ? 1 : 0.5, transition:'all 0.2s',
            }}
            onMouseEnter={e => { if (temMultitrack) e.currentTarget.style.borderColor='var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)' }}
          >
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ fontSize:36, flexShrink:0 }}>🎛️</div>
              <div>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:18, color:'var(--text)', marginBottom:4 }}>Multitrack</div>
                <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.5 }}>
                  Controle individual de cada trilha — volume, mute e solo por instrumento.
                </div>
                {!temMultitrack && <div style={{ fontSize:11, color:'var(--danger)', marginTop:6 }}>Nenhuma trilha cadastrada</div>}
              </div>
            </div>
          </button>

          {/* Kit Ensaio */}
          <button
            onClick={() => navigate(`/kit/${id}`)}
            disabled={!temKit}
            className="fade-in"
            style={{
              animationDelay: '0.1s',
              background: temKit ? 'var(--bg2)' : 'var(--bg3)',
              border:`1px solid ${temKit ? 'var(--border)' : 'var(--border)'}`,
              borderRadius:'var(--radius-lg)', padding:'28px 24px',
              textAlign:'left', cursor: temKit ? 'pointer' : 'not-allowed',
              opacity: temKit ? 1 : 0.5, transition:'all 0.2s',
            }}
            onMouseEnter={e => { if (temKit) e.currentTarget.style.borderColor='var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)' }}
          >
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ fontSize:36, flexShrink:0 }}>🎼</div>
              <div>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:18, color:'var(--text)', marginBottom:4 }}>Kit Ensaio</div>
                <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.5 }}>
                  Uma trilha por vez — Geral, Guitarras, Soprano, Teclados, Tenor, Baixo, Bateria ou Contralto.
                </div>
                {!temKit && <div style={{ fontSize:11, color:'var(--danger)', marginTop:6 }}>Nenhum kit cadastrado</div>}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
