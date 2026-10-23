# Local streaming text reveal

`client/use-revealed-text.ts` provides a plugin-owned `useRevealedText(text,
phase)` hook. It does not import a host UI module or depend on a timeline schema.
The math renderer (`client/math-message.tsx`) uses it.

Paseo 0.11.2 exposed `useRevealedText` through
`@getpaseo/plugin/client/react-native`. Paseo 0.13.0-beta.1 redirects that module
to the UI runtime, which exports `StreamedText` but not the hook. Calling the old
export therefore fails at render time. A local hook lets custom Markdown/math
renderers pace the source string without depending on that changing host API.

## Behavior

- Initial text, including history and remounted rows, is shown immediately.
- Appended text is revealed at up to 60 updates per second, with catch-up speed
  proportional to the backlog, following the 0.11.2 host policy.
- Completion reveals the full source immediately and cancels pending frames.
- Replacements and shortened messages reset the reveal position.
- Unicode grapheme boundaries are preserved. Missing `Intl.Segmenter` or a
  complete animation-frame clock disables pacing instead of breaking rendering.
- Unmounting cancels the clock and ignores a stale queued callback.

The pure reveal policy and tests are adapted from upstream Apache-2.0 sources;
see `NOTICE`. React lifecycle tests exercise the real local hook, not a mock of
the host export. The test-only React renderer is pinned to the project's React
version; it emits React's deprecation notice and is not shipped at runtime.

## Adopting the helper

A renderer that already receives the phase can use:

```tsx
import { useRevealedText } from "./use-revealed-text.js";

const visibleText = useRevealedText(sourceText, phase);
```

Render `visibleText` and keep copy/export actions tied to `sourceText`. Do not
also import the identically named host hook. Call the hook unconditionally, as
with any React hook.

The local implementation was exercised on n03 while testing #7 with a 0.13 beta
client. This is not a claim that every client/version has been device-tested.
