import './globals.css';

export const metadata = {
  title: 'Pocket Analyzer',
  description: 'Deterministic, signal-only Pocket Option market analysis. Demo data; no trade execution.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
