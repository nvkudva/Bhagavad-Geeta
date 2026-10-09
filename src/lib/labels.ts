import type { Language } from "./gita.types";

/** "Chapter 7" and "47 Verses" in the reader's own language. The number is
 *  interpolated rather than concatenated because Kannada and Telugu put the
 *  count before the noun, as English does, but the word order is not something
 *  to assume — each language states its own template. */
export const CHAPTER_LABEL: Record<Language, (n: number) => string> = {
  en: (n) => `Chapter ${n}`,
  kn: (n) => `ಅಧ್ಯಾಯ ${n}`,
  te: (n) => `అధ్యాయం ${n}`,
};

export const VERSES_LABEL: Record<Language, (n: number) => string> = {
  en: (n) => `${n} Verses`,
  kn: (n) => `${n} ಶ್ಲೋಕಗಳು`,
  te: (n) => `${n} శ్లోకాలు`,
};
