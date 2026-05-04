import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import type { Metadata } from "next";

const inter = Inter({ subsets: ["latin"] });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hoppy.cash";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "hoppy | Privacy-First Payments",
  description: "Load. Redeem. Privately. A privacy-first payment platform on Solana.",
  keywords: ["privacy", "solana", "payments", "crypto", "web3", "hoppy"],
  openGraph: {
    title: "hoppy | Privacy-First Payments",
    description: "Load. Redeem. Privately. Send private payments on Solana.",
    url: APP_URL,
    siteName: "hoppy",
    type: "website",
    images: [
      {
        url: `${APP_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "hoppy - Privacy-First Payments on Solana",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "hoppy | Privacy-First Payments",
    description: "Load. Redeem. Privately. Send private payments on Solana.",
    images: [`${APP_URL}/og-image.png`],
  },
  icons: {
    icon: "/hoppy-logo.png",
    apple: "/hoppy-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        {/* Theme initialization script - runs early to prevent flash */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
        >{`
          (function() {
            try {
              var theme = localStorage.getItem('theme');
              if (theme === 'dark') {
                document.documentElement.classList.add('dark');
              }
            } catch (e) {}
          })();
        `}</Script>
        <Providers>
          <main className="min-h-screen pb-16">
            {children}
          </main>
          <footer className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm border-t border-border py-3 px-4 z-50">
            <div className="max-w-7xl mx-auto flex items-center justify-center">
              <p className="text-xs text-muted-foreground font-mono">
                Hoppy — Privacy-first payments
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
