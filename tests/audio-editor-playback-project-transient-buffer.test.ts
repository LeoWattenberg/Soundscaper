/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCanonicalProjectToPlaybackEngine } from
	'../src/common/editor/controller/playback-project-service.ts';
import { createPreparedProjectSources } from
	'../src/common/editor/controller/prepared-project-sources.ts';

test('track-render fallback reapply forwards uncached native source buffers', async () => {
	const canonical = Object.freeze({ id: 'track-fallback' });
	const fallback = Object.freeze({ kind: 'fallback-buffer' });
	const dry = Object.freeze({ kind: 'large-native-buffer' });
	const sourceBuffers = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>();
	const prepared = createPreparedProjectSources({
		prepared: new Map([['fallback-source', { kind: 'buffer', value: fallback }]]),
		sourceBuffers,
		sourceChunkProviders,
		cacheSourceBuffer: (sourceId, buffer) => sourceBuffers.set(sourceId, buffer),
		throwIfAborted: (signal) => signal?.throwIfAborted(),
	});
	let applied = false;
	const result = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: () => ({
			project: canonical,
			featureRequirementsReport: null,
			audioEffectPlaybackBypass: null,
			audioRenderedFallback: { role: 'audio-track-render-v1' },
			videoEffectPlaybackBypass: null,
			videoRenderedFallback: null,
			requiredAudioSourceIds: ['fallback-source'],
			requiredVideoSourceIds: [],
		}) as never,
		getCurrentProject: () => canonical,
		prepareRequiredProjectSources: async () => prepared,
		ensureProjectSourcesAvailable: async (_project, options) => {
			assert.deepEqual(options.excludedAudioSourceIds, ['fallback-source']);
			return new Map([['dry-source', dry]]);
		},
		sourceBuffers,
		sourceChunkProviders,
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			stop() {},
			applyProject(_project, buffers) {
				applied = true;
				assert.strictEqual(buffers.get('fallback-source'), fallback);
				assert.strictEqual(buffers.get('dry-source'), dry);
			},
		},
		setReadyStatus() {},
	});
	assert.equal(result, true);
	assert.equal(applied, true);
});
