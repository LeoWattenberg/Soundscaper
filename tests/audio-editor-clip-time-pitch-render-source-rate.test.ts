/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipTimePitchRenderService,
	type ClipTimePitchRenderStore,
} from '../src/common/editor/controller/clip-time-pitch-render-service.ts';
import type { ClipTimePitchCacheEntry } from '../src/common/editor/controller/clip-time-pitch-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-domain-types.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';

test('rendering a source below the project rate keeps the clip timeline extent', async () => {
	const rendered = bufferFixture(4, 24_000);
	const harness = createHarness({
		project: projectFixture({
			clips: [clipFixture({ sourceDurationFrames: 4, durationFrames: 8 })],
			sources: [sourceFixture({ frameCount: 4, sampleRate: 24_000, originalSampleRate: 24_000 })],
		}),
		rendered,
	});

	assert.equal(await harness.service.renderClipPitchSpeed('clip'), 'clip');

	const source = harness.addedSource();
	assert.equal(source.sampleRate, 24_000);
	assert.equal(source.frameCount, 4);
	const clip = harness.addedClip();
	assert.deepEqual({
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
	}, { sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 8 });
});

test('rendering a source above the project rate keeps the clip timeline extent', async () => {
	const harness = createHarness({
		project: projectFixture({
			clips: [clipFixture({ sourceDurationFrames: 8, durationFrames: 4 })],
			sources: [sourceFixture({ frameCount: 8, sampleRate: 96_000, originalSampleRate: 96_000 })],
		}),
		rendered: bufferFixture(8, 96_000),
	});

	assert.equal(await harness.service.renderClipPitchSpeed('clip'), 'clip');

	const clip = harness.addedClip();
	assert.equal(clip.sourceDurationFrames, 8);
	assert.equal(clip.durationFrames, 4);
});

test('rendering clears the edge trims the replacement source no longer holds', async () => {
	const harness = createHarness({
		project: projectFixture({
			clips: [clipFixture({
				sourceStartFrame: 1,
				sourceDurationFrames: 2,
				durationFrames: 2,
				trimStartFrames: 1,
				trimEndFrames: 1,
			})],
		}),
		rendered: bufferFixture(2, 48_000),
	});

	assert.equal(await harness.service.renderClipPitchSpeed('clip'), 'clip');

	const clip = harness.addedClip();
	assert.deepEqual({
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		trimStartFrames: clip.trimStartFrames,
		trimEndFrames: clip.trimEndFrames,
	}, {
		sourceStartFrame: 0, sourceDurationFrames: 2, trimStartFrames: 0, trimEndFrames: 0,
	});
});

function createHarness(options: Readonly<{
	project: ClipTransformProject;
	rendered: AudioBufferLike;
}>) {
	const project = options.project;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const commits: AudioEditorCommand[] = [];
	const store: ClipTimePitchRenderStore = {
		async beginSourceWrite() {
			return {
				async write() { /* the harness does not persist channels */ },
				async commit() { /* the harness does not persist channels */ },
				async abort() { /* the harness does not persist channels */ },
			};
		},
		async saveAnalysis() { /* the harness does not persist analysis */ },
		async deleteAnalysis() { /* the harness does not persist analysis */ },
		async deleteSource() { /* the harness does not persist sources */ },
	};
	const service = createClipTimePitchRenderService({
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.',
			rendering: 'Rendering…',
			renderPitchSpeed: 'Render Pitch and Speed',
			done: 'Done',
		},
		store,
		sourceBuffers: new Map<string, AudioBufferLike>(),
		sourcePeaks: new Map<string, unknown>(),
		sourceChunkFrames: 65_536,
		getProject: () => project,
		getSelectedClipId: () => 'clip',
		editingBlocked: () => false,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		prepareCommittedOutput: async () => cacheEntry(options.rendered),
		materializeEntry: async (entry) => entry,
		preflightStorage: async () => undefined,
		createId: (prefix: string) => `${prefix}-1`,
		writeBuffer: async () => undefined,
		generateWaveformPeaks: async () => ({ version: 1 }),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer: () => undefined,
		commit: (command) => { commits.push(command); },
		setProcessing: () => undefined,
		setStatus: () => undefined,
		publish: () => undefined,
	});
	return {
		service,
		addedClip(): Record<string, number> {
			const command = batchCommand(commits).find((entry) => entry.type === 'clip/add');
			if (command?.type !== 'clip/add') assert.fail('Expected a rendered clip.');
			return command.clip as unknown as Record<string, number>;
		},
		addedSource(): Record<string, number> {
			const command = batchCommand(commits).find((entry) => entry.type === 'source/add');
			if (command?.type !== 'source/add') assert.fail('Expected a rendered source.');
			return command.source as unknown as Record<string, number>;
		},
	};
}

function batchCommand(commits: readonly AudioEditorCommand[]): readonly AudioEditorCommand[] {
	const command = commits[0];
	if (command?.type !== 'batch') assert.fail('Expected a render replacement batch.');
	return command.commands;
}

function projectFixture(overrides: Partial<ClipTransformProject> = {}): ClipTransformProject {
	return {
		schemaVersion: 2, id: 'project', title: 'Project', sampleRate: 48_000,
		tracks: [{ id: 'track', name: 'Voice track', type: 'audio', clipIds: ['clip'] }],
		clips: [clipFixture()],
		sources: [sourceFixture()],
		selection: null,
		...overrides,
	};
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'clip', sourceId: 'source', title: 'Voice', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4,
		durationFrames: 4, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], groupId: null, pitchCents: 200, speedRatio: 1,
		preserveFormants: false, renderCacheRevision: 0,
		...overrides,
	};
}

function sourceFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'source', storageKey: 'source', name: 'Voice', mimeType: 'audio/wav',
		frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		...overrides,
	};
}

function cacheEntry(audioBuffer: AudioBufferLike): ClipTimePitchCacheEntry {
	return { cacheKey: 'cache', sampleRate: audioBuffer.sampleRate, audioBuffer };
}

function bufferFixture(length: number, sampleRate: number): AudioBufferLike {
	const channel = new Float32Array(length);
	return { length, numberOfChannels: 1, sampleRate, getChannelData: () => channel };
}
