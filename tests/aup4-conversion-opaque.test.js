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
import {
	decodeAup4ProjectTree,
} from '../src/common/editor/aup4-conversion.js';
import { aup4NativeEffectId } from '../src/common/editor/aup4-effects.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createLabelTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

test('AUP4 conversion preserves interleaved track and opaque-root child order', async () => {
	const sources = ['first-source', 'second-source'].map((id) => createAudioSource({
		id,
		storageKey: id,
		name: id,
		frameCount: 2,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	const clips = sources.map((source, index) => createAudioClip({
		id: `ordered-clip-${index + 1}`,
		sourceId: source.id,
		title: source.name,
		sourceDurationFrames: 2,
		durationFrames: 2,
	}));
	const firstTrack = createAudioTrack({
		id: 'first-track',
		name: 'First audio',
		clipIds: [clips[0].id],
	});
	const labelTrack = createLabelTrack({
		id: 'middle-labels',
		name: 'Middle labels',
		labels: [],
	});
	const secondTrack = createAudioTrack({
		id: 'second-track',
		name: 'Second audio',
		clipIds: [clips[1].id],
	});
	const project = createCurrentAudioEditorProject({
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

	assert.deepEqual(decoded.project.tracks.map((track) => track.name), ['First audio', 'Second audio']);
	assert.ok(decoded.compatibilityReport.items.some(({ code }) => code === 'AUDACITY_EMPTY_LABEL_TRACK_OMITTED'));
	const rewritten = createAup4ProjectTree(decoded.project);
	assert.deepEqual(
		rewritten.content
			.filter((entry) => entry.kind === 'node')
			.map((entry) => entry.node.name),
		['tags', 'wavetrack', 'wavetrack', 'opaque-track-divider', 'effects'],
	);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(rewritten, 'opaque-track-divider')[0], 'revision'), 7);

	decoded.project.tracks.push(createAudioTrack({
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

test('AUP4 conversion reports and strips unsupported nested wave clips', async () => {
	const source = createAudioSource({
		id: 'nested-source', storageKey: 'nested-source', name: 'Nested source', frameCount: 4,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'nested-clip', sourceId: source.id, title: 'Outer clip',
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
	});
	const track = createAudioTrack({
		id: 'nested-track', name: 'Nested track', clipIds: [clip.id],
	});
	const project = createCurrentAudioEditorProject({
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
		[1, 'audacity-project', 'open'],
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
