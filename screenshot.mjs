import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'temporary screenshots');

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

function getNextIndex(label) {
  const files = fs.existsSync(screenshotDir) ? fs.readdirSync(screenshotDir) : [];
  const nums = files.map(f => parseInt(f.match(/^screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
  return (Math.max(0, ...nums) + 1);
}

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

const idx = getNextIndex(label);
const filename = label ? `screenshot-${idx}-${label}.png` : `screenshot-${idx}.png`;
const outPath = path.join(screenshotDir, filename);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// Force all animated elements visible for screenshot
await page.evaluate(async () => {
  document.querySelectorAll('.fade-up').forEach(el => {
    el.classList.add('visible');
  });
  await new Promise(r => setTimeout(r, 500));
});

const fullPage = !process.argv[4] || process.argv[4] !== 'viewport';
await page.screenshot({ path: outPath, fullPage });
await browser.close();

console.log(`Screenshot saved: ${outPath}`);
