import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HackBLR Dev Agent",
  description: "Voice-first developer assistant with session-isolated RAG",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
