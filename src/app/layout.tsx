import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TrendForge",
  description: "AI-powered Reddit trend discovery and content pipeline",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
            <span className="text-sm font-bold tracking-tight">🔥 TrendForge</span>
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/trends"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Trends
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
