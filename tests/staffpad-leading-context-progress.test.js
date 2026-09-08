/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createStaffPadChangePitchTransform,
	loadStaffPadWasm,
	renderStaffPad,
} from '../src/common/editor/staffpad/index.js';

const WASM_PATH = new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url);

test('StaffPad reports progress while discarding leading selection context', async () => {
	const runtime = await loadStaffPadWasm(await readFile(WASM_PATH));
	const events = [];
	await renderStaffPad({
		channels: [Float32Array.from({ length: 8_192 }, (_, frame) => Math.sin(frame / 20))],
		sampleRate: 8_000,
		selection: { startFrame: 6_144, frameCount: 2_048 },
		transform: createStaffPadChangePitchTransform({ cents: 700, preserveFormants: false }),
		chunkFrames: 1_024,
	}, runtime, {
		onChunk() { events.push({ type: 'chunk' }); },
		onProgress(progress) { events.push({ type: 'progress', progress }); },
	});

	const firstChunk = events.findIndex(({ type }) => type === 'chunk');
	assert.ok(firstChunk > 0);
	assert.ok(events.slice(0, firstChunk).some(({ progress }) => progress > 0.5));
});
