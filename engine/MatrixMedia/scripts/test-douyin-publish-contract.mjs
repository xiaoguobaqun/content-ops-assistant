import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublishArgs, parsePublishRequest } from '../src/main/cli/parsePublishArgs.js';
import { resolveEffectivePublishMode } from '../src/shared/accountPublishSettings.js';
import { getPublishAttemptLimit } from '../src/shared/xhsPublishPolicy.js';

const base = ['-p', 'dy', '--phone', '测试账号', '-f', '/tmp/素材 a.mov', '-t', '测试标题'];

test('explicit private visibility survives CLI parsing', () => {
  const result = parsePublishArgs([...base, '--visibility', 'private']);
  assert.equal(result.ok, true);
  assert.equal(result.value.visibility, 'private');
});

test('invalid or missing visibility is rejected before upload', () => {
  for (const args of [['--visibility', 'typo'], ['--visibility']]) {
    assert.equal(parsePublishArgs([...base, ...args]).ok, false);
  }
});

test('visibility cannot silently be ignored on another platform', () => {
  const args = [...base]; args[1] = 'ks';
  assert.equal(parsePublishArgs([...args, '--visibility', 'private']).ok, false);
});

test('HTTP requests preserve an explicit visibility and publish mode', () => {
  const result = parsePublishRequest({ platform: 'dy', phone: '测试账号', file: '/tmp/a.mov', title: '测试', visibility: 'private', publish: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.visibility, 'private');
  assert.equal(result.value.publish, true);
});

test('conflicting draft and publish requests fail rather than changing intent', () => {
  assert.equal(parsePublishArgs([...base, '--draft', '--publish']).ok, false);
});

test('explicit publish overrides account default draft without mutating settings', () => {
  const settings = { defaultPublishToDraft: true };
  assert.deepEqual(resolveEffectivePublishMode(false, settings, true), { publishMode: 'publish', publishToDraft: false });
  assert.equal(settings.defaultPublishToDraft, true);
});

test('omitting explicit mode retains the account draft default', () => {
  assert.deepEqual(resolveEffectivePublishMode(false, { defaultPublishToDraft: true }), { publishMode: 'draft', publishToDraft: true });
});

test('Douyin tasks never replay the upload automatically', () => {
  assert.equal(getPublishAttemptLimit({ pt: '抖音' }, 5), 1);
});

test('batch mode refuses unsupported explicit privacy and publish overrides', () => {
  for (const flags of [['--visibility','private'], ['--publish']]) {
    assert.equal(parsePublishArgs(['-p','dy','--phone','x','--dir','/tmp/videos','--config','/tmp/a.xlsx',...flags]).ok, false);
  }
});
test('external task ID survives CLI and HTTP requests',()=>{
  assert.equal(parsePublishArgs([...base,'--task-id','job-123']).value.clientTaskId,'job-123');
  assert.equal(parsePublishRequest({platform:'dy',phone:'x',file:'/tmp/a.mov',title:'测试',clientTaskId:'job-123'}).value.clientTaskId,'job-123');
});
test('scheduled tasks reject unsupported explicit privacy and publish overrides',()=>{
  for(const flags of [['--visibility','private'],['--publish'],['--task-id','job-123']])assert.equal(parsePublishArgs([...base,'--publish-at','2027-01-01 12:00:00',...flags]).ok,false);
});
test('supplied blank or non-string HTTP visibility is rejected',()=>{
  for(const visibility of ['', ' ', [], null, 0, {}]) assert.equal(parsePublishRequest({platform:'dy',phone:'x',file:'/tmp/a.mov',title:'测试',visibility,publish:true}).ok,false);
});
