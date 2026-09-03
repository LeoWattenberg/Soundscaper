/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDerivedSourceService,
} from '../src/common/editor/controller/derived-source-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import type {
	ControllerProject,
	ControllerSource,
} from '../src/common/editor/controller/track-domain-types.ts';

test('derived-source rollback attempts every deletion and aggregates source-store failures', async () => {
	const firstFailure = new Error('first source deletion failed');
	const secondFailure = new Error('second source deletion failed');
	const events: string[] = [];
	const sourceBuffers = new Map<string, AudioBufferLike>([
		['first', buffer()],
		['second', buffer()],
	]);
	const sourcePeaks = new Map<string, unknown>([
		['first', {}],
		['second', {}],
	]);
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		store: {
			beginSourceWrite: async () => assert.fail('No source write expected.'),
			saveAnalysis: async () => undefined,
			deleteAnalysis: async (key) => { events.push(`analysis:${key}`); },
			deleteSource: async (sourceId) => {
				events.push(`source:${sourceId}`);
				throw sourceId === 'first' ? firstFailure : secondFailure;
			},
		},
		sourceBuffers,
		sourcePeaks,
		sourceChunkFrames: 65_536,
		retireSourceChunkProvider: async (sourceId) => { events.push(`retire:${sourceId}`); },
		getProject: project,
		captureProject: () => ({ generation: 1, projectId: 'project' }),
		assertProject() {},
		createId: () => 'unused',
		projectSampleRate: () => 48_000,
		getAudioContext: async () => assert.fail('No audio context expected.'),
		createBufferFromChannels: async () => assert.fail('No audio buffer expected.'),
		loadSourceChannels: async () => assert.fail('No source load expected.'),
		writeBuffer: async () => assert.fail('No buffer write expected.'),
		generateWaveformPeaks: async () => assert.fail('No peak generation expected.'),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer() {},
	});

	await assert.rejects(
		() => service.rollbackDerivedSources([{ source: source('first') }, { source: source('second') }]),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [firstFailure, secondFailure]);
			return true;
		},
	);
	assert.deepEqual(events, [
		'retire:first', 'analysis:peaks:first', 'source:first',
		'retire:second', 'analysis:peaks:second', 'source:second',
	]);
	assert.equal(sourceBuffers.size, 0);
	assert.equal(sourcePeaks.size, 0);
});

function project(): ControllerProject {
	return {
		schemaVersion: 17,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [],
		clips: [],
		sources: [],
		selection: null,
		mixer: { groups: [], sends: [], routes: {} },
		trackFolders: [],
	};
}

function source(id: string): ControllerSource {
	return {
		id,
		storageKey: id,
		name: id,
		mimeType: 'audio/wav',
		frameCount: 1,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	};
}

function buffer(): AudioBufferLike {
	const channel = Float32Array.of(0);
	return {
		length: 1,
		numberOfChannels: 1,
		sampleRate: 48_000,
		getChannelData: () => channel,
	};
}
