// Polyfill globalThis.crypto for Node.js < 20
import { webcrypto } from 'crypto';

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}
