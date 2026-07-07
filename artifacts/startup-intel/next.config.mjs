/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/api-zod", "@workspace/api-client-react"],
};

export default nextConfig;
