/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createSoundscaperRoutingEditorModel,
	editSoundscaperRoutingGraph,
} from '../src/common/editor/ui/soundscaper-routing-editor-model.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T13:00:00.000Z';

test('routing editor model exposes structured graph collections and canonical endpoints', () => {
	const model = createSoundscaperRoutingEditorModel(PROJECT, graphText(PROJECT.mixer));

	assert.equal(model.validationError, null);
	assert.deepEqual(model.graph && {
		groups: model.graph.groups.length,
		sends: model.graph.sends.length,
		cues: model.graph.cues.length,
		vcas: model.graph.vcas.length,
		outputs: model.graph.outputs.length,
		edges: model.graph.edges.length,
	}, { groups: 0, sends: 0, cues: 0, vcas: 0, outputs: 1, edges: 2 });
	assert.deepEqual(model.sourceEndpoints.map(({ label }) => label), ['Track: Voice', 'Master']);
	assert.deepEqual(model.destinationEndpoints.map(({ label }) => label), ['Master', 'Output: Main output']);
	assert.deepEqual(model.vcaMembers.map(({ label }) => label), ['Track: Voice', 'Master']);
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(model.sourceEndpoints));
});

test('focused routing edits compile one full canonical graph while preserving unrelated collections', () => {
	const initial = graphText(PROJECT.mixer);
	const group = strip('dialogue', 'Dialogue', 2);
	const withGroup = editSoundscaperRoutingGraph(PROJECT, initial, {
		type: 'node/set', collection: 'groups', previousId: null, node: group,
	});
	assert.equal(withGroup.validationError, null);
	const withVca = editSoundscaperRoutingGraph(PROJECT, withGroup.text, {
		type: 'vca/set', previousId: null,
		vca: { id: 'all', name: 'All', gain: 1, mute: false, members: [{ kind: 'track', id: 'voice' }] },
	});
	assert.equal(withVca.validationError, null);
	const withEdge = editSoundscaperRoutingGraph(PROJECT, withVca.text, {
		type: 'edge/set', previousId: null,
		edge: edge('voice-dialogue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
	});
	assert.equal(withEdge.validationError, null);

	const graph = createSoundscaperRoutingEditorModel(PROJECT, withEdge.text).graph;
	assert.equal(graph?.groups[0]?.name, 'Dialogue');
	const member = graph?.vcas[0]?.members[0];
	assert.equal(member?.kind === 'master' ? null : member?.id, 'voice');
	assert.equal(graph?.edges.at(-1)?.position, 'post-fader');
	assert.deepEqual(graph?.edges.at(-1)?.channelMap, [0, 1]);
	assert.deepEqual(graph?.outputs, PROJECT.mixer.outputs);

	const renamed = editSoundscaperRoutingGraph(PROJECT, withEdge.text, {
		type: 'node/set', collection: 'groups', previousId: 'dialogue',
		node: { ...group, name: 'Dialogue stem' },
	});
	assert.equal(createSoundscaperRoutingEditorModel(PROJECT, renamed.text).graph?.groups[0]?.name, 'Dialogue stem');
	const removed = editSoundscaperRoutingGraph(PROJECT, renamed.text, {
		type: 'vca/remove', id: 'all',
	});
	assert.equal(createSoundscaperRoutingEditorModel(PROJECT, removed.text).graph?.vcas.length, 0);
});

test('routing cycle and channel-map errors are announced before project commit', () => {
	let draft = graphText({
		...PROJECT.mixer,
		groups: [strip('a', 'A', 2), strip('b', 'B', 2)],
	});
	draft = editSoundscaperRoutingGraph(PROJECT, draft, {
		type: 'edge/set', previousId: null,
		edge: edge('a-b', { kind: 'mixer-node', id: 'a' }, { kind: 'mixer-node', id: 'b' }),
	}).text;
	const cycle = editSoundscaperRoutingGraph(PROJECT, draft, {
		type: 'edge/set', previousId: null,
		edge: edge('b-a', { kind: 'mixer-node', id: 'b' }, { kind: 'mixer-node', id: 'a' }),
	});
	assert.match(cycle.validationError ?? '', /routing cycle/u);
	assert.equal(createSoundscaperRoutingEditorModel(PROJECT, cycle.text).canApply, false);

	// The map is destination-indexed, so reading source channel 2 of a stereo track is a
	// source error, and a map longer than the destination is a destination error.
	const missingSource = editSoundscaperRoutingGraph(PROJECT, draft, {
		type: 'edge/set', previousId: null,
		edge: edge('voice-bad-map', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'a' }, [0, 2]),
	});
	assert.match(missingSource.validationError ?? '', /channel map reads a missing source channel/u);
	assert.equal(createSoundscaperRoutingEditorModel(PROJECT, missingSource.text).canApply, false);

	const tooWide = editSoundscaperRoutingGraph(PROJECT, draft, {
		type: 'edge/set', previousId: null,
		edge: edge('voice-wide-map', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'a' }, [0, 1, 0, 1]),
	});
	assert.match(tooWide.validationError ?? '', /channel map exceeds its destination width/u);
	assert.equal(createSoundscaperRoutingEditorModel(PROJECT, tooWide.text).canApply, false);

	const legal = editSoundscaperRoutingGraph(PROJECT, draft, {
		type: 'edge/set', previousId: null,
		edge: edge('voice-swap', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'a' }, [1, 0]),
	});
	assert.equal(legal.validationError, null);
});

test('outputs remain explicit placeholders and become applicable only after they are routed', () => {
	const added = editSoundscaperRoutingGraph(PROJECT, graphText(PROJECT.mixer), {
		type: 'output/set', previousId: null,
		output: { id: 'headphones', name: 'Headphones', role: 'control-room', channelCount: 2 },
	});
	assert.match(added.validationError ?? '', /output headphones is unreachable/u);
	const routed = editSoundscaperRoutingGraph(PROJECT, added.text, {
		type: 'edge/set', previousId: null,
		edge: edge('master-headphones', { kind: 'master' }, { kind: 'output', id: 'headphones' }),
	});
	assert.equal(routed.validationError, null);
	assert.equal(createSoundscaperRoutingEditorModel(PROJECT, routed.text).canApply, true);
});

test('a draft that breaks the folder rules is refused before Apply, not after', () => {
	// Folder authority owns a folder-derived group's name. The stored-document validator
	// enforces that, so the editor has to as well: reporting a draft valid and then
	// failing the commit leaves the user with no way to see what is wrong.
	const foldered = createSoundscaperProjectV21({
		id: 'foldered', title: 'Foldered', now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		trackFolders: [{ id: 'stems', name: 'Stems' }],
		sequences: [{
			id: 'main-sequence', trackIds: ['voice'], trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
			],
		}],
		primarySequenceId: 'main-sequence',
	} as never);
	const group = foldered.mixer.groups.find(({ id }) => id === 'stems');
	assert.ok(group, 'the folder owns a group bus');

	const renamed = editSoundscaperRoutingGraph(foldered, graphText(foldered.mixer), {
		type: 'node/set', collection: 'groups', previousId: 'stems',
		node: { ...group, name: 'Renamed by hand' },
	} as never);
	assert.match(renamed.validationError ?? '', /mirror its track folder name/u);
	assert.equal(createSoundscaperRoutingEditorModel(foldered, renamed.text).canApply, false);

	// An untouched folder-derived graph still opens cleanly.
	assert.equal(createSoundscaperRoutingEditorModel(foldered, graphText(foldered.mixer)).canApply, true);
});

const PROJECT = Object.freeze({
	schemaVersion: 21,
	masterChannels: 2,
	master: Object.freeze({ effects: Object.freeze([]) }),
	tracks: Object.freeze([Object.freeze({
		id: 'voice', type: 'audio', name: 'Voice', effects: Object.freeze([]),
	})]),
	mixer: Object.freeze({
		schemaVersion: 1 as const,
		groups: Object.freeze([]), sends: Object.freeze([]), cues: Object.freeze([]), vcas: Object.freeze([]),
		outputs: Object.freeze([{ id: 'main', name: 'Main output', role: 'main' as const, channelCount: 2 }]),
		edges: Object.freeze([
			edge('voice-master', { kind: 'track', id: 'voice' }, { kind: 'master' }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
		]),
	}),
});

function graphText(value: unknown): string {
	return JSON.stringify(value, null, '\t');
}

function strip(id: string, name: string, channelCount: number) {
	return {
		id, name, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount,
	};
}

function edge(
	id: string,
	source: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
	channelMap: readonly number[] = [0, 1],
): MixerEdgeV21 {
	return {
		id, kind: 'assignment' as const, source, destination,
		position: 'post-fader' as const, level: 1, enabled: true, channelMap,
	};
}
