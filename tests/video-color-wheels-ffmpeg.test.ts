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
const wheel = (params: Readonly<Record<string, number>>) => createVideoEffect('color-wheels-v1', { id: 'wheel', params });

test('actual pinned WASM wheel GEQ preserves literal scalar primaries, mixed-rounding divergence and exact straight alpha', () => {
	assert.deepEqual(execute(new Uint8Array([0,0,0,1,128,128,128,127,0,255,255,0]), [wheel({ shadowsHue: 0, shadowsSaturation: 100 })]),
		[123,0,0,1,172,112,112,127,123,249,249,0]);
	assert.equal(execute(new Uint8Array([8,0,255,77]), [wheel({ highlightsLuminance: -9.310940439148165 })])[0], 8);
	assert.equal(execute(new Uint8Array([8,255,0,77]), [wheel({ highlightsLuminance: 8.74628412503394 })])[0], 9);
	assert.deepEqual(execute(new Uint8Array([0,0,0,1,128,128,128,127]),
		[wheel({ shadowsLuminance: 25 }), createVideoEffect('color-wheels-v1', { id: 'gamma', params: { midtonesLuminance: 100 } })]), [137,137,137,1,192,192,192,127]);
});

test('pinned WASM follows all256 shared scalar samples, every alpha and ordered mixed tone/wheel chains', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n, (n * 17) % 256, 255 - n, n]).flat());
	const hue = () => wheel({ shadowsHue: -179.125, shadowsSaturation: 100, shadowsLuminance: -37.5, midtonesHue: 45,
		midtonesSaturation: 78.125, midtonesLuminance: 33.3, highlightsHue: 120.01, highlightsSaturation: 50, highlightsLuminance: -100 });
	const tone = () => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 0.37 } });
	for (const effects of [[hue()], [tone(), hue()], [hue(), tone()]]) {
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
		const next = `wheel_${String(n)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width: source.length / 4, height: 1 }); label = next;
	}
	core.FS.writeFile('wheel.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try { core.reset(); assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(source.length / 4)}x1`, '-i', 'wheel.rgba',
		'-filter_complex', filters.join(';'), '-map', `[${label}]`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'wheel-out.rgba'), 0, logs.join('\n'));
		const output = core.FS.readFile('wheel-out.rgba'); assert.equal(output.length, source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('wheel.rgba'); try { core.FS.unlink('wheel-out.rgba'); } catch { /* Refused output can be absent. */ } }
}
