import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFileSystem } from '../host/fs-api.js';
import { apply } from '../index.js';

test('data, backups and notes use the dedicated root; backup listing round-trips', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feifan-host-test-'));
  try {
    const api = createFileSystem({dataDir:root,vaultDir:root});
    const prefix = '.obsidian/plugins/feifan-life';
    await api.write(prefix+'/data.json','{"test":true}');
    await api.write(prefix+'/backups/daily/data-test.json','{"backup":true}');
    await api.write('05-复盘迭代/03人生复盘/2026-11-09.md','# Review');
    assert.equal(await fs.readFile(path.join(root,'data.json'),'utf8'),'{"test":true}');
    const listing=await api.list(prefix+'/backups/daily');
    assert.equal(listing.files[0],prefix+'/backups/daily/data-test.json');
    assert.equal((await api.read(listing.files[0])).text,'{"backup":true}');
    assert.ok((await api.stat(listing.files[0])).mtime>0);
    assert.ok((await api.tree('')).entries.some(x=>x.path.endsWith('2026-11-09.md')));
    assert.throws(()=>api.resolveVaultPath('../outside.json'));
    assert.throws(()=>api.resolveVaultPath('/Users/feifan/FEIFAN/.obsidian/plugins/command-center/data.json'));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('host registers mutation as an HTTP handler, protects routes and disposes registrations', () => {
  const routes=[]; const cleanup=[];
  apply({webServer:{register(route){routes.push(route);return()=>routes.splice(routes.indexOf(route),1);}},
    connection:{authorizeIndex(){return false;}},effect(fn){cleanup.push(fn());}},
    {dataDir:'/tmp/feifan-unused-test-root',vaultDir:'/tmp/feifan-unused-test-root'});
  assert.equal(typeof routes.find(x=>x.path.endsWith('/fs')).handler,'function');
  assert.equal(typeof routes.find(x=>x.kind==='prefix').resource,'function');
  cleanup.reverse().forEach(dispose=>dispose());
  assert.equal(routes.length,0);
});

test('source app retains all eight original modules and byte-identical business UI styles', async () => {
  const root=new URL('../',import.meta.url);
  const base=await fs.readFile(new URL('app/src/views/base.ts',root),'utf8');
  for(const tab of ['overview','tasks','planning','finance','life','habits','inspiration','review']) assert.ok(base.includes("key: '"+tab+"'"));
  // Lock down the original stylesheet snapshot used for the personal edition.
  const {createHash}=await import('node:crypto');
  const manifest=JSON.parse(await fs.readFile(new URL('_docs/source-parity.json',root),'utf8'));
  for(const [relative,hash] of Object.entries(manifest.originalStyles)) {
    const actual=createHash('sha256').update(await fs.readFile(new URL('app/src/'+relative,root))).digest('hex');
    assert.equal(actual,hash,relative);
  }
});
