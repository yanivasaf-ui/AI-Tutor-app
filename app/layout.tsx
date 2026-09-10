import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

/**
 * Hebrew-native face — Geist was falling back to Arial for Hebrew text
 * (no Hebrew glyphs in the font), invisible until you actually look at
 * rendered Hebrew rather than the English placeholder copy.
 * UI Revamp Brief Section 2/9.
 */
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "המורה הפרטי שלי",
  description: "אב טיפוס פנימי — לא לשימוש חיצוני",
};

/**
 * lang/dir moved up to <html> (was English + per-screen `dir="rtl"` divs) —
 * this is a Hebrew-first, RTL-first app, not an English app with RTL
 * patches. UI Revamp Brief Section 8.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
