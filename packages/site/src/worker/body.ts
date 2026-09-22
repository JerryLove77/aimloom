/** Reads at most `max` bytes from a Request/Response body and says whether more was cut off.
 * Never buffers past `max + 1` bytes, so a lying or absent `content-length` cannot OOM the isolate. */
export async function readCapped(source: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = source.body?.getReader()
  if (reader === undefined) return { bytes: new Uint8Array(0), truncated: false }
  const buf = new Uint8Array(max + 1); let total = 0
  try {
    while (total <= max) {
      const { done, value } = await reader.read()
      if (done) break
      const part = value.subarray(0, max + 1 - total)
      buf.set(part, total); total += part.byteLength
    }
  } finally {
    // The failing path is the one that needs this: a rejected read must not leave the stream open.
    await reader.cancel().catch(() => undefined)
  }
  return { bytes: buf.subarray(0, Math.min(total, max)), truncated: total > max }
}

/** `readCapped`, decoded — silently caps at `max` bytes (used for third-party answers we don't need to reject on size). */
export async function readCappedText(source: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<string> {
  const { bytes } = await readCapped(source, max)
  return new TextDecoder().decode(bytes)
}
