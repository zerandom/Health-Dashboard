/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from Google (for user avatar)
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

module.exports = nextConfig;
