import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';

import './globals.css';
import { ThemeProvider } from '@/components/shell/theme-provider';
import { Toaster } from '@/components/ui/sonner';

// Inter over Geist: a larger x-height reads bigger at the same size, and its
// lining figures suit screens that are mostly numbers. Geist Mono stays for
// phone numbers, MRNs and invoice numbers.
//
// The variable names here are what globals.css reads. Keep them in step: an
// unmatched name is a silent fallback to the browser default sans, not an error.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Hospital Management System',
    template: '%s — HMS',
  },
  description: 'Registration, billing and records for small hospitals.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      // next-themes sets the theme class on this element before React
      // hydrates, so the server and client markup differ here by design.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
