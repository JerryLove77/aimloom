import { Button } from '../installer/components/Button'

/**
 * The local, immediate substring search box shared by Theme, Sounds and Crosshair: a
 * visually-hidden label, a native `type="search"` input and a × clear button that appears once
 * there is text. Filtering itself stays with the caller -- this component only owns the box.
 */
export function SearchBox({ id, label, placeholder, clearLabel, value, onChange }: {
  id: string
  label: string
  placeholder: string
  clearLabel: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="pr-search">
      <label className="pr-sr-only" htmlFor={id}>{label}</label>
      <input id={id} type="search" placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />
      {value ? <Button variant="ghost" aria-label={clearLabel} onClick={() => onChange('')}>×</Button> : null}
    </div>
  )
}
