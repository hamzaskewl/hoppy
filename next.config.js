/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    // Required for Privy v3 Solana support
    // Note: Only needed for webpack. Next.js 15 uses Turbopack by default which doesn't need this.
    // If you're using webpack explicitly, uncomment the following:
    /*
    if (!isServer) {
      const existingExternals = config.externals || [];
      config.externals = [
        ...(Array.isArray(existingExternals) ? existingExternals : [existingExternals]),
        {
          '@solana/kit': 'commonjs @solana/kit',
          '@solana-program/memo': 'commonjs @solana-program/memo',
          '@solana-program/system': 'commonjs @solana-program/system',
          '@solana-program/token': 'commonjs @solana-program/token',
        },
      ];
    }
    */
    return config;
  },
};

module.exports = nextConfig;
