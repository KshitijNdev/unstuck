"use client";

import { useSyncExternalStore } from "react";

/**
 * One remembered reviewer name for the whole app. Every "Your name" field reads and writes this, so a person
 * types it once: fields on the same page update together, and it is kept in this browser for next time.
 * Nothing is sent anywhere until the person saves something; then the name travels with that record only.
 */
const KEY = "unstuck.reviewer";
const listeners = new Set<() => void>();

function read(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function setReviewer(name: string) {
  try { localStorage.setItem(KEY, name); } catch { /* storage blocked: the name still works for this page */ fallback = name; }
  listeners.forEach((l) => l());
}

let fallback: string | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);   // another tab changed it
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}

export function useReviewer(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, () => fallback ?? read(), () => "");
  return [name, setReviewer];
}
