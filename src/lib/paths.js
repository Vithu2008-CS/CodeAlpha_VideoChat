// Resolve important directories relative to the project root (one level above /src).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(__dirname, '..', '..');
export const publicDir = path.join(rootDir, 'public');
export const uploadsDir = path.join(rootDir, 'uploads');

// Make sure the uploads directory exists at boot.
fs.mkdirSync(uploadsDir, { recursive: true });
