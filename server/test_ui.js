const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERR:', err.toString()));

    await page.goto('http://localhost:3001/dashboard.html');
    await new Promise(r => setTimeout(r, 2000));
    
    // Check if subjects grid exists
    const gridExists = await page.evaluate(() => !!document.getElementById('subjectsGrid'));
    console.log("Subjects Grid exists:", gridExists);
    
    console.log("UI Test Complete");
    await browser.close();
})();
