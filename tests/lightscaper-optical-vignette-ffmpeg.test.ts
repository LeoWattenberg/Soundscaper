/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { independentOpticalByte } from './helpers/lightscaper-optical-vignette-oracle.ts';

interface Core {
	FS: { writeFile(name: string, bytes: Uint8Array): void; readFile(name: string): Uint8Array; unlink(name: string): void };
	exec(...args: string[]): number; reset(): void; setLogger(listener: (entry: { message: string }) => void): void;
}
let core: Core;
test.before(async () => {
	const require = createRequire(import.meta.url), previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Object.defineProperty(globalThis, 'self', { configurable: true, value: { location: { href: 'file:///ffmpeg-core.js' } } });
	try {
		const create = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
		core = await create({ wasmBinary: await readFile(require.resolve('@ffmpeg/core/wasm')) });
	} finally { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); }
});
const optical = (amount: number, enabled = true) => createVideoEffect('optical-vignette-v1', { id: 'optical-delivery', enabled, params: { amount } });

test('Light optical vignette actual pinned FFmpeg and Frame CPU deliver independent linear-gain literals with exact alpha', async () => {
	const source = Uint8Array.of(64, 32, 16, 128, 64, 32, 16, 255, 64, 32, 16, 1), before = source.slice();
	for (const [amount, side] of [[100, [84, 44, 24]], [-100, [48, 23, 10]]] as const) {
		const effect = optical(amount), expected = [...side, 128, 64, 32, 16, 255, ...side, 1];
		assert.deepEqual(execute(source, 3, [effect]), expected);
		const output = await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...output.pixels], expected); } finally { output.pixels.fill(0); }
	}
	assert.deepEqual(source, before);
});

test('Light optical vignette actual delivery matches an independent exponential-distance oracle across signed fractional controls and varied alpha', async () => {
	const width = 7, height = 5, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => {
		const p = Math.floor(i / 4); return (p === 0 ? [193, 71, 109, 0] : [p * 31 % 256, p * 17 % 256, p * 53 % 256, p * 41 % 256])[i % 4]!;
	}), before = source.slice();
	for (const amount of [100, -100, 37.125, -63.875, 0]) {
		const effect = optical(amount), expected = independentOpticalByte([...source], width, amount);
		assert.deepEqual(execute(source, width, [effect]), expected, `FFmpeg amount${String(amount)}`);
		const output = await applyVideoExactBrowserEffectsFinishing({ width, height, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...output.pixels], expected); } finally { output.pixels.fill(0); }
		assert.deepEqual(expected.slice(0, 4), [...source.slice(0, 4)]);
		for (let i = 3; i < source.length; i += 4) assert.equal(expected[i], source[i]);
	}
	assert.deepEqual(execute(source, width, [optical(100, false)]), [...source]); assert.deepEqual(source, before);
});

function execute(source: Uint8Array, width: number, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [index, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `optical_${String(index)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width, height: source.length / (4 * width) }); label = next;
	}
	core.FS.writeFile('optical.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try {
		core.reset(); const graph = filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : [];
		assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(width)}x${String(source.length / (4 * width))}`,
			'-i', 'optical.rgba', ...graph, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'optical-out.rgba'), 0, logs.join('\n'));
		const output = core.FS.readFile('optical-out.rgba'); assert.equal(output.length, source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('optical.rgba'); try { core.FS.unlink('optical-out.rgba'); } catch { /* A refused encoder may not create output. */ } }
}
