import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const [modo, setModo] = useState('entrar')

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    let result
    if (modo === 'entrar') {
      result = await supabase.auth.signInWithPassword({ email, password: senha })
    } else {
      result = await supabase.auth.signUp({ email, password: senha })
      if (!result.error) {
        setErro('Conta criada! Verifique seu email para confirmar.')
        setLoading(false)
        return
      }
    }
    if (result.error) setErro(result.error.message)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: 24,
    }}>
      <div className="fade-in" style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: 6,
            color: 'var(--accent)',
            lineHeight: 1,
          }}>MIX<br/>STAGE</div>
          <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 10, letterSpacing: 3 }}>MULTITRACK PLAYER</div>
        </div>

        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 32,
        }}>
          <div style={{ display: 'flex', marginBottom: 28, gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {['entrar', 'cadastrar'].map(m => (
              <button key={m} onClick={() => setModo(m)} style={{
                flex: 1, padding: '10px 0', fontSize: 12, letterSpacing: 2,
                background: modo === m ? 'var(--accent)' : 'transparent',
                color: modo === m ? '#000' : 'var(--text2)',
                fontWeight: modo === m ? 600 : 400,
                textTransform: 'uppercase',
              }}>{m}</button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text2)', letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text2)', letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Senha</label>
              <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" required minLength={6} />
            </div>

            {erro && (
              <div style={{
                padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13,
                background: erro.includes('criada') ? 'rgba(60,255,143,0.1)' : 'rgba(255,68,68,0.1)',
                color: erro.includes('criada') ? 'var(--success)' : 'var(--danger)',
                border: `1px solid ${erro.includes('criada') ? 'rgba(60,255,143,0.2)' : 'rgba(255,68,68,0.2)'}`,
              }}>{erro}</div>
            )}

            <button type="submit" disabled={loading} style={{
              marginTop: 8, padding: '13px 0', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, letterSpacing: 3,
              textTransform: 'uppercase', opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Aguarde...' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
