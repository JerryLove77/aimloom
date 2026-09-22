# Profile audio module

An independent, browser-compatible audio section for the simple JSON TrainingProfile. This module has no dependency on `@kvk/core`, no React or Node imports, no game writes and no automatic playback. Import from `./profiles/audio`.

## Data contract

```ts
// Editor/preview data uses paths; Profile persistence records name/path objects.
const audio = {
  kill: ['assets/kill.ogg', 'assets/kill.ogg', 'assets/alternate.wav'],
  spawn: [],
}
```

- `null`: keep the entire current audio component.
- An omitted event: keep that event's current binding.
- An empty array: explicitly select no files. This is an editor value; native empty-list behavior has not been verified.
- Profile JSON stores each file as `{name, path}` under its event. `replaceProfileAudio`
  creates these records; `profileAudioPaths` converts them back to editor paths.
- Lists retain order and duplicates. Replacement is by event or by exact list index.
- Initial editor events: `kill`, `spawn`, `mbsGood`, `mbsOkay`, `mbsBad`, `mbsChangeNow`. These correspond to candidate settings in the existing source corpus, not verified activation mappings. Shoot is excluded until weapon scope is defined; hit/crit volume/pitch and game override flags are not modeled here.
- Up to 64 local `.ogg`/`.wav` paths per event (4096 characters each) retain their original spelling, path and extension. Relative references are relative to the Profile JSON directory. Absolute POSIX, Windows and UNC paths are retained. URI schemes and control characters are rejected. File extensions do not prove decodability; the browser verifies actual media on audition.
- Parsing returns independent list copies. Invalid events, lists, file references and indices throw localized errors. A failed replacement leaves the previous valid draft and audition intact.

## Integration

```ts
import { createAudioEditor, replaceProfileAudio, profileAudioPaths } from './profiles/audio'

// `profileDraft`, `profileDirectory`, `profileStore`, `localFiles` and the view
// are supplied by the Profile owner; they are not implemented by this module.
const editor = createAudioEditor({
  audio: profileAudioPaths(profileDraft.audio),
  readFile: async (reference, signal) => {
    // Resolve relative paths against profileDirectory using the native/local
    // file boundary. Read fresh bytes, propagate missing-file errors, honor
    // AbortSignal, and return a Blob. Never fetch untrusted remote URLs here.
    return localFiles.readAudioBlob(profileDirectory, reference, signal)
  },
  onAudioChange: audio => {
    profileDraft = replaceProfileAudio(profileDraft, audio)
    markDraftDirty()
  },
})

const unsubscribe = editor.subscribePreview(renderPlaybackState)
editor.replaceEvent('kill', ['assets/new.ogg', 'assets/new.ogg'])
await editor.play('kill', 1) // Call from the user's explicit audition action.
editor.stop()

// Explicit Save action, owned by Profile storage:
await profileStore.save(profileDraft)

// On navigation/unmount:
unsubscribe()
editor.dispose()
```

The example identifies integration dependencies; it does not claim a Profile store or native reader ships in this branch. Browser file inputs can supply `File` objects directly through the reader, but they do not expose persistent absolute paths. A browser filename alone is not a durable native file reference.

Use `replaceFile`, `moveFile`, `removeFile`, `keepEvent`, and `setAudio` for other draft changes. Every successful selection edit stops the previous audition. Invalid edits do not overwrite a valid draft. `getAudio()` returns a detached snapshot; do not mutate it to edit the selection.

`getPreviewState()` / `subscribePreview()` expose `idle`, `loading`, `playing`, and `error`. Error states include the original file, a stable `code` (`format`, `read`, `decode`, `blocked`, `timeout`) and a bilingual `Msg` (see `src/i18n`). Subscribe does not immediately replay state; render the initial value from `getPreviewState()`. Do not use `getAudio()` directly as a React external-store snapshot because it intentionally returns a new copy.

The default browser backend uses `Audio` and a short-lived object URL. Only one audition is active per editor. Switching, stopping, errors, natural completion and disposal pause/unload media, release the URL, abort pending reads and invalidate late results. The 15-second timeout covers loading and starting playback, not the length of an already playing sound. A stopped request settles even if the injected reader ignores cancellation.

Source bytes are read on every audition; overwriting a source file is heard on the next request without a stale media cache. This does not monitor files continuously or promise exact in-game loudness, pitch, mixing, random selection or event timing.

## Remaining integration

- The formal Profile screen still requires its editable Figma design. This branch adds no installer navigation or product screen.
- Profile JSON persistence, source picking and local file resolution remain at the existing native/local-service boundary. `replaceProfileAudio` preserves unrelated sections but is not a complete Profile validator or store.
- Existing Tauri CSP does not permit blob media. The native integration must explicitly add the narrow `media-src blob:` policy and verify playback in Windows WebView2; do not enable remote media or broaden `default-src`.
- Game application must validate event/override/empty-list semantics and use the existing reviewed backup/recovery transaction. Previewing and saving a draft do not activate it in KovaaK.

## Tests

```sh
npx vitest run --project installer packages/app/tests/installer/profiles
npm run typecheck
npm run build:installer
```

See the [verification record](../../../../../docs/superpowers/notes/2026-09-15-audio-verification.md) for the actual browser and automated results.
