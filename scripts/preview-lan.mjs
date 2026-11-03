import os from 'node:os';
import { preview } from 'vite';

const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? [])
    .filter((address) => !address.internal && (address.family === 'IPv4' || address.family === 4))
    .map((address) => ({ name, address: address.address })),
);
const isPrivateIPv4 = (address) =>
  /^10\./.test(address) ||
  /^192\.168\./.test(address) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(address);
const preferredInterface = interfaces.find(({ name }) => /wi-?fi|wireless/i.test(name));
const lanAddress = process.env.LAN_HOST || preferredInterface?.address || interfaces.find(({ address }) => isPrivateIPv4(address))?.address;

if (!lanAddress) {
  throw new Error('No Wi-Fi IPv4 address found. Set LAN_HOST to your computer’s local network IP and retry.');
}

const port = Number(process.env.LAN_PREVIEW_PORT || 4175);
const server = await preview({
  root: process.cwd(),
  configFile: false,
  preview: {
    host: lanAddress,
    port,
    strictPort: true,
    open: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});

console.log(`AlpasFarm LAN preview: http://${lanAddress}:${port}`);
console.log('API requests are forwarded to the local backend; keep the backend and ML services running.');

server.httpServer.on('close', () => process.exit(0));
