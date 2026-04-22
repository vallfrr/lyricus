const BASE = "https://lyricus.vallfrr.ovh";

const pages = [
  { loc: `${BASE}/`,            changefreq: "weekly",  priority: "1.0" },
  { loc: `${BASE}/leaderboard`, changefreq: "daily",   priority: "0.8" },
  { loc: `${BASE}/setup`,       changefreq: "monthly", priority: "0.5" },
  { loc: `${BASE}/settings`,    changefreq: "monthly", priority: "0.4" },
];

export async function GET() {
  const urls = pages
    .map(
      ({ loc, changefreq, priority }) =>
        `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
    )
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
