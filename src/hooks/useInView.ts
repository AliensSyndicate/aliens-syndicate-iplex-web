import { useEffect, useState, type RefObject } from 'react'

/** Visível (com margem)? Usado para só pedir imagens/metadados do que aparece. */
export function useInView(ref: RefObject<Element | null>, rootMargin = '300px'): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || inView || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin, inView])
  return inView
}
