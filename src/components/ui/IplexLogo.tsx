import { classNames } from '../../utils/classNames'

/** Logo textual oficial: "iPlex", Google Sans Bold, #FFFFFF sólido, sem efeitos. */
export function IplexLogo({ size = 'header', className }: { size?: 'header' | 'screen' | 'small'; className?: string }) {
  return (
    <span className={classNames('iplex-logo-text', `iplex-logo-text--${size}`, className)} role="img" aria-label="iPlex">
      <span aria-hidden="true">iPlex</span>
    </span>
  )
}
