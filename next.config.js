/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['privacycash', '@solana/web3.js', '@lightprotocol/hasher.rs', 'imapflow', 'mailparser'],
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      path: false,
      crypto: false,
    };
    
    // Exclude Privacy Cash SDK from client bundle
    if (!isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('privacycash');
      } else {
        config.externals = [config.externals, 'privacycash'];
      }
      
      // Fix for @solana/web3.js CURVE error - ensure it uses the correct build
      // The issue is that Webpack tries to bundle Node.js-specific crypto code
      config.resolve.alias = {
        ...config.resolve.alias,
        // Force use of browser-compatible build
        '@solana/web3.js': require.resolve('@solana/web3.js'),
      };
    }
    
    return config;
  },
};

module.exports = nextConfig;
