/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedExactRenderRgbaFrameV13 } from '../src/common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

const LIVE = new AbortController().signal;
const modes = [[], [createVideoEffect('white-balance-v1', { enabled: false })],
	[createVideoEffect('develop-geometry-v1', { enabled: false })], [createVideoEffect('color-adjust', { enabled: false })]];
const frame = () => ({ width: 1, height: 1, pixels: new Uint8Array([90, 128, 140, 127]) });

test('empty and disabled Frame routes admit closed bounded source state before cloning or browser resources', async () => {
	let reads = 0, resources = 0;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, get() { resources++; throw Error('resource before admission'); } });
	try {
		for (const effects of modes) {
			const accessor = Object.defineProperty(frame(), 'width', { enumerable: true, get() { reads++; return 1; } });
			for (const value of [accessor, { ...frame(), future: true }, { ...frame(), width: 0 },
				{ ...frame(), width: 65_537 }, { ...frame(), pixels: new Uint8Array(3) }]) {
				await assert.rejects(applyVideoExactBrowserEffectsFinishing(value as UnifiedExactRenderRgbaFrameV13, effects, LIVE));
			}
		}
	} finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
	assert.equal(reads, 0); assert.equal(resources, 0);
});

test('empty Frame output is a detached straight-alpha copy within the admitted geometry', async () => {
	const input = frame(), output = await applyVideoExactBrowserEffectsFinishing(input, [], LIVE);
	assert.deepEqual([...output.pixels], [90, 128, 140, 127]); assert.notEqual(output.pixels.buffer, input.pixels.buffer);
	input.pixels.fill(0); assert.deepEqual([...output.pixels], [90, 128, 140, 127]);
});
