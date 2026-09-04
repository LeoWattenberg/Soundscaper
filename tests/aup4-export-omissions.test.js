import assert from 'node:assert/strict';
import test from 'node:test';
import {
	audacityXmlChildren,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	createAup4ExportPlan,
	normalizeAup4ExportSnapshot,
	requiredAup4SourceIds,
} from '../src/common/editor/aup4-export.js';
import {
	createAup4ProjectTree,
} from '../src/common/editor/aup4-profile.js';
import { createEffect, createMissingEffect } from '../src/common/editor/effects.js';
import {
	blockMap,
	clip,
	fixtureProject,
	source,
	track,
	videoClip,
	videoSource,
} from './helpers/aup4-export-harness.js';

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

test('AUP4 export creates an explicit audio-only copy of a V4 video project', () => {
	const project = fixtureProject({
		schemaVersion: 4,
		sources: [
			{ ...source('audio-source', 48_000, 1, 48), kind: 'audio' },
			videoSource('video-source', 48),
			videoSource('bin-video-source', 96),
		],
		clips: [
			{ ...clip('audio-clip', 'audio-source', {
				sourceDurationFrames: 48,
				durationFrames: 48,
			}), kind: 'audio', avLinkId: 'av-1', binItemId: null },
			videoClip('video-clip', 'video-source', {
				sourceDurationFrames: 48,
				durationFrames: 48,
				avLinkId: 'av-1',
			}),
		],
		tracks: [
			{
				id: 'video-track',
				type: 'video',
				name: 'Video',
				clipIds: ['video-clip'],
				laneGroupId: 'lane-1',
			},
			{
				...track('audio-track', ['audio-clip']),
				laneGroupId: 'lane-1',
			},
		],
		selection: {
			startFrame: 0,
			endFrame: 48,
			trackIds: ['video-track', 'audio-track'],
			clipIds: ['video-clip', 'audio-clip'],
		},
		view: {
			selectedTrackIds: ['video-track', 'audio-track'],
			selectedClipIds: ['video-clip', 'audio-clip'],
		},
		projectBin: {
			clips: [videoClip('bin-video-clip', 'bin-video-source', {
				sourceDurationFrames: 96,
				durationFrames: 96,
				binItemId: 'bin-item',
			})],
		},
	});

	const plan = createAup4ExportPlan(project);
	assert.deepEqual(requiredAup4SourceIds(plan), ['audio-source']);
	assert.deepEqual(plan.project.sources.map((item) => item.kind), ['audio']);
	assert.deepEqual(plan.project.clips.map((item) => item.id), ['audio-clip']);
	assert.equal(plan.project.clips[0].avLinkId, null);
	assert.deepEqual(plan.project.tracks.map((item) => item.id), ['audio-track']);
	assert.equal(plan.project.tracks[0].laneGroupId, null);
	assert.deepEqual(plan.project.selection.trackIds, ['audio-track']);
	assert.deepEqual(plan.project.selection.clipIds, ['audio-clip']);
	assert.deepEqual(plan.project.view.selectedTrackIds, ['audio-track']);
	assert.deepEqual(plan.project.view.selectedClipIds, ['audio-clip']);
	assert.deepEqual(plan.project.projectBin, { clips: [] });

	const videoWarning = plan.compatibilityReport.items.find((item) => item.code === 'VIDEO_OMITTED');
	assert.deepEqual(videoWarning, {
		code: 'VIDEO_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		message: 'AUP4 is audio-only. Video tracks, clips, and media were omitted from this exported copy.',
		scope: { kind: 'project' },
		data: {
			reason: 'aup4-audio-only',
			trackCount: 1,
			timelineClipCount: 1,
			projectBinClipCount: 1,
			sourceCount: 2,
		},
	});
	assert.ok(plan.compatibilityReport.items.some((item) => item.code === 'PROJECT_BIN_OMITTED'));

	const snapshot = normalizeAup4ExportSnapshot(project, [{
		sourceId: 'audio-source',
		sampleRate: 48_000,
		channels: [new Float32Array(48)],
	}]);
	assert.equal(snapshot.sources.length, 1);
	const tree = createAup4ProjectTree(snapshot.project, blockMap(snapshot.sources));
	assert.equal(audacityXmlChildren(tree, 'wavetrack').length, 1);
});

test('AUP4 export safely handles a video-only timeline without requesting PCM', () => {
	const project = fixtureProject({
		schemaVersion: 4,
		sources: [videoSource('video-source', 120)],
		clips: [videoClip('video-clip', 'video-source', {
			sourceDurationFrames: 120,
			durationFrames: 120,
		})],
		tracks: [{
			id: 'video-track',
			type: 'video',
			name: 'Video',
			clipIds: ['video-clip'],
		}],
		projectBin: { clips: [] },
	});

	const snapshot = normalizeAup4ExportSnapshot(project, []);
	assert.deepEqual(snapshot.sources, []);
	assert.deepEqual(snapshot.project.sources, []);
	assert.deepEqual(snapshot.project.clips, []);
	assert.deepEqual(snapshot.project.tracks, []);
	assert.ok(snapshot.compatibilityReport.items.some((item) => (
		item.code === 'VIDEO_OMITTED' && item.severity === 'warning'
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

test('AUP4 export reports omitted bus and master envelopes without mutating the source project', () => {
	const project = fixtureProject({
		master: {
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			effects: [],
			envelope: [{ frame: 0, value: 0.75 }, { frame: 96_000, value: 1 }],
		},
		mixer: {
			groups: [
				{ id: 'group-automated', effects: [], envelope: [{ frame: 48_000, value: 0.5 }] },
				{ id: 'group-static', effects: [], envelope: [] },
			],
			sends: [{
				id: 'send-automated',
				effects: [],
				envelope: [{ frame: 0, value: 0 }, { frame: 24_000, value: 0.5 }, { frame: 48_000, value: 1 }],
			}],
			routes: {},
		},
		sources: [],
		clips: [],
		tracks: [],
	});
	const original = structuredClone(project);

	const plan = createAup4ExportPlan(project);
	const groupItem = plan.compatibilityReport.items.find((item) => item.code === 'MIXER_GROUPS_OMITTED');
	const sendItem = plan.compatibilityReport.items.find((item) => item.code === 'MIXER_SENDS_OMITTED');
	const masterItem = plan.compatibilityReport.items.find((item) => item.code === 'MASTER_ENVELOPE_OMITTED');

	assert.deepEqual(groupItem.data, { count: 2, envelopeBusCount: 1, envelopePointCount: 1 });
	assert.deepEqual(sendItem.data, { count: 1, envelopeBusCount: 1, envelopePointCount: 3 });
	assert.deepEqual(masterItem, {
		code: 'MASTER_ENVELOPE_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		scope: { kind: 'master' },
		data: { pointCount: 2 },
	});
	assert.deepEqual(plan.project.master.envelope, []);
	assert.deepEqual(plan.project.mixer, { groups: [], sends: [], routes: {} });
	assert.deepEqual(project, original);
	assert.notStrictEqual(plan.project, project);
	assert.equal(plan.compatibilityReport.counts.omitted, 3);
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
