/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('preview output shares the listening gain and keeps changes live during an audition', async () => {
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	try {
		await engine.getAudioContext();
		engine.setPlaybackGain(0);
		const output = engine.getPlaybackDestination();
		const node = output as unknown as Readonly<{ gain: { value: number }; connections: unknown[] }>;
		assert.equal(node.gain.value, 0);
		assert.equal(node.connections[0], context.destination);
		assert.equal(engine.getPlaybackDestination(), output);
		engine.setPlaybackGain(0.25);
		assert.equal(node.gain.value, 0.25);
	} finally {
		await engine.dispose();
	}
});
