import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/lib/tools/audio-editor/audacity-binary-xml.js';
import { decodeAup4ProjectTree } from '../src/lib/tools/audio-editor/aup4-conversion.js';
import { aup4NativeEffectId } from '../src/lib/tools/audio-editor/aup4-effects.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/lib/tools/audio-editor/aup4-profile.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
} from '../src/lib/tools/audio-editor/project-v2.js';

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
		selection: { startFrame: 4410, endFrame: 8820, trackIds: [audioTrack.id] },
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
	assert.equal(decoded.project.tracks.find((track) => track.type === 'label').labels[0].title, 'Verse');
	assert.equal(decoded.sources.length, 1);
	assert.deepEqual(decoded.sources[0].channels[0], Float32Array.of(-1, -0.5, 0.5, 1));
	assert.deepEqual(decoded.sources[0].channels[1], Float32Array.of(1, 0.5, -0.5, -1));
	assert.deepEqual(decoded.warnings, []);
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
	assert.deepEqual(decoded.project.master.effects.map((effect) => effect.type), ['audacity-compressor']);
	decoded.project.master.effects = [];
	const rewritten = createAup4ProjectTree(decoded.project);
	assert.deepEqual(
		audacityXmlChildren(audacityXmlChildren(rewritten, 'effects').at(-1), 'effect').map((node) => audacityXmlAttribute(node, 'id')),
		['Effect_VST3_Missing_Missing_Missing'],
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

test('AUP4 conversion preserves source offsets and stretched timing across different project and source rates', async () => {
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
	assert.equal(audacityXmlAttribute(audacityXmlChildren(audacityXmlChildren(waveClip, 'envelope')[0], 'controlpoint')[0], 't'), 0.01);

	let id = 0;
	const decoded = await decodeAup4ProjectTree(tree, async () => sampleBlock, {
		idFactory: (prefix) => `${prefix}-${++id}`,
	});
	assert.equal(decoded.project.clips[0].sourceStartFrame, 100);
	assert.equal(decoded.project.clips[0].sourceDurationFrames, 400);
	assert.equal(decoded.project.clips[0].timelineStartFrame, 4_800);
	assert.equal(decoded.project.clips[0].durationFrames, 960);
	assert.deepEqual(decoded.project.clips[0].envelope, [{ frame: 480, value: 0.5 }]);
	assert.equal(decoded.project.sources[0].channelCount, 1);
	assert.equal(decoded.project.sources[0].sampleRate, 24_000);
	assert.equal(Object.hasOwn(decoded.project.tracks[0], 'sampleRate'), false);
});
