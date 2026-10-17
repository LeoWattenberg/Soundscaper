/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { serializeDehazeEffectToFfmpegV1,isCompiledDehazeOperationV1,appendDehazeFfmpegOperationV1 } from '../src/common/editor/video-dehaze-ffmpeg-v1.ts';
import { withDehazePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { DEHAZE_SOURCE_V1,DEHAZE_GOLDENS_V1,dehazeReferenceV1 } from './helpers/video-dehaze-reference.ts';

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
const effect = (amount = 100) => ({ id: 'dehaze',type: 'dehaze-v1',enabled: true,params: { amount } });

test('actual pinned WASM Dehaze preserves independently calculated atmospheric removal and simulated-haze goldens', () => {
	const source = new Uint8Array(DEHAZE_SOURCE_V1);
	for (const [amount,expected] of DEHAZE_GOLDENS_V1) assert.deepEqual(execute(source,2,[amount]),expected);
});

test('owning compiled Dehaze rejects lookalikes and opaque proxies before mutating filters; neutral still closes admission', () => {
	assert.equal(serializeDehazeEffectToFfmpegV1(effect(0)),null); assert.equal(serializeDehazeEffectToFfmpegV1({ ...effect(),enabled: false }),null);
	assert.throws(() => serializeDehazeEffectToFfmpegV1({ ...effect(101),enabled: false }));
	const operation = serializeDehazeEffectToFfmpegV1(effect(50)); assert.ok(operation); assert.equal(isCompiledDehazeOperationV1(operation),true);
	const filters = ['held']; let reads = 0;
	const opaque = new Proxy({}, { get() { reads++; throw Error(); },getPrototypeOf() { reads++; throw Error(); } });
	for (const candidate of [{ ...operation },opaque,null]) {
		assert.equal(isCompiledDehazeOperationV1(candidate),false);
		assert.throws(() => appendDehazeFfmpegOperationV1({ filters,inputLabel: '0:v',outputLabel: 'refused',operation: candidate }));
	}
	assert.equal(reads,0); assert.deepEqual(filters,['held']);
});

test('actual original-alpha transport preserves all256 alpha and distinct ordered repeated Dehaze instances', async () => {
	const source = new Uint8Array(Array.from({ length: 256 },(_,n) => [64 + n % 128,80 + (n * 17) % 160,96 + (n * 31) % 160,n]).flat());
	for (const stages of [[100],[-100],[37.125],[-37.125],[0],[37.125,-50],[-50,37.125],[100,100]]) {
		let expected = [...source];
		for (const amount of stages) {
			const independent = dehazeReferenceV1(expected,16,amount);
			const cpu = await withDehazePixelFrameV1({ frame: { descriptor: { schemaVersion: 1,width: 16,height: 16,
				sampleFormat: 'unorm8',primaries: 'srgb',transfer: 'srgb' },pixels: new Uint8Array(expected) },effect: effect(amount) },value => [...value.pixels],
			{ limits: { maximumSidePixels: 16,maximumPixels: 256,maximumBytes: 1024 } });
			assert.deepEqual(cpu,independent); expected = independent;
		}
		const actual = execute(source,16,stages); assert.deepEqual(actual,expected);
		assert.deepEqual(actual.filter((_,n) => n % 4 === 3),Array.from({ length: 256 },(_,n) => n)); assert.deepEqual(actual.slice(0,4),[...source.slice(0,4)]);
	}
});

function execute(source: Uint8Array,width: number,stages: readonly number[]): number[] {
	const filters: string[] = [],logs: string[] = []; let label = '0:v';
	for (const [n,amount] of stages.entries()) {
		const operation = serializeDehazeEffectToFfmpegV1(effect(amount)); if (!operation) continue;
		const next = `dehaze_${String(n)}`; appendDehazeFfmpegOperationV1({ filters,inputLabel: label,outputLabel: next,operation }); label = next;
	}
	core.FS.writeFile('dehaze.rgba',source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); const graph = filters.length ? ['-filter_complex',filters.join(';'),'-map',`[${label}]`] : [];
		assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length / (4 * width))}`,'-i','dehaze.rgba',
			...graph,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','dehaze-out.rgba'),0,logs.join('\n'));
		const output = core.FS.readFile('dehaze-out.rgba'); assert.equal(output.length,source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('dehaze.rgba'); try { core.FS.unlink('dehaze-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
