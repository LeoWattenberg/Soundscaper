import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import { aup4NativeEffectId } from '../src/common/editor/aup4-effects.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
} from '../src/common/editor/project-v2.js';

test('AUP4 conversion restores stereo audio, clips, metadata, labels, tempo, and selection', async () => {
	const source = createAudioSourceV2({
		id: 'source-1', storageKey: 'source-1', name: 'Source', frameCount: 4,
		channelCount: 2, sampleRate: 44_100, originalSampleRate: 44_100,
	});
	const clip = createAudioClipV2({
		id: 'clip-1', sourceId: source.id, title: 'Clip', timelineStartFrame: 4410,
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		pitchCents: 200, speedRatio: 1, groupId: 'group-a',
	});
	const audioTrack = createAudioTrackV2({
		id: 'track-1', name: 'Stereo',
		clipIds: [clip.id], displayMode: 'multiview',
	});
	const labelTrack = createLabelTrackV2({
		id: 'labels-1', name: 'Labels', labels: [{ id: 'label-1', title: 'Verse', startFrame: 4410, endFrame: 8820 }],
	});
	const project = createAudioEditorProjectV2({
		id: 'project-1', title: 'Fixture', sampleRate: 44_100,
		tempo: { bpm: 145, timeSignature: { numerator: 7, denominator: 8 } },
		metadata: { title: 'Native title', artist: 'kw.media' },
		selection: {
			startFrame: 4410,
			endFrame: 8820,
			trackIds: [audioTrack.id],
			clipIds: [clip.id],
			frequencyRange: { minimumFrequency: 120, maximumFrequency: 12_000 },
		},
		view: { selectedTrackIds: [audioTrack.id] },
		sources: [source], clips: [clip], tracks: [audioTrack, labelTrack],
	});
	const left = createAup4SampleBlock(Float32Array.of(-1, -0.5, 0.5, 1));
	const right = createAup4SampleBlock(Float32Array.of(1, 0.5, -0.5, -1));
	const blocks = new Map([
		['source-1:0', [{ blockId: 1, start: 0, sampleCount: 4 }]],
		['source-1:1', [{ blockId: 2, start: 0, sampleCount: 4 }]],
	]);
	const tree = createAup4ProjectTree(project, blocks);
	for (const waveTrack of audacityXmlChildren(tree, 'wavetrack')) {
		assert.equal(audacityXmlAttribute(audacityXmlChildren(waveTrack, 'waveclip')[0], 'isSelected'), true);
	}
	let nextId = 0;
	const decoded = await decodeAup4ProjectTree(tree, async (id) => id === 1 ? left : id === 2 ? right : null, {
		projectId: 'opened-project',
		title: 'opened.aup4',
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});

	assert.equal(decoded.project.schemaVersion, 2);
	assert.equal(decoded.project.sampleRate, 44_100);
	assert.equal(decoded.project.tempo.bpm, 145);
	assert.deepEqual(decoded.project.tempo.timeSignature, { numerator: 7, denominator: 8 });
	assert.equal(decoded.project.metadata.title, 'Native title');
	assert.equal(decoded.project.metadata.artist, 'kw.media');
	assert.equal(decoded.project.tracks.filter((track) => track.type === 'audio').length, 1);
	assert.equal(decoded.project.tracks.filter((track) => track.type === 'label').length, 1);
	for (const field of ['channelCount', 'channelLayout', 'sampleRate', 'sampleFormat']) {
		assert.equal(Object.hasOwn(decoded.project.tracks.find((track) => track.type === 'audio'), field), false);
	}
	assert.equal(decoded.project.sources[0].channelCount, 2);
	assert.equal(decoded.project.sources[0].sampleRate, 44_100);
	const decodedAudioTrack = decoded.project.tracks.find((track) => track.type === 'audio');
	assert.equal(decoded.project.tracks.find((track) => track.type === 'label').labels[0].title, 'Verse');
	assert.deepEqual(decoded.project.selection.trackIds, [decodedAudioTrack.id]);
	assert.deepEqual(decoded.project.selection.clipIds, [decodedAudioTrack.clipIds[0]]);
	assert.deepEqual(decoded.project.selection.frequencyRange, {
		minimumFrequency: 120,
		maximumFrequency: 12_000,
	});
	assert.equal(decoded.sources.length, 1);
	assert.deepEqual(decoded.sources[0].channels[0], Float32Array.of(-1, -0.5, 0.5, 1));
	assert.deepEqual(decoded.sources[0].channels[1], Float32Array.of(1, 0.5, -0.5, -1));
	assert.deepEqual(decoded.warnings, []);

	decoded.project.selection.frequencyRange = null;
	const withoutFrequencySelection = createAup4ProjectTree(decoded.project);
	assert.equal(audacityXmlAttributes(withoutFrequencySelection, 'selLow').length, 0);
	assert.equal(audacityXmlAttributes(withoutFrequencySelection, 'selHigh').length, 0);
});

test('AUP4 conversion reconciles mixed-rate and structurally mismatched linked-channel timelines', async () => {
	const source = createAudioSourceV2({
		id: 'linked-source',
		storageKey: 'linked-source',
		name: 'Linked source',
		frameCount: 480,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	const clip = createAudioClipV2({
		id: 'linked-clip',
		sourceId: source.id,
		title: 'Linked clip',
		sourceStartFrame: 0,
		sourceDurationFrames: 480,
		durationFrames: 480,
	});
	const track = createAudioTrackV2({
		id: 'linked-track',
		name: 'Linked track',
		clipIds: [clip.id],
	});
	const project = createAudioEditorProjectV2({
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

test('AUP4 conversion preserves native track color and spectrogram settings', async () => {
	const source = createAudioSourceV2({
		id: 'view-source',
		storageKey: 'view-source',
		name: 'View source',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	const clip = createAudioClipV2({
		id: 'view-clip',
		sourceId: source.id,
		title: 'View clip',
		sourceDurationFrames: 4,
		durationFrames: 4,
	});
	const track = createAudioTrackV2({
		id: 'view-track',
		name: 'View track',
		clipIds: [clip.id],
		displayMode: 'spectrogram',
	});
	const project = createAudioEditorProjectV2({
		id: 'view-project',
		title: 'View fixture',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});
	const tree = createAup4ProjectTree(project, new Map([
		['view-source:0', [{ blockId: 1, start: 0, sampleCount: 4 }]],
	]));
	const nativeTrack = audacityXmlChildren(tree, 'wavetrack')[0];
	for (const [name, value] of [
		['colorindex', 3],
		['syncWithGlobalSettings', false],
		['frequencyGain', 9],
		['windowType', 4],
		['zeroPaddingFactor', 3],
		['colorScheme', 7],
		['scaleType', 4],
		['algorithm', 6],
	]) audacityXmlAttributes(nativeTrack, name)[0].value = value;

	let nextId = 0;
	const decoded = await decodeAup4ProjectTree(
		tree,
		async () => createAup4SampleBlock(Float32Array.of(0.1, 0.2, 0.3, 0.4)),
		{ idFactory: (prefix) => `${prefix}-${++nextId}` },
	);
	const decodedTrack = decoded.project.tracks[0];
	assert.equal(decodedTrack.color, '#ffad51');
	assert.deepEqual({
		scale: decodedTrack.spectrogram.scale,
		windowType: decodedTrack.spectrogram.windowType,
		syncWithGlobal: decodedTrack.spectrogram.syncWithGlobal,
		frequencyGainDb: decodedTrack.spectrogram.frequencyGainDb,
		zeroPaddingFactor: decodedTrack.spectrogram.zeroPaddingFactor,
		colorScheme: decodedTrack.spectrogram.colorScheme,
		algorithm: decodedTrack.spectrogram.algorithm,
	}, {
		scale: 'erb',
		windowType: 'blackman',
		syncWithGlobal: false,
		frequencyGainDb: 9,
		zeroPaddingFactor: 3,
		colorScheme: 7,
		algorithm: 6,
	});

	const rewrittenTrack = audacityXmlChildren(createAup4ProjectTree(decoded.project), 'wavetrack')[0];
	for (const [name, value] of [
		['colorindex', 3],
		['syncWithGlobalSettings', false],
		['frequencyGain', 9],
		['windowType', 4],
		['zeroPaddingFactor', 3],
		['colorScheme', 7],
		['scaleType', 4],
		['algorithm', 6],
	]) assert.equal(audacityXmlAttribute(rewrittenTrack, name), value, name);
});

test('AUP4 conversion decodes int16, int24, float32, and silent sample blocks', async () => {
	const formats = [
		{ id: 'int16', sampleFormat: 0x00020001, blockId: 1 },
		{ id: 'int24', sampleFormat: 0x00040001, blockId: 2 },
		{ id: 'float32', sampleFormat: 0x0004000f, blockId: 3 },
		{ id: 'silent', sampleFormat: 0x0004000f, blockId: -3 },
	];
	const sources = formats.map(({ id }) => createAudioSourceV2({
		id: `${id}-source`,
		storageKey: `${id}-source`,
		name: id,
		frameCount: 3,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	const clips = sources.map((source) => createAudioClipV2({
		id: `${source.id}-clip`,
		sourceId: source.id,
		title: source.name,
		sourceDurationFrames: 3,
		durationFrames: 3,
	}));
	const tracks = clips.map((clip) => createAudioTrackV2({
		id: `${clip.id}-track`,
		name: clip.title,
		clipIds: [clip.id],
	}));
	const project = createAudioEditorProjectV2({
		id: 'sample-formats',
		title: 'Sample formats',
		sampleRate: 48_000,
		sources,
		clips,
		tracks,
	});
	const channelBlocks = new Map(formats.map((format, index) => [
		`${sources[index].id}:0`,
		[{ blockId: format.blockId, start: 0, sampleCount: 3 }],
	]));
	const tree = createAup4ProjectTree(project, channelBlocks);
	for (const [index, waveTrack] of audacityXmlChildren(tree, 'wavetrack').entries()) {
		audacityXmlAttributes(waveTrack, 'sampleformat')[0].value = formats[index].sampleFormat;
	}
	const int16 = new Uint8Array(6);
	const int16View = new DataView(int16.buffer);
	int16View.setInt16(0, -32_768, true);
	int16View.setInt16(2, 0, true);
	int16View.setInt16(4, 16_384, true);
	const int24 = new Uint8Array(12);
	const int24View = new DataView(int24.buffer);
	int24View.setInt32(0, -8_388_608, true);
	int24View.setInt32(4, 2_097_152, true);
	int24View.setInt32(8, 8_388_607, true);
	const float32 = createAup4SampleBlock(Float32Array.of(-0.75, 0, 1.25));
	const blocks = new Map([
		[1, { sampleformat: 0x00020001, samples: int16 }],
		[2, { sampleformat: 0x00040001, samples: int24 }],
		[3, float32],
	]);
	let nextId = 0;
	const loadedBlockIds = [];
	const decoded = await decodeAup4ProjectTree(tree, async (blockId) => {
		loadedBlockIds.push(blockId);
		return blocks.get(blockId);
	}, {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});

	assert.deepEqual(decoded.project.sources.map((source) => source.sampleFormat), [
		'int16',
		'int24',
		'float32',
		'float32',
	]);
	assert.deepEqual([...decoded.sources[0].channels[0]], [-1, 0, 0.5]);
	assert.deepEqual([...decoded.sources[1].channels[0]], [-1, 0.25, 8_388_607 / 8_388_608]);
	assert.deepEqual([...decoded.sources[2].channels[0]], [-0.75, 0, 1.25]);
	assert.deepEqual([...decoded.sources[3].channels[0]], [0, 0, 0]);
	assert.deepEqual(loadedBlockIds, [1, 2, 3]);

	nextId = 0;
	const missing = await decodeAup4ProjectTree(tree, async () => null, {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.deepEqual(
		missing.compatibilityReport.missingAudio.map(({ blockId, reason }) => ({ blockId, reason })),
		[1, 2, 3].map((blockId) => ({ blockId, reason: 'missing-local-sample-block' })),
	);
	assert.equal(
		missing.compatibilityReport.items.filter((item) => item.code === 'MISSING_LOCAL_AUDIO').length,
		3,
	);

	nextId = 0;
	const undecodable = await decodeAup4ProjectTree(tree, async () => ({
		sampleformat: 0x7fff_ffff,
		samples: Uint8Array.of(0),
	}), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.deepEqual(
		undecodable.compatibilityReport.missingAudio.map(({ blockId, reason }) => ({ blockId, reason })),
		[1, 2, 3].map((blockId) => ({ blockId, reason: 'undecodable-sample-block' })),
	);

	const mismatchedTree = structuredClone(tree);
	const mismatchedBlock = audacityXmlChildren(
		audacityXmlChildren(audacityXmlChildren(mismatchedTree, 'wavetrack')[0], 'waveclip')[0],
		'sequence',
	)[0];
	audacityXmlAttributes(audacityXmlChildren(mismatchedBlock, 'waveblock')[0], 'length')[0].value = 2;
	nextId = 0;
	const mismatched = await decodeAup4ProjectTree(mismatchedTree, async (blockId) => blocks.get(blockId), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.ok(mismatched.compatibilityReport.missingAudio.some((entry) => (
		entry.blockId === 1 && entry.reason === 'mismatched-sample-block-length'
	)));

	const zeroIdTree = structuredClone(tree);
	const zeroIdBlock = audacityXmlChildren(
		audacityXmlChildren(
			audacityXmlChildren(audacityXmlChildren(zeroIdTree, 'wavetrack')[0], 'waveclip')[0],
			'sequence',
		)[0],
		'waveblock',
	)[0];
	audacityXmlAttributes(zeroIdBlock, 'blockid')[0].value = 0;
	nextId = 0;
	const zeroId = await decodeAup4ProjectTree(zeroIdTree, async (blockId) => blocks.get(blockId), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.ok(zeroId.compatibilityReport.missingAudio.some((entry) => (
		entry.blockId === 0 && entry.reason === 'invalid-zero-sample-block'
	)));
});

test('AUP4 conversion preserves empty stereo track rate, collapsed state, and boundary tempo settings', async () => {
	const audioTrack = createAudioTrackV2({
		id: 'empty-stereo',
		name: 'Empty stereo',
		clipIds: [],
		collapsed: true,
		height: 160,
	});
	const labelTrack = createLabelTrackV2({
		id: 'collapsed-labels',
		name: 'Collapsed labels',
		labels: [],
		collapsed: true,
		height: 96,
	});
	const project = createAudioEditorProjectV2({
		id: 'empty-stereo-project',
		title: 'Empty stereo project',
		sampleRate: 48_000,
		tempo: { bpm: 1_000, timeSignature: { numerator: 33, denominator: 64 } },
		tracks: [audioTrack, labelTrack],
	});
	const tree = createAup4ProjectTree(project);
	assert.equal(audacityXmlAttribute(tree, 'time_signature_tempo'), 1_000);
	assert.equal(audacityXmlAttribute(tree, 'time_signature_upper'), 33);
	assert.equal(audacityXmlAttribute(tree, 'time_signature_lower'), 64);
	const leader = audacityXmlChildren(tree, 'wavetrack')[0];
	audacityXmlAttributes(leader, 'rate').at(-1).value = 44_100;
	audacityXmlAttributes(leader, 'linked')[0].value = 1;
	const follower = structuredClone(leader);
	audacityXmlAttributes(follower, 'channel')[0].value = 1;
	audacityXmlAttributes(follower, 'linked')[0].value = 0;
	follower.content = follower.content.filter((entry) => entry.kind !== 'node' || entry.node?.name !== 'effects');
	const leaderIndex = tree.content.findIndex((entry) => entry.kind === 'node' && entry.node === leader);
	tree.content.splice(leaderIndex + 1, 0, { kind: 'node', node: follower });

	let nextId = 0;
	const decoded = await decodeAup4ProjectTree(tree, async () => null, {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.equal(decoded.project.tracks[0].collapsed, true);
	assert.equal(decoded.project.tracks[1].collapsed, true);
	assert.deepEqual(decoded.project.tempo, {
		bpm: 1_000,
		timeSignature: { numerator: 33, denominator: 64 },
		detected: false,
	});
	const rewritten = createAup4ProjectTree(decoded.project);
	const rewrittenWaveTracks = audacityXmlChildren(rewritten, 'wavetrack');
	assert.equal(rewrittenWaveTracks.length, 2);
	assert.deepEqual(rewrittenWaveTracks.map((node) => audacityXmlAttribute(node, 'rate')), [44_100, 44_100]);
	assert.deepEqual(rewrittenWaveTracks.map((node) => audacityXmlAttribute(node, 'height')), [40, 40]);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(rewritten, 'labeltrack')[0], 'height'), 40);
});

test('AUP4 conversion preserves interleaved track and opaque-root child order', async () => {
	const sources = ['first-source', 'second-source'].map((id) => createAudioSourceV2({
		id,
		storageKey: id,
		name: id,
		frameCount: 2,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	const clips = sources.map((source, index) => createAudioClipV2({
		id: `ordered-clip-${index + 1}`,
		sourceId: source.id,
		title: source.name,
		sourceDurationFrames: 2,
		durationFrames: 2,
	}));
	const firstTrack = createAudioTrackV2({
		id: 'first-track',
		name: 'First audio',
		clipIds: [clips[0].id],
	});
	const labelTrack = createLabelTrackV2({
		id: 'middle-labels',
		name: 'Middle labels',
		labels: [],
	});
	const secondTrack = createAudioTrackV2({
		id: 'second-track',
		name: 'Second audio',
		clipIds: [clips[1].id],
	});
	const project = createAudioEditorProjectV2({
		id: 'ordered-project',
		title: 'Ordered',
		sampleRate: 48_000,
		sources,
		clips,
		tracks: [firstTrack, labelTrack, secondTrack],
	});
	const tree = createAup4ProjectTree(project, new Map([
		['first-source:0', [{ blockId: 1, start: 0, sampleCount: 2 }]],
		['second-source:0', [{ blockId: 2, start: 0, sampleCount: 2 }]],
	]));
	const secondWaveTrackIndex = tree.content.findIndex((entry) => (
		entry.kind === 'node'
		&& entry.node?.name === 'wavetrack'
		&& audacityXmlAttribute(entry.node, 'name') === 'Second audio'
	));
	tree.content.splice(secondWaveTrackIndex, 0, {
		kind: 'node',
		node: createAudacityXmlNode('opaque-track-divider', [
			{ kind: 'attribute', name: 'revision', type: 'int', value: 7 },
		]),
	});
	const blocks = new Map([
		[1, createAup4SampleBlock(Float32Array.of(0.1, 0.2))],
		[2, createAup4SampleBlock(Float32Array.of(0.3, 0.4))],
	]);
	let nextId = 0;
	const decoded = await decodeAup4ProjectTree(tree, async (blockId) => blocks.get(blockId), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});

	assert.deepEqual(decoded.project.tracks.map((track) => track.name), [
		'First audio',
		'Middle labels',
		'Second audio',
	]);
	const rewritten = createAup4ProjectTree(decoded.project);
	assert.deepEqual(
		rewritten.content
			.filter((entry) => entry.kind === 'node')
			.map((entry) => entry.node.name),
		['tags', 'wavetrack', 'labeltrack', 'opaque-track-divider', 'wavetrack', 'effects'],
	);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(rewritten, 'opaque-track-divider')[0], 'revision'), 7);

	decoded.project.tracks.push(createAudioTrackV2({
		id: 'new-empty-track',
		name: 'New empty track',
		clipIds: [],
	}));
	const withNewTrack = createAup4ProjectTree(decoded.project);
	const rootNodes = withNewTrack.content.filter((entry) => entry.kind === 'node').map((entry) => entry.node);
	assert.equal(rootNodes.at(-1).name, 'effects');
	assert.ok(
		rootNodes.findIndex((node) => node.name === 'wavetrack' && audacityXmlAttribute(node, 'name') === 'New empty track')
			< rootNodes.findIndex((node) => node.name === 'effects'),
	);
});

test('AUP4 conversion preserves overlapping native clips as layers on their original track', async () => {
	const sources = ['layer-source-a', 'layer-source-b'].map((id) => createAudioSourceV2({
		id,
		storageKey: id,
		name: id,
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	const clips = sources.map((source, index) => createAudioClipV2({
		id: `layer-clip-${index + 1}`,
		sourceId: source.id,
		title: `Layer ${index + 1}`,
		timelineStartFrame: index * 2,
		sourceStartFrame: 0,
		sourceDurationFrames: 4,
		durationFrames: 4,
	}));
	const track = createAudioTrackV2({
		id: 'layer-track',
		name: 'Layered track',
		clipIds: clips.map((clip) => clip.id),
	});
	const project = createAudioEditorProjectV2({
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
	const source = createAudioSourceV2({
		id: 'group-source', storageKey: 'group-source', name: 'Groups', frameCount: 16,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const groupIds = ['aup4-group-1', 'new-z', 'new-a', 'aup4-group-5'];
	const clips = groupIds.map((groupId, index) => createAudioClipV2({
		id: `group-clip-${index + 1}`,
		sourceId: source.id,
		title: groupId,
		timelineStartFrame: index * 4,
		sourceStartFrame: index * 4,
		sourceDurationFrames: 4,
		durationFrames: 4,
		groupId,
	}));
	const track = createAudioTrackV2({
		id: 'group-track', name: 'Groups', clipIds: clips.map((clip) => clip.id),
	});
	const createProject = (projectClips) => createAudioEditorProjectV2({
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

test('AUP4 conversion preserves unmodelled native root nodes, attributes, and master effects', async () => {
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
		{ kind: 'attribute', name: 'future-root-flag', type: 'bool', value: true },
	], [
		{ kind: 'node', node: createAudacityXmlNode('tags') },
		{ kind: 'node', node: createAudacityXmlNode('experimental-state', [
			{ kind: 'attribute', name: 'revision', type: 'long-long', value: 7 },
		]) },
		{ kind: 'node', node: createAudacityXmlNode('effects', [
			{ kind: 'attribute', name: 'active', type: 'bool', value: false },
		], [{ kind: 'node', node: createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'id', type: 'string', value: 'future-effect' },
		]) }]) },
	]);
	let id = 0;
	const decoded = await decodeAup4ProjectTree(root, async () => null, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	const rewritten = createAup4ProjectTree(decoded.project);
	assert.equal(audacityXmlAttribute(rewritten, 'future-root-flag'), true);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(rewritten, 'experimental-state')[0], 'revision'), 7);
	const masterEffects = audacityXmlChildren(rewritten, 'effects').at(-1);
	assert.equal(audacityXmlAttribute(masterEffects, 'active'), false);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(masterEffects, 'effect')[0], 'id'), 'future-effect');
});

test('AUP4 conversion discards excluded cloud/account state without dropping unrelated opaque extensions', async () => {
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
		{ kind: 'attribute', name: 'cloud-account', type: 'string', value: 'private-user' },
	], [
		{ kind: 'node', node: createAudacityXmlNode('tags', [], [
			{ kind: 'node', node: createAudacityXmlNode('tag', [
				{ kind: 'attribute', name: 'name', type: 'string', value: 'AUDIOCOM_ACCOUNT' },
				{ kind: 'attribute', name: 'value', type: 'string', value: 'private' },
			]) },
			{ kind: 'node', node: createAudacityXmlNode('tag', [
				{ kind: 'attribute', name: 'name', type: 'string', value: 'LICENSE' },
				{ kind: 'attribute', name: 'value', type: 'string', value: 'CC0' },
			]) },
		]) },
		{ kind: 'node', node: createAudacityXmlNode('cloud-sync', [
			{ kind: 'attribute', name: 'oauth-token', type: 'string', value: 'secret' },
		]) },
		{ kind: 'node', node: createAudacityXmlNode('plugin-state', [
			{ kind: 'attribute', name: 'revision', type: 'int', value: 2 },
		]) },
		{ kind: 'node', node: createAudacityXmlNode('cloud-reverb-plugin', [
			{ kind: 'attribute', name: 'preset', type: 'string', value: 'Large hall' },
		]) },
	]);
	let id = 0;
	const decoded = await decodeAup4ProjectTree(root, async () => null, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.equal(decoded.compatibilityReport.discardedCloudMetadata.discardedEntries, 3);
	assert.equal(decoded.compatibilityReport.networkAccessAttempted, false);
	assert.equal(decoded.project.metadata.tags.LICENSE, 'CC0');
	assert.equal(decoded.project.metadata.tags.AUDIOCOM_ACCOUNT, undefined);
	assert.match(decoded.warnings[0], /cloud\/account metadata/);

	const rewritten = createAup4ProjectTree(decoded.project);
	assert.equal(audacityXmlAttributes(rewritten, 'cloud-account').length, 0);
	assert.equal(audacityXmlChildren(rewritten, 'cloud-sync').length, 0);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(rewritten, 'plugin-state')[0], 'revision'), 2);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(rewritten, 'cloud-reverb-plugin')[0], 'preset'), 'Large hall');
	assert.deepEqual(
		audacityXmlChildren(audacityXmlChildren(rewritten, 'tags')[0], 'tag').map((tag) => audacityXmlAttribute(tag, 'name')),
		['LICENSE'],
	);
});

test('AUP4 conversion and profile distinguish deleted modeled effects from unavailable opaque effects', async () => {
	const compressor = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: aup4NativeEffectId('audacity-compressor') },
	]);
	const unavailable = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: false },
		{ kind: 'attribute', name: 'id', type: 'string', value: 'Effect_VST3_Missing_Missing_Missing' },
	]);
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
	], [{ kind: 'node', node: createAudacityXmlNode('effects', [], [
		{ kind: 'node', node: compressor },
		{ kind: 'node', node: unavailable },
	]) }]);
	let id = 0;
	const decoded = await decodeAup4ProjectTree(root, async () => null, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.deepEqual(decoded.project.master.effects.map((effect) => effect.type), ['audacity-compressor', 'missing']);
	assert.deepEqual(decoded.project.master.effects[1].missing, {
		name: 'Missing',
		nativeId: 'Effect_VST3_Missing_Missing_Missing',
		reason: 'plugin-unavailable',
		source: 'aup4',
	});
	const unedited = createAup4ProjectTree(decoded.project);
	assert.deepEqual(
		audacityXmlChildren(audacityXmlChildren(unedited, 'effects').at(-1), 'effect').map((node) => audacityXmlAttribute(node, 'id')),
		[aup4NativeEffectId('audacity-compressor'), 'Effect_VST3_Missing_Missing_Missing'],
	);
	decoded.project.master.effects = [];
	const rewritten = createAup4ProjectTree(decoded.project);
	assert.deepEqual(
		audacityXmlChildren(audacityXmlChildren(rewritten, 'effects').at(-1), 'effect').map((node) => audacityXmlAttribute(node, 'id')),
		[],
	);
});

test('AUP4 conversion keeps interleaved opaque attribute order, numeric widths, and unknown node payloads', async () => {
	const opaqueNode = createAudacityXmlNode('plugin-state', [
		{ kind: 'attribute', name: 'provider', type: 'string', value: 'unsupported.test' },
		{ kind: 'attribute', name: 'slot', type: 'size-t', value: 0xffff_ffff },
		{ kind: 'attribute', name: 'revision', type: 'long-long', value: 9_007_199_254_740_993n },
		{ kind: 'attribute', name: 'mix', type: 'float', value: 0.25, digits: 5 },
	], [
		{ kind: 'blob', name: 'state', value: Uint8Array.of(0, 1, 2, 255) },
		{ kind: 'data', value: 'opaque payload' },
	]);
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'future-before', type: 'long', value: -7 },
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'future-middle', type: 'double', value: 1.25, digits: 4 },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000, digits: -1 },
		{ kind: 'attribute', name: 'future-after', type: 'bool', value: true },
	], [{ kind: 'node', node: opaqueNode }]);
	let id = 0;
	const decoded = await decodeAup4ProjectTree(root, async () => null, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	const rewritten = createAup4ProjectTree(decoded.project);
	assert.deepEqual(
		audacityXmlAttributes(rewritten).slice(0, 6),
		audacityXmlAttributes(root),
	);
	assert.deepEqual(audacityXmlChildren(rewritten, 'plugin-state')[0], opaqueNode);

	const encoded = encodeAudacityBinaryXml(rewritten);
	const reparsed = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root;
	assert.deepEqual(audacityXmlAttributes(reparsed).slice(0, 6), audacityXmlAttributes(root));
	assert.deepEqual(audacityXmlChildren(reparsed, 'plugin-state')[0], opaqueNode);
});

test('AUP4 conversion preserves source offsets and stretched timing with Audacity 4 linear envelopes', async () => {
	const source = createAudioSourceV2({
		id: 'source-rate', storageKey: 'source-rate', name: 'Rate source', frameCount: 1_000,
		channelCount: 1, sampleRate: 24_000, originalSampleRate: 24_000,
	});
	const clip = createAudioClipV2({
		id: 'clip-rate', sourceId: source.id, title: 'Stretched', timelineStartFrame: 4_800,
		sourceStartFrame: 100, sourceDurationFrames: 400, durationFrames: 960,
		trimStartFrames: 100, trimEndFrames: 500, speedRatio: 1 / 1.2,
		envelope: [{ frame: 480, value: 0.5 }],
		opaqueExtensions: { aup4WaveClip: { kind: 'node', node: createAudacityXmlNode('waveclip', [
			{ kind: 'attribute', name: 'clipTempo', type: 'double', value: 60, digits: 8 },
			{ kind: 'attribute', name: 'rawAudioTempo', type: 'double', value: 120, digits: 8 },
		]) } },
	});
	const track = createAudioTrackV2({
		id: 'track-rate', name: 'Different rate',
		clipIds: [clip.id],
	});
	const project = createAudioEditorProjectV2({
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
	const source = createAudioSourceV2({
		id: 'formant-source', storageKey: 'formant-source', name: 'Formant source', frameCount: 4,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClipV2({
		id: 'formant-clip', sourceId: source.id, title: 'Formant clip',
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		preserveFormants: true,
	});
	const track = createAudioTrackV2({
		id: 'formant-track', name: 'Formant track', clipIds: [clip.id],
	});
	const project = createAudioEditorProjectV2({
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

test('AUP4 conversion reports and strips unsupported nested wave clips', async () => {
	const source = createAudioSourceV2({
		id: 'nested-source', storageKey: 'nested-source', name: 'Nested source', frameCount: 4,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClipV2({
		id: 'nested-clip', sourceId: source.id, title: 'Outer clip',
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
	});
	const track = createAudioTrackV2({
		id: 'nested-track', name: 'Nested track', clipIds: [clip.id],
	});
	const project = createAudioEditorProjectV2({
		id: 'nested-project', title: 'Nested fixture', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [track],
	});
	const sampleBlock = createAup4SampleBlock(Float32Array.of(0.1, 0.2, 0.3, 0.4));
	const tree = createAup4ProjectTree(project, new Map([
		['nested-source:0', [{ blockId: 1, start: 0, sampleCount: 4 }]],
	]));
	const nativeTrack = audacityXmlChildren(tree, 'wavetrack')[0];
	const nativeClip = audacityXmlChildren(nativeTrack, 'waveclip')[0];
	const trackEffectsIndex = nativeTrack.content.findIndex((entry) => entry.kind === 'node' && entry.node?.name === 'effects');
	nativeTrack.content.splice(trackEffectsIndex, 0, { kind: 'node', node: createAudacityXmlNode('track-before-effects') });
	const trackClipIndex = nativeTrack.content.findIndex((entry) => entry.kind === 'node' && entry.node?.name === 'waveclip');
	nativeTrack.content.splice(trackClipIndex, 0, { kind: 'node', node: createAudacityXmlNode('track-before-clip') });
	nativeTrack.content.push({ kind: 'node', node: createAudacityXmlNode('track-after-clip') });
	const sequenceIndex = nativeClip.content.findIndex((entry) => entry.kind === 'node' && entry.node?.name === 'sequence');
	nativeClip.content.splice(sequenceIndex, 0, { kind: 'node', node: createAudacityXmlNode('clip-before-sequence') });
	const envelopeIndex = nativeClip.content.findIndex((entry) => entry.kind === 'node' && entry.node?.name === 'envelope');
	nativeClip.content.splice(envelopeIndex, 0, { kind: 'node', node: createAudacityXmlNode('clip-before-envelope') });
	nativeClip.content.push({ kind: 'node', node: createAudacityXmlNode('clip-after-envelope') });
	nativeClip.content.push({ kind: 'node', node: createAudacityXmlNode('legacy-wrapper', [], [{
		kind: 'node',
		node: createAudacityXmlNode('waveclip', [
			{ kind: 'attribute', name: 'name', type: 'string', value: 'Legacy nested clip' },
		], [{ kind: 'node', node: createAudacityXmlNode('sequence', [
			{ kind: 'attribute', name: 'numsamples', type: 'long-long', value: 4 },
		], [{ kind: 'node', node: createAudacityXmlNode('waveblock', [
			{ kind: 'attribute', name: 'start', type: 'long-long', value: 0 },
			{ kind: 'attribute', name: 'length', type: 'long-long', value: 4 },
			{ kind: 'attribute', name: 'blockid', type: 'long-long', value: 999 },
		]) }]) }]),
	}]) });

	let id = 0;
	const decoded = await decodeAup4ProjectTree(tree, async (blockId) => blockId === 1 ? sampleBlock : null, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	const item = decoded.compatibilityReport.items.find((entry) => entry.code === 'UNSUPPORTED_NESTED_WAVECLIP');
	assert.deepEqual(
		[decoded.compatibilityReport.schemaVersion, decoded.compatibilityReport.format, decoded.compatibilityReport.direction],
		[1, 'aup4', 'open'],
	);
	assert.equal(item.disposition, 'omitted');
	assert.equal(item.data.count, 1);
	assert.equal(decoded.compatibilityReport.counts.omitted, 1);
	assert.match(decoded.warnings.join(' '), /unsupported nested wave clip/);

	const rewritten = createAup4ProjectTree(decoded.project);
	const rewrittenTrack = audacityXmlChildren(rewritten, 'wavetrack')[0];
	const rewrittenClip = audacityXmlChildren(rewrittenTrack, 'waveclip')[0];
	assert.equal(audacityXmlChildren(rewrittenClip, 'waveclip').length, 0);
	const rewrittenWrapper = audacityXmlChildren(rewrittenClip, 'legacy-wrapper')[0];
	assert.ok(rewrittenWrapper);
	assert.equal(audacityXmlChildren(rewrittenWrapper, 'waveclip').length, 0);
	assert.equal(JSON.stringify(rewritten).includes('999'), false);
	assert.deepEqual(
		rewrittenTrack.content.filter((entry) => entry.kind === 'node').map((entry) => entry.node.name),
		['track-before-effects', 'effects', 'track-before-clip', 'waveclip', 'track-after-clip'],
	);
	assert.deepEqual(
		rewrittenClip.content.filter((entry) => entry.kind === 'node').map((entry) => entry.node.name),
		['clip-before-sequence', 'sequence', 'clip-before-envelope', 'envelope', 'clip-after-envelope', 'legacy-wrapper'],
	);
});
