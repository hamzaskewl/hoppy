import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>hoppy | Privacy-First Payments</title>
        <meta name="description" content="Load. Redeem. Privately. A privacy-first payment platform on Solana." />
        <meta name="keywords" content="privacy, solana, payments, crypto, web3, hoppy" />
      </head>
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
