/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is run separately in CI; do not block builds on it in this scaffold.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
