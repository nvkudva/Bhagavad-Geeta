# Code review — bhagavad-geeta

A React 19 + Vite PWA that reads the 701-verse Bhagavad Gita in Sanskrit, Kannada and Telugu from static per-chapter JSON generated at build time, with a hand-rolled router, service-worker precache and two distinct readers (a phone card pager and a desktop column/book).

Read: `package.json`, `vite.config.ts`, `index.html`, all of `src/lib/`, `src/App.tsx`, `src/components/VerseViewer.tsx` (in part), `VerseOfMoment.tsx`, `BookView.tsx` (head), `scripts/build-data.mjs`, `eslint.config.js`, `wrangler.toml`, `TODO.md`. Not read: the ~4,900 lines of CSS beyond targeted greps, `docs/*.md`, most of `scripts/data-sources/` and `scripts/bakeoff/`, and the bulk of `SearchScreen`/`CommandPalette`/`TabBar`/`Header`.

## Architecture

The system is four layers with clean seams.

**Build-time data pipeline.** `scripts/build-data.mjs` reads the 6 MB canonical `src/data/verses.json` and emits `public/data/v1/{chapter-NN,commentary-NN,search-index,manifest}.json`. `validate()` (build-data.mjs:93) is a real ratchet: unknown fields, duplicate refs, verse-sequence gaps, a `verses_count` mismatch and script-mismatched translations all fail the build. `writeStable()` (build-data.mjs:76) keeps byte-identical output so Workbox precache revisions survive a rebuild. `eslint.config.js:26` forbids importing `verses.json` from app code, which is what keeps the corpus out of the bundle. This half of the repo is the strongest part of it.

**Runtime data access.** `src/lib/gita.ts` is the only module that fetches verse data. It holds three module-level maps — `memo`, `inflight`, `withCommentary` — and `loadReader()` (gita.ts:109) merges chapter and commentary before either is shown, which is why the reader has no late layout shift. Chapter metadata is statically imported (5 KB) so the home grid paints with the shell.

**State.** Three module-level singleton stores read through `useSyncExternalStore` — `router.tsx`, `bookmarks.ts`, `history.ts` — plus one React context for durable preferences (`settings.tsx`). No state library. The stores are consistent with each other in shape (snapshot + listener set + `storage` event handler), which makes them easy to follow.

**Routing.** `src/lib/router.tsx` is a ~300-line History API router. `boot()` runs as an import side effect (router.tsx:218): it installs scroll restoration, consumes a one-shot `?lang` override, canonicalises the URL and binds `popstate`. Navigation goes through `setRouteAnimated` (router.tsx:167), which wraps the commit in `startViewTransition` + `flushSync`, and deliberately skips the transition for same-chapter moves.

What the structure gets right: the data boundary is enforced by lint, not convention; the loader is the single fetch point; the router is consumed only through `useRoute`/`navigate`/`<Link>`, so swapping it out really is a one-file change; the size gate (`scripts/check-size.mjs`) turns the performance budget into a build failure.

Where it will hurt:

- `src/components/VerseViewer.tsx:284` is one 672-line component containing two complete readers. Nine effects are each gated on `if (wide) return` or `if (!wide) return` (lines 332, 358, 376, 382, 413, 435, 474, 484, 492) and coordinate through four mutable refs (`activeRef`, `chapterRef`, `placedRef`, `activeSlideRef`) whose invariants exist only in prose comments. A third layout, or a change to the phone pager, means reasoning about all nine at once. The two readers want to be two components sharing a `useActiveVerse` hook.
- The language-fallback rule is implemented three times and has already diverged: `VerseViewer.tsx:34` (`pick`), `VerseOfMoment.tsx:22-32` (`scriptureOf`/`translationOf`) and `BookView.tsx:41-46` (`VerseRun`). `VerseOfMoment.tsx:80` re-implements scripture cleanup inline instead of calling `readableScripture`, so the home card still shows the `।।2.13।।` colophon that both readers strip.
- `src/lib/book.ts` is a single-slot global handler registry connecting the shell's keyboard layer to a lazily-loaded screen. Its own comment concedes "a second registrant would silently win". It works because exactly one component mounts, and it will break silently the day two do.
- 4,857 lines of hand-written CSS (`index.css` 2,919 + `desktop.css` 1,938) are bound to components by class-name convention alone. Nothing detects an orphaned rule or a renamed class; `check-size.mjs` gates bytes, not correctness.

## Code quality

**Types.** Genuinely good. No `any`, no `@ts-ignore`, explicit return types throughout, discriminated-union routes, `readonly` on shared arrays. `gita.types.ts` documents per-field corpus coverage inline.

**Error handling.** The weak seam. Failures are caught and dropped: `App.tsx:70` and `App.tsx:116` both end in `.catch(() => undefined)`, and a chapter that fails to load leaves `VerseViewer.tsx:579`/`612` showing "Loading chapter…" permanently with no retry and no message. `SearchScreen.tsx:62` sets a `failed` flag and tells the reader — the reader route should do the same. `sw.ts:120` calls `void register()` on an async function with no `.catch`, so a registration rejection surfaces as an unhandled rejection. There is no error boundary anywhere (`main.tsx:9`), so any render throw blanks the app.

**Dead and stale code.** `router.tsx:307` is a trailing doc comment with no symbol under it — the export it documented is gone. The wide reader's `IntersectionObserver` scroll-spy (`VerseViewer.tsx:492-513`) observes `.verse-row` elements, but the wide column now mounts exactly one verse (`VerseViewer.tsx:589`), so the observer can only ever report the verse already active. `vite.config.ts:11` points at `public/_redirects`, which does not exist. `router.tsx:24-29` justifies a design decision with "chapter 13 says 34, the corpus has 35"; `chapters.json` now says 35 and `build-data.mjs:130` makes that count authoritative, so the rationale is stale.

**Tests.** None. No test file, no test runner in `package.json`, no `.github/` directory. `TODO.md` lists both CI and tests as pending. The three things most worth testing are already identified there: `build-data.mjs` output shape, router path round-trip, and language fallback.

**Dependencies.** Three runtime deps (`react`, `react-dom`, `lucide-react`), all current. Clean.

**Secrets and config.** No secrets in the tree. `scripts/bakeoff/run-claude.mjs:6` and `run-deepseek.mjs:5` read API keys from the environment and exit if absent — correct. `vite.config.ts:54` pins a personal Tailscale hostname in `server.allowedHosts`; dev-only, but committed.

**Formatting.** Prettier is configured and applied, but at a very wide print width — several lines in `App.tsx` and `settings.tsx` exceed 300 characters (e.g. `settings.tsx:163`), which defeats side-by-side diffs.

## Risks

- **SPA fallback poisons data fetches.** `wrangler.toml` sets `not_found_handling = "single-page-application"`, so a missing or renamed `/data/v1/chapter-NN.json` returns `index.html` with HTTP 200. `gita.ts:64` checks only `res.ok`, so the HTML reaches `res.json()`, rejects, and the reader hangs on the loading line. Workbox's `navigateFallbackDenylist` only covers loads the service worker controls; a first visit is unprotected. Check the content type, or verify the response against `manifest.json`.
- **Silent bookmark loss.** `bookmarks.ts:52` and `history.ts:35` swallow `localStorage.setItem` failures by design. Under quota pressure or in a locked-down browser, saves appear to succeed and are gone on reload with no signal.
- **Licence.** `README.md:44` claims MIT but there is no LICENSE file. The Telugu translations are te.wikisource CC BY-SA 4.0 (per `gita.types.ts:13`); attribution is carried in the app and in `manifest.json`, but the repo itself ships no licence text or notice.
- **Search scales linearly.** `search.ts:120` scans 701 rows × 5 fields per keystroke with `indexOf`, over a 726 KB index held whole in memory. Fine for one scripture; it is not a foundation for a second corpus.
- The 6 MB `src/data/verses.json` is committed and rewritten in place by several scripts in `scripts/data-sources/` — every corpus edit adds a multi-megabyte blob to history.

## Action items

| Priority | Item | File | Why |
|---|---|---|---|
| P0 | Give the reader a failure state and a retry when a chapter never arrives | src/components/VerseViewer.tsx:579 | A dropped fetch shows "Loading chapter…" forever; the reader has no way out but a reload |
| P0 | Add a LICENSE file and a notice for the CC BY-SA 4.0 Telugu corpus | README.md:44 | README asserts MIT with no licence text, and the imported data carries a share-alike obligation |
| P1 | Validate that a `/data/v1/*.json` response is JSON, not the SPA fallback | src/lib/gita.ts:64 | Cloudflare returns index.html at 200 for a missing asset, which fails inside `res.json()` |
| P1 | Delete the Tailwind claim from the tech stack | README.md:20 | No tailwind dependency, config or directive exists; all styling is hand-written CSS |
| P1 | Catch the service-worker registration promise | src/lib/sw.ts:120 | `void register()` on an async function turns any registration failure into an unhandled rejection |
| P1 | Extract one language-fallback module and call it from all three readers | src/components/VerseOfMoment.tsx:22 | The same rule exists in three places and has already drifted apart |
| P1 | Route the home card's scripture through `readableScripture` | src/components/VerseOfMoment.tsx:80 | The card shows the `।।2.13।।` colophon that both readers strip, so the same verse reads differently |
| P1 | Split VerseViewer into phone and wide readers over a shared active-verse hook | src/components/VerseViewer.tsx:284 | 672 lines, nine width-gated effects and four shared mutable refs make any change a whole-file audit |
| P1 | Add a test runner and cover build-data output, router round-trip and language fallback | package.json:8 | No tests exist; these three are the pieces where a silent regression ships bad data |
| P1 | Add a CI workflow running typecheck, lint, format check and build | package.json:11 | Nothing enforces the lint rules or the size gate before a deploy |
| P1 | Surface a warning when a bookmark write fails | src/lib/bookmarks.ts:52 | Quota or private-mode failures are swallowed, so saved verses vanish on reload with no signal |
| P2 | Add an error boundary around the app | src/main.tsx:9 | One render throw currently leaves a blank page with no recovery path |
| P2 | Remove the wide reader's scroll-spy observer, or restore multi-verse mounting | src/components/VerseViewer.tsx:492 | The column mounts one verse, so the observer can only report the verse already active |
| P2 | Delete the orphaned trailing doc comment | src/lib/router.tsx:307 | It documents an export that no longer exists |
| P2 | Fix or drop the `public/_redirects` comment | vite.config.ts:11 | The file it names is not in the repo; the SPA rewrite comes from wrangler.toml |
| P2 | Update the chapter-13 rationale | src/lib/router.tsx:24 | chapters.json now says 35 and build-data.mjs:130 enforces it, so the stated reason no longer holds |
| P2 | Move the Tailscale hostname out of `server.allowedHosts` into a local override | vite.config.ts:54 | A personal machine name is committed to a public repo for no shared benefit |
| P2 | Lower Prettier's print width | .prettierrc | Lines past 300 characters (settings.tsx:163) make diffs and review unreadable |
