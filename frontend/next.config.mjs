/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://backend:8000";
    const umami  = process.env.UMAMI_URL    ?? "http://umami:3000";
    return [
      { source: "/api/:path*",          destination: `${backend}/api/:path*` },
      // Proxy Umami via notre propre domaine — contourne les bloqueurs de pub
      { source: "/stats/script.js",     destination: `${umami}/script.js` },
      { source: "/stats/api/send",      destination: `${umami}/api/send` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
    ],
  },
};

export default nextConfig;
