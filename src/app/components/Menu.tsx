'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  label: string;
  /** One line on what the item does. */
  description?: string;
  /** Tooltip, e.g. why the item is disabled; defaults to the description. */
  title?: string;
  onSelect: () => void;
  testId?: string;
  disabled?: boolean;
}

/**
 * A button that opens a list of actions. Arrow keys move through the items, Enter picks one,
 * Escape or a click outside closes it.
 */
export function Menu({
  label, items, testId, className = 'btn btn-sm', title, align = 'left', search, maxShown = 40,
}: {
  label: string; items: MenuItem[]; testId?: string; className?: string; title?: string;
  /** A search field above a long list: it filters the items by label and description. */
  search?: { placeholder: string };
  /** With a search field, how many matches are listed at once. */
  maxShown?: number;
  /** Which edge of the button the list lines up with; 'right' for a menu near the right of the screen. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = search
    ? items.filter((i) => !needle || i.label.toLowerCase().includes(needle) || (i.description ?? '').toLowerCase().includes(needle)).slice(0, maxShown)
    : items;

  const itemEls = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const focusItem = (i: number) => {
    const els = itemEls();
    if (els.length) els[(i + els.length) % els.length]!.focus();
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    setQ('');
    if (refocus) button.current?.focus();
  };
  // The item to focus once the list is on screen (0 first, -1 last).
  const focusOnOpen = useRef<number | null>(null);
  const openAt = (i: number) => {
    focusOnOpen.current = i;
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || focusOnOpen.current === null) return;
    if (search && focusOnOpen.current === 0) input.current?.focus();
    else focusItem(focusOnOpen.current);
    focusOnOpen.current = null;
  });

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(e.key === 'ArrowDown' ? 0 : -1);
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const els = itemEls();
    const typing = document.activeElement === input.current;
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    if (typing && (e.key === 'Home' || e.key === 'End')) return;
    if (e.key === 'ArrowDown') focusItem(at + 1);
    else if (e.key === 'ArrowUp') {
      if (at === 0 && search) input.current?.focus();
      else focusItem(at - 1);
    } else if (e.key === 'Home') focusItem(0);
    else if (e.key === 'End') focusItem(-1);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
      setQ('');
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKey}
        data-testid={testId}
      >
        {label}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-50 mt-1 grid min-w-[16rem] gap-px rounded-[6px] border border-slag bg-anvil p-1`}
          onKeyDown={onListKey}
          data-testid={testId ? `${testId}-list` : undefined}
        >
          {search && (
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="field mb-1 w-full"
              data-testid={testId ? `${testId}-search` : undefined}
            />
          )}
          {search && shown.length === 0 && <span className="px-2.5 py-1.5 text-[13px] text-ash">Nothing matches.</span>}
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              title={item.title ?? item.description}
              className={`grid rounded-[5px] px-2.5 py-1.5 text-left focus:bg-iron ${item.disabled ? 'cursor-default opacity-45' : 'hover:bg-iron'}`}
              onClick={() => {
                if (item.disabled) return;
                close(true);
                item.onSelect();
              }}
              data-testid={item.testId}
            >
              <span className="text-[14px] text-bone">{item.label}</span>
              {item.description && <span className="text-[13px] leading-snug text-ash">{item.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
