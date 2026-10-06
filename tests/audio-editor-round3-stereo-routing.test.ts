/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackTransformService } from '../src/common/editor/controller/track-audio/internal/track-transform-service.ts';
import type { TrackTransformServiceDependencies } from '../src/common/editor/controller/track-audio/internal/track-transform-service.ts';
import type { ControllerProject, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

const NOW = '2026-10-07T00:00:00.000Z';

function fixture() {
	const source = createAudioSource({ id: 'source', name: 'Stereo', storageKey: 'source',
		mimeType: 'audio/wav', frameCount: 4, sampleRate: 48_000, channelCount: 2,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Stereo',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 });
	const bus = (id: string) => ({ id, name: id, color: '#808080', gain: 1, pan: 0,
		mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 });
	let project = createSoundscaperProject({ id: 'project', title: 'Stereo routing', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'stereo', name: 'Stereo', clipIds: [clip.id] })],
		sequences: [{ id: 'sequence', trackIds: ['stereo'] }], primarySequenceId: 'sequence',
		mixer: { schemaVersion: 1, groups: [bus('group')], sends: [bus('send')], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }], edges: [
				{ id: 'assignment:track:stereo:mixer-node:group', kind: 'assignment',
					source: { kind: 'track', id: 'stereo' }, destination: { kind: 'mixer-node', id: 'group' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
				{ id: 'send:track:stereo:mixer-node:send', kind: 'send',
					source: { kind: 'track', id: 'stereo' }, destination: { kind: 'mixer-node', id: 'send' },
					position: 'pre-fader', level: 0.5, enabled: true, channelMap: [0, 1] },
				...['group', 'send'].map(id => ({ id: `${id}-master`, kind: 'assignment',
					source: { kind: 'mixer-node', id }, destination: { kind: 'master' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] })),
				{ id: 'master-main', kind: 'assignment', source: { kind: 'master' },
					destination: { kind: 'output', id: 'main' }, position: 'post-fader',
					level: 1, enabled: true, channelMap: [0, 1] },
			] },
	});
	let sequence = 0;
	const createId = (prefix: string) => `${prefix}-${++sequence}`;
	const dependencies: TrackTransformServiceDependencies = {
		lifetime: { assertActive() {}, startTask(name) { return { name, scope: null, generation: 1,
			signal: new AbortController().signal, abort() {}, assertCurrent() {}, finish() {} }; } },
		copy: { v2Required: 'Required', audioTrackRequired: 'Audio required', stereoTrackRequired: 'Stereo required',
			monoTrackRequired: 'Mono required', compatibleMonoTrackRequired: 'Compatible required',
			resamplingTrack: 'Resampling', audacityProcessing: 'Processing', rewritingChannels: 'Rewriting',
			done: 'Done', channelsSwapped: 'Swapped', leftChannel: 'Left', rightChannel: 'Right', stereo: 'Stereo' },
		getProject: () => project as unknown as ControllerProject, getSelectedTrackId: () => 'stereo',
		editingBlocked: () => false, captureProject: () => ({ projectId: project.id, generation: 0 }),
		assertProject() {}, createId,
		commit(command) { project = applySoundscaperProjectCommand(project, command, { now: NOW }); },
		projectSampleRate: () => 48_000, normalizeProjectSampleRate: Number, audioTrackChannelCount: () => 2,
		preflightStorage: async () => {}, setProcessing() {}, setStatus() {}, publish() {},
		resampleChannels: channels => channels, renderDryTrackRange: async () => [],
		derivedSources: {
			uniqueClipSources: () => [source as unknown as ControllerSource],
			sourceChannelsForEdit: async () => [new Float32Array(4).fill(0.25), new Float32Array(4).fill(-0.25)],
			async persistDerivedSource(template, channels, name) {
				const id = createId('source');
				return { source: { ...template, id, storageKey: id, name, channelCount: channels.length } as ControllerSource,
					channels, buffer: null };
			}, rollbackDerivedSources: async () => {},
			persistRenderedMixSource: async () => { throw new Error('Unexpected mix render.'); },
		},
	};
	Object.assign(dependencies, { previewCommand: (candidate: ControllerProject, command: Parameters<typeof applySoundscaperProjectCommand>[1]) => (
		applySoundscaperProjectCommand(candidate, command, { now: NOW })
	) });
	return { service: createTrackTransformService(dependencies), getProject: () => project };
}

test('stereo splitting retains the authored group and send on both mono tracks with valid channel maps', async () => {
	const runtime = fixture();
	const result = await runtime.service.splitStereoTrack();
	assert.ok(result);
	const project = runtime.getProject();
	for (const trackId of [result.leftTrackId, result.rightTrackId]) {
		const routes = project.mixer.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === trackId);
		assert.deepEqual(routes.map(({ kind, destination, position, level, channelMap }) => (
			{ kind, destination, position, level, channelMap }
		)), [
			{ kind: 'assignment', destination: { kind: 'mixer-node', id: 'group' }, position: 'post-fader', level: 1, channelMap: [0, 0] },
			{ kind: 'send', destination: { kind: 'mixer-node', id: 'send' }, position: 'pre-fader', level: 0.5, channelMap: [0, 0] },
		]);
	}
	assert.equal(new Set(project.mixer.edges.map(({ id }) => id)).size, project.mixer.edges.length);
});

test('the public controller previews stereo routing from the authored document, with one undo step', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round3-stereo-routing' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 2,
		durationSeconds: 0.1, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId!;
	const groupId = controller.actions.mixer.addBus('group');
	const sendId = controller.actions.mixer.addBus('send');
	controller.actions.mixer.setRoute(trackId, { groupId, sends: { [String(sendId)]: 0.5 } });
	const before = controller.getSnapshot().project!.mixer;
	const split = await controller.actions.track.splitStereoLR(trackId);
	assert.ok(split);
	const graph = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	for (const id of [split.leftTrackId, split.rightTrackId]) {
		const outgoing = graph.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === id);
		assert.equal(outgoing.length, 2);
		assert.ok(outgoing.some(edge => edge.destination.kind === 'mixer-node' && edge.destination.id === groupId));
		assert.ok(outgoing.some(edge => edge.destination.kind === 'mixer-node' && edge.destination.id === sendId && edge.level === 0.5));
	}
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, before);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, graph);
});
