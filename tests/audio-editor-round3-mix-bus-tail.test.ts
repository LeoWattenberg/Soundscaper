/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMixRenderSnapshot, mixRenderTailFrames } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { rackTailFrames } from '../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const now = '2026-10-07T00:00:00.000Z';

for (const serial of [true, false]) test(`a ${serial ? 'serial' : 'parallel'} bus graph has its actual longest rendered tail`, () => {
	const project = fixture(serial);
	const tracks = project.tracks.filter(track => track.type === 'audio') as unknown as ControllerTrack[];
	const before = structuredClone(project);
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, tracks, { mixDown: true });
	assert.equal(mixRenderTailFrames(tracks, snapshot, 48_000, rackTailFrames, { includeBuses: true }), serial ? 48_000 : 24_000);
	assert.equal(mixRenderTailFrames(tracks, snapshot, 48_000, rackTailFrames, { renderEffects: false }), 0);
	assert.deepEqual(project, before);
});

function fixture(serial: boolean) {
	let project = createSoundscaperProject({ id: 'bus-delays', title: 'Bus delays', now,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] })],
		sources: [createAudioSource({ id: 'voice-source', storageKey: 'voice-source', name: 'Voice',
			sampleRate: 48_000, frameCount: 38_400, channelCount: 1 })],
		clips: [createAudioClip({ id: 'voice-clip', sourceId: 'voice-source', timelineStartFrame: 0,
			durationFrames: 38_400, sourceStartFrame: 0, sourceDurationFrames: 38_400 })],
	});
	const apply = (command: AudioEditorCommand) => { project = applySoundscaperProjectCommand(project, command, { now }); };
	for (const id of ['first', 'second']) {
		apply({ type: 'mixer/bus-add', busType: 'group', bus: { id, name: id } });
		apply({ type: 'effect/add', scope: 'group', busId: id,
			effect: { id: `${id}-delay`, type: 'delay', enabled: true, params: { time: 0.5, feedback: 0, mix: 1 } } });
	}
	const mixer = project.mixer;
	const changed = { ...mixer, edges: mixer.edges.map(edge => {
		if (edge.source.kind === 'track') return { ...edge, destination: { kind: 'mixer-node' as const, id: 'first' } };
		if (serial && edge.source.kind === 'mixer-node' && edge.source.id === 'first') {
			return { ...edge, destination: { kind: 'mixer-node' as const, id: 'second' } };
		}
		return edge;
	}) };
	if (!serial) changed.edges.push({ id: 'voice-second', kind: 'send', source: { kind: 'track', id: 'voice' },
		destination: { kind: 'mixer-node', id: 'second' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 0] });
	apply({ type: 'mixer-graph/set', expected: mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: changed as unknown as Readonly<Record<string, unknown>> });
	return project;
}
