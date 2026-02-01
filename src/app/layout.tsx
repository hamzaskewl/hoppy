import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import type { Metadata } from "next";

const inter = Inter({ subsets: ["latin"] });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hoppy.cash";

export const metadata: Metadata = {
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
        <Providers>
          <main className="min-h-screen">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
