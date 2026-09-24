/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFrequencyWaveformRuntime,
	type FrequencyWaveformRuntimeInputs,
} from '../src/common/editor/controller/source/frequency-waveform-runtime-composition.ts';
import type { FrequencyWaveformRuntimeEntry } from '../src/common/editor/controller/source/frequency-waveform-source-service.ts';
import type { FrequencyWaveformRuntimeWindowEntry } from '../src/common/editor/controller/source/frequency-waveform-window-service.ts';
import type { SourceRuntimeProject } from '../src/common/editor/controller/source/source-runtime-composition-types.ts';

const PCM = new Float32Array(4_096);
const PROJECT: SourceRuntimeProject = Object.freeze({
	id: 'project', schemaVersion: 21,
	sources: [{ id: 'source', kind: 'audio', storageKey: 'stored-source',
		frameCount: PCM.length, channelCount: 1, sampleRate: 48_000 }],
	clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
		sourceStartFrame: 0, durationFrames: 1_024 }],
	tracks: [],
});

function createFixture(
	deleteAnalysis: (key: string) => Promise<void> = async () => undefined,
	project: SourceRuntimeProject | null = null,
	bufferedSource = false,
) {
	const deleted: string[] = [];
	const analyses = new Map<string, FrequencyWaveformRuntimeEntry>();
	const windows = new Map<string, FrequencyWaveformRuntimeWindowEntry>();
	const bypass = new Set<string>();
	let publishes = 0;
	let storedReads = 0;
	const inputs: FrequencyWaveformRuntimeInputs = {
		getProject: () => project,
		publishDocumentSnapshot: () => { publishes += 1; },
		// Node has no AudioBuffer constructor; the runtime reads these two methods.
		sourceBuffers: bufferedSource ? new Map<string, AudioBuffer>([['source', {
			numberOfChannels: 1,
			getChannelData: () => PCM,
		} as unknown as AudioBuffer]]) : new Map<string, AudioBuffer>(),
		sourceFrequencyAnalyses: analyses,
		sourceFrequencyWindows: windows,
		persistentCacheBypassSourceIds: bypass,
		store: {
			async *readSourceChunks() {
				storedReads += 1;
				yield { channels: [PCM], frames: PCM.length };
			},
			loadAnalysis: async () => null,
			saveAnalysis: async () => undefined,
			deleteAnalysis: async (key) => {
				deleted.push(key);
				await deleteAnalysis(key);
			},
		},
		requestPcmWindow: async (clipId, options) => project ? {
			clipId,
			sourceId: 'source',
			startFrame: 0,
			endFrame: PCM.length,
			visibleStartFrame: options.startFrame,
			visibleEndFrame: options.endFrame,
			channels: [PCM],
		} : null,
	};
	return {
		runtime: createFrequencyWaveformRuntime(inputs),
		analyses,
		windows,
		bypass,
		deleted,
		publishes: () => publishes,
		storedReads: () => storedReads,
	};
}

test('cold spectral invalidation removes only the changed source and its persisted analysis', async () => {
	const fixture = createFixture();
	fixture.analyses.set('changed', { projectId: 'project', storageKey: 'changed', analysis: null! });
	fixture.windows.set('changed-clip', { sourceId: 'changed' } as FrequencyWaveformRuntimeWindowEntry);
	fixture.windows.set('other-clip', { sourceId: 'other' } as FrequencyWaveformRuntimeWindowEntry);

	await fixture.runtime.invalidateSource('changed');

	assert.equal(fixture.analyses.has('changed'), false);
	assert.equal(fixture.windows.has('changed-clip'), false);
	assert.equal(fixture.windows.has('other-clip'), true);
	assert.equal(fixture.publishes(), 1);
	assert.deepEqual(fixture.deleted, ['audio-editor-frequency-waveform-v1:changed']);
	assert.equal(fixture.bypass.has('changed'), false);
});

test('failed persistent invalidation keeps the source bypassed across lazy requests and runtime clearing', async () => {
	const fixture = createFixture(async () => { throw new Error('cache unavailable'); });

	await fixture.runtime.invalidateSource('changed');
	assert.equal(fixture.bypass.has('changed'), true);
	assert.equal(await fixture.runtime.requestFrequencyWaveform('missing'), null);
	assert.equal(await fixture.runtime.requestFrequencyWaveform('missing', {
		startFrame: 0,
		endFrame: 8,
	}), null);
	fixture.runtime.clearRuntime();
	assert.equal(fixture.bypass.has('changed'), true);
	assert.equal(fixture.publishes(), 0);
});

test('runtime clearing drops resident spectral maps and allows a later source request', async () => {
	const fixture = createFixture();
	fixture.windows.set('old-clip', { sourceId: 'old' } as FrequencyWaveformRuntimeWindowEntry);
	await fixture.runtime.requestFrequencyWaveform('missing');
	await fixture.runtime.requestFrequencyWaveform('missing', { startFrame: 0, endFrame: 8 });

	fixture.runtime.clearRuntime();

	assert.equal(fixture.windows.size, 0);
	assert.equal(fixture.analyses.size, 0);
	assert.equal(await fixture.runtime.requestFrequencyWaveform('missing'), null);
});

test('lazy spectral runtime generates a source and visible window, then invalidates both', async () => {
	const fixture = createFixture(async () => undefined, PROJECT);

	const analysis = await fixture.runtime.requestFrequencyWaveform('clip');
	assert.equal(analysis?.frameCount, PCM.length);
	assert.equal(fixture.analyses.get('source')?.analysis, analysis);
	const window = await fixture.runtime.requestFrequencyWaveform('clip', {
		startFrame: 16, endFrame: 32,
	});
	assert.ok(window && 'startFrame' in window);
	assert.equal(window?.startFrame, 16);
	assert.equal(window?.frameCount, 16);
	assert.equal(fixture.windows.get('clip')?.window, window);

	await fixture.runtime.invalidateSource('source');
	assert.equal(fixture.analyses.size, 0);
	assert.equal(fixture.windows.size, 0);
	assert.deepEqual(fixture.deleted, ['audio-editor-frequency-waveform-v1:source']);
});

test('lazy spectral runtime analyzes a resident PCM buffer without reading stored chunks', async () => {
	const fixture = createFixture(async () => undefined, PROJECT, true);

	const analysis = await fixture.runtime.requestFrequencyWaveform('clip');

	assert.equal(analysis?.frameCount, PCM.length);
	assert.equal(fixture.storedReads(), 0);
	assert.equal(fixture.analyses.get('source')?.analysis, analysis);
});
