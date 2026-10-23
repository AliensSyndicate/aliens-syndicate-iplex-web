/** Formatação dos metadados de detalhes/pessoa (sem Intl obrigatório: Chromium M56). */
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** AAAA-MM-DD → "31 de março de 1999"; inválida → null. */
export function formatDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${Number(m[3])} de ${MONTHS[month - 1]} de ${m[1]}`
}
