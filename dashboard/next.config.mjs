/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["worker", "renderer"],
  serverExternalPackages: ["@supabase/supabase-js"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
