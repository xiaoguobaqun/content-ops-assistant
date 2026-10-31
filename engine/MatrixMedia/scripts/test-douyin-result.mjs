import test from 'node:test';
import assert from 'node:assert/strict';

const fresh = { workId: '7702023091953618217', title: '接口验证', description: '私密测试说明', publishTime: 20000, visibility: 'private' };
const base = { works: [fresh], baselineIds: ['7702023091953618216'], complete: true, baselineComplete: true, since: 19000, now: 25000, title: '接口验证', description: '私密测试说明', visibility: 'private' };
async function matcher() { return (await import('../src/shared/douyinWork.js')).matchDouyinWork; }

test('a unique fresh work confirms its string ID and privacy', async () => {
  const match = await matcher();
  const result = match(base);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.work.workId, '7702023091953618217');
});
test('same-title old work and pre-submission timestamps cannot confirm a new publish', async () => {
  const match = await matcher();
  assert.equal(match({ ...base, baselineIds: [fresh.workId] }).status, 'unknown');
  assert.equal(match({ ...base, works: [{ ...fresh, publishTime: 10000 }] }).status, 'unknown');
});
test('incomplete baseline, missing time and ambiguous new works remain unknown', async () => {
  const match = await matcher();
  for (const change of [{ baselineComplete: false }, { complete: false }, { works: [{ ...fresh, publishTime: 0 }] }, { works: [fresh, { ...fresh, workId: '7702023091953618218' }] }]) {
    assert.equal(match({ ...base, ...change }).status, 'unknown');
  }
});
test('wrong or unobserved privacy never satisfies private confirmation', async () => {
  const match = await matcher();
  for (const visibility of ['public', null]) assert.equal(match({ ...base, works: [{ ...fresh, visibility }] }).status, 'unknown');
});
test('explicit ID lookup does not require a full historical baseline', async () => {
  const match = await matcher();
  assert.equal(match({ works: [fresh], workId: '7702023091953618217' }).status, 'confirmed');
  assert.equal(match({ works: [fresh], workId: '7702023091953618219' }).status, 'unknown');
});
test('different content with a matching title does not satisfy verification', async () => {
  const match = await matcher();
  assert.equal(match({ ...base, works: [{ ...fresh, description: '另一份素材' }] }).status, 'unknown');
});
test('Douyin combined text must match title and full description together', async () => {
  const match=await matcher();
  const combined={...fresh,title:'',combinedText:'接口验证 私密测试说明',description:'接口验证 私密测试说明'};
  assert.equal(match({...base,works:[combined]}).status,'confirmed');
  assert.equal(match({...base,works:[{...combined,combinedText:'接口验证 别的说明'}]}).status,'unknown');
});

test('submit click and confirmation errors yield unknown without replay', async () => {
  const { submitDyOnce } = await import('../src/main/services/upLoad/dySubmission.js');
  for (const stage of ['click', 'confirm']) {
    let calls = 0; let report;
    await submitDyOnce({
      submit: async () => { calls++; if (stage === 'click') throw Error('connection lost'); },
      confirm: async () => { if (stage === 'confirm') throw Error('page closed'); },
      reportUnknown: payload => { report = payload; }
    });
    assert.equal(calls, 1);
    assert.equal(report.outcome, 'submission_unknown');
    assert.equal(report.publishAbnormal, true);
    assert.equal(report.status, true);
  }
});
