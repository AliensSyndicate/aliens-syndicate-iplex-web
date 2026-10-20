import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'

/** Aba do menu principal (texto, ou somente ícone com nome acessível). */
export function NavigationTab({
  id,
  active,
  onSelect,
  children,
  label,
  iconOnly,
}: {
  id: string
  active: boolean
  onSelect: () => void
  children: ReactNode
  label?: string
  iconOnly?: boolean
}) {
  return (
    <button
      type="button"
      className={classNames('iplex-tab', 'iplex-focusable', active && 'is-active', iconOnly && 'iplex-tab--icon')}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      data-nav=""
      data-nav-id={`tab-${id}`}
      data-nav-group="header"
      {...(active ? { 'data-nav-preferred': '' } : {})}
    >
      {children}
    </button>
  )
}
