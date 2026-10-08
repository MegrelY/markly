import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const svg = fs.readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1024, height: 1024 });
await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await p.screenshot({ path: new URL('../assets/icon.png', import.meta.url).pathname, omitBackground: true });
await b.close();
