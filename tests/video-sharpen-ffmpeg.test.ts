/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { withDetailSharpenPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-sharpen-v1.ts';

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
const sharp = (amount = 100, threshold = 0) => createVideoEffect('detail-sharpen-v1', { params: { amount, threshold } });

test('actual pinned WASM detail graph preserves literal replicated-edge and negative-half-tie RGB bytes', () => {
	const source = new Uint8Array([40,40,40,255,100,100,100,255,160,160,160,255]);
	assert.deepEqual(execute(source, 3, [sharp()]), [25,25,25,255,100,100,100,255,175,175,175,255]);
	assert.deepEqual(execute(source, 3, [sharp(50)]), [33,33,33,255,100,100,100,255,168,168,168,255]);
});

test('actual pinned WASM detail graph preserves every alpha and agrees with independent rational neighborhoods for fractional/clipped controls', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n,255-n,(n*17)%256,n]).flat());
	for (const [amount, threshold] of [[37.125,3],[200,0],[50,1],[0,0]] as const) {
		const expected = reference(source, 16, amount, threshold), effect = sharp(amount, threshold);
		const actual = execute(source, 16, [effect]), mismatch = actual.findIndex((n,i) => n !== expected[i]);
		assert.deepEqual(actual, expected, JSON.stringify({ amount, threshold, mismatch, actual: actual[mismatch], expected: expected[mismatch] }));
		const cpu = await withDetailSharpenPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 16, height: 16,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source }, effect }, view => [...view.pixels],
		{ limits: { maximumSidePixels: 16, maximumPixels: 256, maximumBytes: 1024 } });
		assert.deepEqual(cpu, expected); assert.deepEqual(expected.filter((_, n) => n % 4 === 3), Array.from({ length: 256 }, (_, n) => n));
	}
	const hidden = new Uint8Array([255,0,255,0,100,40,10,127,0,255,0,0]);
	assert.deepEqual(execute(hidden, 3, [sharp()]), [...hidden]);
});

test('owning multi-input graph composes two sharpen stages and an ordered curve with independent alpha/hidden-RGB goldens', () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n,255-n,(n*17)%256,n]).flat());
	const invert = createVideoEffect('point-curves-v1', { params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const inverted = (bytes: readonly number[]) => bytes.map((n,i) => i%4===3 ? n : 255-n);
	const first = reference(source,16,37.125,3), twice = reference(new Uint8Array(first),16,50,1);
	assert.deepEqual(execute(source,16,[sharp(37.125,3),sharp(50,1)]),twice);
	assert.deepEqual(execute(source,16,[sharp(37.125,3),invert,sharp(50,1)]),reference(new Uint8Array(inverted(first)),16,50,1));
	assert.deepEqual(execute(source,16,[invert,sharp(50,1),sharp(37.125,3)]),
		reference(new Uint8Array(reference(new Uint8Array(inverted([...source])),16,50,1)),16,37.125,3));
	assert.deepEqual([...source].filter((_,i)=>i%4===3),Array.from({length:256},(_,n)=>n));
});

test('owning graph joins wheel → sharpen → curve and a second sharpen without label collisions or alpha transport loss', () => {
	const source = new Uint8Array([40,80,120,0,100,140,180,127,160,200,240,255]);
	const wheel = createVideoEffect('color-wheels-v1', { id: 'wheel', params: { highlightsLuminance: 100 } });
	const invert = createVideoEffect('point-curves-v1', { id: 'curve', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const expected = [197,144,90,0,137,79,12,127,31,0,0,255];
	assert.deepEqual(execute(source, 3, [wheel, sharp(50,3), invert]), expected);
	assert.deepEqual(execute(source, 3, [wheel, sharp(50,3), invert, sharp(37.125,1)]), reference(new Uint8Array(expected),3,37.125,1));
	assert.deepEqual([...source], [40,80,120,0,100,140,180,127,160,200,240,255]);
});

// Independent BigInt rational oracle: literal nine weights, independently
// addressed pixels, positive blur ties and signed-floor gain ties.
function reference(source: Uint8Array, width: number, amount: number, threshold: number): number[] {
	const height = source.length / (4 * width), gain = BigInt(Math.round(amount * 256 / 100));
	const neighbors = [[-1,-1,1],[0,-1,2],[1,-1,1],[-1,0,2],[0,0,4],[1,0,2],[-1,1,1],[0,1,2],[1,1,1]] as const;
	return [...source].map((original, offset) => {
		const channel = offset % 4, pixel = Math.floor(offset / 4); if (channel === 3 || source[pixel * 4 + 3] === 0) return original;
		const x = pixel % width, y = Math.floor(pixel / width);
		const samples = neighbors.map(([dx,dy,w]) => {
			const n = 4 * (Math.min(height-1,Math.max(0,y+dy))*width+Math.min(width-1,Math.max(0,x+dx)));
			return { weight: BigInt(w * source[n+3]!), value: BigInt(source[n+channel]!) };
		});
		const denominator = samples.reduce((total,n) => total+n.weight,0n), numerator = samples.reduce((total,n) => total+n.value*n.weight,0n);
		const blur = (2n*numerator+denominator)/(2n*denominator), delta = BigInt(original)-blur;
		if ((delta<0n?-delta:delta)<=BigInt(threshold)) return original;
		const n = delta*gain+128n, adjustment = n>=0n ? n/256n : -((-n+255n)/256n), result = BigInt(original)+adjustment;
		return Number(result<0n?0n:result>255n?255n:result);
	});
}

function execute(source: Uint8Array, width: number, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [n, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `detail_${String(n)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width, height: source.length/(4*width) }); label = next;
	}
	core.FS.writeFile('detail.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); const graph = filters.length ? ['-filter_complex',filters.join(';'),'-map',`[${label}]`] : [];
		assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length/(4*width))}`,'-i','detail.rgba',
			...graph,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','detail-out.rgba'),0,logs.join('\n'));
		const output = core.FS.readFile('detail-out.rgba'); assert.equal(output.length,source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('detail.rgba'); try { core.FS.unlink('detail-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
