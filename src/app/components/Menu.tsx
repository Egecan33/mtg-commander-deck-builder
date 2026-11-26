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
  label, items, testId, className = 'btn btn-sm', title, align = 'left',
}: {
  label: string; items: MenuItem[]; testId?: string; className?: string; title?: string;
  /** Which edge of the button the list lines up with; 'right' for a menu near the right of the screen. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const itemEls = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const focusItem = (i: number) => {
    const els = itemEls();
    if (els.length) els[(i + els.length) % els.length]!.focus();
  };
  const close = (refocus: boolean) => {
    setOpen(false);
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
    focusItem(focusOnOpen.current);
    focusOnOpen.current = null;
  });

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
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
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') focusItem(at + 1);
    else if (e.key === 'ArrowUp') focusItem(at - 1);
    else if (e.key === 'Home') focusItem(0);
    else if (e.key === 'End') focusItem(-1);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
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
        onClick={() => (open ? setOpen(false) : openAt(0))}
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
          {items.map((item) => (
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
