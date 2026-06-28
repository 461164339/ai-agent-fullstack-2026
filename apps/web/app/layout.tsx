import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'AI Agent Chat',
  description: 'Streaming chat UI for the NestJS AI agent API.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
