import { useEffect, useRef, type ReactNode } from 'react'
import { useBackHandler } from '../../navigation/FocusProvider'
import { focusElement, initialTarget } from '../../navigation/spatial'
import { IplexText } from '../ui/IplexText'

/** Diálogo modal: foco preso (data-nav-scope), Back fecha, foco devolvido ao sair. */
export function Dialog({ title, description, onClose, children, labelledBy }: { title: string; description?: string; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useBackHandler(() => {
    onClose()
    return true
  })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const id = setTimeout(() => {
      const target = ref.current ? initialTarget(ref.current) : null
      if (target) focusElement(target)
    }, 0)
    return () => {
      clearTimeout(id)
      if (previous && document.body.contains(previous)) focusElement(previous)
    }
  }, [])
  const headingId = labelledBy ?? `dialog-${title.replace(/\W+/g, '-')}`
  return (
    <div className="iplex-dialog" role="presentation">
      <div ref={ref} className="iplex-dialog__panel" role="dialog" aria-modal="true" aria-labelledby={headingId} data-nav-scope="">
        <IplexText variant="section-title" id={headingId} className="iplex-dialog__title">
          {title}
        </IplexText>
        {description && <IplexText variant="description" className="iplex-dialog__description">{description}</IplexText>}
        {children}
      </div>
    </div>
  )
}
