import assert from 'node:assert/strict';
import test from 'node:test';
import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	decodeAup4ProjectTree,
} from '../src/common/editor/aup4-conversion.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

test('AUP4 conversion reconciles mixed-rate and structurally mismatched linked-channel timelines', async () => {
	const source = createAudioSource({
		id: 'linked-source',
		storageKey: 'linked-source',
		name: 'Linked source',
		frameCount: 480,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'linked-clip',
		sourceId: source.id,
		title: 'Linked clip',
		sourceStartFrame: 0,
		sourceDurationFrames: 480,
		durationFrames: 480,
	});
	const track = createAudioTrack({
		id: 'linked-track',
		name: 'Linked track',
		clipIds: [clip.id],
	});
	const project = createCurrentAudioEditorProject({
		id: 'linked-project',
		title: 'Linked fixture',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});
	const blockMap = new Map([
		['linked-source:0', [{ blockId: 1, start: 0, sampleCount: 480 }]],
		['linked-source:1', [{ blockId: 2, start: 0, sampleCount: 480 }]],
	]);
	const mixedRateTree = createAup4ProjectTree(project, blockMap);
	const mixedRateTracks = audacityXmlChildren(mixedRateTree, 'wavetrack');
	audacityXmlAttributes(mixedRateTracks[1], 'rate').at(-1).value = 44_100;
	const mixedRateSequence = audacityXmlChildren(audacityXmlChildren(mixedRateTracks[1], 'waveclip')[0], 'sequence')[0];
	audacityXmlAttributes(mixedRateSequence, 'numsamples')[0].value = 441;
	audacityXmlAttributes(audacityXmlChildren(mixedRateSequence, 'waveblock')[0], 'length')[0].value = 441;
	let nextId = 0;
	const mixedRate = await decodeAup4ProjectTree(mixedRateTree, async (blockId) => (
		blockId === 1
			? createAup4SampleBlock(Float32Array.from({ length: 480 }, () => 0.25))
			: createAup4SampleBlock(Float32Array.from({ length: 441 }, () => -0.25))
	), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});

	assert.equal(mixedRate.project.tracks.length, 1);
	assert.equal(mixedRate.project.clips.length, 1);
	assert.equal(mixedRate.sources[0].channels.length, 2);
	assert.equal(mixedRate.sources[0].channels[0].length, 480);
	assert.equal(mixedRate.sources[0].channels[1].length, 480);
	assert.ok(mixedRate.compatibilityReport.items.some((item) => item.code === 'LINKED_CHANNEL_RATE_CONVERTED'));
	assert.equal(mixedRate.compatibilityReport.items.some((item) => item.code === 'LINKED_CHANNEL_MISMATCH'), false);

	const mismatchedTree = createAup4ProjectTree(project, blockMap);
	const followerSequence = audacityXmlChildren(
		audacityXmlChildren(audacityXmlChildren(mismatchedTree, 'wavetrack')[1], 'waveclip')[0],
		'sequence',
	)[0];
	audacityXmlAttributes(followerSequence, 'numsamples')[0].value = 400;
	audacityXmlAttributes(audacityXmlChildren(followerSequence, 'waveblock')[0], 'length')[0].value = 400;
	nextId = 0;
	const mismatched = await decodeAup4ProjectTree(mismatchedTree, async (blockId) => (
		blockId === 1
			? createAup4SampleBlock(Float32Array.from({ length: 480 }, () => 0.5))
			: createAup4SampleBlock(Float32Array.from({ length: 400 }, () => -0.5))
	), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.equal(mismatched.project.clips.length, 1);
	assert.equal(mismatched.sources[0].channels[1].length, 480);
	assert.deepEqual(mismatched.sources[0].channels[1].subarray(400), new Float32Array(80));
	assert.ok(mismatched.compatibilityReport.items.some((item) => item.code === 'LINKED_CHANNEL_MISMATCH'));
});

test('AUP4 conversion imports exact musical, time, and video snap grids and preserves future types', async () => {
	for (const [type, division] of [[6, '1/64'], [8, 'seconds'], [14, 'video-ntsc']]) {
		const root = createAudacityXmlNode('project', [
			{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
			{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
			{ kind: 'attribute', name: 'snap_enabled', type: 'bool', value: true },
			{ kind: 'attribute', name: 'snap_type', type: 'int', value: type },
			{ kind: 'attribute', name: 'snap_triplets', type: 'bool', value: type === 6 },
		]);
		let nextId = 0;
		const decoded = await decodeAup4ProjectTree(root, async () => null, {
			idFactory: (prefix) => `${prefix}-${++nextId}`,
		});
		assert.equal(decoded.project.snap.division, division);
		assert.equal(decoded.project.snap.opaqueType, type);
		assert.equal(decoded.project.snap.triplets, type === 6);
		assert.equal(audacityXmlAttribute(createAup4ProjectTree(decoded.project), 'snap_type'), type);
	}

	const futureRoot = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
		{ kind: 'attribute', name: 'snap_type', type: 'int', value: 77 },
	]);
	let nextId = 0;
	const future = await decodeAup4ProjectTree(futureRoot, async () => null, {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.equal(future.project.snap.division, 'seconds');
	assert.equal(future.project.snap.opaqueType, 77);
	assert.equal(audacityXmlAttribute(createAup4ProjectTree(future.project), 'snap_type'), 77);

	future.project.snap.division = 'video-pal';
	future.project.snap.unit = 'video-pal';
	future.project.snap.opaqueType = 16;
	assert.equal(audacityXmlAttribute(createAup4ProjectTree(future.project), 'snap_type'), 16);
});

test('AUP4 conversion preserves overlapping native clips as layers on their original track', async () => {
	const sources = ['layer-source-a', 'layer-source-b'].map((id) => createAudioSource({
		id,
		storageKey: id,
		name: id,
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	const clips = sources.map((source, index) => createAudioClip({
		id: `layer-clip-${index + 1}`,
		sourceId: source.id,
		title: `Layer ${index + 1}`,
		timelineStartFrame: index * 2,
		sourceStartFrame: 0,
		sourceDurationFrames: 4,
		durationFrames: 4,
	}));
	const track = createAudioTrack({
		id: 'layer-track',
		name: 'Layered track',
		clipIds: clips.map((clip) => clip.id),
	});
	const project = createCurrentAudioEditorProject({
		id: 'layer-project',
		title: 'Layer project',
		sampleRate: 48_000,
		sources,
		clips,
		tracks: [track],
	});
	const blocks = new Map([
		['layer-source-a:0', [{ blockId: 1, start: 0, sampleCount: 4 }]],
		['layer-source-b:0', [{ blockId: 2, start: 0, sampleCount: 4 }]],
	]);
	const tree = createAup4ProjectTree(project, blocks);
	const sampleBlocks = new Map([
		[1, createAup4SampleBlock(Float32Array.of(0.1, 0.2, 0.3, 0.4))],
		[2, createAup4SampleBlock(Float32Array.of(-0.1, -0.2, -0.3, -0.4))],
	]);
	let nextId = 0;
	const decoded = await decodeAup4ProjectTree(tree, async (id) => sampleBlocks.get(id), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});

	const audioTracks = decoded.project.tracks.filter((candidate) => candidate.type === 'audio');
	assert.equal(audioTracks.length, 1);
	assert.equal(audioTracks[0].clipIds.length, 2);
	assert.deepEqual(
		audioTracks[0].clipIds.map((clipId) => (
			decoded.project.clips.find((clip) => clip.id === clipId).timelineStartFrame
		)),
		[0, 2],
	);
	assert.deepEqual(decoded.warnings, []);
});

test('AUP4 export preserves imported group numbers and deterministically avoids collisions for new groups', () => {
	const source = createAudioSource({
		id: 'group-source', storageKey: 'group-source', name: 'Groups', frameCount: 16,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const groupIds = ['aup4-group-1', 'new-z', 'new-a', 'aup4-group-5'];
	const clips = groupIds.map((groupId, index) => createAudioClip({
		id: `group-clip-${index + 1}`,
		sourceId: source.id,
		title: groupId,
		timelineStartFrame: index * 4,
		sourceStartFrame: index * 4,
		sourceDurationFrames: 4,
		durationFrames: 4,
		groupId,
	}));
	const track = createAudioTrack({
		id: 'group-track', name: 'Groups', clipIds: clips.map((clip) => clip.id),
	});
	const createProject = (projectClips) => createCurrentAudioEditorProject({
		id: 'group-project', title: 'Groups', sampleRate: 48_000,
		sources: [source], clips: projectClips, tracks: [track],
	});
	const exportedGroups = (project) => Object.fromEntries(
		audacityXmlChildren(audacityXmlChildren(createAup4ProjectTree(project), 'wavetrack')[0], 'waveclip')
			.map((node) => [audacityXmlAttribute(node, 'name'), audacityXmlAttribute(node, 'groupId')]),
	);

	const expected = {
		'aup4-group-1': 1,
		'new-z': 2,
		'new-a': 0,
		'aup4-group-5': 5,
	};
	assert.deepEqual(exportedGroups(createProject(clips)), expected);
	assert.deepEqual(exportedGroups(createProject([...clips].reverse())), expected);
	assert.equal(new Set(Object.values(expected)).size, groupIds.length);
});

test('AUP4 conversion preserves source offsets and stretched timing with Audacity 4 linear envelopes', async () => {
	const source = createAudioSource({
		id: 'source-rate', storageKey: 'source-rate', name: 'Rate source', frameCount: 1_000,
		channelCount: 1, sampleRate: 24_000, originalSampleRate: 24_000,
	});
	const clip = createAudioClip({
		id: 'clip-rate', sourceId: source.id, title: 'Stretched', timelineStartFrame: 4_800,
		sourceStartFrame: 100, sourceDurationFrames: 400, durationFrames: 960,
		trimStartFrames: 100, trimEndFrames: 500, speedRatio: 1 / 1.2,
		envelope: [{ frame: 480, value: 0.5 }],
		opaqueExtensions: { aup4WaveClip: { kind: 'node', node: createAudacityXmlNode('waveclip', [
			{ kind: 'attribute', name: 'clipTempo', type: 'double', value: 60, digits: 8 },
			{ kind: 'attribute', name: 'rawAudioTempo', type: 'double', value: 120, digits: 8 },
		]) } },
	});
	const track = createAudioTrack({
		id: 'track-rate', name: 'Different rate',
		clipIds: [clip.id],
	});
	const project = createCurrentAudioEditorProject({
		id: 'project-rate', title: 'Rate fixture', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [track],
	});
	const sampleBlock = createAup4SampleBlock(new Float32Array(1_000));
	const tree = createAup4ProjectTree(project, new Map([
		['source-rate:0', [{ blockId: 1, start: 0, sampleCount: 1_000 }]],
	]));
	const waveClip = audacityXmlChildren(audacityXmlChildren(tree, 'wavetrack')[0], 'waveclip')[0];
	assert.equal(audacityXmlAttribute(waveClip, 'clipStretchRatio'), 0.6);
	assert.equal(audacityXmlAttribute(waveClip, 'clipTempo'), 60);
	assert.equal(audacityXmlAttribute(waveClip, 'rawAudioTempo'), 120);
	assert.equal(audacityXmlAttribute(waveClip, 'trimLeft'), 0.005);
	assert.equal(audacityXmlAttribute(waveClip, 'offset'), 0.095);
	assert.deepEqual(
		audacityXmlChildren(audacityXmlChildren(waveClip, 'envelope')[0], 'controlpoint')
			.map((point) => audacityXmlAttribute(point, 't')),
		[0.005, 0.015],
	);

	let id = 0;
	const decoded = await decodeAup4ProjectTree(tree, async () => sampleBlock, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.equal(decoded.project.clips[0].sourceStartFrame, 100);
	assert.equal(decoded.project.clips[0].sourceDurationFrames, 400);
	assert.equal(decoded.project.clips[0].timelineStartFrame, 4_800);
	assert.equal(decoded.project.clips[0].durationFrames, 960);
	assert.deepEqual(decoded.project.clips[0].envelope, [
		{ frame: 0, value: 1 },
		{ frame: 480, value: 0.5 },
	]);
	assert.equal(decoded.project.sources[0].channelCount, 1);
	assert.equal(decoded.project.sources[0].sampleRate, 24_000);
	assert.equal(Object.hasOwn(decoded.project.tracks[0], 'sampleRate'), false);

	const linearTree = structuredClone(tree);
	const linearClip = audacityXmlChildren(audacityXmlChildren(linearTree, 'wavetrack')[0], 'waveclip')[0];
	const linearPoints = audacityXmlChildren(audacityXmlChildren(linearClip, 'envelope')[0], 'controlpoint');
	audacityXmlAttributes(linearPoints[0], 't')[0].value = 0;
	audacityXmlAttributes(linearPoints[0], 'val')[0].value = 0;
	audacityXmlAttributes(linearPoints[1], 't')[0].value = 0.01;
	audacityXmlAttributes(linearPoints[1], 'val')[0].value = 1;
	id = 0;
	const linear = await decodeAup4ProjectTree(linearTree, async () => sampleBlock, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.equal(linear.project.clips[0].envelope[0].frame, 0);
	assert.equal(linear.project.clips[0].envelope[0].value, 0.5);
});

test('AUP4 conversion maps formant preservation through pitchAndSpeedPreset', async () => {
	const source = createAudioSource({
		id: 'formant-source', storageKey: 'formant-source', name: 'Formant source', frameCount: 4,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'formant-clip', sourceId: source.id, title: 'Formant clip',
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		preserveFormants: true,
	});
	const track = createAudioTrack({
		id: 'formant-track', name: 'Formant track', clipIds: [clip.id],
	});
	const project = createCurrentAudioEditorProject({
		id: 'formant-project', title: 'Formant fixture', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [track],
	});
	const sampleBlock = createAup4SampleBlock(Float32Array.of(0.1, 0.2, 0.3, 0.4));
	const tree = createAup4ProjectTree(project, new Map([
		['formant-source:0', [{ blockId: 1, start: 0, sampleCount: 4 }]],
	]));
	const nativeClip = audacityXmlChildren(audacityXmlChildren(tree, 'wavetrack')[0], 'waveclip')[0];
	assert.equal(audacityXmlAttribute(nativeClip, 'pitchAndSpeedPreset'), 1);
	assert.equal(audacityXmlAttributes(nativeClip, 'preserveFormants').length, 0);

	let id = 0;
	const decoded = await decodeAup4ProjectTree(tree, async () => sampleBlock, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.equal(decoded.project.clips[0].preserveFormants, true);

	const preset = nativeClip.content.find((entry) => entry.kind === 'attribute' && entry.name === 'pitchAndSpeedPreset');
	preset.value = 100_000;
	id = 0;
	const unknown = await decodeAup4ProjectTree(tree, async () => sampleBlock, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.equal(unknown.project.clips[0].preserveFormants, false);
	const rewritten = createAup4ProjectTree(unknown.project);
	const rewrittenClip = audacityXmlChildren(audacityXmlChildren(rewritten, 'wavetrack')[0], 'waveclip')[0];
	assert.equal(audacityXmlAttribute(rewrittenClip, 'pitchAndSpeedPreset'), 100_000);
});
