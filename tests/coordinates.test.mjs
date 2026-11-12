import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectGPSPoints} from '../src/coordinates.mjs';
test('WGS84 public reference projects to GCJ02 while original stays unchanged',()=>{const source=[[116.404,39.915]],copy=structuredClone(source),result=projectGPSPoints(source);assert.deepEqual(source,copy);assert(Math.abs(result[0][0]-116.41024449916938)<1e-9);assert(Math.abs(result[0][1]-39.91640428150164)<1e-9);});
test('long routes preserve repeated positions, order and all 18164 samples',()=>{const source=Array.from({length:18164},(_,i)=>[113.4+(i%40)*.0001,22.9]);const result=projectGPSPoints(source);assert.equal(result.length,18164);assert.deepEqual(result[0],result[40]);assert.notDeepEqual(result[0],result[1]);result[0][0]=0;assert.notEqual(projectGPSPoints([source[0]])[0][0],0);});
test('coordinates outside China retain their exact GPS location',()=>{const source=[[-122.4194,37.7749],[151.2093,-33.8688]];assert.deepEqual(projectGPSPoints(source),source);});
test('invalid coordinates fail instead of drawing a fake position',()=>{for(const p of [[NaN,30],[190,30],[10,91],['113',22]])assert.throws(()=>projectGPSPoints([p]),/无效/);});
