/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import { createTakeCompFlattenService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-flatten-service.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer } from './helpers/mock-audio-context.js';

for (const shorten of [false, true]) test(`native comp flatten preserves ${shorten ? 'an authored trailing gap' : 'the full take control'}`, async context => {
	const initial = createSoundscaperProject({ id: `take-gap-${shorten}`, sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', name: 'Recorded take',
			frameCount: 400, channelCount: 1, sampleRate: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'track', startSample: 0, endSample: 400,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }],
			takes: [{ id: 'take', laneId: 'lane', sourceId: 'source', startSample: 0, endSample: 400, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 400 }] }],
	});
	let history = createSoundscaperProjectHistory(initial);
	let nextId = 0;
	const lifetime = new EditorControllerLifetime();
	context.after(() => { lifetime.beginDisposal(); lifetime.finishDisposal(); });
	const service = createTakeCompService({ lifetime, getProject: () => history.present,
		editingBlocked: () => false, commit: command => { history = executeSoundscaperProjectCommand(history, command); } });
	if (shorten) service.editCompBoundary('group', { regionId: 'region', edge: 'end', boundarySample: 200 });
	const sourceBuffer = new MockAudioBuffer(1, 400, 48_000);
	sourceBuffer.getChannelData(0).fill(.25);
	const buffers = new Map([['source', sourceBuffer as unknown as AudioBuffer]]);
	const engine = createAudioEditorEngine({ audioContextFactory: null,
		offlineAudioContextFactory: ((options: { numberOfChannels: number; length: number; sampleRate: number }) =>
			new MockGainRenderingOfflineAudioContext(options)) as never });
	context.after(async () => { await engine.dispose(); });
	const flatten = createTakeCompFlattenService({ lifetime, service, getProject: () => history.present,
		editingBlocked: () => false, createId: prefix => `${prefix}-${++nextId}`,
		captureProject: () => ({ projectId: initial.id, generation: 0 }), assertProject: () => undefined,
		sourceBuffers: buffers, sourceChunkProviders: new Map(),
		async renderSnapshot(model, options) {
			engine.loadProject(model, buffers);
			return await engine.renderMix({ startFrame: Number(options.startFrame), endFrame: Number(options.endFrame),
				includeMaster: options.includeMaster === true, includeTrackPan: options.includeTrackPan === true,
				respectMuteSolo: options.respectMuteSolo === true,
				outputFrames: options.outputFrames == null ? null : Number(options.outputFrames) });
		},
		derivedSources: {
			async persistRenderedMixSource(rendered, name) {
				assert.equal(rendered.length, 400);
				const pcm = rendered.getChannelData(0);
				assert.ok(pcm.slice(0, shorten ? 200 : 400).some(sample => sample > .1));
				if (shorten) assert.ok(pcm.slice(200).every(sample => sample === 0));
				return { source: { id: 'flattened', storageKey: 'flattened', name, mimeType: 'audio/wav',
					frameCount: rendered.length, channelCount: rendered.numberOfChannels,
					sampleRate: rendered.sampleRate, originalSampleRate: rendered.sampleRate }, buffer: rendered, channels: null };
			}, rollbackDerivedSources: () => Promise.resolve(),
		},
	});
	const result = await flatten.flatten('group');
	assert.equal(result.publication.source.frameCount, 400);
	assert.equal(history.present.takeGroups.length, 0);
});
