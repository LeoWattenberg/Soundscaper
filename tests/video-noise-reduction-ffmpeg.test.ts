/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { serializeNoiseReductionEffectToFfmpegV1, appendNoiseReductionFfmpegOperationV1 } from '../src/common/editor/video-noise-reduction-ffmpeg-v1.ts';
import { withNoiseReductionPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-noise-reduction-v1.ts';
import { noiseReductionReferenceV1 } from './helpers/video-noise-reduction-reference.ts';

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
const effect = (params: unknown) => ({ id: 'noise', type: 'noise-reduction-v1', enabled: true, params });
const defaults = Object.freeze({ luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 0, colorDetail: 50, colorSmoothness: 50 });

test('actual pinned GEQ noise graph preserves the literal luma and signed-chroma neighborhood goldens', () => {
	const impulse = new Uint8Array([100,100,100,255,200,200,200,255,100,100,100,255]);
	assert.deepEqual(execute(impulse, 3, [{ luminance: 100, luminanceDetail: 0 }]), [125,125,125,255,150,150,150,255,125,125,125,255]);
	assert.deepEqual(execute(impulse, 3, [{ luminance: 100, luminanceDetail: 0, luminanceContrast: 100 }]), [115,115,115,255,170,170,170,255,115,115,115,255]);
	const speckle = new Uint8Array([110,110,150,255,130,130,90,255,110,110,150,255]);
	assert.deepEqual(execute(speckle, 3, [{ color: 100, colorDetail: 0, colorSmoothness: 0 }]), [115,115,135,255,120,120,120,255,115,115,135,255]);
	assert.deepEqual(execute(speckle, 3, [{ color: 100, colorDetail: 0, colorSmoothness: 100 }]), [115,115,135,255,118,118,128,255,115,115,135,255]);
});

test('owning compiled noise graphs refuse lookalikes and close neutral admission', () => {
	assert.equal(serializeNoiseReductionEffectToFfmpegV1(effect({})), null);
	assert.throws(() => serializeNoiseReductionEffectToFfmpegV1({ ...effect({ color: 101 }), enabled: false }));
	const operation = serializeNoiseReductionEffectToFfmpegV1(effect({ color: 50 })); assert.ok(operation);
	assert.throws(() => appendNoiseReductionFfmpegOperationV1({ filters: [], inputLabel: '0:v', outputLabel: 'fake', operation: { ...operation } }));
	let reads = 0; const opaque = new Proxy({}, { get() { reads++; throw Error(); }, getPrototypeOf() { reads++; throw Error(); } });
	assert.throws(() => appendNoiseReductionFfmpegOperationV1({ filters: [], inputLabel: '0:v', outputLabel: 'opaque', operation: opaque }));
	assert.equal(reads, 0);
});

test('actual pinned noise graph preserves all alpha bytes and ordered repeated stages', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n,255-n,(n*17)%256,n]).flat());
	const params = [
		{ luminance: 37.125, luminanceDetail: 1.5, luminanceContrast: 50, color: 72.25, colorDetail: 3.125, colorSmoothness: 50 },
		{ luminance: 100, luminanceDetail: 0, color: 100, colorDetail: 0, colorSmoothness: 100 },
		{ luminance: 50, luminanceDetail: 100, color: 50, colorDetail: 100, colorSmoothness: 0 },
	];
	for (const stages of [[params[0]!], [params[1]!], [params[2]!], [params[0]!, params[1]!], [params[1]!, params[0]!]]) {
		let expected = [...source];
		for (const settings of stages) {
			const independent = noiseReductionReferenceV1(expected, 16, { ...defaults, ...settings });
			const cpu = await withNoiseReductionPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 16, height: 16,
				sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(expected) }, effect: effect(settings) }, view => [...view.pixels],
			{ limits: { maximumSidePixels: 16, maximumPixels: 256, maximumBytes: 1024 } });
			assert.deepEqual(cpu, independent); expected = independent;
		}
		const actual = execute(source, 16, stages); assert.deepEqual(actual, expected);
		assert.deepEqual(actual.filter((_, n) => n % 4 === 3), Array.from({ length: 256 }, (_, n) => n));
		assert.deepEqual(actual.slice(0,4), [...source.slice(0,4)], 'transparent hidden RGB remains exact through every stage');
	}
});

function execute(source: Uint8Array, width: number, stages: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [n, params] of stages.entries()) {
		const operation = serializeNoiseReductionEffectToFfmpegV1(effect(params)); if (!operation) continue;
		const next = `noise_${String(n)}`; appendNoiseReductionFfmpegOperationV1({ filters, inputLabel: label, outputLabel: next, operation }); label = next;
	}
	core.FS.writeFile('noise.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); const graph = filters.length ? ['-filter_complex',filters.join(';'),'-map',`[${label}]`] : [];
		assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length/(4*width))}`,'-i','noise.rgba',
			...graph,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','noise-out.rgba'),0,logs.join('\n'));
		const output = core.FS.readFile('noise-out.rgba'); assert.equal(output.length,source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('noise.rgba'); try { core.FS.unlink('noise-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
