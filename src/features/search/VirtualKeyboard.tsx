const ROWS = ['abcdefg', 'hijklmn', 'opqrstu', 'vwxyz12', '3456789', '0']

/** Teclado na tela para controle remoto (o IME da TV não é garantido dentro do iframe). */
export function VirtualKeyboard({ onKey, onDelete, onSpace, onClear }: { onKey: (k: string) => void; onDelete: () => void; onSpace: () => void; onClear: () => void }) {
  const key = (label: string, action: () => void, id: string, wide = false, aria?: string) => (
    <button
      key={id}
      type="button"
      className={wide ? 'iplex-key iplex-key--wide iplex-focusable' : 'iplex-key iplex-focusable'}
      onClick={action}
      aria-label={aria ?? label}
      data-nav=""
      data-nav-id={`key-${id}`}
      data-nav-group="keyboard"
      {...(id === 'a' ? { 'data-nav-autofocus': '' } : {})}
    >
      {label}
    </button>
  )
  return (
    <div className="iplex-keyboard" role="group" aria-label="Teclado" data-nav-group-root="keyboard">
      {ROWS.map((row, r) => (
        <div className="iplex-keyboard__row" key={r}>
          {row.split('').map((ch) => key(ch.toUpperCase(), () => onKey(ch), ch))}
          {r === ROWS.length - 1 && (
            <>
              {key('Espaço', onSpace, 'space', true)}
              {key('Apagar', onDelete, 'delete', true)}
              {key('Limpar', onClear, 'clear', true)}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
