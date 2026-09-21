import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roomie — Your space, reimagined",
  description:
    "See new possibilities in your room. Place, refine, and save your next idea with Roomie.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/roomie.png",
    shortcut: "/roomie.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
