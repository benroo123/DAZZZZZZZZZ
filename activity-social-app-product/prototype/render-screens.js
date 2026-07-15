const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const root = __dirname;
const fileUrl = `file://${path.join(root, 'index.html')}`;
const themes = ['blue', 'teal', 'coral', 'midnight', 'clash', 'cobalt', 'forest', 'mono'];
const screens = ['home', 'match', 'publish', 'messages', 'profile'];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--allow-file-access-from-files']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  for (const theme of themes) {
    const dir = path.join(root, 'screens', theme);
    fs.mkdirSync(dir, { recursive: true });
    for (const screen of screens) {
      await page.goto(`${fileUrl}?theme=${theme}&screen=${screen}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(dir, `${screen}.png`) });
    }
  }
  const filterDir = path.join(root, 'screens', 'blue');
  await page.goto(`${fileUrl}?theme=blue&screen=home&filter=open`, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(filterDir, 'home-filter.png') });
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Rendered ${themes.length * screens.length + 1} screens.`);
})();
