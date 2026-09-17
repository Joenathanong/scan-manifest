'use client';

import { useCallback, useEffect, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
type Item = { id: number; kind: ToastKind; text: string };

type Listener = (items: Item[]) => void;

let items: Item[] = [];
let seq = 1;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l([...items]));
}

export function toast(kind: ToastKind, text: string, ms = 3200) {
  const id = seq++;
  items = [...items, { id, kind, text }].slice(-4);
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    emit();
  }, ms);
}

export function ToastHost() {
  const [list, setList] = useState<Item[]>([]);
  const onChange = useCallback((next: Item[]) => setList(next), []);

  useEffect(() => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [onChange]);

  if (!list.length) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {list.map((i) => (
        <div key={i.id} className={`toast toast-${i.kind}`}>
          {i.text}
        </div>
      ))}
    </div>
  );
}
