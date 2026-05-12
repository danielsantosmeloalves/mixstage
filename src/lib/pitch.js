export const NOTAS = [
  'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F',
  'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
]

export const NOTA_INDEX = {
  'C': 0, 'B#': 0,
  'C#': 1, 'Db': 1, 'C#/Db': 1,
  'D': 2,
  'D#': 3, 'Eb': 3, 'D#/Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'E#': 5,
  'F#': 6, 'Gb': 6, 'F#/Gb': 6,
  'G': 7,
  'G#': 8, 'Ab': 8, 'G#/Ab': 8,
  'A': 9,
  'A#': 10, 'Bb': 10, 'A#/Bb': 10,
  'B': 11, 'Cb': 11,
}

export function calcularTom(tomBase, semitons) {
  if (!tomBase) return null
  const idx = NOTA_INDEX[tomBase]
  if (idx === undefined) return null
  const novo = ((idx + semitons) % 12 + 12) % 12
  return NOTAS[novo]
}

export const TONS_SELECT = [
  'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F',
  'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
]

// Aceita qualquer forma válida: C#, Db, C#/Db, etc
export function normalizarTom(tom) {
  if (!tom) return null
  const clean = tom.trim()
  if (NOTA_INDEX[clean] !== undefined) return NOTAS[NOTA_INDEX[clean]]
  const partes = clean.split('/')
  for (const parte of partes) {
    const p = parte.trim()
    if (NOTA_INDEX[p] !== undefined) return NOTAS[NOTA_INDEX[p]]
    const cap = p.charAt(0).toUpperCase() + p.slice(1)
    if (NOTA_INDEX[cap] !== undefined) return NOTAS[NOTA_INDEX[cap]]
  }
  return null
}
