import React, { useState } from 'react'

export default function TimeCodeNav({ secoes, tempoAtual, onSeek, onLoopChange }) {
  const [loopSecao, setLoopSecao] = useState(null)

  if (!secoes || secoes.length === 0) return null

  // Encontra a seção atual
  function secaoAtual() {
    for (let i = secoes.length - 1; i >= 0; i--) {
      if (tempoAtual * 1000 >= secoes[i].tempoMs) return i
    }
    return 0
  }

  function fmt(ms) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`
  }

  function toggleLoop(idx) {
    const novo = loopSecao === idx ? null : idx
    setLoopSecao(novo)
    if (onLoopChange) {
      if (novo === null) {
        onLoopChange(null)
      } else {
        const inicio = secoes[idx].tempoMs / 1000
        const fim = idx < secoes.length - 1 ? secoes[idx+1].tempoMs / 1000 : null
        onLoopChange({ inicio, fim, idx })
      }
    }
  }

  const atual = secaoAtual()

  // Agrupa seções por nome para mostrar repetições
  const grupos = {}
  secoes.forEach((s, i) => {
    if (!grupos[s.nome]) grupos[s.nome] = []
    grupos[s.nome].push({ ...s, idx: i })
  })

  return (
    <div style={{ marginTop:12 }}>
      <div style={{ fontSize:11, color:'var(--text2)', letterSpacing:2, textTransform:'uppercase', marginBottom:8 }}>Seções</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {secoes.map((s, i) => {
          const isAtual = i === atual
          const isLoop = loopSecao === i
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:0, borderRadius:'var(--radius)', overflow:'hidden', border:`1px solid ${isAtual ? 'var(--accent)' : isLoop ? 'rgba(60,255,143,0.4)' : 'var(--border)'}` }}>
              {/* Botão pular para seção */}
              <button
                onClick={() => onSeek(s.tempoMs / 1000)}
                style={{
                  padding:'5px 10px', background: isAtual ? 'rgba(232,255,60,0.15)' : 'var(--bg3)',
                  color: isAtual ? 'var(--accent)' : 'var(--text2)',
                  fontSize:11, cursor:'pointer', border:'none',
                  fontFamily:'var(--font-mono)', fontWeight: isAtual ? 700 : 400,
                }}
              >
                {s.nome} <span style={{ color:'var(--text3)', fontSize:10 }}>{fmt(s.tempoMs)}</span>
              </button>
              {/* Botão loop */}
              <button
                onClick={() => toggleLoop(i)}
                title={isLoop ? 'Desativar loop' : 'Loop nesta seção'}
                style={{
                  padding:'5px 7px', background: isLoop ? 'rgba(60,255,143,0.2)' : 'var(--bg3)',
                  color: isLoop ? 'var(--success)' : 'var(--text3)',
                  fontSize:11, cursor:'pointer', border:'none', borderLeft:'1px solid var(--border)',
                }}
              >↺</button>
            </div>
          )
        })}
      </div>
      {loopSecao !== null && (
        <div style={{ marginTop:8, fontSize:11, color:'var(--success)', display:'flex', alignItems:'center', gap:8 }}>
          <span>🔁 Loop: {secoes[loopSecao].nome}</span>
          <button onClick={() => toggleLoop(loopSecao)} style={{ background:'none', color:'var(--text3)', border:'none', cursor:'pointer', fontSize:11 }}>✕ desativar</button>
        </div>
      )}
    </div>
  )
}
