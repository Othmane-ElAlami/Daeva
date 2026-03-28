import { Inter, Cinzel } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-cinzel",
});

export const metadata = {
  title: "Daeva Analyzer",
  description: "Aion 2 Build Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.className} ${cinzel.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="darkreader-lock" />
        <meta name="color-scheme" content="dark" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
