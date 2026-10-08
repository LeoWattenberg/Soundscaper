/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { MixerEdgeV21, MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const operation of ['selection', 'track', 'connected pair', 'stereo split', 'bus detector', 'detector track'] as const) {
	test(`${operation} preserves the derived effect's incoming sidechain and original history`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime, sessionController: projectRuntime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round5-sidechain-${operation}` }),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		const generate = () => controller.actions.generators.generate('tone', {
			amplitude: 0.4, channelCount: 2, durationSeconds: 0.1, frequency: 440,
		});
		await generate();
		const programmeTrack = controller.getSnapshot().selectedTrackId;
		const programmeClip = controller.getSnapshot().selectedClipId;
		assert.ok(programmeTrack && programmeClip);
		const gateId = controller.actions.effects.add({ scope: 'track', trackId: programmeTrack, type: 'gate' });
		assert.equal(typeof gateId, 'string');
		const controlTrack = controller.actions.track.add({ name: 'Detector' });
		assert.equal(typeof controlTrack, 'string');
		await generate();
		const controlClip = controller.getSnapshot().selectedClipId;
		assert.ok(controlClip);
		const bus = operation === 'bus detector' ? controller.actions.mixer.addBus('group') : null;
		if (bus) controller.actions.mixer.setRoute(controlTrack, { groupId: bus });
		const snapshot = controller.getSnapshot().project!;
		const graph = snapshot.mixer as unknown as MixerGraphV21;
		const detector: MixerEdgeV21 = { id: 'external-detector', kind: 'sidechain',
			source: bus ? { kind: 'mixer-node', id: bus } : { kind: 'track', id: controlTrack },
			destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: programmeTrack }, effectId: String(gateId) },
			position: 'pre-fader', level: 0.5, enabled: operation !== 'bus detector',
			channelMap: operation === 'track' ? [1, 0] : [0, 1] };
		// The Routing graph panel publishes this exact command through actions.edit.commit.
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: graph,
			mixer: { ...graph, edges: [...graph.edges, detector] } });
		controller.actions.timeline.selectClip(programmeClip);
		if (operation === 'connected pair') controller.actions.timeline.selectClip(controlClip, { additive: true });
		const original = controller.getSnapshot().project!;
		const before = original.mixer as unknown as MixerGraphV21;
		const beforeTracks = (projectRuntime.projectForCommandConsumers(original) as ControllerProject).tracks;
		const history = controller.getSnapshot().history.undoEntries.length;
		if (operation === 'stereo split') await controller.actions.track.splitStereoLR(programmeTrack);
		else if (operation === 'track' || operation === 'detector track') {
			controller.actions.track.duplicate(operation === 'track' ? programmeTrack : controlTrack);
		}
		else controller.actions.edit.duplicate();
		const afterSnapshot = controller.getSnapshot();
		const after = afterSnapshot.project!.mixer as unknown as MixerGraphV21;
		const afterTracks = (projectRuntime.projectForCommandConsumers(afterSnapshot.project!) as ControllerProject).tracks;
		const copies = afterTracks.filter(track => !beforeTracks.some(originalTrack => originalTrack.id === track.id));
		const derivedTracks = operation === 'stereo split'
			? afterTracks.filter(track => track.id === programmeTrack || copies.includes(track)) : copies;
		const programmeCopies = derivedTracks.filter(track => track.type === 'audio' && track.effects?.some(effect => effect.type === 'gate'));
		assert.equal(programmeCopies.length, operation === 'stereo split' ? 2 : operation === 'detector track' ? 0 : 1);
		const controlCopy = operation === 'connected pair' ? copies.find(track => !programmeCopies.includes(track)) : null;
		if (operation === 'connected pair') assert.ok(controlCopy);
		const sidechains = after.edges.filter(edge => edge.kind === 'sidechain');
		assert.equal(sidechains.length, 2);
		if (operation !== 'stereo split') assert.deepEqual(sidechains.find(edge => edge.id === detector.id), detector);
		if (operation === 'detector track') {
			const copied = sidechains.find(edge => edge.id !== detector.id);
			assert.ok(copied);
			assert.deepEqual(copied.source, { kind: 'track', id: copies[0]!.id });
			assert.deepEqual(copied.destination, detector.destination);
		}
		for (const programmeCopy of programmeCopies) {
			const copiedGate = programmeCopy.effects?.find(effect => effect.type === 'gate');
			assert.ok(copiedGate);
			if (programmeCopy.id === programmeTrack) assert.equal(copiedGate.id, gateId);
			else assert.notEqual(copiedGate.id, gateId);
			const copied = sidechains.find(edge => edge.destination.kind === 'effect-sidechain'
				&& edge.destination.strip.kind === 'track' && edge.destination.strip.id === programmeCopy.id);
			assert.ok(copied);
			assert.deepEqual(copied.source, controlCopy ? { kind: 'track', id: controlCopy.id } : detector.source);
			assert.deepEqual(copied.destination, { kind: 'effect-sidechain',
				strip: { kind: 'track', id: programmeCopy.id }, effectId: copiedGate.id });
			assert.deepEqual([copied.position, copied.level, copied.enabled, copied.channelMap],
				[detector.position, detector.level, detector.enabled, operation === 'stereo split' ? [0] : detector.channelMap]);
		}
		assert.equal(new Set(after.edges.map(edge => edge.id)).size, after.edges.length);
		assert.equal(afterSnapshot.history.undoEntries.length, history + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.mixer, before);
		assert.deepEqual(controller.getSnapshot().project!.tracks, original.tracks);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.mixer, after);
	});
}
