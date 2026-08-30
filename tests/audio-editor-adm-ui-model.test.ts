import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAdmChna,
	encodeChnaPayload,
	generateAdmAxml,
} from '../src/common/editor/adm-metadata.ts';

import {
	addAdmEditorObject,
	admEditorChannelCount,
	createDefaultAdmMetadata,
	removeAdmEditorObject,
	setAdmEditorObject,
	createProjectAdmEditorValue,
	listAdmEditorSourceChannels,
	setAdmEditorAssignment,
	setAdmEditorLayout,
} from '../src/common/editor/ui/adm-metadata-editor-model.ts';

const PROJECT = {
	title: 'Evening News',
	revision: 4,
	masterChannels: 2,
	metadata: { adm: null },
	sources: [{ id: 'source-1', channelCount: 2 }],
	clips: [{ id: 'clip-1', sourceId: 'source-1' }],
	tracks: [{ id: 'track-1', type: 'audio', name: 'Main bed', clipIds: ['clip-1'] }],
	mixer: { groups: [], sends: [], routes: {} },
};

test('ADM editor defaults create a complete stereo DirectSpeakers routing', () => {
	const adm = createDefaultAdmMetadata(PROJECT);
	assert.equal(adm.mode, 'authored');
	assert.equal(adm.programme.name, 'Evening News');
	assert.equal(adm.bed.layout, 'stereo');
	assert.deepEqual(adm.bed.assignments, [
		{ stripKind: 'track', stripId: 'track-1', sourceChannel: 0, bedChannel: 'L', gain: 1 },
		{ stripKind: 'track', stripId: 'track-1', sourceChannel: 1, bedChannel: 'R', gain: 1 },
	]);
	assert.deepEqual(listAdmEditorSourceChannels(PROJECT).map(({ label }) => label), [
		'Main bed — channel 1',
		'Main bed — channel 2',
	]);
});

test('ADM editor restarts the bed mapping for every terminal strip', () => {
	const project = {
		...PROJECT,
		sources: [
			{ id: 'source-1', channelCount: 2 },
			{ id: 'source-2', channelCount: 2 },
		],
		clips: [
			{ id: 'clip-1', sourceId: 'source-1' },
			{ id: 'clip-2', sourceId: 'source-2' },
		],
		tracks: [
			{ id: 'track-1', type: 'audio', name: 'Music', clipIds: ['clip-1'] },
			{ id: 'track-2', type: 'audio', name: 'Dialogue', clipIds: ['clip-2'] },
		],
	};
	const adm = createDefaultAdmMetadata(project);
	assert.deepEqual(adm.bed.assignments.map(({ bedChannel }) => bedChannel), ['L', 'R', 'L', 'R']);
	assert.deepEqual(
		setAdmEditorLayout(adm, project, 'stereo').bed.assignments.map(({ bedChannel }) => bedChannel),
		['L', 'R', 'L', 'R'],
	);
});

test('ADM editor exposes the width that is routed into a terminal bus', () => {
	const project = {
		...PROJECT,
		masterChannels: 6,
		sources: [{ id: 'source-1', channelCount: 2 }],
		mixer: {
			groups: [{ id: 'group', name: 'Stereo group' }],
			sends: [],
			routes: { 'track-1': { groupId: 'group' } },
		},
	};

	assert.deepEqual(listAdmEditorSourceChannels(project).map(({ label }) => label), [
		'Stereo group — channel 1',
		'Stereo group — channel 2',
	]);
});

test('ADM editor offers only master-fed strips from a production mixer graph', () => {
	const project = {
		...PROJECT,
		schemaVersion: 21,
		masterChannels: 6,
		sources: [{ id: 'source-1', channelCount: 6 }],
		mixer: {
			schemaVersion: 1,
			groups: [{ id: 'group', name: 'Dialogue bus', channelCount: 6 }],
			sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 6 }],
			edges: [
				{
					id: 'track-to-group', kind: 'assignment',
					source: { kind: 'track', id: 'track-1' },
					destination: { kind: 'mixer-node', id: 'group' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1, 2, 3, 4, 5],
				},
				{
					id: 'group-to-master', kind: 'assignment',
					source: { kind: 'mixer-node', id: 'group' }, destination: { kind: 'master' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1, 2, 3, 4, 5],
				},
			],
		},
	};

	assert.deepEqual(listAdmEditorSourceChannels(project).map(({ label }) => label), [
		'Dialogue bus — channel 1',
		'Dialogue bus — channel 2',
		'Dialogue bus — channel 3',
		'Dialogue bus — channel 4',
		'Dialogue bus — channel 5',
		'Dialogue bus — channel 6',
	]);
});

test('ADM editor leaves surplus multichannel sources unassigned in a smaller bed', () => {
	const project = {
		...PROJECT,
		sources: [{ id: 'source-1', channelCount: 6 }],
	};

	assert.deepEqual(createDefaultAdmMetadata(project, 'stereo').bed.assignments, [
		{ stripKind: 'track', stripId: 'track-1', sourceChannel: 0, bedChannel: 'L', gain: 1 },
		{ stripKind: 'track', stripId: 'track-1', sourceChannel: 1, bedChannel: 'R', gain: 1 },
	]);
});

test('ADM editor layout and routing updates remain normalized', () => {
	const stereo = createDefaultAdmMetadata(PROJECT);
	const mono = setAdmEditorLayout(stereo, PROJECT, 'mono');
	assert.equal(mono.bed.layout, 'mono');
	assert.deepEqual(mono.bed.assignments.map(({ bedChannel }) => bedChannel), ['M', 'M']);
	const mutedRight = setAdmEditorAssignment(mono, {
		stripKind: 'track', stripId: 'track-1', sourceChannel: 1, bedChannel: null, gain: 1,
	});
	assert.equal(mutedRight.bed.assignments.length, 1);
	const restored = setAdmEditorAssignment(mutedRight, {
		stripKind: 'track', stripId: 'track-1', sourceChannel: 1, bedChannel: 'M', gain: 0.5,
	});
	assert.equal(restored.bed.assignments[1]?.gain, 0.5);
	const emptyTrackProject = {
		...PROJECT,
		tracks: [{ id: 'empty', type: 'audio', name: 'Empty', clipIds: [] }],
	};
	const emptyStereo = createDefaultAdmMetadata(emptyTrackProject);
	assert.equal(emptyStereo.bed.assignments.length, 2);
	assert.equal(setAdmEditorLayout(emptyStereo, emptyTrackProject, 'mono').bed.assignments.length, 2);
});

test('ADM editor preserves imported passthrough metadata until explicit conversion', () => {
	const xml = generateAdmAxml({ layout: 'stereo' });
	const chna = createAdmChna({ layout: 'stereo' });
	const passthrough = {
		mode: 'passthrough' as const,
		payload: {
			kind: 'axml' as const,
			xml,
			rawBase64: Buffer.from(xml).toString('base64'),
		},
		chna: {
			entries: chna.entries.map((entry) => ({
				trackIndex: entry.trackIndex,
				audioTrackUid: entry.uid,
				audioTrackFormatIdRef: entry.trackRef,
				audioPackFormatIdRef: entry.packRef,
			})),
			rawBase64: Buffer.from(encodeChnaPayload(chna)).toString('base64'),
		},
		source: { id: 'source-1', storageKey: 'pcm/source-1', mimeType: 'audio/wav' },
		geometry: { sampleRate: 48_000, channelCount: 2, frameCount: 10, bitDepth: 24 as const, float: false },
		pristineRevision: 4,
		valid: true,
		warnings: [],
	};
	assert.deepEqual(createProjectAdmEditorValue({
		...PROJECT,
		metadata: { adm: passthrough },
	}), passthrough);
});

test('the editor turns a source channel into an object, and takes it back', () => {
	const project = {
		masterChannels: 2,
		sources: [{ id: 'stereo', channelCount: 2 }, { id: 'mono', channelCount: 1 }],
		clips: [{ id: 'music-clip', sourceId: 'stereo' }, { id: 'voice-clip', sourceId: 'mono' }],
		tracks: [
			{ type: 'audio', id: 'music', name: 'Music', clipIds: ['music-clip'] },
			{ type: 'audio', id: 'narration', name: 'Narration', clipIds: ['voice-clip'] },
		],
		mixer: {},
	};
	const base = createDefaultAdmMetadata(project, 'stereo');
	const narration = listAdmEditorSourceChannels(project)
		.find(({ stripId }) => stripId === 'narration');
	assert.ok(narration);

	let ids = 0;
	const withObject = addAdmEditorObject(base, narration, () => `object-${++ids}`);
	assert.deepEqual(withObject.objects?.map(({ id, stripId, position }) => ({ id, stripId, position })), [{
		id: 'object-1',
		stripId: 'narration',
		// In front of the listener: an object has to start somewhere, and this is
		// the position an operator can hear as wrong.
		position: { azimuth: 0, elevation: 0, distance: 1 },
	}]);
	assert.equal(admEditorChannelCount(withObject), 3, 'the stereo bed plus one object');

	const placed = setAdmEditorObject(withObject, 'object-1', {
		name: 'Narrator', gain: 0.5, position: { azimuth: -45, elevation: 20, distance: 0.5 },
	});
	assert.equal(placed.objects?.[0]?.name, 'Narrator');
	assert.deepEqual(placed.objects?.[0]?.position, { azimuth: -45, elevation: 20, distance: 0.5 });

	// A partial move keeps the coordinates it did not name.
	const raised = setAdmEditorObject(placed, 'object-1', { position: { elevation: 30 } as never });
	assert.deepEqual(raised.objects?.[0]?.position, { azimuth: -45, elevation: 30, distance: 0.5 });

	const removed = removeAdmEditorObject(raised, 'object-1');
	assert.equal(Object.hasOwn(removed, 'objects'), false, 'the last object leaves no empty collection behind');
	assert.deepEqual(removed, base);
});

test('adding an object leaves the bed assignment its channel already had', () => {
	// One signal in the bed and as an object is a choice ADM allows; the editor
	// does not quietly undo it.
	const project = {
		masterChannels: 2,
		sources: [{ id: 'stereo', channelCount: 2 }],
		clips: [{ id: 'clip', sourceId: 'stereo' }],
		tracks: [{ type: 'audio', id: 'music', name: 'Music', clipIds: ['clip'] }],
		mixer: {},
	};
	const base = createDefaultAdmMetadata(project, 'stereo');
	const [left] = listAdmEditorSourceChannels(project);
	assert.ok(left);
	const withObject = addAdmEditorObject(base, left, () => 'object-1');
	assert.deepEqual(withObject.bed.assignments, base.bed.assignments);
});
