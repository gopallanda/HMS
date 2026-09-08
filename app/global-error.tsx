'use client';

/**
 * The floor. Only reached when the ROOT LAYOUT itself throws -- a bad font
 * fetch, a provider that cannot mount -- which is also why it replaces that
 * layout and has to supply its own <html> and <body>.
 *
 * Everything is inline, and that is the point rather than an oversight: the
 * layout that imports globals.css is the thing that just failed, so a Tailwind
 * class here would render as unstyled text on white. The colours are literals
 * for the same reason -- the design tokens live in that stylesheet -- so this
 * one screen does not follow the theme, and reads acceptably either way.
 *
 * A plain <a> and a full reload, not reset() and not <Link>: at this level the
 * router is part of what may be broken, so the recovery has to be one the
 * browser can perform on its own.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#fafaf9',
          color: '#1c1917',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.125rem' }}>
            The system could not start
          </h1>
          <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: '#57534e' }}>
            Nothing recorded has been lost. Reload the page, and if this keeps happening the
            system needs attention from whoever set it up.
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              A full document load is the recovery, not an accident: <Link />
              routes through the router, which is part of what has failed by
              the time anything renders here. */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              background: '#0f766e',
              color: '#ffffff',
              fontSize: '0.875rem',
              textDecoration: 'none',
            }}
          >
            Reload
          </a>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#78716c' }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
