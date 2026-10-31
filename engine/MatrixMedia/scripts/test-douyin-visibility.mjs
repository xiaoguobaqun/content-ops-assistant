import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

let browser;
test.before(async () => {
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
});
test.after(async () => { await browser?.close(); });

async function withPage(html, run) {
  const page = await browser.newPage();
  try { await page.setContent(html); await run(page); }
  finally { await page.close(); }
}
const form = `<section><p>谁可以看</p>
 <label><input name="scope" type="radio" checked>公开</label>
 <label><input name="scope" type="radio">好友可见</label>
 <label><input name="scope" type="radio">仅自己可见</label>
 </section><label><input type="checkbox" checked>允许</label>`;

test('private visibility is selected and read back without changing save permission', async () => {
  await withPage(form, async page => {
    await assert.doesNotReject(async () => {
      const { setDyVisibility } = await import('../src/main/services/upLoad/dyVisibility.js');
      await setDyVisibility(page, 'private', { timeoutMs: 500 });
    });
    assert.equal(await page.$eval('input[name=scope]:checked', el => el.parentElement.textContent.trim()), '仅自己可见');
    assert.equal(await page.$eval('input[type=checkbox]', el => el.checked), true);
  });
});

test('friends and public select their actual form controls', async () => {
  await withPage(form, async page => {
    const { setDyVisibility } = await import('../src/main/services/upLoad/dyVisibility.js');
    await setDyVisibility(page, 'friends', { timeoutMs: 500 });
    assert.equal(await page.$eval('input[name=scope]:checked', el => el.parentElement.textContent.trim()), '好友可见');
    await setDyVisibility(page, 'public', { timeoutMs: 500 });
    assert.equal(await page.$eval('input[name=scope]:checked', el => el.parentElement.textContent.trim()), '公开');
  });
});

test('missing or disabled controls stop the workflow', async () => {
  const { setDyVisibility } = await import('../src/main/services/upLoad/dyVisibility.js');
  await withPage('<label><input type="radio" checked>公开</label>', async page => {
    await assert.rejects(setDyVisibility(page, 'private', { timeoutMs: 30 }), /可见范围/);
  });
  await withPage(form.replace('type="radio">仅自己', 'type="radio" disabled>仅自己'), async page => {
    await assert.rejects(setDyVisibility(page, 'private', { timeoutMs: 30 }), /可见范围/);
  });
});

test('a click that does not persist cannot pass verification', async () => {
  const { setDyVisibility } = await import('../src/main/services/upLoad/dyVisibility.js');
  await withPage(form.replace('>仅自己', ' onclick="event.preventDefault()">仅自己'), async page => {
    await assert.rejects(setDyVisibility(page, 'private', { timeoutMs: 50 }), /确认/);
  });
});
