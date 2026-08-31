/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperRoutingEditorModel } from '../src/common/editor/ui/soundscaper-routing-editor-model.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-08-14T13:00:00.000Z';

test('an authored group assignment survives unrelated commands', () => {
	// The legacy mixer surface authors a track-to-group route under the same
	// assignment:* identity the folder reconciler owns, so folder authority used to
	// reclaim it and silently reroute the track straight to master.
	const project = createSoundscaperProject({
		id: 'grouped', title: 'Grouped', now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	});
	const routed = applySoundscaperProjectCommand(project, {
		type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'group', bus: { id: 'dialogue', name: 'Dialogue' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { groupId: 'dialogue' } },
		],
	} as AudioEditorCommand);
	const trackEdges = (value: typeof routed) => value.mixer.edges
		.filter((edge) => edge.source.kind === 'track')
		.map(({ id }) => id);
	assert.deepEqual(trackEdges(routed), ['assignment:track:voice:mixer-node:dialogue']);

	const renamed = applySoundscaperProjectCommand(routed, {
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
	const project = createSoundscaperProject({
		id: 'adm-narrow', title: 'ADM narrow', now: NOW,
		masterChannels: 6, metadata: { adm: authored('5.1') },
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
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
	const narrowed = applySoundscaperProjectCommand(project, {
		type: 'metadata/update', changes: { adm: authored('stereo') },
	} as never);

	const mapOf = (id: string) => narrowed.mixer.edges.find((edge) => edge.id === id)?.channelMap;
	assert.equal(narrowed.masterChannels, 2);
	assert.deepEqual(mapOf('assignment:mixer-node:dialogue:master'), [0, 1]);
	assert.deepEqual(mapOf('assignment:master:output:main'), [0, 1]);
	assert.deepEqual(mapOf('hand-authored-parallel'), [5, 4]);
	assert.deepEqual(mapOf('assignment:track:voice:master'), [0, 1]);
});

test('narrowing a track restates its send route as well as its assignment', () => {
	// Send edges carry their own map under the same identity convention, so a width
	// move used to leave them reading source channels the track no longer has.
	const authored = (layout: 'stereo' | '5.1') => ({
		mode: 'authored' as const,
		programme: { name: 'Programme', language: 'en' },
		content: { name: 'Content', language: 'en' },
		bed: { name: `${layout} bed`, layout, assignments: [] },
	});
	const project = createSoundscaperProject({
		id: 'send-narrow', title: 'Send narrow', now: NOW,
		masterChannels: 6, metadata: { adm: authored('5.1') },
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		mixer: createDefaultMixerGraphV21([{ id: 'voice', channelCount: 6 }], 6),
	} as never);
	const routed = applySoundscaperProjectCommand(project, {
		type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'reverb', name: 'Reverb' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { sends: { reverb: 0.5 } } },
		],
	} as AudioEditorCommand);
	const sendMap = (value: typeof routed) => value.mixer.edges
		.find((edge) => edge.kind === 'send')?.channelMap;
	assert.deepEqual(sendMap(routed), [0, 1, 2, 3, 4, 5]);

	const narrowed = applySoundscaperProjectCommand(routed, {
		type: 'metadata/update', changes: { adm: authored('stereo') },
	} as AudioEditorCommand);
	// The clipless track follows the master down to two channels while the send bus
	// keeps the width it was created at, so the route restates to two live channels.
	assert.equal(narrowed.masterChannels, 2);
	assert.deepEqual(sendMap(narrowed), [0, 1, -1, -1, -1, -1]);
});

test('the routing editor accepts the graph the product authored for a wide master', () => {
	// A track with no clips takes its width from the master, which is the fallback the
	// reconciler uses when it authors that track's map. The editor must resolve it the
	// same way or it refuses to open the very graph it would be used to repair.
	const project = createSoundscaperProject({
		id: 'wide', title: 'Wide', now: NOW, masterChannels: 6,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		mixer: createDefaultMixerGraphV21([{ id: 'voice', channelCount: 6 }], 6),
	} as never);
	const model = createSoundscaperRoutingEditorModel(
		project, JSON.stringify(project.mixer, null, '\t'),
	);
	assert.equal(model.validationError, null);
	assert.equal(model.canApply, true);
});

test('a clip edit that narrows a track restates its send route with the master unchanged', () => {
	// The trigger need not be a master width change: a track takes its width from clip
	// content, so swapping a six-channel clip for a mono one narrows the source under
	// an already-authored send map.
	const six = createAudioSource({
		id: 'six', storageKey: 'pcm:six', frameCount: 512, channelCount: 6,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const sixClip = createAudioClip({
		id: 'six-clip', sourceId: 'six', title: 'Six', timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const project = createSoundscaperProject({
		id: 'clip-narrow', title: 'Clip narrow', now: NOW, masterChannels: 6,
		sources: [six], clips: [sixClip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['six-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		mixer: createDefaultMixerGraphV21([{ id: 'voice', channelCount: 6 }], 6),
	} as never);
	const routed = applySoundscaperProjectCommand(project, {
		type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'verb', name: 'Verb' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { sends: { verb: 0.5 } } },
		],
	} as AudioEditorCommand);
	const sendMap = (value: typeof routed) => value.mixer.edges
		.find((edge) => edge.kind === 'send')?.channelMap;
	assert.deepEqual(sendMap(routed), [0, 1, 2, 3, 4, 5]);

	const mono = createAudioSource({
		id: 'one', storageKey: 'pcm:one', frameCount: 512, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const narrowed = applySoundscaperProjectCommand(routed, {
		type: 'batch', commands: [
			{ type: 'source/add', source: mono },
			{ type: 'clip/remove-many', clipIds: ['six-clip'], rippleMode: 'none' },
			{
				type: 'clip/add', trackId: 'voice',
				clip: createAudioClip({
					id: 'one-clip', sourceId: 'one', title: 'One', timelineStartFrame: 0,
					durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
				}),
			},
		],
	} as AudioEditorCommand);
	assert.equal(narrowed.masterChannels, 6);
	assert.deepEqual(sendMap(narrowed), [0, 0, -1, -1, -1, -1]);
});

test('narrowing a key track restates the sidechain map it feeds', () => {
	// A sidechain map is not covered by the canonical route convention: the routing
	// editor lets its author type the edge ID. Its map was therefore left behind by every
	// width change, so narrowing the key track pointed it at channels the source no
	// longer had, and the engine refused to build the graph the document still validated.
	const wide = (id: string, channelCount: number) => createAudioSource({
		id, storageKey: `pcm:${id}`, frameCount: 512, channelCount,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const take = (id: string, sourceId: string) => createAudioClip({
		id, sourceId, title: id, timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const base = createSoundscaperProject({
		id: 'sidechain-width', title: 'Sidechain width', now: NOW, masterChannels: 6,
		sources: [wide('bed-live', 6), wide('key-live', 6)],
		clips: [take('bed-clip', 'bed-live'), take('key-clip', 'key-live')],
		tracks: [
			createAudioTrack({
				id: 'bed', name: 'Bed', clipIds: ['bed-clip'],
				effects: [{ id: 'bed-comp', type: 'compressor', enabled: true, params: {} }],
			}),
			createAudioTrack({ id: 'key', name: 'Key', clipIds: ['key-clip'] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['bed', 'key'] }],
		primarySequenceId: 'main-sequence',
	} as never);
	const sidechainId = 'duck-the-bed';
	const authored = applySoundscaperProjectCommand(base, {
		type: 'mixer-graph/set', expected: base.mixer,
		mixer: {
			...base.mixer,
			edges: [...base.mixer.edges, {
				id: sidechainId, kind: 'sidechain',
				source: { kind: 'track', id: 'key' },
				destination: {
					kind: 'effect-sidechain', strip: { kind: 'track', id: 'bed' }, effectId: 'bed-comp',
				},
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1, 2, 3, 4, 5],
			}],
		},
	} as never);
	const sidechainMap = (value: typeof authored) => value.mixer.edges
		.find(({ id }) => id === sidechainId)?.channelMap;
	assert.deepEqual(sidechainMap(authored), [0, 1, 2, 3, 4, 5]);

	const narrowed = applySoundscaperProjectCommand(authored, {
		type: 'batch', commands: [
			{ type: 'source/add', source: wide('key-stereo', 2) },
			{ type: 'clip/replace-source', clipId: 'key-clip', sourceId: 'key-stereo' },
		],
	} as AudioEditorCommand);
	// The bed strip is still 6 wide, so the restated map is the stereo key spread into a
	// 5.1 destination rather than a map reading four channels that no longer exist.
	assert.deepEqual(sidechainMap(narrowed), [0, 1, -1, -1, -1, -1]);
});

test('a hand-shaped map is still preserved across a width change', () => {
	// The shape test is what admits a sidechain for restatement, so it has to keep
	// refusing a map its author actually shaped: only a map still matching the default
	// for the widths it was built against is ours to move.
	const source = createAudioSource({
		id: 'six', storageKey: 'pcm:six', frameCount: 512, channelCount: 6,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const base = createSoundscaperProject({
		id: 'hand-shaped', title: 'Hand shaped', now: NOW, masterChannels: 6,
		sources: [source],
		clips: [createAudioClip({
			id: 'six-clip', sourceId: 'six', title: 'Six', timelineStartFrame: 0,
			durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
		})],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['six-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		mixer: createDefaultMixerGraphV21([{ id: 'voice', channelCount: 6 }], 6),
	} as never);
	const swapped = [1, 0, 3, 2, 5, 4];
	const authored = applySoundscaperProjectCommand(base, {
		type: 'mixer-graph/set', expected: base.mixer,
		mixer: {
			...base.mixer,
			edges: base.mixer.edges.map((edge) => edge.id === 'assignment:track:voice:master'
				? { ...edge, id: 'hand-authored-swap', channelMap: swapped }
				: edge),
		},
	} as never);

	const mono = createAudioSource({
		id: 'one', storageKey: 'pcm:one', frameCount: 512, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const narrowed = applySoundscaperProjectCommand(authored, {
		type: 'batch', commands: [
			{ type: 'source/add', source: mono },
			{ type: 'clip/remove-many', clipIds: ['six-clip'], rippleMode: 'none' },
			{
				type: 'clip/add', trackId: 'voice',
				clip: createAudioClip({
					id: 'one-clip', sourceId: 'one', title: 'One', timelineStartFrame: 0,
					durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
				}),
			},
		],
	} as AudioEditorCommand);
	assert.deepEqual(
		narrowed.mixer.edges.find(({ id }) => id === 'hand-authored-swap')?.channelMap,
		swapped,
	);
});

test('compact mixer commands refuse canonical-ID edges with advanced routing semantics', () => {
	const base = createSoundscaperProject({
		id: 'advanced-routes', title: 'Advanced routes', now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	});
	const routed = applySoundscaperProjectCommand(base, {
		type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'group', bus: { id: 'dialogue', name: 'Dialogue' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { groupId: 'dialogue' } },
			{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'reverb', name: 'Reverb' } },
			{ type: 'mixer/route-update', trackId: 'voice', changes: { sends: { reverb: 0.5 } } },
		],
	} as AudioEditorCommand);
	const advanced = applySoundscaperProjectCommand(routed, {
		type: 'mixer-graph/set', expected: routed.mixer,
		mixer: {
			...routed.mixer,
			edges: routed.mixer.edges.map((edge) => {
				if (edge.id === 'assignment:track:voice:mixer-node:dialogue') {
					return { ...edge, position: 'pre-fader' };
				}
				if (edge.id === 'send:track:voice:mixer-node:reverb') {
					return { ...edge, enabled: false };
				}
				return edge;
			}),
		},
	} as unknown as AudioEditorCommand);

	assert.throws(() => applySoundscaperProjectCommand(advanced, {
		type: 'mixer/route-update', trackId: 'voice', changes: { groupId: null },
	} as AudioEditorCommand), /advanced assignment/iu);
	assert.throws(() => applySoundscaperProjectCommand(advanced, {
		type: 'mixer/route-update', trackId: 'voice', changes: { sends: { reverb: 0.25 } },
	} as AudioEditorCommand), /advanced send/iu);
});
