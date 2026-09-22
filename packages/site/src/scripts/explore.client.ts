/**
 * The explorer's only client script: the sort control submits on change, a card's Listen button
 * plays one sound at a time, and Copy puts a crosshair code on the clipboard. Nothing plays
 * without a click; the page works without this script (the form has a submit button).
 */
const sort = document.getElementById('ex-sort') as HTMLSelectElement | null
sort?.addEventListener('change', () => sort.form?.requestSubmit())

let playing: { audio: HTMLAudioElement; button: HTMLButtonElement } | null = null
function stop(): void {
  if (!playing) return
  playing.audio.pause()
  playing.button.textContent = `▶ ${playing.button.dataset.listen ?? ''}`
  playing = null
}
for (const button of document.querySelectorAll<HTMLButtonElement>('.ex-listen')) {
  button.addEventListener('click', () => {
    const wasThis = playing?.button === button
    stop()
    if (wasThis || !button.dataset.src) return
    const audio = new Audio(button.dataset.src)
    audio.addEventListener('ended', stop)
    playing = { audio, button }
    button.textContent = `■ ${button.dataset.stop ?? ''}`
    void audio.play().catch(stop)
  })
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.ex-copy')) {
  button.addEventListener('click', () => {
    const text = button.closest('.ex-code')?.querySelector('.ex-code__text')?.textContent ?? ''
    const label = button.textContent
    void navigator.clipboard.writeText(text).then(() => {
      button.textContent = button.dataset.copied ?? label
      setTimeout(() => { button.textContent = label }, 1500)
    }).catch(() => {})
  })
}
