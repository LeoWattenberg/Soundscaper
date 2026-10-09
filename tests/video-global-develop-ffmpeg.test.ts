/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';

interface Core {
	FS: { writeFile(name: string, bytes: Uint8Array): void; readFile(name: string): Uint8Array; unlink(name: string): void };
	exec(...args: string[]): number; reset(): void; setLogger(logger: (entry: { message: string }) => void): void;
}
const require = createRequire(import.meta.url);
let core: Core;
test.before(async () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Object.defineProperty(globalThis, 'self', { configurable: true, value: { location: { href: 'file:///ffmpeg-core.js' } } });
	try {
		const create = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
		core = await create({ wasmBinary: await readFile(require.resolve('@ffmpeg/core/wasm')) });
	} finally { if (original) Object.defineProperty(globalThis, 'self', original); else Reflect.deleteProperty(globalThis, 'self'); }
});
const effect = (type: string, params = {}) => createVideoEffect(type, { params });
const SOURCE = [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 255, 224, 16, 255];

// Development/reproducibility FFmpeg graph evidence; this does not invoke production Frame export orchestration.
test('pinned native WASM executes owning generated graphs against independent global byte goldens', () => {
	const fixtures = [
		[effect('white-balance-v1', { temperature: 100 }), [0,32,44,0,90,128,140,1,176,128,92,127,255,224,9,255]],
		[effect('white-balance-v1', { tint: 100 }), [0,20,76,0,76,92,224,1,150,92,150,127,255,164,21,255]],
		[effect('tone-ladder-v1', { exposure: 1 }), [0,47,90,0,90,176,255,1,176,176,176,127,255,255,26,255]],
		[effect('tone-ladder-v1', { contrast: 50 }), [0,0,0,0,0,137,240,1,137,137,137,127,255,255,0,255]],
		[effect('tone-ladder-v1', { highlights: -100 }), [0,32,64,0,64,128,192,1,128,128,128,127,225,207,16,255]],
		[effect('tone-ladder-v1', { shadows: 100 }), [137,140,147,0,147,163,192,1,163,163,163,127,255,224,138,255]],
		[effect('tone-ladder-v1', { whites: -100 }), [0,32,64,0,64,128,192,1,128,128,128,127,225,224,16,255]],
		[effect('tone-ladder-v1', { blacks: 100 }), [137,140,143,0,143,131,192,1,131,131,131,127,255,224,138,255]],
	] as const;
	for (const [recipe, expected] of fixtures) assert.deepEqual(execute(new Uint8Array(SOURCE), [recipe]), expected, recipe.type);
});

test('pinned native WASM agrees byte-exactly for all256 samples, alpha and ordered per-pass quantization', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n, (n * 17) % 256, 255 - n, [0,1,127,255][n % 4]!]).flat());
	for (const effects of [[effect('white-balance-v1')], [effect('tone-ladder-v1')],
		[effect('white-balance-v1', { temperature: 73, tint: -41 })],
		[effect('tone-ladder-v1', { exposure: 0.37, contrast: 29, highlights: -63, shadows: 47, whites: 21, blacks: -33 })],
		[effect('white-balance-v1', { temperature: 100 }), effect('tone-ladder-v1', { exposure: -1 })],
		[effect('tone-ladder-v1', { exposure: -1 }), effect('white-balance-v1', { temperature: 100 })]]) {
		const cpu = await withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 256, height: 1,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source }, effects, signal: new AbortController().signal },
			output => Array.from(output.pixels), { limits: { maximumSidePixels: 256, maximumPixels: 256, maximumBytes: 1024 } });
		assert.deepEqual(execute(source, effects), cpu, JSON.stringify(effects));
	}
});

test('pinned WASM preserves every alpha byte through white balance, tone and both authored orders', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n, (17 * n) % 256, 255 - n, n]).flat());
	const white = () => effect('white-balance-v1', { temperature: 73, tint: -41 });
	const tone = () => effect('tone-ladder-v1', { exposure: 0.37, contrast: 29, highlights: -63, shadows: 47, whites: 21, blacks: -33 });
	for (const effects of [[white()], [tone()], [white(), tone()], [tone(), white()]]) {
		const expected = await withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 256, height: 1,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source }, effects },
			view => [...view.pixels], { limits: { maximumSidePixels: 256, maximumPixels: 256, maximumBytes: 1024 } });
		assert.deepEqual(execute(source, effects), expected, JSON.stringify(effects));
		for (let n = 0; n < 256; n++) assert.equal(expected[n * 4 + 3], n);
	}
});

function execute(source: Uint8Array, effects: readonly unknown[]): number[] {
	const filters: string[] = []; let label = '0:v';
	for (const [i, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `global_${String(i)}`;
		appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width: source.length / 4, height: 1 }); label = next;
	}
	const input = 'global-input.rgba', output = 'global-output.rgba', logs: string[] = [];
	core.FS.writeFile(input, source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try {
		core.reset(); const code = core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(source.length / 4)}x1`,
			'-i', input, ...(filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : ['-map', label]),
			'-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', output);
		assert.equal(code, 0, logs.join('\n')); const bytes = core.FS.readFile(output); assert.equal(bytes.length, source.length); return Array.from(bytes);
	} finally { core.reset(); core.FS.unlink(input); try { core.FS.unlink(output); } catch { /* Native failure may produce no output. */ } }
}
