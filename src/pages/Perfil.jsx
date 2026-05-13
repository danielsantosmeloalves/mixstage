import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ATUACOES = [
  'Líder de adoração', 'Backing', 'Violão', 'Guitarra',
  'Baixo', 'Bateria', 'Teclado', 'Violino', 'Sax'
]

export default function Perfil({ session }) {
  const navigate = useNavigate()
  const [nomeCompleto, setNomeCompleto] = useState('')
  const [dataNascimento, setDataNascimento] = useState('')
  const [atuacao, setAtuacao] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    async function carregar() {
      const { data } = await supabase.from('perfis').select('*').eq('id', session.user.id).single()
      if (data) {
        setNomeCompleto(data.nome_completo || '')
        setDataNascimento(data.data_nascimento || '')
        setAtuacao(data.atuacao || [])
      }
      setCarregando(false)
    }
    carregar()
  }, [])

  function toggleAtuacao(item) {
    setAtuacao(prev => {
      if (prev.includes(item)) return prev.filter(a => a !== item)
      if (prev.length >= 5) return prev
      return [...prev, item]
    })
  }

  async function salvar(e) {
    e.preventDefault()
    if (!nomeCompleto.trim()) { setErro('Nome completo é obrigatório.'); return }
    setSalvando(true); setErro(''); setMsg('')
    const { error } = await supabase.from('perfis').upsert({
      id: session.user.id,
      nome_completo: nomeCompleto.trim(),
      data_nascimento: dataNascimento || null,
      atuacao,
    }, { onConflict: 'id' })
    if (error) { setErro('Erro ao salvar: ' + error.message) }
    else { setMsg('Perfil salvo!'); setTimeout(() => navigate('/'), 1000) }
    setSalvando(false)
  }

  if (carregando) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)' }}>Carregando...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ borderBottom:'1px solid var(--border)', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, background:'var(--bg)', zIndex:10 }}>
        <button onClick={() => navigate('/')} style={{ background:'none', color:'var(--text2)', fontSize:20, border:'none', cursor:'pointer' }}>←</button>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16 }}>Meu Perfil</div>
      </div>

      <div style={{ maxWidth:500, margin:'0 auto', padding:'32px 16px' }}>
        <form onSubmit={salvar} className="fade-in" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:28, display:'flex', flexDirection:'column', gap:20 }}>

          <div style={{ textAlign:'center', marginBottom:8 }}>
            <div style={{ fontSize:40, marginBottom:8 }}>👤</div>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:18 }}>Seu perfil</div>
            <div style={{ fontSize:13, color:'var(--text2)', marginTop:4 }}>{session.user.email}</div>
          </div>

          <div>
            <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:8 }}>Nome completo *</label>
            <input value={nomeCompleto} onChange={e => setNomeCompleto(e.target.value)} placeholder="Seu nome completo" required style={{ width:'100%' }} />
          </div>

          <div>
            <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:8 }}>Data de nascimento</label>
            <input type="date" value={dataNascimento} onChange={e => setDataNascimento(e.target.value)} style={{ width:'100%' }} />
          </div>

          <div>
            <label style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', display:'block', marginBottom:4 }}>Atuação <span style={{ color:'var(--text3)', fontWeight:400, textTransform:'none', letterSpacing:0 }}>(até 5 opções)</span></label>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>{atuacao.length}/5 selecionadas</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {ATUACOES.map(item => {
                const sel = atuacao.includes(item)
                const disabled = !sel && atuacao.length >= 5
                return (
                  <button key={item} type="button" onClick={() => toggleAtuacao(item)} disabled={disabled} style={{
                    padding:'7px 14px', borderRadius:'var(--radius)', fontSize:12,
                    background: sel ? 'var(--accent)' : 'var(--bg3)',
                    color: sel ? '#000' : disabled ? 'var(--text3)' : 'var(--text2)',
                    border: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontWeight: sel ? 600 : 400,
                    opacity: disabled ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}>{item}</button>
                )
              })}
            </div>
          </div>

          {erro && <div style={{ padding:'10px 14px', borderRadius:'var(--radius)', fontSize:13, background:'rgba(255,68,68,0.1)', color:'var(--danger)' }}>{erro}</div>}
          {msg && <div style={{ padding:'10px 14px', borderRadius:'var(--radius)', fontSize:13, background:'rgba(60,255,143,0.1)', color:'var(--success)' }}>{msg}</div>}

          <button type="submit" disabled={salvando} style={{ padding:'14px 0', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, letterSpacing:2, border:'none', cursor:'pointer', opacity: salvando ? 0.7 : 1 }}>
            {salvando ? 'SALVANDO...' : 'SALVAR PERFIL'}
          </button>

          <button type="button" onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} style={{ padding:'10px 0', borderRadius:'var(--radius)', background:'none', color:'var(--text3)', fontSize:12, border:'1px solid var(--border)', cursor:'pointer' }}>
            Sair da conta
          </button>
        </form>
      </div>
    </div>
  )
}
