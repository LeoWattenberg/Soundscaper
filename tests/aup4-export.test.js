import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityXmlAttribute, audacityXmlChildren } from '../src/lib/tools/audio-editor/audacity-binary-xml.js';
import { decodeAup4ProjectTree } from '../src/lib/tools/audio-editor/aup4-conversion.js';
import {
	createAup4ExportPlan,
	normalizeAup4ExportSnapshot,
	normalizeAup4ExportSource,
	requiredAup4SourceIds,
} from '../src/lib/tools/audio-editor/aup4-export.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/lib/tools/audio-editor/aup4-profile.js';
import { createEffect, createMissingEffect } from '../src/lib/tools/audio-editor/effects.js';

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
		envelope: [{ frame: 0, value: 1 }, { frame: 192, value: 0.5 }],
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
		envelope: [{ frame: 0, value: 1 }, { frame: 192, value: 0.5 }],
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

test('AUP4 export planning is PCM-free and materializes one original source at a time', () => {
	const project = fixtureProject({
		sources: [
			source('shared-source', 44_100, 1, 441),
			source('stereo-source', 48_000, 2, 480),
		],
		clips: [
			clip('shared-native', 'shared-source', { sourceDurationFrames: 441 }),
			clip('shared-mixed', 'shared-source', { sourceDurationFrames: 441 }),
			clip('stereo-mixed', 'stereo-source', { sourceDurationFrames: 480 }),
		],
		tracks: [
			track('native-track', ['shared-native']),
			track('mixed-track', ['shared-mixed', 'stereo-mixed']),
		],
	});
	const plan = createAup4ExportPlan(project);
	assert.deepEqual(requiredAup4SourceIds(plan), ['shared-source', 'stereo-source']);
	assert.equal(plan.sources.length, 3);
	assert.deepEqual(plan.sources.map((variant) => [
		variant.inputSourceId,
		variant.source.sampleRate,
		variant.source.channelCount,
		variant.source.frameCount,
	]), [
		['shared-source', 44_100, 1, 441],
		['shared-source', 48_000, 2, 480],
		['stereo-source', 48_000, 2, 480],
	]);

	const shared = Float32Array.from({ length: 441 }, (_, frame) => frame / 441);
	const sharedVariants = normalizeAup4ExportSource(plan, {
		sourceId: 'shared-source', sampleRate: 44_100, channels: [shared],
	});
	assert.equal(sharedVariants.length, 2);
	assert.deepEqual(sharedVariants.map((variant) => [
		variant.channels.length, variant.channels[0].length,
	]), [[1, 441], [2, 480]]);
	assert.deepEqual(normalizeAup4ExportSource(plan, {
		sourceId: 'unused-source', channels: [Float32Array.of(1)],
	}), []);
	assert.deepEqual(shared, Float32Array.from({ length: 441 }, (_, frame) => frame / 441));
});

test('incremental AUP4 source normalization is byte-for-byte equivalent to snapshot normalization', () => {
	const project = fixtureProject({
		sources: [
			source('mono-source', 44_100, 1, 441),
			source('stereo-source', 48_000, 2, 480),
		],
		clips: [
			clip('mono-clip', 'mono-source', { sourceDurationFrames: 441 }),
			clip('stereo-clip', 'stereo-source', { sourceDurationFrames: 480 }),
		],
		tracks: [track('mixed-track', ['mono-clip', 'stereo-clip'])],
	});
	const sources = [
		{ sourceId: 'mono-source', sampleRate: 44_100, channels: [new Float32Array(441).fill(0.25)] },
		{
			sourceId: 'stereo-source', sampleRate: 48_000,
			channels: [new Float32Array(480).fill(0.5), new Float32Array(480).fill(-0.5)],
		},
	];
	const snapshot = normalizeAup4ExportSnapshot(project, sources);
	const plan = createAup4ExportPlan(project);
	const incremental = sources.flatMap((sourceAudio) => normalizeAup4ExportSource(plan, sourceAudio));
	assert.deepEqual(plan.project, snapshot.project);
	assert.deepEqual(incremental, snapshot.sources);
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

test('AUP4 export plan renders reverse and excessive gain into an isolated PCM variant', () => {
	const project = fixtureProject({
		sources: [source('render-source', 48_000, 1, 4)],
		clips: [clip('render-clip', 'render-source', {
			sourceDurationFrames: 4,
			durationFrames: 4,
			gain: 8,
			fadeInFrames: 2,
			fadeOutFrames: 2,
			reversed: true,
		})],
		tracks: [{
			...track('render-track', ['render-clip']),
			envelope: [{ frame: 0, value: 0.5 }, { frame: 4, value: 1 }],
		}],
	});
	const original = structuredClone(project);
	const plan = createAup4ExportPlan(project);
	const normalized = normalizeAup4ExportSource(plan, {
		sourceId: 'render-source',
		sampleRate: 48_000,
		channels: [Float32Array.of(1, 2, 3, 4)],
	})[0];
	const exportedClip = plan.project.clips[0];

	assert.deepEqual(normalized.channels[0], Float32Array.of(6, 4.5, 3, 1.5));
	assert.equal(exportedClip.reversed, false);
	assert.equal(exportedClip.gain, 1);
	assert.equal(exportedClip.fadeInFrames, 0);
	assert.equal(exportedClip.fadeOutFrames, 0);
	assert.deepEqual(exportedClip.envelope, [
		{ frame: 0, value: 0 },
		{ frame: 1, value: 5 / 3 },
		{ frame: 2, value: 4 },
		{ frame: 3, value: 7 / 3 },
		{ frame: 4, value: 0 },
	]);
	assert.deepEqual(project, original);
	assert.equal(plan.compatibilityReport.schemaVersion, 1);
	assert.equal(plan.compatibilityReport.format, 'aup4');
	assert.equal(plan.compatibilityReport.direction, 'save');
	assert.ok(plan.compatibilityReport.items.some((item) => item.code === 'REVERSED_CLIP_RENDERED'));
	assert.ok(plan.compatibilityReport.items.some((item) => (
		item.code === 'CLIP_GAIN_AUTOMATION_MERGED' && item.data.pcmGain === 1.5
	)));
	assert.equal(plan.compatibilityReport.counts.converted, 3);
});

test('AUP4 export isolates trim-accessible PCM and reverses hidden handles with the clip', async () => {
	const project = fixtureProject({
		sources: [source('trim-source', 48_000, 1, 10)],
		clips: [clip('trim-clip', 'trim-source', {
			sourceStartFrame: 3,
			sourceDurationFrames: 4,
			durationFrames: 4,
			trimStartFrames: 2,
			trimEndFrames: 1,
			reversed: true,
		})],
		tracks: [track('trim-track', ['trim-clip'])],
	});
	const snapshot = normalizeAup4ExportSnapshot(project, [{
		sourceId: 'trim-source',
		sampleRate: 48_000,
		channels: [Float32Array.from({ length: 10 }, (_, frame) => frame)],
	}]);
	const exportedClip = snapshot.project.clips[0];
	assert.deepEqual(snapshot.sources[0].channels[0], Float32Array.of(7, 6, 5, 4, 3, 2, 1));
	assert.deepEqual({
		sourceStartFrame: exportedClip.sourceStartFrame,
		sourceDurationFrames: exportedClip.sourceDurationFrames,
		trimStartFrames: exportedClip.trimStartFrames,
		trimEndFrames: exportedClip.trimEndFrames,
	}, {
		sourceStartFrame: 1,
		sourceDurationFrames: 4,
		trimStartFrames: 1,
		trimEndFrames: 2,
	});
	assert.ok(snapshot.compatibilityReport.items.some((item) => item.code === 'CLIP_SOURCE_RANGE_ISOLATED'));

	const blocks = nativeBlockFixture(snapshot.sources);
	const tree = createAup4ProjectTree(snapshot.project, blocks.channelBlocks);
	let nextId = 0;
	const reopened = await decodeAup4ProjectTree(tree, async (blockId) => blocks.sampleBlocks.get(blockId), {
		idFactory: (prefix) => `${prefix}-${++nextId}`,
	});
	assert.deepEqual({
		sourceStartFrame: reopened.project.clips[0].sourceStartFrame,
		sourceDurationFrames: reopened.project.clips[0].sourceDurationFrames,
		trimStartFrames: reopened.project.clips[0].trimStartFrames,
		trimEndFrames: reopened.project.clips[0].trimEndFrames,
	}, {
		sourceStartFrame: 1,
		sourceDurationFrames: 4,
		trimStartFrames: 1,
		trimEndFrames: 2,
	});
});

test('AUP4 export splits overlapping clips into lanes and materializes automatic crossfades', () => {
	const project = fixtureProject({
		sources: [source('overlap-source', 48_000, 1, 8)],
		clips: [
			clip('overlap-a', 'overlap-source', { sourceDurationFrames: 6, durationFrames: 6 }),
			clip('overlap-b', 'overlap-source', {
				timelineStartFrame: 3,
				sourceDurationFrames: 5,
				durationFrames: 5,
			}),
		],
		tracks: [{
			...track('overlap-track', ['overlap-a', 'overlap-b']),
			effects: [createEffect('audacity-invert', { id: 'overlap-invert' })],
		}],
	});
	const plan = createAup4ExportPlan(project);
	assert.equal(plan.project.tracks.length, 2);
	assert.deepEqual(plan.project.tracks.map((item) => item.clipIds), [['overlap-a'], ['overlap-b']]);
	assert.deepEqual(plan.project.clips[0].envelope, [
		{ frame: 0, value: 1 },
		{ frame: 3, value: 1 },
		{ frame: 6, value: 0 },
	]);
	assert.deepEqual(plan.project.clips[1].envelope, [
		{ frame: 0, value: 0 },
		{ frame: 3, value: 1 },
		{ frame: 5, value: 1 },
	]);
	const codes = new Set(plan.compatibilityReport.items.map((item) => item.code));
	assert.ok(codes.has('OVERLAPPING_CLIPS_SPLIT_TO_LANES'));
	assert.ok(codes.has('TRACK_EFFECT_RACK_DUPLICATED_FOR_OVERLAP'));
	assert.ok(plan.compatibilityReport.items.filter((item) => (
		item.code === 'CLIP_GAIN_AUTOMATION_MERGED' && item.data.automaticCrossfade
	)).length >= 2);
});

test('AUP4 export reports disabled loop bounds that have no native equivalent', () => {
	const project = fixtureProject({
		loop: { enabled: false, startFrame: 100, endFrame: 200 },
		sources: [],
		clips: [],
		tracks: [],
	});
	const plan = createAup4ExportPlan(project);
	assert.ok(plan.compatibilityReport.items.some((item) => item.code === 'LOOP_REGION_OMITTED'));
	assert.deepEqual(plan.project.loop, { enabled: false, startFrame: 0, endFrame: 0 });
});

test('AUP4 export omits project-bin clips and their bin-only PCM with a compatibility warning', () => {
	const project = fixtureProject({
		sources: [
			source('timeline-source', 48_000, 1, 32),
			source('bin-source', 48_000, 1, 64),
		],
		clips: [clip('timeline-clip', 'timeline-source', {
			sourceDurationFrames: 32,
			durationFrames: 32,
		})],
		tracks: [track('track-1', ['timeline-clip'])],
		projectBin: {
			clips: [clip('bin-clip', 'bin-source', {
				sourceDurationFrames: 64,
				durationFrames: 64,
			})],
		},
	});

	const plan = createAup4ExportPlan(project);
	assert.deepEqual(requiredAup4SourceIds(plan), ['timeline-source']);
	assert.deepEqual(plan.project.projectBin, { clips: [] });
	assert.ok(plan.compatibilityReport.items.some((item) => (
		item.code === 'PROJECT_BIN_OMITTED'
		&& item.disposition === 'omitted'
		&& item.data.clipCount === 1
	)));
});

test('AUP4 export report identifies converted source layouts and omitted mixer state', () => {
	const project = fixtureProject({
		masterChannels: 6,
		master: { gain: 0.5, pan: -0.25, mute: true, solo: false, effects: [] },
		loop: { enabled: true, startFrame: 1, endFrame: 4 },
		view: { panelState: { inspector: true } },
		mixer: {
			groups: [{ id: 'group', effects: [createEffect('highpass', { id: 'group-effect' })] }],
			sends: [{ id: 'send', effects: [createEffect('delay', { id: 'send-effect' })] }],
			routes: { track: { groupId: 'group', sends: { send: 0.5 } } },
		},
		sources: [source('surround', 44_100, 6, 4)],
		clips: [clip('clip', 'surround', { sourceDurationFrames: 4, durationFrames: 4 })],
		tracks: [{ ...track('track', ['clip']), armed: true, displayMode: 'half-wave' }],
	});
	const plan = createAup4ExportPlan(project);
	const codes = new Set(plan.compatibilityReport.items.map((item) => item.code));

	for (const code of [
		'MIXER_GROUPS_OMITTED',
		'MIXER_SENDS_OMITTED',
		'BUS_EFFECTS_OMITTED',
		'MIXER_ROUTES_OMITTED',
		'MASTER_GAIN_OMITTED',
		'MASTER_PAN_OMITTED',
		'MASTER_MUTE_OMITTED',
		'MASTER_CHANNEL_LAYOUT_OMITTED',
		'LOOP_REGION_OMITTED',
		'EDITOR_PANEL_STATE_OMITTED',
		'TRACK_ARMED_STATE_OMITTED',
		'HALF_WAVE_DISPLAY_CONVERTED',
		'MULTICHANNEL_DOWNMIXED_TO_STEREO',
	]) assert.ok(codes.has(code), `missing compatibility item ${code}`);
	assert.deepEqual(plan.project.mixer, { groups: [], sends: [], routes: {} });
	assert.deepEqual(
		[plan.project.master.gain, plan.project.master.pan, plan.project.master.mute],
		[1, 0, false],
	);
	assert.equal(plan.project.masterChannels, 2);
	assert.equal(plan.project.loop.enabled, false);
	assert.equal(plan.project.tracks[0].armed, false);
	assert.equal(plan.project.tracks[0].displayMode, 'waveform');
	assert.equal(plan.compatibilityReport.counts.omitted, 12);
});

test('AUP4 save analysis reports browser and unavailable effects at their rack positions', () => {
	const browserEffect = createEffect('reverb', { id: 'browser-reverb' });
	const missingEffect = createMissingEffect({
		id: 'missing-superverb',
		enabled: false,
		missing: {
			name: 'SuperVerb',
			nativeId: 'Effect_VST3_Acme_SuperVerb_Acme SuperVerb',
			reason: 'plugin-unavailable',
			source: 'aup4',
		},
	});
	const nativeEffect = createEffect('audacity-invert', { id: 'native-invert' });
	const project = fixtureProject({
		sources: [],
		clips: [],
		tracks: [{
			...track('effect-track', []),
			effectsActive: false,
			effects: [browserEffect, missingEffect, nativeEffect],
		}],
		master: { effects: [] },
	});

	const report = createAup4ExportPlan(project).compatibilityReport;
	const missingItems = report.items.filter((item) => item.disposition === 'missing');
	assert.deepEqual(missingItems.map((item) => ({
		code: item.code,
		name: item.data.name,
		severity: item.severity,
		effectIndex: item.scope.effectIndex,
	})), [
		{
			code: 'SOUNDSCAPER_EFFECT_EXPORTED_AS_MISSING',
			name: 'Reverb',
			severity: 'info',
			effectIndex: 0,
		},
		{
			code: 'MISSING_REALTIME_EFFECT',
			name: 'SuperVerb',
			severity: 'info',
			effectIndex: 1,
		},
	]);
	assert.equal(report.counts.missing, 2);
});

test('AUP4 save analysis reports future effects and mapped effects with unsupported local state', () => {
	const echo = createEffect('audacity-echo', {
		id: 'stateful-echo',
		state: { revision: 7 },
	});
	echo.params.futureControl = 0.5;
	const future = {
		id: 'future-effect',
		type: 'spectral-cloud-v2',
		enabled: true,
		params: { density: 0.75 },
	};
	const project = fixtureProject({
		sources: [],
		clips: [],
		tracks: [{ ...track('effect-track', []), effects: [echo, future] }],
	});
	const report = createAup4ExportPlan(project).compatibilityReport;
	assert.deepEqual(report.items.filter((item) => item.disposition === 'missing').map((item) => item.code), [
		'AUDACITY_EFFECT_UNSUPPORTED_STATE_EXPORTED_AS_MISSING',
		'SOUNDSCAPER_EFFECT_EXPORTED_AS_MISSING',
	]);
	const tree = createAup4ProjectTree(createAup4ExportPlan(project).project);
	assert.equal(audacityXmlChildren(audacityXmlChildren(tree, 'wavetrack')[0], 'effects').length, 1);
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
