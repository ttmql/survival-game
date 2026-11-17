// The former test seed must now behave like any ordinary procedural world.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context=vm.createContext({console,performance});
for(const name of ['config','world'])vm.runInContext(readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8'),context);
const {Wilds:W}=context;
const a=W.World.createWorld(0x123456),b=W.World.createWorld(0x123456);
assert.equal(a.isDebugMap,undefined);
for(const [x,y] of [[0,0],[5,0],[9,0],[0,7],[-14,7],[-8,-6]]){
 assert.equal(a.terrainAt(x,y),b.terrainAt(x,y));assert.equal(a.featureAt(x,y),b.featureAt(x,y));
}
const spawn=a.findSpawn();assert.equal(a.terrainAt(spawn.tx,spawn.ty),W.TERRAIN.GRASS);
assert(!readFileSync(new URL('../js/game.js',import.meta.url),'utf8').includes('buildDebugMap'));
console.log('Former debug seed now generates an ordinary deterministic world without test buildings or supplies.');
