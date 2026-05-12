import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Catalogo({ session, isAdmin }) {
  const [musicas, setMusicas] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    async function carregar() {
      const { data } = await supabase.from('musicas').select('*').order('criado_em', { ascending: false })
      setMusicas(data || [])
      setLoading(false)
    }
    carregar()
  }, [])

  async function sair() {
    await supabase.auth.signOut()
  }

  const filtradas = musicas.filter(m =>
    m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
    (m.artista || '').toLowerCase().includes(busca.toLowerCase())
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        padding: '16px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, letterSpacing: 4, color: 'var(--accent)' }}>MIXSTAGE</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {isAdmin && (
            <button onClick={() => navigate('/admin')} style={{
              padding: '8px 16px', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: 2,
            }}>ADMIN</button>
          )}
          <button onClick={sair} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)',
            background: 'var(--bg3)', color: 'var(--text2)',
            fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 1,
            border: '1px solid var(--border)',
          }}>Sair</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
        <div className="fade-in">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 800, marginBottom: 8 }}>Catálogo</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 32 }}>Escolha uma música para mixar</p>

          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por título ou artista..."
            style={{ marginBottom: 32, maxWidth: 400 }}
          />

          {loading ? (
            <div style={{ color: 'var(--text2)', textAlign: 'center', padding: 60 }}>Carregando...</div>
          ) : filtradas.length === 0 ? (
            <div style={{ color: 'var(--text2)', textAlign: 'center', padding: 60 }}>
              {busca ? 'Nenhuma música encontrada.' : 'Nenhuma música cadastrada ainda.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {filtradas.map((m, i) => (
                <button key={m.id} onClick={() => navigate(`/escolha/${m.id}`)}
                  className="fade-in"
                  style={{
                    animationDelay: `${i * 0.05}s`,
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '24px 20px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--accent)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 8,
                    background: `hsl(${(i * 67) % 360}, 60%, 50%)`,
                    marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18,
                  }}>🎵</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 4, color: 'var(--text)' }}>{m.titulo}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{m.artista || 'Sem artista'}</div>
                  <div style={{
                    marginTop: 16, fontSize: 11, letterSpacing: 2, color: 'var(--accent)',
                    fontWeight: 600, textTransform: 'uppercase',
                  }}>Abrir mixer →</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
