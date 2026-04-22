export default function robots() {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/history", "/game"] },
    ],
    sitemap: "https://lyricus.vallfrr.ovh/sitemap.xml",
    host: "https://lyricus.vallfrr.ovh",
  };
}
