/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';

test('engine reports the actual realtime and exact-offline warp facilities it owns', async () => {
	const realtime = createAudioEditorEngine({
		audioContextFactory: (() => undefined) as never,
		offlineAudioContextFactory: (() => undefined) as never,
	});
	assert.deepEqual(realtime.getAudioWarpRenderStatus(), {
		path: 'realtime', realtimeAcceleration: true, exactOfflineAvailable: true, fallback: false,
	});
	await realtime.dispose();

	const fallback = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: (() => undefined) as never,
	});
	assert.deepEqual(fallback.getAudioWarpRenderStatus(), {
		path: 'exact-offline', realtimeAcceleration: false, exactOfflineAvailable: true, fallback: true,
	});
	await fallback.dispose();
});

test('engine fails closed when neither exact warp runtime exists', async () => {
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
	});
	assert.throws(() => engine.getAudioWarpRenderStatus(), /exact offline/iu);
	await engine.dispose();
});
