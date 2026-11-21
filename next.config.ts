import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `forbidden()` renders app/forbidden.tsx with a real 403 status when a
  // signed-in person asks for another role's area. Next 16 still gates the
  // auth-interrupt helpers behind this flag.
  experimental: {
    authInterrupts: true,
  },
  // Tailwind 4 is processed by the Turbopack loader that ships with
  // create-next-app. There is deliberately no webpack configuration:
  // Turbopack is the default builder in Next.js 16.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
