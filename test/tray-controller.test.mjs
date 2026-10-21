import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createTrayController} from '../desktop/tray-controller.mjs';
test('entry survives offline start, unchanged updates, external destruction and repeated repair without duplicates',()=>{
 const entries=[];let clicks=0,renders=0;
 class FakeTray extends EventEmitter{constructor(image){super();this.image=image;this.destroyed=false;entries.push(this);}setImage(image){this.image=image;}setToolTip(value){this.tip=value;}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;}}
 const owner=createTrayController({create:image=>new FakeTray(image),render:state=>{renders++;return state.remaining;},handlers:{click:()=>clicks++}});
 owner.update({remaining:75,tooltip:'offline cached quota'});assert.equal(entries.length,0);
 owner.start();owner.start();assert.equal(entries.length,1);assert.equal(renders,1);assert.equal(owner.entry.image,75);
 owner.entry.emit('click');assert.equal(clicks,1);
 owner.entry.destroy();owner.update();assert.equal(owner.ready,true);assert.equal(entries.length,2);assert.equal(owner.entry.image,75);
 owner.repair();assert.equal(entries.filter(e=>!e.destroyed).length,1);owner.entry.emit('click');assert.equal(clicks,2);
 owner.stop();owner.update({remaining:20});owner.repair();assert.equal(owner.ready,false);assert.equal(entries.filter(e=>!e.destroyed).length,0);
 owner.start();assert.equal(owner.entry.image,20);owner.stop();
});
