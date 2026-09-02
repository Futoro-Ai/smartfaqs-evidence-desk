import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SmartFAQs Evidence Desk",
  description: "A synthetic public evidence review workspace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
