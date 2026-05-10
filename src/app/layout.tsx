import type { Metadata } from 'next';
import { Geist, Geist_Mono, Playfair_Display } from 'next/font/google';
import { SessionProvider } from '@/components/auth/session-provider';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  /** Reduces "preloaded font not used" on client-navigated routes (e.g. /signup) where LCP differs. */
  preload: false,
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  /** Avoid unused preload warnings — mono is secondary UI */
  preload: false,
});

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  /** Headings load after first paint; skip link preload to reduce console noise */
  preload: false,
});

export const metadata: Metadata = {
  title: 'FitNexus — numbers that don\'t lie',
  description: 'AI-powered wellness dashboard for busy professionals. Get personalized daily actions, intake guidance, and progress tracking.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var k='fitnexus-theme';if(localStorage.getItem(k)==='light')document.documentElement.classList.add('light');}catch(e){}",
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased`}>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
