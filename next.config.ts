import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    outputFileTracingRoot: process.cwd(),
    poweredByHeader: false,
    logging: { incomingRequests: { ignore: [/\/bal\//] } },
    serverExternalPackages: ['axios', 'lodash'],
    outputFileTracingExcludes: { '/*': ['./.env*', './.drivehub-client.json'] },
};

export default nextConfig;
