/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';

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

function pixels(values: number[]) { return new Uint8Array(values.flatMap(value => value === 0 ? [0, 0, 0, 0] : [value, value + 10, value + 20, 255])); }

test('the actual pinned FFmpeg engine renders independent crop, quarter-turn and projective geometry byte goldens', () => {
	const cases = [
		{ width: 4, height: 2, source: pixels([1, 2, 3, 4, 5, 6, 7, 8]), params: { cropX: 0.25, cropWidth: 0.5 }, expected: pixels([0, 2, 3, 0, 0, 6, 7, 0]) },
		{ width: 2, height: 2, source: pixels([1, 2, 3, 4]), params: { rotationDegrees: 90 }, expected: pixels([3, 1, 4, 2]) },
		{ width: 2, height: 2, source: new Uint8Array([0, 10, 20, 255, 100, 110, 120, 255, 50, 60, 70, 255, 150, 160, 170, 255]),
			params: { perspective: 1, bottomRightX: 0.75, bottomLeftX: 0.25 }, expected: new Uint8Array([25, 35, 45, 255, 105, 115, 125, 255, 71, 81, 91, 255, 129, 139, 149, 255]) },
		{ width: 2, height: 1, source: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255]), params: { cropX: 0.25, cropWidth: 0.5 }, expected: new Uint8Array([0, 0, 0, 0, 0, 0, 255, 255]) },
		{ width: 4, height: 1, source: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]),
			params: { cropX: 0.125, cropWidth: 0.5 }, expected: new Uint8Array([0, 0, 0, 0, 0, 0, 255, 128, 0, 128, 128, 255, 0, 0, 0, 0]) },
	];
	for (const [index, fixture] of cases.entries()) {
		const effect = createVideoEffect('develop-geometry-v1', { params: fixture.params }), filters: string[] = [];
		const operations = serializeVideoEffectsToFfmpegOperations([effect]); assert.equal(operations.length, 1);
		appendVideoEffectOperation({ filters, inputLabel: '0:v', outputLabel: 'geometry', operation: operations[0]!, width: fixture.width, height: fixture.height });
		const input = `geometry-${String(index)}.rgba`, output = `geometry-output-${String(index)}.rgba`, logs: string[] = [];
		core.FS.writeFile(input, fixture.source); core.setLogger(({ message }) => { if (logs.length < 64) logs.push(message); });
		try {
			core.reset(); const code = core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${String(fixture.width)}x${String(fixture.height)}`,
				'-i', input, '-filter_complex', filters.join(';'), '-map', '[geometry]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', output);
			assert.equal(code, 0, logs.join('\n'));
			assert.deepEqual(Array.from(core.FS.readFile(output)), Array.from(fixture.expected), `actual FFmpeg geometry case ${String(index)}`);
		} finally { core.FS.unlink(input); try { core.FS.unlink(output); } catch { /* No output exists after native failure. */ } }
	}
});
