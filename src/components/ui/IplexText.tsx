import type { ElementType, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'

export type TextVariant = 'page-title' | 'hero-title' | 'section-title' | 'content-title' | 'meta' | 'description' | 'caption'

const DEFAULT_TAG: Record<TextVariant, ElementType> = {
  'page-title': 'h1',
  'hero-title': 'h1',
  'section-title': 'h2',
  'content-title': 'h3',
  meta: 'p',
  description: 'p',
  caption: 'p',
}

export function IplexText({
  variant,
  as,
  clamp,
  secondary,
  className,
  children,
  id,
}: {
  variant: TextVariant
  as?: ElementType
  clamp?: 2 | 3
  secondary?: boolean
  className?: string
  children: ReactNode
  id?: string
}) {
  const Tag = as ?? DEFAULT_TAG[variant]
  return (
    <Tag
      id={id}
      className={classNames('iplex-text', `iplex-text--${variant}`, clamp && `iplex-text--clamp-${clamp}`, secondary && 'iplex-text--secondary', className)}
    >
      {children}
    </Tag>
  )
}
