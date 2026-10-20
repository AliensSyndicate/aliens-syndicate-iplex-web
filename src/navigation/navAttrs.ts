/**
 * Atributos da navegação espacial (controle remoto):
 *  data-nav            elemento navegável
 *  data-nav-id         identidade estável (memória de foco ao voltar)
 *  data-nav-group      grupo (fileira, menu) com memória do último foco
 *  data-nav-autofocus  foco inicial da tela
 */
export interface NavProps {
  navId?: string
  navGroup?: string
  autoFocus?: boolean
}

export function navAttrs({ navId, navGroup, autoFocus }: NavProps): Record<string, string> {
  const attrs: Record<string, string> = { 'data-nav': '' }
  if (navId) attrs['data-nav-id'] = navId
  if (navGroup) attrs['data-nav-group'] = navGroup
  if (autoFocus) attrs['data-nav-autofocus'] = ''
  return attrs
}
