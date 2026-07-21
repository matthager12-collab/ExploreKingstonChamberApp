"use client";

import { useEffect } from "react";

// E14 — set <html lang> for a route whose page language is not the site default
// (WCAG 3.1.1, Language of Page, Level A).
//
// WHY A CLIENT COMPONENT. In the App Router only the ROOT layout may emit
// <html>, and this app has exactly one (src/app/layout.tsx, lang="en"). A route
// that is wholly in another language — /es — therefore cannot declare its own
// document language declaratively. Wrapping the page body in <div lang="es">
// fixes the CONTENT, but the <title> and <meta description> live in <head> and
// are still announced in the document language, so a Spanish page title gets
// read with an English voice.
//
// The mount sets the attribute and the cleanup restores whatever was there
// before, so a client-side navigation away from /es leaves the document exactly
// as it found it. It runs after paint, which is fine: an assistive technology
// reads the title when the user asks for it, not in the first frame.
export function DocumentLang({ lang }: { lang: string }) {
  useEffect(() => {
    const el = document.documentElement;
    const previous = el.lang;
    el.lang = lang;
    return () => {
      el.lang = previous;
    };
  }, [lang]);
  return null;
}
