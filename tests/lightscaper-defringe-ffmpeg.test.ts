/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

import { independentDefringeEncoded } from './helpers/lightscaper-defringe-oracle.ts';

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
const defringe = (purple: number, green = 0, edgeThreshold = 25, enabled = true) => createVideoEffect('defringe-v1', { id: 'delivery-defringe', enabled, params: { purple, green, edgeThreshold } });

test('Lightscaper defringe actual pinned FFmpeg and Frame CPU suppress purple and green edge literals while retaining exact alpha', async () => {
	for (const [color, params, expected] of [[[255, 0, 255], [100, 0], 73], [[0, 255, 0], [0, 100], 182]] as const) {
		const source = Uint8Array.of(0, 0, 0, 255, ...color, 128, 255, 255, 255, 255), before = source.slice();
		const effect = defringe(params[0], params[1]), result = [0, 0, 0, 255, expected, expected, expected, 128, 255, 255, 255, 255];
		assert.deepEqual(execute(source, 3, [effect]), result);
		const frame = await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...frame.pixels], result); } finally { frame.pixels.fill(0); }
		assert.deepEqual(source, before);
	}
});

test('Lightscaper defringe actual delivery matches an independent source-multiplicity oracle across controls and alpha support', async () => {
	const width = 7, height = 5, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => {
		const pixel = Math.floor(i / 4); return (pixel === 0 ? [193, 71, 109, 0] : [pixel * 31 % 256, pixel * 17 % 256, pixel * 53 % 256, pixel * 41 % 256])[i % 4]!;
	}), before = source.slice();
	for (const [purple, green, threshold] of [[100, 100, 0], [100, 0, 25], [0, 100, 12.5], [37.5, 62.5, 10.25]] as const) {
		const effect = defringe(purple, green, threshold), expected = independentDefringeEncoded([...source].map(value => value / 255), width, purple, green, threshold).map(value => Math.round(255 * value));
		assert.deepEqual(execute(source, width, [effect]), expected, `FFmpeg ${String(purple)}/${String(green)}/${String(threshold)}`);
		const frame = await applyVideoExactBrowserEffectsFinishing({ width, height, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...frame.pixels], expected); } finally { frame.pixels.fill(0); }
		for (let i = 3; i < source.length; i += 4) assert.equal(expected[i], source[i]);
		assert.deepEqual(expected.slice(0, 4), [...source.slice(0, 4)]);
	}
	for (const effect of [defringe(0, 0), defringe(100, 100, 100), defringe(100, 100, 0, false)]) assert.deepEqual(execute(source, width, [effect]), [...source]);
	assert.deepEqual(source, before);
});

function execute(source: Uint8Array, width: number, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [index, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `defringe_${String(index)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width, height: source.length / (4 * width) }); label = next;
	}
	core.FS.writeFile('defringe.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try {
		core.reset(); const graph = filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : [];
		assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(width)}x${String(source.length / (4 * width))}`,
			'-i', 'defringe.rgba', ...graph, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'defringe-out.rgba'), 0, logs.join('\n'));
		const output = core.FS.readFile('defringe-out.rgba'); assert.equal(output.length, source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('defringe.rgba'); try { core.FS.unlink('defringe-out.rgba'); } catch { /* A refused encoder may not create output. */ } }
}
