/**
 * A row of toggle buttons that picks what the editor below shows (Sounds' events, Enemy's
 * shapes). Each tab's accessible name carries its current value; a pending edit adds a dot.
 * `prefix` keeps each page's own class names (`au-tabs`, `em-tabs`).
 */
export function TabRow<K extends string>({ prefix, label, tabs, selected, locked, onSelect }: {
  prefix: 'au' | 'em'
  label: string
  tabs: { key: K; text: string; accessibleName: string; pending: boolean }[]
  selected: K | null
  locked: boolean
  onSelect(key: K): void
}) {
  return <div className={`${prefix}-tabs`} role="group" aria-label={label}>{tabs.map(tab =>
    <button type="button" className={`${prefix}-tab`} key={tab.key} aria-pressed={tab.key === selected} disabled={locked}
      aria-label={tab.accessibleName} onClick={() => onSelect(tab.key)}>
      {tab.text}{tab.pending ? <span className={`${prefix}-tab-dot`} aria-hidden="true" /> : null}
    </button>)}</div>
}
