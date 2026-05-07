/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@solana/web3.js', '@lightprotocol/hasher.rs', 'imapflow', 'mailparser', 'pg', 'snarkjs', '@umbra-privacy/sdk', '@umbra-privacy/web-zk-prover'],
  async rewrites() {
    return [
      {
        // Proxy Umbra ZK prover circuit files to avoid CORS issues
        source: '/umbra-zk/:path*',
        destination: 'https://d3j9fjdkre529f.cloudfront.net/:path*',
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/solana-labs/token-list/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      path: false,
      crypto: false,
    };

    if (!isServer) {
      // Fix for @solana/web3.js CURVE error - ensure it uses the correct build
      config.resolve.alias = {
        ...config.resolve.alias,
        '@solana/web3.js': require.resolve('@solana/web3.js'),
      };
    }

    // Enable WASM support for @umbra-privacy/web-zk-prover
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    return config;
  },
};

module.exports = nextConfig;
