import { useState, useSyncExternalStore } from "react";

/* The two desktop tiers, kept in one place so the JS branches and the CSS
   media blocks cannot drift. Every `false` path in a component that reads
   these is the code that shipped before the desktop pass — a phone renders
   exactly as it did. */
const WIDE = "(min-width: 900px)";
const WIDE_PLUS = "(min-width: 1280px)";

type Store = { subscribe: (fn: () => void) => () => void; get: () => boolean };

const stores = new Map<string, Store>();

const storeFor = (query: string): Store => {
  const existing = stores.get(query);
  if (existing) return existing;

  const mql = typeof matchMedia === "function" ? matchMedia(query) : null;
  const store: Store = {
    subscribe: (fn) => {
      if (!mql) return () => undefined;
      mql.addEventListener("change", fn);
      return () => mql.removeEventListener("change", fn);
    },
    get: () => mql?.matches ?? false,
  };
  stores.set(query, store);
  return store;
};

const useMedia = (query: string): boolean => {
  const store = storeFor(query);
  // Server/prerender snapshot is `false`: the mobile rendering is the one that
  // must be correct without JS.
  return useSyncExternalStore(store.subscribe, store.get, () => false);
};

/** True at >=900px — sidebar, continuous reader, keyboard layer, palette. */
export const useWide = (): boolean => useMedia(WIDE);

/** True at >=1280px — two-pane reader with the verse rail, 3-column grids. */
export const useWidePlus = (): boolean => useMedia(WIDE_PLUS);

/* Two pages or one. A desktop window and a tablet or phone held landscape have
   the room for a spread; portrait does not. The query is the default only —
   the reader's own choice wins until the orientation itself changes, which is
   a new hold and so a new default. */
const BOOK_TWO_UP = "(min-width: 1280px), (orientation: landscape) and (min-width: 640px)";

export type BookPages = 1 | 2;

/** The page count the book opens at, and the toggle that overrides it. */
export const useBookPages = (): [BookPages, () => void] => {
  const auto: BookPages = useMedia(BOOK_TWO_UP) ? 2 : 1;
  const [chosen, setChosen] = useState<BookPages | null>(null);
  const [lastAuto, setLastAuto] = useState(auto);

  // A turn of the device is a new hold: it retires the previous choice rather
  // than leaving a phone in landscape on the single page it was given in
  // portrait. Adjusting state in render is the documented way to do this — it
  // re-renders before paint, with no effect and no flash of the wrong count.
  if (lastAuto !== auto) {
    setLastAuto(auto);
    setChosen(null);
  }

  const pages = chosen ?? auto;
  return [pages, () => setChosen(pages === 2 ? 1 : 2)];
};
