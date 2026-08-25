'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Light / dark / follow-the-system, persisted in localStorage.
 *
 * A client boundary in the root layout, but `children` passes straight through
 * as a prop, so every page beneath stays a Server Component -- the same shape
 * QueryProvider uses inside /(app).
 *
 * attribute="class" is what globals.css expects: the tokens are redefined under
 * a `.dark` rule and the dark: variant is declared as `&:is(.dark *)`. Switching
 * this to the data-attribute form would silently disable every dark style in
 * the app.
 *
 * The script next-themes injects runs before paint, so a dark-mode user never
 * sees a white flash. That is also why <html> needs suppressHydrationWarning:
 * the script edits the class before React hydrates, which is a mismatch React
 * would otherwise complain about on every load.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Suppresses the cross-fade on every colour token at the moment of the
      // switch, which otherwise reads as the whole screen lagging.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
