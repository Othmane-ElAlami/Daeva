import localFont from "next/font/local";
import { Cinzel } from "next/font/google";
import "./globals.css";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  display: "swap",
  weight: "400 800",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-cinzel",
});

export const metadata = {
  title: "Daeva — Open-source AION 2 meta and build analyzer",
  description:
    "Analyze high-ranking players to discover popular skills, stigmas, equipment, and build trends in Aion 2.",
  icons: {
    icon: [
      { url: "/icon0.svg", type: "image/svg+xml" },
      { url: "/icon1.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.className} ${cinzel.variable}`} suppressHydrationWarning>
      <head>
        <meta name="darkreader-lock" />
        <meta name="color-scheme" content="dark" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
