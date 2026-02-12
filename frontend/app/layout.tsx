import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plusJakartaSans = Plus_Jakarta_Sans({ 
  subsets: ["latin"], 
  variable: "--font-plus-jakarta-sans" 
});

export const metadata: Metadata = {
  title: "GhostHop Bridge",
  description: "One-Click Cross-Chain Gateway to TEN L2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plusJakartaSans.variable} ${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
