import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { classNames } from '../../utils/classNames'
import { navAttrs, type NavProps } from '../../navigation/navAttrs'

export type IplexButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> &
  NavProps & {
    variant?: 'primary' | 'secondary'
    /** Somente texto: botões textuais nunca têm ícones (decisão aprovada). */
    children: string
  }

export const IplexButton = forwardRef<HTMLButtonElement, IplexButtonProps>(function IplexButton(
  { variant = 'primary', className, children, navId, navGroup, autoFocus, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classNames('iplex-button', variant === 'primary' ? 'iplex-button-primary' : 'iplex-button-secondary', className)}
      {...navAttrs({ navId, navGroup, autoFocus })}
      {...rest}
    >
      {children}
    </button>
  )
})
