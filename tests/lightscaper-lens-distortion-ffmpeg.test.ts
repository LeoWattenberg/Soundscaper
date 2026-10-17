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
const lens = (amount: number, enabled = true) => createVideoEffect('lens-distortion-v1', { id: 'delivery-lens', enabled, params: { amount } });

test('Lightscaper shared lens actual FFmpeg and Frame CPU paths preserve independent three-pixel transparent-support literals', async () => {
	const source = Uint8Array.of(255, 0, 0, 255, 0, 128, 255, 128, 32, 200, 16, 64), before = source.slice();
	const expected = [255, 0, 0, 224, 0, 128, 255, 128, 32, 200, 16, 56];
	assert.deepEqual(execute(source, 3, [lens(100)]), expected);
	const frame = await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels: source }, [lens(100)], new AbortController().signal);
	try { assert.deepEqual([...frame.pixels], expected); } finally { frame.pixels.fill(0); }
	assert.deepEqual(source, before);
});

test('Lightscaper shared radial export matches exact rational coordinate/alpha arithmetic across signed and fractional amounts', async () => {
	const width = 9, source = Uint8Array.from({ length: width * 7 * 4 }, (_, i) => {
		const pixel = Math.floor(i / 4); return [pixel * 31 % 256, pixel * 17 % 256, pixel * 53 % 256, pixel * 41 % 256][i % 4]!;
	}), before = source.slice();
	for (const [numerator, denominator] of [[100, 1], [-100, 1], [297, 8], [-45, 2]] as const) {
		const effect = lens(numerator / denominator), expected = rational(source, width, numerator, denominator);
		assert.deepEqual(execute(source, width, [effect]), expected, `FFmpeg amount ${String(numerator / denominator)}`);
		const frame = await applyVideoExactBrowserEffectsFinishing({ width, height: 7, pixels: source }, [effect], new AbortController().signal);
		try { assert.deepEqual([...frame.pixels], expected, `CPU amount ${String(numerator / denominator)}`); } finally { frame.pixels.fill(0); }
	}
	assert.deepEqual(execute(source, width, [lens(0)]), [...source]);
	assert.deepEqual(execute(source, width, [lens(100, false)]), [...source]); assert.deepEqual(source, before);
});

// Independent integer derivation: dx/dy are doubled center displacements.
// Every source coordinate has denominator2000*q*(w²+h²). Four rational
// bilinear tap weights then give exact alpha and straight RGB rounding.
function rational(source: Uint8Array, width: number, p: number, q: number): number[] {
	const height = source.length / (width * 4), d = BigInt(2000 * q * (width * width + height * height)), d2 = d * d;
	const floor = (n: bigint) => n >= 0n ? n / d : -((-n + d - 1n) / d);
	const round = (n: bigint, denominator: bigint) => Number((2n * n + denominator) / (2n * denominator));
	const result: number[] = [];
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const dx = 2 * x + 1 - width, dy = 2 * y + 1 - height, radius = dx * dx + dy * dy;
		const sx = BigInt(x) * d + BigInt(dx * p * 3 * radius), sy = BigInt(y) * d + BigInt(dy * p * 3 * radius);
		const ix = floor(sx), iy = floor(sy), fx = sx - ix * d, fy = sy - iy * d;
		let alpha = 0n; const rgb = [0n, 0n, 0n];
		for (let yy = 0; yy <= 1; yy++) for (let xx = 0; xx <= 1; xx++) {
			const px = Number(ix) + xx, py = Number(iy) + yy; if (px < 0 || px >= width || py < 0 || py >= height) continue;
			const offset = (py * width + px) * 4, a = BigInt(source[offset + 3]!) * (xx ? fx : d - fx) * (yy ? fy : d - fy);
			alpha += a; for (let c = 0; c < 3; c++) rgb[c] = rgb[c]! + BigInt(source[offset + c]!) * a;
		}
		const a = round(alpha, d2); result.push(...(a === 0 ? [0, 0, 0, 0] : [...rgb.map(n => round(n, alpha)), a]));
	}
	return result;
}

function execute(source: Uint8Array, width: number, effects: readonly unknown[]): number[] {
	const filters: string[] = [], logs: string[] = []; let label = '0:v';
	for (const [index, operation] of serializeVideoEffectsToFfmpegOperations(effects).entries()) {
		const next = `lens_${String(index)}`; appendVideoEffectOperation({ filters, inputLabel: label, outputLabel: next, operation, width, height: source.length / (4 * width) }); label = next;
	}
	core.FS.writeFile('lens.rgba', source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
	try {
		core.reset(); const graph = filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : [];
		assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(width)}x${String(source.length / (4 * width))}`,
			'-i', 'lens.rgba', ...graph, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'lens-out.rgba'), 0, logs.join('\n'));
		const output = core.FS.readFile('lens-out.rgba'); assert.equal(output.length, source.length); return [...output];
	} finally { core.reset(); core.FS.unlink('lens.rgba'); try { core.FS.unlink('lens-out.rgba'); } catch { /* A refused encoder may not create output. */ } }
}
