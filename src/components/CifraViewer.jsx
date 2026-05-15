import React, { useState } from 'react'

export default function CifraViewer({ cifras, tomAtual, tomOriginal }) {
  const [aberta, setAberta] = useState(false)

  function encontrarCifra() {
    if (!cifras || Object.keys(cifras).length === 0) return null
    if (tomAtual && cifras[tomAtual]) return { tom: tomAtual, ...cifras[tomAtual] }
    if (tomOriginal && cifras[tomOriginal]) return { tom: tomOriginal, ...cifras[tomOriginal] }
    const primeiraTom = Object.keys(cifras)[0]
    return { tom: primeiraTom, ...cifras[primeiraTom] }
  }

  const cifra = encontrarCifra()
  if (!cifra) return null

  const temTexto = !!cifra.conteudo
  const temPdf = !!cifra.pdf_url

  return (
    <div style={{ marginTop:12 }}>
      <button onClick={() => setAberta(a => !a)} style={{
        width:'100%', padding:'10px 16px', borderRadius:'var(--radius)',
        background:'var(--bg3)', border:'1px solid var(--border)',
        color:'var(--text2)', fontSize:12, cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        fontFamily:'var(--font-mono)', letterSpacing:1,
      }}>
        <span style={{ display:'flex', alignItems:'center', gap:8 }}>
          🎸 CIFRA {cifra.tom ? `— ${cifra.tom}` : ''}
          {temTexto && <span style={{ fontSize:10, background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 5px', color:'var(--text3)' }}>📝</span>}
          {temPdf && <span style={{ fontSize:10, background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 5px', color:'var(--text3)' }}>📄</span>}
        </span>
        <span style={{ fontSize:16 }}>{aberta ? '▲' : '▼'}</span>
      </button>

      {aberta && (
        <div style={{ marginTop:4, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:16, display:'flex', flexDirection:'column', gap:10 }}>

          {/* Texto */}
          {temTexto && (
            <div style={{ maxHeight:400, overflowY:'auto' }}>
              <pre style={{ fontFamily:'var(--font-mono)', fontSize:13, color:'var(--text)', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.8, margin:0 }}>{cifra.conteudo}</pre>
            </div>
          )}

          {/* Download PDF */}
          {temPdf && (
            <a
              href={cifra.pdf_url}
              download
              target="_blank"
              rel="noreferrer"
              style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                padding:'10px 16px', borderRadius:'var(--radius)',
                background:'var(--accent)', color:'#000',
                fontSize:13, fontWeight:700, textDecoration:'none',
                fontFamily:'var(--font-display)', letterSpacing:1,
              }}
            >
              📄 Baixar cifra em PDF
            </a>
          )}
        </div>
      )}
    </div>
  )
}
