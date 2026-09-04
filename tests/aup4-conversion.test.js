import assert from 'node:assert/strict';
import test from 'node:test';
import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
} from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree, decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createLabelTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

test('AUP4 conversion restores stereo audio, clips, metadata, labels, tempo, and selection', async () => {
	const source = createAudioSource({
		id: 'source-1', storageKey: 'source-1', name: 'Source', frameCount: 4,
		channelCount: 2, sampleRate: 44_100, originalSampleRate: 44_100,
	});
	const clip = createAudioClip({
		id: 'clip-1', sourceId: source.id, title: 'Clip', timelineStartFrame: 4410,
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		pitchCents: 200, speedRatio: 1, groupId: 'group-a',
	});
	const audioTrack = createAudioTrack({
		id: 'track-1', name: 'Stereo',
		clipIds: [clip.id], displayMode: 'multiview',
	});
	const labelTrack = createLabelTrack({
		id: 'labels-1', name: 'Labels', labels: [{ id: 'label-1', title: 'Verse', startFrame: 4410, endFrame: 8820 }],
	});
	const project = createCurrentAudioEditorProject({
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

	assert.equal(decoded.project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(decoded.project.sampleRate, 44_100);
	assert.equal(decoded.project.tempo.bpm, 145);
	assert.deepEqual(decoded.project.tempo.timeSignature, { numerator: 7, denominator: 8 });
	assert.equal(decoded.project.metadata.title, 'Native title');
	assert.equal(decoded.project.metadata.artist, 'kw.media');
	assert.equal(decoded.project.tracks.filter((track) => track.type === 'audio').length, 1);
	assert.equal(decoded.project.tracks.filter((track) => track.type === 'label').length, 0);
	assert.equal(decoded.project.timelineAnnotations.length, 1);
	for (const field of ['channelCount', 'channelLayout', 'sampleRate', 'sampleFormat']) {
		assert.equal(Object.hasOwn(decoded.project.tracks.find((track) => track.type === 'audio'), field), false);
	}
	assert.equal(decoded.project.sources[0].channelCount, 2);
	assert.equal(decoded.project.sources[0].sampleRate, 44_100);
	const decodedAudioTrack = decoded.project.tracks.find((track) => track.type === 'audio');
	assert.equal(decoded.project.timelineAnnotations[0].name, 'Verse');
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

test('AUP4 conversion preserves native track color and spectrogram settings', async () => {
	const source = createAudioSource({
		id: 'view-source',
		storageKey: 'view-source',
		name: 'View source',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'view-clip',
		sourceId: source.id,
		title: 'View clip',
		sourceDurationFrames: 4,
		durationFrames: 4,
	});
	const track = createAudioTrack({
		id: 'view-track',
		name: 'View track',
		clipIds: [clip.id],
		displayMode: 'spectrogram',
	});
	const project = createCurrentAudioEditorProject({
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
	const sources = formats.map(({ id }) => createAudioSource({
		id: `${id}-source`,
		storageKey: `${id}-source`,
		name: id,
		frameCount: 3,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	const clips = sources.map((source) => createAudioClip({
		id: `${source.id}-clip`,
		sourceId: source.id,
		title: source.name,
		sourceDurationFrames: 3,
		durationFrames: 3,
	}));
	const tracks = clips.map((clip) => createAudioTrack({
		id: `${clip.id}-track`,
		name: clip.title,
		clipIds: [clip.id],
	}));
	const project = createCurrentAudioEditorProject({
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
	await assert.rejects(
		decodeAudacityProjectTree(tree, async () => null, {
			idFactory: (prefix) => `${prefix}-${++nextId}`,
			sourceGeneration: 'aup3',
		}),
		(error) => error.code === 'MISSING_SAMPLE_BLOCK',
	);

	nextId = 0;
	await assert.rejects(
		decodeAudacityProjectTree(tree, async () => ({
			sampleformat: 0x7fff_ffff,
			samples: Uint8Array.of(0),
		}), { idFactory: (prefix) => `${prefix}-${++nextId}` }),
		(error) => error.code === 'UNSUPPORTED_SAMPLE_FORMAT',
	);

	const mismatchedTree = structuredClone(tree);
	const mismatchedBlock = audacityXmlChildren(
		audacityXmlChildren(audacityXmlChildren(mismatchedTree, 'wavetrack')[0], 'waveclip')[0],
		'sequence',
	)[0];
	audacityXmlAttributes(audacityXmlChildren(mismatchedBlock, 'waveblock')[0], 'length')[0].value = 2;
	nextId = 0;
	await assert.rejects(
		decodeAudacityProjectTree(mismatchedTree, async (blockId) => blocks.get(blockId), {
			idFactory: (prefix) => `${prefix}-${++nextId}`,
		}),
		(error) => error.code === 'CORRUPT_SEQUENCE',
	);

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
	await assert.rejects(
		decodeAudacityProjectTree(zeroIdTree, async (blockId) => blocks.get(blockId), {
			idFactory: (prefix) => `${prefix}-${++nextId}`,
		}),
		(error) => error.code === 'INVALID_SAMPLE_BLOCK',
	);
});

test('AUP4 conversion preserves empty stereo track rate, collapsed state, and boundary tempo settings', async () => {
	const audioTrack = createAudioTrack({
		id: 'empty-stereo',
		name: 'Empty stereo',
		clipIds: [],
		collapsed: true,
		height: 160,
	});
	const labelTrack = createLabelTrack({
		id: 'collapsed-labels',
		name: 'Collapsed labels',
		labels: [],
		collapsed: true,
		height: 96,
	});
	const project = createCurrentAudioEditorProject({
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
	assert.equal(decoded.project.tracks.length, 1);
	assert.equal(decoded.project.timelineAnnotations.length, 0);
	assert.ok(decoded.compatibilityReport.items.some(({ code }) => code === 'AUDACITY_EMPTY_LABEL_TRACK_OMITTED'));
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
	assert.equal(audacityXmlChildren(rewritten, 'labeltrack').length, 0);
});
