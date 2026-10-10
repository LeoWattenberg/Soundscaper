/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand as apply, prepareFramescaperVideoTransitionAllocations } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectForRuntimeConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand,
	undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { applySoundscaperMixerSurfaceCommand } from '../src/soundscaper/editor-project-mixer-surface.ts';
import { isMixerGraphV21Surface } from '../src/common/editor/mixer-graph-surface-v21.ts';

function mixerGraph(project: Readonly<{ mixer: unknown }>) {
	const mixer: unknown = project.mixer;
	assert.ok(isMixerGraphV21Surface(mixer), 'The actual selected native factory/history must retain a V21 graph.');
	return mixer;
}

function fixture() {
	const project = createFramescaperProject(PROFILE, { id: 'native-mixer', masterChannels: 2,
		tracks: [{ id: 'dialogue', name: 'Dialogue', type: 'audio', clipIds: [] }] });
	return { ...project, mixer: mixerGraph(project) };
}
function seeded() {
	const project = fixture();
	const grouped = { ...project, mixer: applySoundscaperMixerSurfaceCommand(project,
		{ type: 'mixer/bus-add', busType: 'group', bus: { id: 'dialogue-group', name: 'Dialogue group' } }) };
	const mixer = applySoundscaperMixerSurfaceCommand(grouped,
		{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'room-send', name: 'Room send' } });
	return apply(PROFILE, project, { type: 'mixer-graph/set', expected: mixerGraph(project), mixer });
}

for (const busType of ['group', 'send'] as const) {
	const collection = busType === 'group' ? 'groups' : 'sends';
	const busId = busType === 'group' ? 'dialogue-group' : 'room-send';
	test(`normal native ${busType} addition retains its strip, output edge and one-entry history`, () => {
		const project = fixture(), before = structuredClone(project);
		let history = createFramescaperProjectHistory(PROFILE, project);
		history = executeFramescaperProjectCommand(PROFILE, history, { type: 'mixer/bus-add', busType,
			bus: { id: busId, name: 'New bus' } });
		assert.equal(mixerGraph(history.present)[collection].length, 1);
		assert.equal(mixerGraph(history.present)[collection][0]!.id, busId);
		assert.equal(mixerGraph(history.present)[collection][0]!.channelCount, 2);
		assert.equal(history.undoStack.length, 1);
		assert.deepEqual(mixerGraph(history.present).edges.find(({ source }) => source.kind === 'mixer-node'), {
			id: `assignment:mixer-node:${busId}:master`, kind: 'assignment',
			source: { kind: 'mixer-node', id: busId }, destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
		});
		const accepted = mixerGraph(history.present);
		const runtime = framescaperProjectForRuntimeConsumers(PROFILE, history.present);
		assert.deepEqual(mixerGraph(runtime), accepted);
		assert.notEqual(mixerGraph(runtime), accepted);
		history = undoFramescaperProjectCommand(PROFILE, history);
		assert.deepEqual(mixerGraph(history.present), mixerGraph(project));
		history = redoFramescaperProjectCommand(PROFILE, history);
		assert.deepEqual(mixerGraph(history.present), accepted);
		assert.deepEqual(project, before);
	});
	test(`normal native ${busType} gain and mute update mutate the canonical strip`, () => {
		const project = seeded(), before = structuredClone(project);
		const result = apply(PROFILE, project, { type: 'mixer/bus-update', busType, busId,
			changes: { gain: .25, mute: true, name: 'Edited bus' } });
		assert.equal(mixerGraph(result)[collection][0]!.gain, .25);
		assert.equal(mixerGraph(result)[collection][0]!.mute, true);
		assert.equal(mixerGraph(result)[collection][0]!.name, 'Edited bus');
		assert.deepEqual(mixerGraph(result).edges, mixerGraph(project).edges);
		assert.deepEqual(project, before);
	});
	test(`normal native ${busType} removal retires its canonical strip and edges`, () => {
		const project = seeded(), before = structuredClone(project);
		const result = apply(PROFILE, project, { type: 'mixer/bus-remove', busType, busId });
		assert.equal(mixerGraph(result)[collection].length, 0);
		assert.ok(mixerGraph(result).edges.every(edge => edge.source.kind !== 'mixer-node' || edge.source.id !== busId));
		assert.deepEqual(project, before);
	});
}

test('normal native Output and send controls retain exact destinations, levels and maps', () => {
	const project = seeded(), before = structuredClone(project);
	const result = apply(PROFILE, project, { type: 'mixer/route-update', trackId: 'dialogue',
		changes: { groupId: 'dialogue-group', sends: { 'room-send': .5 } } });
	assert.deepEqual(mixerGraph(result).edges.filter(edge => edge.source.kind === 'track'), [
		{ id: 'assignment:track:dialogue:mixer-node:dialogue-group', kind: 'assignment',
			source: { kind: 'track', id: 'dialogue' }, destination: { kind: 'mixer-node', id: 'dialogue-group' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
		{ id: 'send:track:dialogue:mixer-node:room-send', kind: 'send',
			source: { kind: 'track', id: 'dialogue' }, destination: { kind: 'mixer-node', id: 'room-send' },
			position: 'post-fader', level: .5, enabled: true, channelMap: [0, 1] },
	]);
	assert.deepEqual(project, before);
});

test('native mixed and nested batches retain graph edits in order with one Undo/Redo', () => {
	const project = fixture();
	let history = createFramescaperProjectHistory(PROFILE, project);
	history = executeFramescaperProjectCommand(PROFILE, history, { type: 'batch', commands: [
		{ type: 'mixer/bus-add', busType: 'group', bus: { id: 'dialogue-group' } },
		{ type: 'master/update', changes: { gain: .75 } },
		{ type: 'batch', commands: [
			{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'room-send' } },
			{ type: 'mixer/route-update', trackId: 'dialogue', changes: { groupId: 'dialogue-group', sends: { 'room-send': .5 } } },
		] },
	] });
	assert.equal(mixerGraph(history.present).groups.length, 1);
	assert.equal(mixerGraph(history.present).sends.length, 1);
	assert.equal(mixerGraph(history.present).edges.length, 5);
	assert.equal(history.present.master.gain, .75);
	assert.equal(history.undoStack.length, 1);
	const accepted = history.present;
	history = undoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(mixerGraph(history.present), mixerGraph(project));
	assert.deepEqual(history.present.master, project.master);
	history = redoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(mixerGraph(history.present), mixerGraph(accepted));
	assert.deepEqual(history.present.master, accepted.master);
});

test('existing native graph authoring and ordinary track toggles remain healthy', () => {
	const project = seeded();
	assert.equal(mixerGraph(project).groups.length, 1);
	assert.equal(mixerGraph(project).sends.length, 1);
	const muted = apply(PROFILE, project, { type: 'track/update', trackId: 'dialogue', changes: { mute: true } });
	assert.equal(muted.tracks.find(({ id }) => id === 'dialogue')!.mute, true);
	assert.deepEqual(mixerGraph(muted), mixerGraph(project));
});

test('removing a routed native group preserves sends and retires only the removed bus automation', () => {
	const base = seeded();
	const lane = (id: string, strip: { kind: 'track' | 'mixer-node'; id: string }) => ({
		id, address: { kind: 'strip', strip, parameterId: 'gain' }, timebase: 'absolute-samples',
		points: [{ id: `${id}-origin`, position: 0, value: .5 }], segments: [],
	});
	const project = apply(PROFILE, base, { type: 'batch', commands: [
		{ type: 'mixer/route-update', trackId: 'dialogue', changes: { groupId: 'dialogue-group', sends: { 'room-send': .5 } } },
		{ type: 'automation-lane/set', laneId: 'group-gain', expected: null,
			lane: lane('group-gain', { kind: 'mixer-node', id: 'dialogue-group' }) },
		{ type: 'automation-lane/set', laneId: 'track-gain', expected: null,
			lane: lane('track-gain', { kind: 'track', id: 'dialogue' }) },
	] });
	let history = createFramescaperProjectHistory(PROFILE, project);
	history = executeFramescaperProjectCommand(PROFILE, history,
		{ type: 'mixer/bus-remove', busType: 'group', busId: 'dialogue-group' });
	assert.equal(mixerGraph(history.present).groups.length, 0);
	assert.deepEqual(mixerGraph(history.present).sends, mixerGraph(project).sends);
	assert.deepEqual(mixerGraph(history.present).edges.find(({ id }) => id === 'send:track:dialogue:mixer-node:room-send'),
		mixerGraph(project).edges.find(({ id }) => id === 'send:track:dialogue:mixer-node:room-send'));
	const lanes: unknown = history.present.automationLanes;
	assert.ok(Array.isArray(lanes));
	assert.deepEqual(lanes.map((lane: unknown) => {
		assert.ok(lane && typeof lane === 'object' && 'id' in lane && typeof lane.id === 'string');
		return lane.id;
	}), ['track-gain']);
	assert.deepEqual(mixerGraph(history.present).edges.find(({ id }) => id === 'assignment:track:dialogue:master')?.destination,
		{ kind: 'master' });
	const accepted = history.present;
	history = undoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(mixerGraph(history.present), mixerGraph(project));
	assert.deepEqual(history.present.automationLanes, project.automationLanes);
	history = redoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(mixerGraph(history.present), mixerGraph(accepted));
	assert.deepEqual(history.present.automationLanes, accepted.automationLanes);
});

for (const busType of ['group', 'send'] as const) {
	const collection = busType === 'group' ? 'groups' : 'sends';
	const busId = busType === 'group' ? 'dialogue-group' : 'room-send';
	test(`the actual native transition preparation retains normal ${busType} strip updates`, () => {
		const project = seeded(), before = structuredClone(project);
		const command = { type: 'mixer/bus-update' as const, busType, busId, changes: { mute: true } };
		let allocated = 0;
		const prepared = prepareFramescaperVideoTransitionAllocations(PROFILE, project, command,
			() => { allocated++; return 'unneeded-transition'; });
		assert.deepEqual(prepared, command);
		assert.equal(allocated, 0);
		let history = createFramescaperProjectHistory(PROFILE, project);
		history = executeFramescaperProjectCommand(PROFILE, history, prepared);
		assert.equal(mixerGraph(history.present)[collection][0]!.mute, true);
		assert.equal(history.undoStack.length, 1);
		history = undoFramescaperProjectCommand(PROFILE, history);
		assert.equal(mixerGraph(history.present)[collection][0]!.mute, false);
		history = redoFramescaperProjectCommand(PROFILE, history);
		assert.equal(mixerGraph(history.present)[collection][0]!.mute, true);
		assert.deepEqual(project, before);
	});
	test(`the actual native transition preparation retains normal ${busType} removal`, () => {
		const project = seeded();
		const command = { type: 'mixer/bus-remove' as const, busType, busId };
		const prepared = prepareFramescaperVideoTransitionAllocations(PROFILE, project, command,
			() => { throw new Error('No visual overlap is authored by bus removal.'); });
		assert.deepEqual(prepared, command);
		const result = apply(PROFILE, project, prepared);
		assert.equal(mixerGraph(result)[collection].length, 0);
	});
}

test('actual native transition preparation respects a mixed compact mixer batch in order', () => {
	const project = fixture();
	const command = { type: 'batch' as const, commands: [
		{ type: 'mixer/bus-add' as const, busType: 'group' as const, bus: { id: 'dialogue-group' } },
		{ type: 'master/update' as const, changes: { gain: .75 } },
		{ type: 'mixer/bus-update' as const, busType: 'group' as const, busId: 'dialogue-group', changes: { mute: true } },
		{ type: 'mixer/route-update' as const, trackId: 'dialogue', changes: { groupId: 'dialogue-group' } },
	] };
	const prepared = prepareFramescaperVideoTransitionAllocations(PROFILE, project, command,
		() => { throw new Error('No visual overlap is authored by compact mixer edits.'); });
	let history = createFramescaperProjectHistory(PROFILE, project);
	history = executeFramescaperProjectCommand(PROFILE, history, prepared);
	assert.equal(mixerGraph(history.present).groups[0]!.mute, true);
	assert.equal(history.present.master.gain, .75);
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(mixerGraph(history.present).edges.find(({ source }) => source.kind === 'track')?.destination,
		{ kind: 'mixer-node', id: 'dialogue-group' });
	history = undoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(mixerGraph(history.present), mixerGraph(project));
	history = redoFramescaperProjectCommand(PROFILE, history);
	assert.equal(mixerGraph(history.present).groups[0]!.mute, true);
});

test('actual native transition preparation retains the ordinary output/send route', () => {
	const project = seeded();
	const command = { type: 'mixer/route-update' as const, trackId: 'dialogue',
		changes: { groupId: 'dialogue-group', sends: { 'room-send': .5 } } };
	const prepared = prepareFramescaperVideoTransitionAllocations(PROFILE, project, command,
		() => { throw new Error('No visual overlap is authored by output/send routing.'); });
	assert.deepEqual(prepared, command);
	const result = apply(PROFILE, project, prepared);
	assert.deepEqual(mixerGraph(result).edges.find(({ source }) => source.kind === 'track')?.destination,
		{ kind: 'mixer-node', id: 'dialogue-group' });
	assert.equal(mixerGraph(result).edges.find(({ kind }) => kind === 'send')?.level, .5);
});
