import test from 'node:test';
import assert from 'node:assert/strict';
test('desktop package manifest is local, isolated and points at the intended project',async()=>{
  const {desktopManifest}=await import('../desktop/package-config.mjs');
  const manifest=desktopManifest('/Users/example/内容工作区','/tmp/App.app/Contents/Resources/runtime/node');
  assert.equal(manifest.package.main,'desktop/main.cjs');assert.equal(manifest.info.CFBundleIdentifier,'cn.local.contentops.assistant');assert.equal(manifest.config.projectRoot,'/Users/example/内容工作区');
  assert.throws(()=>desktopManifest('../relative','/tmp/node'),/绝对路径/);
});
