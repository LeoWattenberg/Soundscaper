/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

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
const correction = (red: number, blue: number, enabled = true) => createVideoEffect('chromatic-aberration-v1', { id: 'delivery-ca', enabled, params: { red, blue } });

test('Lightscaper chromatic correction actual FFmpeg and Frame CPU paths preserve independent channel and fixed-alpha literals', async () => {
	const source = Uint8Array.of(0, 0, 0, 255, 200, 200, 200, 255, 0, 0, 0, 255), before = source.slice();
	const expected = [1, 0, 0, 255, 200, 200, 200, 255, 1, 0, 0, 255];
	assert.deepEqual(execute(source, 3, [correction(-100, 100)]), expected);
	const frame = await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels: source }, [correction(-100, 100)], new AbortController().signal);
	try { assert.deepEqual([...frame.pixels], expected); } finally { frame.pixels.fill(0); }
	assert.deepEqual(source, before);
});

test('Lightscaper chromatic export matches exact rational per-channel alpha arithmetic across signed, fractional and zero controls', async () => {
	const width = 9, source = Uint8Array.from({ length: width * 7 * 4 }, (_, i) => {
		const pixel = Math.floor(i / 4); return (pixel === 0 ? [193, 71, 109, 0] : [pixel * 31 % 256, pixel * 17 % 256, pixel * 53 % 256, pixel * 41 % 256])[i % 4]!;
	}), before = source.slice();
	for (const [red, blue] of [[100, -100], [-100, 100], [37.125, -22.5], [0, 100], [-100, 0]] as const) {
		const effect = correction(red, blue), expected = rational(source, width, red, blue);
		assert.deepEqual(execute(source, width, [effect]), expected, `FFmpeg R${String(red)} B${String(blue)}`);
		const frame = await applyVideoExactBrowserEffectsFinishing({ width, height: 7, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...frame.pixels], expected, `CPU R${String(red)} B${String(blue)}`); } finally { frame.pixels.fill(0); }
		for (let i = 0; i < source.length; i += 4) { assert.equal(expected[i + 1], source[i + 1]); assert.equal(expected[i + 3], source[i + 3]); }
	}
	assert.deepEqual(execute(source, width, [correction(0, 0)]), [...source]);
	assert.deepEqual(execute(source, width, [correction(100, -100, false)]), [...source]); assert.deepEqual(source, before);
});

test('Lightscaper tiny nonzero controls reconstruct transparent support even when derived coefficients underflow', async () => {
	const source = Uint8Array.of(47, 31, 7, 0), expected = [0, 31, 7, 0];
	for (const amount of [Number.MIN_VALUE, 1e-40]) {
		const effect = correction(amount, 0);
		assert.deepEqual(execute(source, 1, [effect]), expected);
		const frame = await applyVideoExactBrowserEffectsFinishing({ width: 1, height: 1, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...frame.pixels], expected); } finally { frame.pixels.fill(0); }
	}
});

test('Lightscaper authoritative CPU and FFmpeg retain tiny channel motion through transparent edge and diagonal support', async () => {
	for (const count of [3, 9]) {
		const source = Uint8Array.from({ length: count * 4 }, (_, i) => [47, 31, 7, 0][i % 4]!);
		source.set([255, 11, 70, 255], Math.floor(count / 2) * 4);
		const expected = [...source].map((value, index) => index % 4 === 0 ? 255 : value);
		for (const amount of [-1e-12, -1e-20]) {
			const effect = correction(amount, 0);
			assert.deepEqual(execute(source, 3, [effect]), expected);
			const frame = await applyVideoExactBrowserEffectsFinishing({ width: 3, height: count / 3, pixels: source }, [effect], new AbortController().signal);
			try { assert.deepEqual([...frame.pixels], expected); } finally { frame.pixels.fill(0); }
		}
	}
});

// Independently derived rational source-index coordinates: dx/dy are doubled
// center displacements; amount is represented in eighths for this corpus.
// Each R/B channel normalizes its own alpha-weighted support. G/A stay exact.
function rational(source: Uint8Array, width: number, red: number, blue: number): number[] {
	const height = source.length / (width * 4), d = BigInt(20_000 * 8 * (width * width + height * height));
	const floor = (n: bigint) => n >= 0n ? n / d : -((-n + d - 1n) / d);
	const round = (n: bigint, denominator: bigint) => Number((2n * n + denominator) / (2n * denominator));
	const result = [...source];
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (const [channel, amount] of [[0, red], [2, blue]] as const) {
		if (amount === 0) continue;
		const dx = 2 * x + 1 - width, dy = 2 * y + 1 - height, radius = dx * dx + dy * dy, p = amount * 8;
		const sx = BigInt(x) * d + BigInt(dx * p * radius), sy = BigInt(y) * d + BigInt(dy * p * radius);
		const ix = floor(sx), iy = floor(sy), fx = sx - ix * d, fy = sy - iy * d;
		let alpha = 0n, color = 0n;
		for (let yy = 0; yy <= 1; yy++) for (let xx = 0; xx <= 1; xx++) {
			const px = Number(ix) + xx, py = Number(iy) + yy; if (px < 0 || px >= width || py < 0 || py >= height) continue;
			const offset = (py * width + px) * 4, a = BigInt(source[offset + 3]!) * (xx ? fx : d - fx) * (yy ? fy : d - fy);
			alpha += a; color += BigInt(source[offset + channel]!) * a;
		}
		result[(y * width + x) * 4 + channel] = alpha === 0n ? 0 : round(color, alpha);
	}
	return result;
}

function execute(source: Uint8Array, width: number, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [index, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `chroma_${String(index)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width, height: source.length / (4 * width) }); label = next;
	}
	core.FS.writeFile('chroma.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try {
		core.reset(); const graph = filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : [];
		assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(width)}x${String(source.length / (4 * width))}`,
			'-i', 'chroma.rgba', ...graph, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'chroma-out.rgba'), 0, logs.join('\n'));
		const output = core.FS.readFile('chroma-out.rgba'); assert.equal(output.length, source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('chroma.rgba'); try { core.FS.unlink('chroma-out.rgba'); } catch { /* A refused encoder may not create output. */ } }
}
