// Escala cromática com sustenido e bemol
export const NOTAS = [
  'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F',
  'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
]

// Todas as formas de escrever cada nota, mapeadas ao índice
export const NOTA_INDEX = {
  'C': 0, 'B#': 0,
  'C#': 1, 'Db': 1,
  'D': 2,
  'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'E#': 5,
  'F#': 6, 'Gb': 6,
  'G': 7,
  'G#': 8, 'Ab': 8,
  'A': 9,
  'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
}

// Dado um tom base e quantos semitons, retorna o tom resultante
export function calcularTom(tomBase, semitons) {
  if (!tomBase) return null
  const idx = NOTA_INDEX[tomBase]
  if (idx === undefined) return null
  const novo = ((idx + semitons) % 12 + 12) % 12
  return NOTAS[novo]
}

// Lista de tons para o select do admin
export const TONS_SELECT = [
  'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F',
  'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
]

// Normaliza tom digitado para o índice (aceita C#, Db, etc)
export function normalizarTom(tom) {
  if (!tom) return null
  const clean = tom.trim()
  // Testa entrada direta
  if (NOTA_INDEX[clean] !== undefined) return NOTAS[NOTA_INDEX[clean]]
  // Tenta capitalizar primeira letra
  const cap = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase().replace('b', 'b').replace('#', '#')
  if (NOTA_INDEX[cap] !== undefined) return NOTAS[NOTA_INDEX[cap]]
  return null
}
