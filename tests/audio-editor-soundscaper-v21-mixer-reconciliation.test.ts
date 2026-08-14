/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { applySoundscaperProjectCommandV21 } from '../src/soundscaper/editor-project-v21-commands.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T13:00:00.000Z';

test('an authored group assignment survives unrelated commands', () => {
	// The legacy mixer surface authors a track-to-group route under the same
	// assignment:* identity the folder reconciler owns, so folder authority used to
	// reclaim it and silently reroute the track straight to master.
	const project = createSoundscaperProjectV21({
		id: 'grouped', title: 'Grouped', now: NOW,
		tracks: [createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	});
	const routed = applySoundscaperProjectCommandV21(project, {
		type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'group', bus: { id: 'dialogue', name: 'Dialogue' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { groupId: 'dialogue' } },
		],
	} as AudioEditorCommand);
	const trackEdges = (value: typeof routed) => value.mixer.edges
		.filter((edge) => edge.source.kind === 'track')
		.map(({ id }) => id);
	assert.deepEqual(trackEdges(routed), ['assignment:track:voice:mixer-node:dialogue']);

	const renamed = applySoundscaperProjectCommandV21(routed, {
		type: 'project/rename', title: 'Renamed',
	} as AudioEditorCommand);
	// The route is kept, and the folder fallback to master is not added alongside it,
	// which would have doubled the track into the mix.
	assert.deepEqual(trackEdges(renamed), ['assignment:track:voice:mixer-node:dialogue']);
});

test('narrowing the master restates every product-authored assignment map', () => {
	// An ADM bed change rewrites masterChannels, and a bus feeding master keeps its own
	// map, so a stale map used to survive and the graph could no longer be built.
	const authored = (layout: 'stereo' | '5.1') => ({
		mode: 'authored' as const,
		programme: { name: 'Programme', language: 'en' },
		content: { name: 'Content', language: 'en' },
		bed: { name: `${layout} bed`, layout, assignments: [] },
	});
	const base = createDefaultMixerGraphV21([{ id: 'voice', channelCount: 6 }], 6);
	const group = {
		id: 'dialogue', name: 'Dialogue', color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 6,
	};
	const assignment = (
		id: string,
		source: Readonly<Record<string, unknown>>,
		destination: Readonly<Record<string, unknown>>,
		channelMap: readonly number[],
	) => ({
		id, kind: 'assignment', source, destination,
		position: 'post-fader', level: 1, enabled: true, channelMap,
	});
	const project = createSoundscaperProjectV21({
		id: 'adm-narrow', title: 'ADM narrow', now: NOW,
		masterChannels: 6, metadata: { adm: authored('5.1') },
		tracks: [createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		mixer: {
			...base,
			groups: [group],
			edges: [
				assignment('assignment:track:voice:master',
					{ kind: 'track', id: 'voice' }, { kind: 'master' }, [0, 1, 2, 3, 4, 5]),
				assignment('assignment:mixer-node:dialogue:master',
					{ kind: 'mixer-node', id: 'dialogue' }, { kind: 'master' }, [0, 1, 2, 3, 4, 5]),
				assignment('assignment:master:output:main',
					{ kind: 'master' }, { kind: 'output', id: 'main' }, [0, 1, 2, 3, 4, 5]),
				// Not a canonical ID, so its author's intent is preserved untouched.
				assignment('hand-authored-parallel',
					{ kind: 'mixer-node', id: 'dialogue' }, { kind: 'master' }, [5, 4]),
			],
		},
	} as never);
	const narrowed = applySoundscaperProjectCommandV21(project, {
		type: 'metadata/update', changes: { adm: authored('stereo') },
	} as never);

	const mapOf = (id: string) => narrowed.mixer.edges.find((edge) => edge.id === id)?.channelMap;
	assert.equal(narrowed.masterChannels, 2);
	assert.deepEqual(mapOf('assignment:mixer-node:dialogue:master'), [0, 1]);
	assert.deepEqual(mapOf('assignment:master:output:main'), [0, 1]);
	assert.deepEqual(mapOf('hand-authored-parallel'), [5, 4]);
	assert.deepEqual(mapOf('assignment:track:voice:master'), [0, 1]);
});
