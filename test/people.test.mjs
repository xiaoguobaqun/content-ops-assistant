import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const accounts=[{phone:'账号A',pt:'抖音',loggedIn:true},{phone:'账号A',pt:'视频号',loggedIn:false},{phone:'账号B',pt:'抖音',loggedIn:true}];
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'people-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const {createPeopleStore}=await import('../src/people.mjs');return {root,store:createPeopleStore({root})};}
test('people bind one existing account per platform without changing engine records',async t=>{
 const {root,store}=await fixture(t),original=structuredClone(accounts);
 const person=await store.save({name:' 人员甲 ',bindings:{dy:{platform:'dy',phone:'账号A'},sph:{platform:'sph',phone:'账号A'}}},{accounts});
 assert.equal(person.name,'人员甲');assert.equal(person.revision,1);assert.equal((await store.list()).length,1);assert.deepEqual(accounts,original);
 if(process.platform!=='win32')assert.equal((await fs.stat(path.join(root,'people.json'))).mode&0o777,0o600);
 await assert.rejects(store.save({name:'人员甲',bindings:{}},{accounts}),/名称|同名/);
 await assert.rejects(store.save({name:'人员乙',bindings:{dy:{platform:'dy',phone:'账号A'}}},{accounts}),/归属|绑定/);
 await assert.rejects(store.save({name:'不存在账号',bindings:{dy:{platform:'dy',phone:'没有'}}},{accounts}),/账号/);
 await assert.rejects(store.save({name:'错误平台',bindings:{dy:[{phone:'账号A'}]}},{accounts}),/绑定|账号/);
});
test('revision checks reject stale changes and snapshots after rebinding or renaming',async t=>{
 const {store}=await fixture(t);const person=await store.save({name:'人员甲',bindings:{dy:{platform:'dy',phone:'账号A'}}},{accounts});
 await store.assertSnapshot(person);
 const changed=await store.save({...person,name:'人员甲新版',expectedRevision:1},{accounts});assert.equal(changed.revision,2);
 await assert.rejects(store.assertSnapshot(person),/变化|重新/);
 await assert.rejects(store.save({...person,name:'过期修改',expectedRevision:1},{accounts}),/变化|重新/);
});
test('concurrent mutations never lose an accepted person and corrupt files are not overwritten',async t=>{
 const {root,store}=await fixture(t);const results=await Promise.allSettled(['甲','乙'].map(name=>store.save({name,bindings:{}},{accounts})));
 const accepted=results.filter(r=>r.status==='fulfilled');assert.ok(accepted.length>0);assert.equal((await store.list()).length,accepted.length);
 await fs.writeFile(path.join(root,'people.json'),'bad-json');await assert.rejects(store.save({name:'丙',bindings:{}},{accounts}),/读取|记录/);
 assert.equal(await fs.readFile(path.join(root,'people.json'),'utf8'),'bad-json');
});
