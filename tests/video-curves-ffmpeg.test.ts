/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';

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
const inversion = () => createVideoEffect('point-curves-v1', { params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
const shadows = () => createVideoEffect('parametric-curves-v1', { params: { masterShadows: 100 } });

test('actual pinned WASM curve graphs preserve literal independent point/parametric byte goldens and every alpha value', () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n, n, n, n]).flat());
	assert.deepEqual(execute(source, [inversion()]), Array.from({ length: 256 }, (_, n) => [255 - n, 255 - n, 255 - n, n]).flat());
	// Default shadows has knots (0,0), (1/8,1/4), (3/8,3/8), followed by identity.
	assert.deepEqual(execute(source, [shadows()]), Array.from({ length: 256 }, (_, n) => {
		const byte = n <= 31 ? 2 * n : n <= 95 ? Math.floor(n / 2 + 48.3125) : n; return [byte, byte, byte, n];
	}).flat());
	assert.deepEqual(execute(new Uint8Array([0, 32, 64, 1, 128, 192, 255, 127]), [inversion(), shadows()]), [255, 223, 191, 1, 127, 79, 0, 127]);
	assert.deepEqual(execute(new Uint8Array([0, 32, 64, 1, 128, 192, 255, 127]), [shadows(), inversion()]), [255, 191, 175, 1, 127, 63, 0, 127]);
});

test('pinned WASM follows exact Float64 knots, fractional splits and both ordered chains through the shared CPU owner', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n, (n * 17) % 256, 255 - n, n]).flat());
	const point = () => createVideoEffect('point-curves-v1', { params: { master: Array.from({ length: 32 }, (_, n) => ({ x: n / 31, y: ((n * 17) % 32) / 31 })),
		red: [{ x: 0, y: 0.2 }, { x: 0.5, y: 0.1 }, { x: 0.5000000000000001, y: 0.9 }, { x: 1, y: 0.3 }] } });
	const parametric = () => createVideoEffect('parametric-curves-v1', { params: { masterShadows: 33.3, masterDarks: -73.25,
		greenLights: -37.125, blueHighlights: 12.5, shadowSplit: 0.1, midtoneSplit: 0.6, highlightSplit: 0.9 } });
	const tone = () => createVideoEffect('tone-ladder-v1', { params: { exposure: 0.37 } });
	for (const effects of [[point()], [parametric()], [point(), parametric()], [parametric(), point()], [tone(), point(), parametric()], [parametric(), tone(), point()]]) {
		const expected = await withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 256, height: 1,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source }, effects }, view => [...view.pixels],
		{ limits: { maximumSidePixels: 256, maximumPixels: 256, maximumBytes: 1024 } });
		assert.deepEqual(execute(source, effects), expected);
		for (let n = 0; n < 256; n++) assert.equal(expected[n * 4 + 3], n);
	}
});

function execute(source: Uint8Array, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [n, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `curve_${String(n)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width: source.length / 4, height: 1 }); label = next;
	}
	core.FS.writeFile('curve.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(source.length / 4)}x1`, '-i', 'curve.rgba',
		'-filter_complex', filters.join(';'), '-map', `[${label}]`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'curve-out.rgba'), 0, logs.join('\n'));
		const output = core.FS.readFile('curve-out.rgba'); assert.equal(output.length, source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('curve.rgba'); try { core.FS.unlink('curve-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
