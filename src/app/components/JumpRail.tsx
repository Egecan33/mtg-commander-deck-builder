'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

/*
 * The page's sections as a sticky list on the left. Each `Section` inside a `JumpScope` registers
 * itself; the `JumpRail` in the same scope lists them in page order with their counts, marks the one
 * in view and jumps to any of them.
 */

interface JumpItem { id: string; title: string; count?: number; el: HTMLElement }
type Register = (item: JumpItem) => () => void;

const RegisterContext = createContext<Register | null>(null);
const ItemsContext = createContext<JumpItem[]>([]);

/** Wraps a JumpRail and the Sections it lists. */
export function JumpScope({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ReadonlyMap<string, JumpItem>>(new Map());
  const register = useCallback<Register>((item) => {
    setItems((m) => new Map(m).set(item.id, item));
    return () =>
      setItems((m) => {
        if (m.get(item.id) !== item) return m;
        const next = new Map(m);
        next.delete(item.id);
        return next;
      });
  }, []);
  const ordered = useMemo(
    () => [...items.values()].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)),
    [items],
  );
  return (
    <RegisterContext.Provider value={register}>
      <ItemsContext.Provider value={ordered}>{children}</ItemsContext.Provider>
    </RegisterContext.Provider>
  );
}

/** Lists the element `ref` under `title` in the nearest JumpRail. No-op outside a JumpScope. */
export function useJumpTarget(id: string, title: string, count: number | undefined, ref: RefObject<HTMLElement | null>) {
  const register = useContext(RegisterContext);
  useEffect(() => {
    const el = ref.current;
    if (!register || !el) return;
    return register({ id, title, count, el });
  }, [register, id, title, count, ref]);
}

/** The element that scrolls `el`, or null when the page itself does. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

const smooth = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function scrollTo(scroller: HTMLElement | null, top: number) {
  if (scroller) scroller.scrollTo({ top, behavior: smooth() });
  else window.scrollTo({ top, behavior: smooth() });
}

/**
 * The sticky list of the page's sections (label and count). The section in view is highlighted;
 * a click jumps to a section; "Back to top" returns to the start.
 */
export function JumpRail({ label = 'Sections', className = 'sticky top-4 self-start', testId = 'jump-rail' }: { label?: string; className?: string; testId?: string }) {
  const items = useContext(ItemsContext);
  const [active, setActive] = useState<string | null>(null);
  // After a jump the highlight stays on the chosen section until the scroll there has settled
  // (a short last section cannot reach the top); the next scroll by hand moves it again.
  const pinned = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pin = (ms: number) => {
    if (pinned.current) clearTimeout(pinned.current);
    pinned.current = setTimeout(() => (pinned.current = null), ms);
  };

  useEffect(() => {
    if (items.length === 0) return;
    const scroller = scrollParent(items[0]!.el);
    const visible = new Set<string>();
    const pick = () => {
      if (pinned.current) return;
      const top = scroller ? scroller.scrollTop : window.scrollY;
      const height = scroller ? scroller.clientHeight : window.innerHeight;
      const full = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
      // At the very end the last sections cannot reach the top: the last one counts as in view.
      if (top > 0 && top + height >= full - 2) {
        setActive(items[items.length - 1]!.id);
        return;
      }
      const first = items.find((i) => visible.has(i.id));
      if (first) setActive(first.id);
    };
    // A section is "in view" while it crosses the top half of the scrolling area; the first such one wins.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        pick();
      },
      { root: scroller, rootMargin: '0px 0px -50% 0px', threshold: 0 },
    );
    for (const i of items) io.observe(i.el);
    const target: HTMLElement | Window = scroller ?? window;
    const onScroll = () => {
      // Still moving to a chosen section: wait for the scroll to stop.
      if (pinned.current) pin(150);
      else pick();
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      target.removeEventListener('scroll', onScroll);
    };
  }, [items]);
  useEffect(() => () => {
    if (pinned.current) clearTimeout(pinned.current);
  }, []);

  const jump = (item: JumpItem) => {
    const scroller = scrollParent(item.el);
    const top = scroller
      ? scroller.scrollTop + item.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      : window.scrollY + item.el.getBoundingClientRect().top;
    pin(300);
    setActive(item.id);
    scrollTo(scroller, top);
    item.el.focus({ preventScroll: true });
  };
  const toTop = () => {
    if (items.length === 0) return;
    pin(300);
    setActive(items[0]!.id);
    scrollTo(scrollParent(items[0]!.el), 0);
  };

  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className={`text-[13px] ${className}`} data-testid={testId}>
      <ol className="grid gap-px">
        {items.map((i) => {
          const on = (active ?? items[0]!.id) === i.id;
          return (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  jump(i);
                }}
                aria-current={on ? 'location' : undefined}
                className={`flex items-baseline gap-2 rounded-r-[6px] px-2 py-[5px] leading-snug transition-colors ${
                  on ? 'bg-iron text-bone shadow-[inset_2px_0_0_var(--color-bone)]' : 'text-ash hover:bg-anvil hover:text-bone'
                }`}
                data-testid="jump-link"
                data-section={i.id}
                data-active={on || undefined}
              >
                <span className="min-w-0 flex-1">{i.title}</span>
                {i.count !== undefined && <span className="shrink-0 text-smoke">{i.count}</span>}
              </a>
            </li>
          );
        })}
      </ol>
      <button type="button" className="mt-2 rounded-[6px] px-2 py-[5px] text-smoke hover:text-bone" onClick={toTop} data-testid="jump-top">
        Back to top
      </button>
    </nav>
  );
}
