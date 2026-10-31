import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
test('draft recovery requires exact content, video, cover and selected visibility', async () => {
  const { inspectDyRecoveredDraft } = await import('../src/main/services/upLoad/dyDraft.js');
  const cover = 'https://creator-media-private.douyin.com/cover.jpg';
  const expected = {title:'测试',description:'说明',coverSrcs:[cover],visibility:'private'};
  function inspect({title='测试',description='说明',src=cover,checked=true,video=true}={}) {
    return vm.runInNewContext(`(${inspectDyRecoveredDraft.toString()})(expected)`, { expected, document: {
      querySelector: selector => selector === '.semi-input' ? {value:title} : selector.includes('editor-kit') ? {innerText:description} : null,
      querySelectorAll: selector => selector === 'video' ? (video ? [{currentSrc:'https://douyin.com/video',getAttribute:()=>null}] : []) : selector === 'label' ? [{textContent:'仅自己可见',querySelector:()=>({checked})}] : [{src}],
    }});
  }
  assert.equal(inspect().ok, true);
  assert.equal(inspect({description:'说明\u200b'}).ok, true);
  assert.equal(inspect({src:cover+'?sign=renewed'}).ok, true);
  for (const change of [{title:'旧稿'},{description:'旧说明'},{src:''},{checked:false},{video:false}]) assert.equal(inspect(change).ok, false);
});
