import type { Metadata, Viewport } from 'next';
import { Fraunces, Nunito_Sans } from 'next/font/google';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

const body = Nunito_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://scranbook.labs.tau.gr'),
  applicationName: 'Scranbook',
  title: 'Scranbook — your private food diary',
  description: 'A warm, local-first food diary with configurable vision AI.',
  manifest: '/manifest.webmanifest',
  alternates: { canonical: '/' },
  icons: {
    apple: '/apple-touch-icon.png',
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Scranbook',
    description: 'A private kitchen notebook for the meals you actually eat.',
    url: '/',
    siteName: 'Scranbook',
    type: 'website',
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Scranbook' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#f3ead7',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
