// The feedback panel's behaviour (components/TicketPanel.astro). Nothing is fetched until the
// panel opens: then the Worker says whether tickets are open (a Turnstile key), and only then is
// Cloudflare's widget script loaded.
interface Turnstile { render(el: HTMLElement, options: Record<string, unknown>): string; reset(id?: string): void; getResponse(id?: string): string | undefined }
declare global { interface Window { turnstile?: Turnstile } }

const dialog = document.getElementById('ticket') as HTMLDialogElement | null
if (dialog) setUp(dialog)

function setUp(dialog: HTMLDialogElement): void {
  const lang = dialog.dataset.lang === 'en' ? 'en' : 'zh'
  const messages = JSON.parse(dialog.dataset.messages ?? '{}') as Record<string, string>
  const form = document.getElementById('ticket-form') as HTMLFormElement
  const human = document.getElementById('ticket-human') as HTMLElement
  const status = document.getElementById('ticket-status') as HTMLElement
  const submit = document.getElementById('ticket-submit') as HTMLButtonElement
  const done = document.getElementById('ticket-done') as HTMLElement
  const doneText = document.getElementById('ticket-done-text') as HTMLElement
  let opener: HTMLElement | null = null
  let widget: string | null = null
  let ready: Promise<boolean> | null = null
  let closed = false
  const say = (key: string) => { status.textContent = messages[key] ?? '' }
  // An error about the form goes as soon as the player edits it; "closed" stays.
  form.addEventListener('input', () => { if (!closed) status.textContent = '' })

  const open = (from: HTMLElement) => {
    opener = from
    dialog.showModal()
    ready ??= prepare()
  }
  document.querySelectorAll<HTMLElement>('[data-ticket-open]').forEach(el => el.addEventListener('click', event => { event.preventDefault(); open(el) }))
  dialog.querySelector('[data-ticket-close]')?.addEventListener('click', () => dialog.close())
  // A click on the backdrop (outside the panel's box) closes it too.
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect()
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close()
  })
  dialog.addEventListener('close', () => opener?.focus())

  /** True once the widget is on screen; false (and the form closed) when the site has no key. */
  async function prepare(): Promise<boolean> {
    let siteKey: string | null = null
    try { siteKey = ((await (await fetch('/api/tickets/key')).json()) as { siteKey: string | null }).siteKey } catch { siteKey = null }
    if (!siteKey) { closeForm(); return false }
    try {
      await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
      human.replaceChildren()
      widget = window.turnstile!.render(human, { sitekey: siteKey, language: lang === 'zh' ? 'zh-cn' : 'en' })
      return true
    } catch { closeForm(); return false }
  }
  function closeForm(): void {
    closed = true
    human.replaceChildren()
    say('ticket.closed')
    submit.disabled = true
  }
  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.async = true
      s.onload = () => resolve(); s.onerror = () => reject(new Error('turnstile'))
      document.head.append(s)
    })
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!(await ready)) return
    const data = new FormData(form)
    const description = String(data.get('description') ?? '')
    const contact = String(data.get('contact') ?? '').trim()
    if (!description.trim()) { say('ticket.error.description'); form.querySelector('textarea')?.focus(); return }
    const token = window.turnstile?.getResponse(widget ?? undefined) ?? ''
    if (!token) { say('ticket.error.human'); return }
    // Only the path, and only in the shape the Worker accepts: a query or an odd path is left out.
    const page = /^\/(zh|en)(\/[a-z0-9/-]*)?$/.test(location.pathname) && location.pathname.length <= 100 ? location.pathname : `/${lang}/`
    submit.disabled = true; submit.textContent = messages['ticket.sending'] ?? ''; status.textContent = ''
    try {
      const r = await fetch('/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: String(data.get('kind') ?? 'problem'), description, contact: contact || null, lang, page, token }) })
      const body = (await r.json().catch(() => ({}))) as { number?: string; code?: string }
      if (r.ok && body.number) {
        form.reset(); form.hidden = true; done.hidden = false
        doneText.textContent = (messages['ticket.done'] ?? '').replace('{number}', body.number)
        ;(document.getElementById('ticket-again') as HTMLButtonElement).focus()
      } else {
        say(({ HUMAN_CHECK_FAILED: 'ticket.error.humanFailed', RATE_LIMITED: 'ticket.error.rate', DAILY_LIMIT: 'ticket.error.daily', TICKETS_CLOSED: 'ticket.closed' } as Record<string, string>)[body.code ?? ''] ?? 'ticket.error.generic')
      }
    } catch { say('ticket.error.generic') }
    finally {
      submit.disabled = false; submit.textContent = messages['ticket.submit'] ?? ''
      // A token is good for one check only.
      if (widget !== null) window.turnstile?.reset(widget)
    }
  })
  document.getElementById('ticket-again')?.addEventListener('click', () => {
    done.hidden = true; form.hidden = false; status.textContent = ''
    form.querySelector('textarea')?.focus()
  })
}
export {}
