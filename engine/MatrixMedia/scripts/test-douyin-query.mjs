import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('work query parser rejects unsafe IDs, unknown flags and missing account', async () => {
  const { parseDouyinWorksArgs } = await import('../src/main/cli/parseDouyinWorksArgs.js');
  for (const args of [[], ['--phone','x','--work-id','bad'], ['--phone','x','--unknown']]) assert.equal(parseDouyinWorksArgs(args).ok, false);
  assert.equal(parseDouyinWorksArgs(['--phone','x','--work-id','7702023091953618216']).value.workId, '7702023091953618216');
});

async function collect(pages) {
  const { collectDyWorksInPage } = await import('../src/main/services/douyinWorksPage.js');
  let calls = 0;
  return vm.runInNewContext(`(${collectDyWorksInPage.toString()})()`, {
    fetch: async () => { const page=pages[calls++]; return {ok:true,json:async()=>page,text:async()=>typeof page === 'string' ? page : JSON.stringify(page)}; },
    document: { querySelectorAll: () => [] },
    URL, setTimeout: fn => fn(), AbortSignal,
  });
}
const item = { id:'7702023091953618216', item_title:'标题', description:'简介', create_time:100 };
test('bounded pagination retains exact IDs, content and complete evidence', async () => {
  const r = await collect([{status_code:0,items:[item],has_more:true,max_cursor:'next'}, {status_code:0,items:[],has_more:false}]);
  assert.equal(r.complete, true);
  assert.equal(r.works[0].workId, item.id);
  assert.equal(r.works[0].title, '标题');
  assert.equal(r.works[0].description, '简介');
  assert.equal(r.works[0].visibility, null);
});
test('invalid IDs and API failures never yield a complete baseline', async () => {
  for (const pages of [[{status_code:0,items:[{...item,id:null}],has_more:false}], [{status_code:1}], [{status_code:0,items:[],has_more:true,max_cursor:0}]]) {
    const r = await collect(pages);
    assert.equal(r.complete, false);
  }
});
test('raw JSON numeric IDs retain all 19 digits and do not alter quoted content', async () => {
  const r=await collect(['{"status_code":0,"items":[{"id":7702023091953618216,"description":"id: 7702023091953618217 \\\"文字\\\""}],"has_more":false}']);
  assert.equal(r.complete,true);
  assert.equal(r.works[0].workId,'7702023091953618216');
  assert.equal(r.works[0].description,'id: 7702023091953618217 "文字"');
});
test('nested privacy text confirms only one explicit visibility label',async()=>{
  const r=await collect([{status_code:0,items:[{...item,visibility:{text_list:[{text:'私密'}]}}],has_more:false}]);
  assert.equal(r.works[0].visibility,'private');
  const ambiguous=await collect([{status_code:0,items:[{...item,visibility:{options:['公开','私密']}}],has_more:false}]);
  assert.equal(ambiguous.works[0].visibility,null);
});
test('production transpilation leaves the injected query self-contained', async () => {
  const { collectDyWorksInPage }=await import('../src/main/services/douyinWorksPage.js');
  const config=require('../.electron-vue/webpack.main.config.js');
  const target=config.module.rules.find(r=>r.loader==='esbuild-loader').options?.target || 'es2015';
  const compiled=require('esbuild').transformSync(`export const query=${collectDyWorksInPage.toString()}`,{format:'cjs',target,minify:true}).code;
  const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports});
  const result=await vm.runInNewContext(`(${module.exports.query.toString()})()`,{fetch:async()=>({ok:true,text:async()=>JSON.stringify({status_code:0,items:[item],has_more:false})}),document:{querySelectorAll:()=>[]},AbortSignal});
  assert.equal(result.complete,true);
});
