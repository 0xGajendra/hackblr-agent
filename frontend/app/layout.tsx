import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Code Yapper",
  description: "Voice-first developer assistant with code context",
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