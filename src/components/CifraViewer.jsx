import React, { useState } from 'react'

export default function CifraViewer({ cifras, tomAtual, tomOriginal }) {
  const [aberta, setAberta] = useState(false)

  // Encontra a cifra mais próxima do tom atual
  function encontrarCifra() {
    if (!cifras || Object.keys(cifras).length === 0) return null
    if (tomAtual && cifras[tomAtual]) return { tom: tomAtual, ...cifras[tomAtual] }
    if (tomOriginal && cifras[tomOriginal]) return { tom: tomOriginal, ...cifras[tomOriginal] }
    const primeiraTom = Object.keys(cifras)[0]
    return { tom: primeiraTom, ...cifras[primeiraTom] }
  }

  const cifra = encontrarCifra()
  if (!cifra) return null

  return (
    <div style={{ marginTop:12 }}>
      <button onClick={() => setAberta(a => !a)} style={{
        width:'100%', padding:'10px 16px', borderRadius:'var(--radius)',
        background:'var(--bg3)', border:'1px solid var(--border)',
        color:'var(--text2)', fontSize:12, cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        fontFamily:'var(--font-mono)', letterSpacing:1,
      }}>
        <span>🎸 CIFRA {cifra.tom ? `— ${cifra.tom}` : ''}</span>
        <span style={{ fontSize:16 }}>{aberta ? '▲' : '▼'}</span>
      </button>

      {aberta && (
        <div style={{
          marginTop:4, background:'var(--bg3)', border:'1px solid var(--border)',
          borderRadius:'var(--radius)', padding:16,
          maxHeight:400, overflowY:'auto',
        }}>
          <pre style={{
            fontFamily:'var(--font-mono)', fontSize:13, color:'var(--text)',
            whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.8,
            margin:0,
          }}>{cifra.conteudo}</pre>
        </div>
      )}
    </div>
  )
}
