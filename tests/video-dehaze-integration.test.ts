/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect,serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { dehazeReferenceV1 } from './helpers/video-dehaze-reference.ts';

interface Core { FS: { writeFile(name: string,bytes: Uint8Array): void;readFile(name: string): Uint8Array;unlink(name: string): void };
	exec(...args: string[]): number;reset(): void;setLogger(listener: (entry: { message: string }) => void): void }
let core: Core;
test.before(async () => {
	const require = createRequire(import.meta.url),previous = Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{ configurable: true,value: { location: { href: 'file:///ffmpeg-core.js' } } });
	try { const create = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
		core = await create({ wasmBinary: await readFile(require.resolve('@ffmpeg/core/wasm')) });
	} finally { if (previous) Object.defineProperty(globalThis,'self',previous); else Reflect.deleteProperty(globalThis,'self'); }
});
const dehaze = (amount: number,id: string) => createVideoEffect('dehaze-v1',{ id,params: { amount } });

test('registered shared Dehaze serializes actual pinned GEQ with alpha-exact ordered stages and CPU agreement', async () => {
	const source = new Uint8Array(Array.from({ length: 256 },(_,n) => [64 + n % 128,80 + (n * 17) % 160,96 + (n * 31) % 160,n]).flat()),before = [...source];
	for (const amounts of [[100],[-100],[37.125],[37.125,-50],[-50,37.125]]) {
		const effects = amounts.map((amount,n) => dehaze(amount,`dehaze_${String(n)}`)); let expected = [...source];
		for (const amount of amounts) expected = dehazeReferenceV1(expected,16,amount);
		const output = await applyVideoExactBrowserEffectsFinishing({ width: 16,height: 16,pixels: source },effects,new AbortController().signal);
		try { assert.deepEqual([...output.pixels],expected); assert.deepEqual(execute(source,effects),expected); } finally { output.pixels.fill(0); }
		assert.deepEqual(expected.filter((_,n) => n % 4 === 3),Array.from({ length: 256 },(_,n) => n)); assert.deepEqual(expected.slice(0,4),before.slice(0,4));
	}
	assert.deepEqual([...source],before);
});

test('two registered Dehaze operations separated by point curves use their current stage input without changing compiled identity', async () => {
	const source = new Uint8Array(Array.from({ length: 256 },(_,n) => [64 + n % 128,80 + (n * 17) % 160,96 + (n * 31) % 160,n]).flat());
	const invert = createVideoEffect('point-curves-v1',{ params: { master: [{ x: 0,y: 1 },{ x: 1,y: 0 }] } });
	const first = dehazeReferenceV1(source,16,37.125),inverted = first.map((byte,n) => n % 4 === 3 ? byte : 255 - byte);
	const expected = dehazeReferenceV1(inverted,16,-50),effects = [dehaze(37.125,'first'),invert,dehaze(-50,'second')];
	const output = await applyVideoExactBrowserEffectsFinishing({ width: 16,height: 16,pixels: source },effects,new AbortController().signal);
	try { assert.deepEqual([...output.pixels],expected); assert.deepEqual(execute(source,effects),expected); } finally { output.pixels.fill(0); }
});

function execute(source: Uint8Array,effects: readonly unknown[]): number[] {
	const filters: string[] = [],logs: string[] = []; let label = '0:v';
	for (const [n,operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `dehaze_${String(n)}`; appendVideoEffectOperation({ filters,inputLabel: label,outputLabel: next,operation,width: 16,height: 16 }); label = next;
	}
	core.FS.writeFile('dehaze.rgba',source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size','16x16','-i','dehaze.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','dehaze-out.rgba'),0,logs.join('\n'));
		const output = core.FS.readFile('dehaze-out.rgba'); assert.equal(output.length,source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('dehaze.rgba'); try { core.FS.unlink('dehaze-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
