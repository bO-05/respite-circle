import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
