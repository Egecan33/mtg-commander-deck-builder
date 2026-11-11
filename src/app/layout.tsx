import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Shell } from './components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Commander Forge',
  description: 'Build, score, rate and improve Commander decks.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
