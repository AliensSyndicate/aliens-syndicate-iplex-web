import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { classNames } from '../../utils/classNames'

/**
 * Ícone Hugeicons Stroke Rounded (@hugeicons/core-free-icons, MIT): a única
 * biblioteca de ícones. Nunca usar dentro de botões textuais.
 */
export function IplexIcon({ icon, label, className }: { icon: IconSvgElement; label?: string; className?: string }) {
  return (
    <HugeiconsIcon
      icon={icon}
      className={classNames('iplex-icon', className)}
      strokeWidth={1.5}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
