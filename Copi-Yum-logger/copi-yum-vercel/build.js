import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = import.meta.dirname;
await copyFile(join(root, 'web', 'app.js'), join(root, 'public', 'app.js'));
await copyFile(join(root, 'node_modules', '@zxing', 'browser', 'umd', 'zxing-browser.min.js'), join(root, 'public', 'zxing-browser.min.js'));
console.log('Browser files copied to public/.');
