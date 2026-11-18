import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't. Tools shared between neighbors.",
};

export const viewport: Viewport = { themeColor: "#1a1a1a" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
