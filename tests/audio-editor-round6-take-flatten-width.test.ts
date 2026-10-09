/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	undoSoundscaperProjectCommand, redoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import { createTakeCompFlattenService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-flatten-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';

for (const [width, companionWidth] of [[1, 1], [2, 2], [6, 6], [1, 6]] as const) {
	test(`flatten preserves active ${width}-channel take geometry with a ${companionWidth}-channel unused take`, async () => {
		const before = createSoundscaperProject({ id: 'take-width-project', sampleRate: 48_000,
			sources: [source('selected', width), source('unused', companionWidth)],
			tracks: [createAudioTrack({ id: 'track', clipIds: [] })],
			sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main',
			takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'track', startSample: 100, endSample: 500,
				laneOrder: ['lane', 'unused-lane'], lanes: [{ id: 'lane' }, { id: 'unused-lane' }],
				takes: [{ id: 'take', laneId: 'lane', sourceId: 'selected', startSample: 100, endSample: 500, sourceStartSample: 50 },
					{ id: 'unused-take', laneId: 'unused-lane', sourceId: 'unused', startSample: 100, endSample: 500, sourceStartSample: 0 }],
				compRegions: [{ id: 'region', takeId: 'take', startSample: 100, endSample: 500 }] }],
		});
		let history = createSoundscaperProjectHistory(before);
		let id = 0;
		const lifetime = new EditorControllerLifetime();
		const service = createTakeCompService({ lifetime, getProject: () => history.present, editingBlocked: () => false,
			commit: command => { history = executeSoundscaperProjectCommand(history, command); } });
		const flatten = createTakeCompFlattenService({ lifetime, service, getProject: () => history.present,
			editingBlocked: () => false, createId: prefix => `${prefix}-${++id}`,
			captureProject: () => ({ projectId: before.id, generation: 0 }), assertProject: () => undefined,
			sourceBuffers: new Map(), sourceChunkProviders: new Map(),
			async renderSnapshot(model, options) {
				assert.deepEqual(model.sources?.map(item => item.id), ['selected']);
				assert.equal(model.clips?.[0]?.sourceStartFrame, 50);
				assert.equal(model.clips?.[0]?.sourceDurationFrames, 400);
				assert.equal(options.includeTrackPan, false);
				assert.equal(options.includeMaster, false);
				assert.equal(model.masterChannels, width, 'the PCM renderer must allocate the active native layout');
				return buffer(Number(model.masterChannels), 400);
			},
			derivedSources: {
				async persistRenderedMixSource(rendered, name) {
					return { source: { id: 'flattened', storageKey: 'flattened', name, mimeType: 'audio/wav',
						frameCount: rendered.length, channelCount: rendered.numberOfChannels, sampleRate: rendered.sampleRate,
						originalSampleRate: rendered.sampleRate }, buffer: rendered, channels: null };
				}, rollbackDerivedSources: () => Promise.resolve(),
			},
		});
		const result = await flatten.flatten('group');
		assert.equal(result.publication.source.channelCount, width);
		assert.equal(history.present.takeGroups.length, 0);
		assert.equal(history.undoStack.length, 1);
		assert.deepEqual(history.present.sources.filter(item => item.id !== 'flattened'), before.sources);
		const undone = undoSoundscaperProjectCommand(history);
		assert.deepEqual(undone.present, { ...before, revision: undone.present.revision, updatedAt: undone.present.updatedAt });
		const redone = redoSoundscaperProjectCommand(undone);
		assert.deepEqual(redone.present, { ...history.present, revision: redone.present.revision, updatedAt: redone.present.updatedAt });
		lifetime.beginDisposal();
		lifetime.finishDisposal();
	});
}

function source(id: string, channelCount: number) {
	return createAudioSource({ id, storageKey: id, name: id, frameCount: 1_000, channelCount, sampleRate: 48_000 });
}

function buffer(numberOfChannels: number, length: number): AudioBufferLike {
	const channels = Array.from({ length: numberOfChannels }, (_, channel) => new Float32Array(length).fill((channel + 1) / 10));
	return { numberOfChannels, length, sampleRate: 48_000, getChannelData(channel) {
		const samples = channels[channel]; assert.ok(samples); return samples;
	} };
}
