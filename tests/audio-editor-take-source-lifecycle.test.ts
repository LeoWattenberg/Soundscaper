/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceLifecycleService } from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import type { SourceLifecycleServiceRuntime } from '../src/common/editor/controller/source/source-lifecycle-service.ts';

for (const operation of ['loadProjectSources', 'ensureProjectSourcesAvailable'] as const) {
	test(`${operation} activates audio referenced only by persistent take lanes`, async () => {
		const { service, providers, project } = fixture();
		await service[operation](project);
		assert.deepEqual([...providers.keys()], ['take-source']);
	});

	test(`${operation} preserves explicit exclusions for take-lane audio`, async () => {
		const { service, providers, project } = fixture();
		await service[operation](project, { excludedAudioSourceIds: ['take-source'] });
		assert.equal(providers.size, 0);
	});
}

test('loading only required audio does not activate unrelated take lanes', async () => {
	const { service, providers, project } = fixture();
	await service.loadProjectSources(project, { onlyRequiredAudioSources: true });
	assert.equal(providers.size, 0);
});

function fixture() {
	const providers = new Map<string, object>();
	const project = {
		id: 'take-project', clips: [],
		sources: [{ id: 'take-source', kind: 'audio' }, { id: 'unused-source', kind: 'audio' }],
		takeGroups: [{ takes: [{ sourceId: 'take-source' }, { sourceId: 'take-source' }] }],
	};
	const buffers = new Map<string, object>();
	const runtime: SourceLifecycleServiceRuntime<object> = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1,
		activateVideoSource: () => undefined,
		allProjectClips: (value) => value.clips,
		audioBufferChannels: () => [],
		clipWaveformPcmRequests: new Map(),
		clipWaveformPcmWindows: new Map(),
		clipSourceWindowRange: (_clip, startFrame, endFrame) => ({ startFrame, endFrame }),
		copy: {},
		createStoredChunkProviderCandidate: () => ({}),
		engine: {},
		findClip: () => null,
		findSource: (value, id) => value.sources.find((source) => source.id === id),
		generateStoredWaveformPeaks: async () => ({}),
		generateWaveformPeaks: async () => ({}),
		getProject: () => project,
		legacyPeakCacheKey: (id) => `legacy:${id}`,
		peakCacheKey: (id) => `peak:${id}`,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async () => { throw new Error('Take audio should stream from storage.'); },
		readWaveformPcmWindow: async () => [],
		setStatus: () => undefined,
		sourceAudioBufferBytes: () => 0,
		sourceBuffers: {
			[Symbol.iterator]: () => buffers[Symbol.iterator](),
			has: (id) => buffers.has(id), get: (id) => buffers.get(id),
			delete: (id) => buffers.delete(id),
			setIfFits: (id, buffer) => { buffers.set(id, buffer); return true; },
		},
		sourceChunkProviders: providers,
		sourcePcmBytes: () => 2,
		sourcePeaks: new Map(),
		state: { missingSourceIds: new Set() },
		store: {
			getSourceMetadata: async () => ({}), loadAnalysis: async () => ({}),
			saveAnalysis: async () => undefined,
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	};
	return { service: createSourceLifecycleService(runtime), providers, project };
}
