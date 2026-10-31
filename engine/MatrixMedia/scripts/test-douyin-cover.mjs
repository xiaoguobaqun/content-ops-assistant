import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
test('cover slots are selected by orientation and never cross into the other slot',async()=>{
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{
    const page=await browser.newPage();
    await page.setContent(`<section><div><div onclick="window.chosen='horizontal'"><img src="https://example.com/h.jpg"><span>编辑封面</span></div><span>横封面4:3</span></div><div><div onclick="window.chosen='vertical'"><img src="https://example.com/v.jpg?token=temporary"><span>选择封面</span></div><span>竖封面3:4</span></div></section>`);
    const {inspectDyCoverSlot}=await import('../src/main/services/upLoad/dyCover.js');
    const result=await page.evaluate(inspectDyCoverSlot,{orientation:'vertical',click:true});
    assert.equal(result.src,'https://example.com/v.jpg');
    assert.equal(await page.evaluate(()=>window.chosen),'vertical');
    await page.setContent('<div><img src="https://example.com/h.jpg"><span>横封面4:3</span></div>');
    assert.equal((await page.evaluate(inspectDyCoverSlot,{orientation:'vertical',click:true})).found,false);
  }finally{await browser.close();}
});
