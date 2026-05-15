import React, { useState } from 'react'

export default function CifraViewer({ cifras, tomAtual, tomOriginal }) {
  const [aberta, setAberta] = useState(false)
  const [viewPdf, setViewPdf] = useState(false)

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
        <div style={{ marginTop:4, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>

          {/* Tabs se tiver os dois */}
          {temTexto && temPdf && (
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
              <button onClick={() => setViewPdf(false)} style={{ flex:1, padding:'8px 0', fontSize:11, background: !viewPdf ? 'var(--bg2)' : 'transparent', color: !viewPdf ? 'var(--text)' : 'var(--text3)', border:'none', cursor:'pointer', letterSpacing:1, fontFamily:'var(--font-mono)' }}>📝 TEXTO</button>
              <button onClick={() => setViewPdf(true)} style={{ flex:1, padding:'8px 0', fontSize:11, background: viewPdf ? 'var(--bg2)' : 'transparent', color: viewPdf ? 'var(--text)' : 'var(--text3)', border:'none', cursor:'pointer', letterSpacing:1, fontFamily:'var(--font-mono)' }}>📄 PDF</button>
            </div>
          )}

          {/* Texto */}
          {temTexto && (!viewPdf || !temPdf) && (
            <div style={{ padding:16, maxHeight:400, overflowY:'auto' }}>
              <pre style={{ fontFamily:'var(--font-mono)', fontSize:13, color:'var(--text)', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.8, margin:0 }}>{cifra.conteudo}</pre>
            </div>
          )}

          {/* PDF */}
          {temPdf && (viewPdf || !temTexto) && (
            <div style={{ padding:12 }}>
              <div style={{ marginBottom:10, display:'flex', gap:8 }}>
                <a href={cifra.pdf_url} target="_blank" rel="noreferrer" style={{ flex:1, padding:'8px 0', borderRadius:'var(--radius)', background:'var(--accent)', color:'#000', fontSize:12, fontWeight:600, textAlign:'center', textDecoration:'none', display:'block' }}>
                  📄 Abrir PDF em nova aba
                </a>
              </div>
              <iframe
                src={cifra.pdf_url}
                style={{ width:'100%', height:500, border:'none', borderRadius:'var(--radius)', background:'var(--bg2)' }}
                title="Cifra PDF"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
