import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { chapterText, getChapterMeta, loadChapter, peekChapter } from "../lib/gita";
import type { Language, Verse } from "../lib/gita.types";
import { CHAPTER_LABEL, VERSES_LABEL } from "../lib/labels";
import { Link } from "../lib/router";
import { readableScripture } from "../lib/scripture";

/** The sloka in the reading language's own script, tagged so the [lang] face
 *  rules pick it up. English reads the Devanagari. */
const scriptureOf = (verse: Verse, language: Language): { text: string; lang: string } => {
  if (language === "kn" && verse.text_kannada) return { text: verse.text_kannada, lang: "kn" };
  if (language === "te" && verse.text_telugu) return { text: verse.text_telugu, lang: "te" };
  return { text: verse.text, lang: "sa" };
};

interface VerseListProps {
  chapter: number;
  language: Language;
  /** The verse being read, when the list stands beside the reader. */
  active?: number;
  onPrevChapter: () => void;
  onNextChapter: () => void;
}

/** One chapter as a list of its verses, and the only one in the app: its own
 *  screen on a phone, the reader's sidebar on a wide window. Each row is the
 *  sloka's opening, small, and a tap opens that verse. Only the verse text is
 *  loaded — commentary waits for the reader. */
export const VerseList: React.FC<VerseListProps> = ({ chapter, language, active, onPrevChapter, onNextChapter }) => {
  const [, onLoaded] = useReducer((n: number) => n + 1, 0);
  const listRef = useRef<HTMLOListElement | null>(null);
  const meta = getChapterMeta(chapter);
  const verses = peekChapter(chapter);
  const hasPrev = Boolean(getChapterMeta(chapter - 1));
  const hasNext = Boolean(getChapterMeta(chapter + 1));

  /* Beside the reader the list never follows the reading position — that
     pulled rows out from under the cursor on every click. It does bring the
     active row into view once per chapter, so a deep link into chapter 18 does
     not open with its own row scrolled out of sight. */
  const placedRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !row || placedRef.current === chapter) return;
    placedRef.current = chapter;
    list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
  }, [active, chapter, verses]);

  useEffect(() => {
    if (peekChapter(chapter)) return;
    let cancelled = false;
    loadChapter(chapter)
      .then(() => {
        if (!cancelled) onLoaded();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chapter]);

  if (!meta) return null;

  const name = chapterText(meta, "name", language);
  const meaning = chapterText(meta, "name_meaning", language);

  return (
    <div className="animate-fade-in verse-list-screen">
      <header className="verse-list-head">
        {/* Kept mounted at either end of the book: unmounting reflows the
            header and jumps the rail-head snapshot mid-transition. */}
        <button type="button" className="verse-list-step pressable" onClick={onPrevChapter} disabled={!hasPrev} data-tip={`Chapter ${chapter - 1}`} aria-label={`Chapter ${chapter - 1}`}>
          <ChevronLeft size={16} strokeWidth={2.4} aria-hidden />
        </button>
        <div className="verse-list-title">
          <p className="verse-list-eyebrow" lang={language}>
            {CHAPTER_LABEL[language](chapter)} · {VERSES_LABEL[language](meta.verses_count)}
          </p>
          <h2 className="verse-list-name" lang={name.lang}>
            {name.text}
          </h2>
          <p className="verse-list-meaning" lang={meaning.lang}>
            {meaning.text}
          </p>
        </div>
        <button type="button" className="verse-list-step pressable" onClick={onNextChapter} disabled={!hasNext} data-tip={`Chapter ${chapter + 1}`} aria-label={`Chapter ${chapter + 1}`}>
          <ChevronRight size={16} strokeWidth={2.4} aria-hidden />
        </button>
      </header>

      {!verses ? (
        <p className="verse-viewer-loading">Loading chapter…</p>
      ) : (
        <ol className="verse-list" ref={listRef}>
          {verses.map((verse) => {
            const scripture = scriptureOf(verse, language);
            return (
              <li key={verse.verse_number}>
                <Link to={{ name: "verse", chapter, verse: verse.verse_number }} className="verse-list-card pressable" aria-current={verse.verse_number === active ? "true" : undefined}>
                  <span className="verse-list-number">
                    {chapter}.{verse.verse_number}
                  </span>
                  <span className="verse-list-text" lang={scripture.lang}>
                    {readableScripture(scripture.text)}
                  </span>
                  <ChevronRight className="verse-list-chevron" size={16} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
