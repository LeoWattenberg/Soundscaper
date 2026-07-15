import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityXmlAttribute, audacityXmlChildren } from '../src/lib/tools/audio-editor/audacity-binary-xml.js';
import { decodeAup4ProjectTree } from '../src/lib/tools/audio-editor/aup4-conversion.js';
import { normalizeAup4ExportSnapshot } from '../src/lib/tools/audio-editor/aup4-export.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/lib/tools/audio-editor/aup4-profile.js';

test('AUP4 export normalizes mixed-rate mono and stereo clips to one fixed track profile', async () => {
	const mono = Float32Array.from({ length: 441 }, (_, frame) => Math.sin(frame / 17));
	const left = Float32Array.from({ length: 480 }, (_, frame) => frame / 480);
	const right = Float32Array.from({ length: 480 }, (_, frame) => -frame / 480);
	const project = fixtureProject({
		sampleRate: 48_000,
		sources: [
			source('mono-source', 44_100, 1, 441),
			source('stereo-source', 48_000, 2, 480),
		],
		clips: [
			clip('mono-clip', 'mono-source', {
				timelineStartFrame: 120,
				sourceStartFrame: 44,
				sourceDurationFrames: 353,
				durationFrames: 384,
				trimStartFrames: 44,
				trimEndFrames: 44,
				envelope: [{ frame: 192, value: 0.5 }],
			}),
			clip('stereo-clip', 'stereo-source', {
				timelineStartFrame: 1_000,
				sourceDurationFrames: 480,
				durationFrames: 480,
			}),
		],
		tracks: [track('mixed-track', ['mono-clip', 'stereo-clip'])],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, [
		{ sourceId: 'mono-source', sampleRate: 44_100, channels: [mono] },
		{ sourceId: 'stereo-source', sampleRate: 48_000, channels: [left, right] },
	]);

	assert.equal(snapshot.sources.length, 2);
	assert.ok(snapshot.project.tracks.every((item) => !Object.hasOwn(item, 'sampleRate') && !Object.hasOwn(item, 'channelCount')));
	for (const normalized of snapshot.project.sources) {
		assert.equal(normalized.sampleRate, 48_000);
		assert.equal(normalized.channelCount, 2);
	}
	const normalizedMono = snapshot.sources.find((item) => item.sourceId === snapshot.project.clips[0].sourceId);
	assert.equal(normalizedMono.channels[0].length, 480);
	assert.deepEqual(normalizedMono.channels[0], normalizedMono.channels[1]);
	assert.notStrictEqual(normalizedMono.channels[0], normalizedMono.channels[1]);
	const normalizedStereo = snapshot.sources.find((item) => item.sourceId === snapshot.project.clips[1].sourceId);
	assert.deepEqual(normalizedStereo.channels, [left, right]);
	assert.notStrictEqual(normalizedStereo.channels[0], left);
	assert.deepEqual(snapshot.project.clips[0], {
		...project.clips[0],
		sourceId: normalizedMono.sourceId,
		sourceStartFrame: 48,
		sourceDurationFrames: 384,
		trimStartFrames: 48,
		trimEndFrames: 48,
	});
	assert.equal(project.clips[0].sourceStartFrame, 44);
	assert.equal(project.clips[0].sourceDurationFrames, 353);
	assert.deepEqual(mono, Float32Array.from({ length: 441 }, (_, frame) => Math.sin(frame / 17)));

	const nativeBlocks = nativeBlockFixture(snapshot.sources);
	const tree = createAup4ProjectTree(snapshot.project, nativeBlocks.channelBlocks);
	const waveTracks = audacityXmlChildren(tree, 'wavetrack');
	assert.equal(waveTracks.length, 2);
	assert.deepEqual(waveTracks.map((node) => audacityXmlAttribute(node, 'rate')), [48_000, 48_000]);
	assert.deepEqual(waveTracks.map((node) => audacityXmlAttribute(node, 'channel')), [0, 1]);
	let nextId = 0;
	const reopened = await decodeAup4ProjectTree(tree, async (blockId) => nativeBlocks.sampleBlocks.get(blockId), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	const reopenedMono = reopened.project.clips.find((item) => item.title === 'mono-clip');
	assert.deepEqual({
		timelineStartFrame: reopenedMono.timelineStartFrame,
		sourceStartFrame: reopenedMono.sourceStartFrame,
		sourceDurationFrames: reopenedMono.sourceDurationFrames,
		durationFrames: reopenedMono.durationFrames,
		trimStartFrames: reopenedMono.trimStartFrames,
		trimEndFrames: reopenedMono.trimEndFrames,
		envelope: reopenedMono.envelope,
	}, {
		timelineStartFrame: 120,
		sourceStartFrame: 48,
		sourceDurationFrames: 384,
		durationFrames: 384,
		trimStartFrames: 48,
		trimEndFrames: 48,
		envelope: [{ frame: 192, value: 0.5 }],
	});
	const reopenedMonoAudio = reopened.sources.find((item) => item.sourceId === reopenedMono.sourceId);
	assert.equal(reopenedMonoAudio.sampleRate, 48_000);
	assert.deepEqual(reopenedMonoAudio.channels[0], reopenedMonoAudio.channels[1]);
});

test('AUP4 export preserves a homogeneous source rate and exact PCM', () => {
	const left = Float32Array.of(-1, -0.5, 0, 0.5, 1);
	const right = Float32Array.of(1, 0.5, 0, -0.5, -1);
	const project = fixtureProject({
		sampleRate: 48_000,
		sources: [source('native-source', 24_000, 2, 5)],
		clips: [clip('native-clip', 'native-source', { sourceDurationFrames: 5, durationFrames: 10 })],
		tracks: [track('native-track', ['native-clip'])],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, [{
		sourceId: 'native-source',
		sampleRate: 24_000,
		channels: [left, right],
	}]);

	assert.equal(snapshot.project.sources[0].sampleRate, 24_000);
	assert.equal(snapshot.project.sources[0].channelCount, 2);
	assert.deepEqual(snapshot.sources[0].channels, [left, right]);
	assert.notStrictEqual(snapshot.sources[0].channels[0], left);
	assert.equal(snapshot.project.clips[0].sourceDurationFrames, 5);
	assert.equal(snapshot.project.clips[0].durationFrames, 10);
	const tree = createAup4ProjectTree(snapshot.project, blockMap(snapshot.sources));
	const waveTracks = audacityXmlChildren(tree, 'wavetrack');
	assert.equal(waveTracks.length, 2);
	assert.deepEqual(waveTracks.map((node) => audacityXmlAttribute(node, 'rate')), [24_000, 24_000]);
});

test('AUP4 export folds multichannel sources into a stereo Audacity track', () => {
	const project = fixtureProject({
		sources: [source('surround-source', 48_000, 6, 1)],
		clips: [clip('surround-clip', 'surround-source')],
		tracks: [track('surround-track', ['surround-clip'])],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, [{
		sourceId: 'surround-source',
		sampleRate: 48_000,
		channels: [1, 2, 3, 4, 5, 6].map((value) => Float32Array.of(value)),
	}]);
	const [left, right] = snapshot.sources[0].channels;
	assert.equal(snapshot.project.sources[0].channelCount, 2);
	assert.ok(Math.abs(left[0] - (1 + 3 * Math.SQRT1_2 + 4 * 0.5 + 5 * Math.SQRT1_2)) < 1e-6);
	assert.ok(Math.abs(right[0] - (2 + 3 * Math.SQRT1_2 + 4 * 0.5 + 6 * Math.SQRT1_2)) < 1e-6);
});

test('AUP4 export creates and reuses source variants for shared clips without mutating them', () => {
	const sharedPcm = Float32Array.from({ length: 441 }, (_, frame) => frame / 441);
	const stereoLeft = new Float32Array(480).fill(0.25);
	const stereoRight = new Float32Array(480).fill(-0.25);
	const project = fixtureProject({
		sources: [
			source('shared-source', 44_100, 1, 441),
			source('stereo-source', 48_000, 2, 480),
		],
		clips: [
			clip('native-shared-clip', 'shared-source', { sourceDurationFrames: 441, durationFrames: 480 }),
			clip('mixed-shared-a', 'shared-source', { sourceDurationFrames: 441, durationFrames: 480 }),
			clip('mixed-shared-b', 'shared-source', { timelineStartFrame: 600, sourceDurationFrames: 441, durationFrames: 480 }),
			clip('mixed-stereo', 'stereo-source', { timelineStartFrame: 1_200, sourceDurationFrames: 480, durationFrames: 480 }),
		],
		tracks: [
			track('native-track', ['native-shared-clip']),
			track('mixed-track', ['mixed-shared-a', 'mixed-shared-b', 'mixed-stereo']),
		],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, [
		{ sourceId: 'shared-source', sampleRate: 44_100, channels: [sharedPcm] },
		{ sourceId: 'stereo-source', sampleRate: 48_000, channels: [stereoLeft, stereoRight] },
	]);
	const [nativeClip, mixedA, mixedB, mixedStereo] = snapshot.project.clips;

	assert.equal(snapshot.sources.length, 3);
	assert.notEqual(nativeClip.sourceId, mixedA.sourceId);
	assert.equal(mixedA.sourceId, mixedB.sourceId);
	assert.notEqual(mixedA.sourceId, mixedStereo.sourceId);
	const nativeVariant = snapshot.project.sources.find((item) => item.id === nativeClip.sourceId);
	const mixedVariant = snapshot.project.sources.find((item) => item.id === mixedA.sourceId);
	assert.deepEqual([nativeVariant.sampleRate, nativeVariant.channelCount, nativeVariant.frameCount], [44_100, 1, 441]);
	assert.deepEqual([mixedVariant.sampleRate, mixedVariant.channelCount, mixedVariant.frameCount], [48_000, 2, 480]);
	assert.deepEqual(project.clips.map((item) => item.sourceId), [
		'shared-source', 'shared-source', 'shared-source', 'stereo-source',
	]);
	assert.deepEqual(sharedPcm, Float32Array.from({ length: 441 }, (_, frame) => frame / 441));
});

test('AUP4 export represents an empty track as project-rate mono', () => {
	const project = fixtureProject({
		sampleRate: 96_000,
		sources: [source('unused-source', 44_100, 2, 1)],
		clips: [],
		tracks: [track('empty-track', [])],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, []);

	assert.deepEqual(snapshot.sources, []);
	assert.deepEqual(snapshot.project.sources, []);
	const [waveTrack] = audacityXmlChildren(createAup4ProjectTree(snapshot.project), 'wavetrack');
	assert.equal(audacityXmlAttribute(waveTrack, 'rate'), 96_000);
	assert.equal(audacityXmlAttribute(waveTrack, 'channel'), 0);
	assert.equal(audacityXmlAttribute(waveTrack, 'linked'), 0);
});

test('AUP4 export rejects PCM metadata mismatches and out-of-bounds clip ranges', () => {
	const project = fixtureProject({
		sources: [source('source', 48_000, 1, 3)],
		clips: [clip('clip', 'source', { sourceStartFrame: 1, sourceDurationFrames: 2 })],
		tracks: [track('track', ['clip'])],
	});
	assert.throws(
		() => normalizeAup4ExportSnapshot(project, [{
			sourceId: 'source', sampleRate: 48_000, channels: [new Float32Array(2)],
		}]),
		(error) => error?.code === 'INVALID_SOURCE_AUDIO' && /frame count/.test(error.message),
	);
	project.clips[0].sourceDurationFrames = 3;
	assert.throws(
		() => normalizeAup4ExportSnapshot(project, [{
			sourceId: 'source', sampleRate: 48_000, channels: [new Float32Array(3)],
		}]),
		(error) => error?.code === 'INVALID_SNAPSHOT' && /exceeds source/.test(error.message),
	);
});

function fixtureProject(overrides) {
	return {
		id: 'project',
		title: 'AUP4 export fixture',
		sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: 0, trackIds: [] },
		metadata: {},
		master: { effects: [] },
		...overrides,
	};
}

function source(id, sampleRate, channelCount, frameCount) {
	return {
		id,
		name: id,
		storageKey: id,
		mimeType: 'audio/wav',
		sampleRate,
		originalSampleRate: sampleRate,
		channelCount,
		frameCount,
		sampleFormat: 'float32',
	};
}

function clip(id, sourceId, overrides = {}) {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 1,
		durationFrames: 1,
		trimStartFrames: 0,
		trimEndFrames: 0,
		envelope: [],
		...overrides,
	};
}

function track(id, clipIds) {
	return { id, type: 'audio', name: id, clipIds, effects: [] };
}

function blockMap(sources) {
	const blocks = new Map();
	let blockId = 0;
	for (const sourceAudio of sources) {
		for (let channel = 0; channel < sourceAudio.channels.length; channel += 1) {
			blocks.set(`${sourceAudio.sourceId}:${channel}`, [{
				blockId: ++blockId,
				start: 0,
				sampleCount: sourceAudio.channels[channel].length,
			}]);
		}
	}
	return blocks;
}

function nativeBlockFixture(sources) {
	const channelBlocks = new Map();
	const sampleBlocks = new Map();
	let blockId = 0;
	for (const sourceAudio of sources) {
		for (let channel = 0; channel < sourceAudio.channels.length; channel += 1) {
			const samples = sourceAudio.channels[channel];
			const id = ++blockId;
			sampleBlocks.set(id, createAup4SampleBlock(samples));
			channelBlocks.set(`${sourceAudio.sourceId}:${channel}`, [{
				blockId: id,
				start: 0,
				sampleCount: samples.length,
			}]);
		}
	}
	return { channelBlocks, sampleBlocks };
}
