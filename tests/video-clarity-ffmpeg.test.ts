/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { withClarityPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-clarity-v1.ts';

interface Core { FS: { writeFile(name: string, bytes: Uint8Array): void; readFile(name: string): Uint8Array; unlink(name: string): void };
	exec(...args: string[]): number; reset(): void; setLogger(listener: (entry: { message: string }) => void): void }
let core: Core;
test.before(async () => {
	const require = createRequire(import.meta.url), previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Object.defineProperty(globalThis, 'self', { configurable: true, value: { location: { href: 'file:///ffmpeg-core.js' } } });
	try { const create = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
		core = await create({ wasmBinary: await readFile(require.resolve('@ffmpeg/core/wasm')) });
	} finally { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); }
});
const clarity=(amount=100)=>createVideoEffect('clarity-v1',{params:{amount}});

test('actual pinned WASM Clarity graph preserves independent dense-seven gradient, signed and fractional byte goldens',()=>{
	const source=new Uint8Array([64,64,64,255,128,128,128,255,192,192,192,255]);
	for(const [amount,expected] of [[100,[49,128,206]],[-100,[79,128,178]],[50,[57,128,199]],[37.125,[59,128,197]]] as const)
		assert.deepEqual(execute(source,3,[clarity(amount)]),expected.flatMap(n=>[n,n,n,255]));
});

test('actual owning Clarity graph preserves all256 original alpha and independent BigInt neighborhoods',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
	for(const amount of [-100,100,37.125,0]){
		const expected=reference(source,16,amount),actual=execute(source,16,[clarity(amount)]),mismatch=actual.findIndex((n,i)=>n!==expected[i]);
		assert.deepEqual(actual,expected,JSON.stringify({amount,mismatch,actual:actual[mismatch],expected:expected[mismatch]}));
		assert.deepEqual(await withClarityPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:16,height:16,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effect:clarity(amount)},
			view=>[...view.pixels],{limits:{maximumSidePixels:16,maximumPixels:256,maximumBytes:1024}}),expected);
		assert.deepEqual(actual.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
	}
	const hidden=new Uint8Array([255,0,255,0,64,128,192,127,0,255,0,0]);assert.deepEqual(execute(hidden,3,[clarity()]),[...hidden]);
});

test('two Clarity instances and wheel/sharpen/curve phases retain distinct owning graph labels and original alpha',()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
	const invert=createVideoEffect('point-curves-v1',{params:{master:[{x:0,y:1},{x:1,y:0}]}}),first=reference(source,16,37.125);
	assert.deepEqual(execute(source,16,[clarity(37.125),clarity(-50)]),reference(new Uint8Array(first),16,-50));
	const inverted=first.map((n,i)=>i%4===3?n:255-n);
	assert.deepEqual(execute(source,16,[clarity(37.125),invert,clarity(-50)]),reference(new Uint8Array(inverted),16,-50));
	const mixed=new Uint8Array([40,80,120,0,100,140,180,127,160,200,240,255]);
	const wheel=createVideoEffect('color-wheels-v1',{params:{highlightsLuminance:100}}),sharp=createVideoEffect('detail-sharpen-v1',{params:{amount:50,threshold:3}});
	// Independently pinned previous wheel→sharpen→curve bytes; new Clarity sees these exact straight-alpha neighbors.
	const previous=new Uint8Array([197,144,90,0,137,79,12,127,31,0,0,255]);
	assert.deepEqual(execute(mixed,3,[wheel,sharp,invert,clarity(50),clarity(-37.125)]),reference(new Uint8Array(reference(previous,3,50)),3,-37.125));
});

function reference(source: Uint8Array, width: number, amount: number): number[] {
	const height = source.length / (4 * width), bins = [1n,6n,15n,20n,15n,6n,1n], gain = BigInt(Math.round(amount*256/100));
	const luma = (n: number) => (54n*BigInt(source[n]!)+183n*BigInt(source[n+1]!)+19n*BigInt(source[n+2]!)+128n)/256n;
	return [...source].map((byte, offset) => {
		const c = offset%4, p = Math.floor(offset/4); if (c===3 || source[p*4+3]===0) return byte;
		const x=p%width,y=Math.floor(p/width); let sum=0n,weight=0n;
		for(let row=0;row<7;row++)for(let column=0;column<7;column++){
			const n=4*(Math.min(height-1,Math.max(0,y+row-3))*width+Math.min(width-1,Math.max(0,x+column-3)));
			const w=bins[row]!*bins[column]!*BigInt(source[n+3]!);weight+=w;sum+=w*luma(n);
		}
		const original=luma(p*4),blur=(2n*sum+weight)/(2n*weight),mid=2n*(original<255n-original?original:255n-original);
		const numerator=(original-blur)*gain*mid+32512n,adjustment=numerator>=0n?numerator/65024n:-((-numerator+65023n)/65024n);
		const output=BigInt(byte)+adjustment;return Number(output<0n?0n:output>255n?255n:output);
	});
}

function execute(source: Uint8Array, width: number, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [n, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `clarity_${String(n)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width, height: source.length/(4*width) }); label = next;
	}
	core.FS.writeFile('clarity.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); const graph = filters.length ? ['-filter_complex',filters.join(';'),'-map',`[${label}]`] : [];
		assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length/(4*width))}`,'-i','clarity.rgba',
			...graph,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','clarity-out.rgba'),0,logs.join('\n'));
		const output = core.FS.readFile('clarity-out.rgba'); assert.equal(output.length,source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('clarity.rgba'); try { core.FS.unlink('clarity-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
