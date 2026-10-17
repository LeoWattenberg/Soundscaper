/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindVideoPreviewEffectParameters } from '../src/common/editor/ui/video-preview-effect-parameters.ts';
import { hslMixerPreviewPassV1 } from '../src/common/editor/video-hsl-mixer-v1.ts';

test('owning HSL shader transport uploads all six exact tuples while legacy passes retain two uploads',()=>{
	const keys=['params0','params1','params2','params3','params4','params5'] as const;
	const locations=Object.fromEntries(keys.map(key=>[key,{key}])) as unknown as Record<typeof keys[number],WebGLUniformLocation>;
	const calls:unknown[][]=[],gl={uniform4fv(this:unknown,...args:unknown[]){assert.equal(this,gl);calls.push(args);}};
	const pass=hslMixerPreviewPassV1({id:'hsl',type:'hsl-mixer-v1',enabled:true,params:{redHue:73.25,blueSaturation:100,magentaLuminance:-37.125}})!;
	bindVideoPreviewEffectParameters(gl,locations,pass);assert.equal(calls.length,6);
	for(const [index,key]of keys.entries()){assert.equal(calls[index]?.[0],locations[key]);assert.equal(calls[index]?.[1],pass[key]);}
	assert.equal(pass.params0[0],80009);assert.equal(pass.params3[1],65536);assert.equal(pass.params5[3],-24330);
	calls.length=0;const old={code:22,params0:[1,2,3,4],params1:[5,6,7,8]};
	bindVideoPreviewEffectParameters(gl,locations,old);assert.deepEqual(calls,[[locations.params0,old.params0],[locations.params1,old.params1]]);
	calls.length=0;bindVideoPreviewEffectParameters(gl,locations,{});assert.equal(calls.length,2);assert.deepEqual(calls[0]?.[1],[0,0,0,0]);
});
