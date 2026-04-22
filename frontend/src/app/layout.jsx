import { JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import "../index.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  metadataBase: new URL("https://lyricus.vallfrr.ovh"),
  title: { default: "lyricus", template: "%s · lyricus" },
  description: "Testez vos connaissances sur les paroles de vos chansons préférées. Complétez les paroles manquantes en mode normal, flow ou reconnaissance vocale.",
  keywords: ["paroles", "musique", "quiz", "lyrics", "jeu", "chanson", "karaoké", "test"],
  authors: [{ name: "v4l3nt1", url: "https://github.com/v4l3nt1" }],
  creator: "v4l3nt1",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "https://lyricus.vallfrr.ovh",
    siteName: "lyricus",
    title: "lyricus — complète les paroles",
    description: "Testez vos connaissances sur les paroles de vos chansons préférées.",
  },
  twitter: {
    card: "summary",
    title: "lyricus — complète les paroles",
    description: "Testez vos connaissances sur les paroles de vos chansons préférées.",
  },
  robots: { index: true, follow: true },
  alternates: { canonical: "https://lyricus.vallfrr.ovh" },
};

const themeScript = `(function(){var DARK=['dark','catppuccin-mocha','nord','gruvbox-dark','dracula','tokyo-night','rose-pine'];var t=localStorage.getItem('lyricus-theme');if(!t){t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);if(DARK.includes(t))document.documentElement.classList.add('dark');})()`;

export default function RootLayout({ children }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0d0d0d" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "lyricus",
              url: "https://lyricus.vallfrr.ovh",
              description: "Jeu de quiz sur les paroles de chansons",
              applicationCategory: "GameApplication",
              operatingSystem: "Any",
              inLanguage: "fr",
              author: { "@type": "Person", name: "v4l3nt1", url: "https://github.com/v4l3nt1" },
              offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
            }),
          }}
        />
      </head>
      <body className={`${mono.variable} font-mono bg-background text-foreground antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
