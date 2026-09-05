/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	materializeFramescaperNestedPlaybackFoundationSequence,
	type FramescaperNestedPlaybackFoundationV17,
} from '../src/framescaper/editor-project-sequence-nested-playback.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;
type Record17 = Readonly<Record<string, unknown>>;

interface NestedOverrides {
	readonly videoClip?: Data;
	readonly audioClip?: Data;
	readonly mainRate?: Data;
	readonly nestedRate?: Data;
	readonly subsequences?: readonly Data[];
	readonly project?: Data;
}

const RATE: Data = { num: 10, den: 1 };
/** The nested sequence occupies the whole primary timeline one-to-one. */
const WHOLE_CHILD: Data = {
	id: 'nested-child', sequenceId: 'main-sequence', sourceSequenceId: 'nested-sequence',
	sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
};
/** The same nesting trimmed to child frames 1..10, so every leaf occurrence is sliced. */
const TRIMMED_CHILD: Data = {
	...WHOLE_CHILD, sequenceFrameCount: 9, sourceInFrame: 1, sourceFrameCount: 9,
};
const CONSTANT_RETIME: Data = {
	feature: 'video-retime', version: 2,
	points: [
		{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
		{ outerFrame: 10, sourceFrame: { num: 10, den: 1 } },
	],
	segments: [{ mode: 'constant-forward' }],
};

test('materialization projects every reachable occurrence onto the primary sequence', () => {
	const project = nestedProject();
	const playback = materialize(project);

	assert.equal(playback.schemaVersion, 17);
	assert.equal(Object.isFrozen(playback), true);
	assert.equal(Object.hasOwn(playback, 'schemaFamily'), false);
	assert.equal(Object.hasOwn(playback, 'subsequences'), false);
	assert.equal(Object.hasOwn(playback, 'multicameraGroups'), false);
	assert.deepEqual(playback.trackFolders, []);
	assert.deepEqual(playback.takeGroups, []);
	assert.equal(playback.clips.length, 2);
	assert.equal(
		ids(playback.clips).every((id) => id.startsWith('framescaper-flat-clip-')),
		true,
	);
	assert.deepEqual(pick(video(playback), [
		'sequenceId', 'sequenceStartFrame', 'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	]), {
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	assert.deepEqual(pick(audio(playback), [
		'anchor', 'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
		'musicalStartBeat', 'musicalExtent', 'musicalDurationBeats',
	]), {
		anchor: 'sample', timelineStartFrame: 0, durationFrames: 48_000,
		sourceStartFrame: 0, sourceDurationFrames: 48_000,
		musicalStartBeat: null, musicalExtent: 'fixedSamples', musicalDurationBeats: null,
	});
});

test('the primary sequence adopts the transient tracks and every nested sequence is emptied', () => {
	const playback = materialize(nestedProject());
	const trackIds = ids(playback.tracks);
	const [primary, nested] = playback.sequences;

	assert.equal(trackIds.every((id) => id.startsWith('framescaper-flat-track-')), true);
	assert.deepEqual(playback.tracks.map((track) => track.type), ['video', 'audio']);
	assert.deepEqual(playback.tracks.map((track) => track.laneGroupId), [null, null]);
	assert.deepEqual(playback.tracks.map((track) => track.clipIds), [
		[ids(playback.clips)[1]], [ids(playback.clips)[0]],
	]);
	assert.equal(primary?.id, 'main-sequence');
	assert.deepEqual(primary?.trackIds, trackIds);
	assert.deepEqual(primary?.trackNodes, trackIds.map((id) => ({
		kind: 'track', id, parentFolderId: null,
	})));
	assert.equal(nested?.id, 'nested-sequence');
	assert.deepEqual(nested?.trackIds, []);
	assert.deepEqual(nested?.trackNodes, []);
});

test('transient identity is derived only from the occurrence, so repeated calls agree', () => {
	const project = nestedProject();

	assert.deepEqual(ids(materialize(project).clips), ids(materialize(project).clips));
	assert.deepEqual(ids(materialize(project).tracks), ids(materialize(project).tracks));
	assert.notDeepEqual(
		ids(materialize(project).clips),
		ids(materialize(nestedProject({ subsequences: [TRIMMED_CHILD] })).clips),
	);
});

test('materialization drops persisted proxy attachments and every transient selection', () => {
	const project = nestedProject({ project: {
		selection: {
			startFrame: 0, endFrame: 4_800, trackIds: ['audio-track'], clipIds: ['audio-clip'],
			frequencyRange: null, annotationIds: [],
		},
		view: { selectedTrackIds: ['audio-track'], scrollFrame: 7 },
	} });
	const playback = materialize(project);
	const selection = playback.selection as Data;
	const view = playback.view as Data;

	assert.equal(Object.hasOwn(project.sources[0]!, 'proxyAttachment'), true);
	assert.equal(Object.hasOwn(playback.sources[0]!, 'proxyAttachment'), false);
	assert.deepEqual(selection.trackIds, []);
	assert.deepEqual(selection.clipIds, []);
	assert.equal(selection.endFrame, 4_800);
	assert.deepEqual(view.selectedTrackIds, []);
	assert.equal(view.scrollFrame, 7);
});

test('each nested occurrence of one authored track becomes its own transient track', () => {
	const playback = materialize(nestedProject({ subsequences: [
		WHOLE_CHILD,
		{ ...WHOLE_CHILD, id: 'nested-child-2', sequenceStartFrame: 10 },
	] }));

	assert.equal(new Set(ids(playback.tracks)).size, 4);
	assert.deepEqual(playback.tracks.map((track) => track.type), [
		'video', 'video', 'audio', 'audio',
	]);
	assert.deepEqual(
		playback.clips.filter((clip) => clip.kind === 'video').map((clip) => clip.sequenceStartFrame),
		[0, 10],
	);
	assert.deepEqual(
		playback.clips.filter((clip) => clip.kind === 'audio').map((clip) => clip.timelineStartFrame),
		[0, 48_000],
	);
});

test('sibling clips on one authored track share a single transient track', () => {
	const playback = materialize(nestedProject({ project: {
		clips: [
			videoClip('video-clip', {
				sequenceStartFrame: 0, sequenceFrameCount: 5, sourceInFrame: 0, sourceFrameCount: 5,
			}),
			videoClip('video-clip-2', {
				sequenceStartFrame: 5, sequenceFrameCount: 5, sourceInFrame: 5, sourceFrameCount: 5,
			}),
			audioClip('audio-clip'),
		],
		tracks: [
			...labelAndVideoTracks(['video-clip', 'video-clip-2']),
			{ id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'] },
		],
	} }));

	assert.equal(playback.tracks.length, 2);
	assert.equal((playback.tracks[0]!.clipIds as readonly string[]).length, 2);
	assert.deepEqual(playback.tracks[0]!.clipIds, ids(playback.clips.filter((clip) => clip.kind === 'video')));
});

test('mixer routes follow the audio tracks that survive materialization', () => {
	const playback = materialize(nestedProject({ project: {
		mixer: {
			groups: [{ id: 'group-a', name: 'Group A' }],
			sends: [{ id: 'send-a', name: 'Send A' }],
			routes: { 'audio-track': { groupId: 'group-a', sends: { 'send-a': 0.5 } } },
		},
		clips: [videoClip('video-clip'), audioClip('audio-clip'), audioClip('audio-clip-2')],
		tracks: [
			...labelAndVideoTracks(['video-clip']),
			{ id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'] },
			{ id: 'spare-audio', name: 'Spare', type: 'audio', clipIds: ['audio-clip-2'] },
		],
		sequences: [
			{ id: 'main-sequence', rate: RATE, trackIds: ['label-track'] },
			{
				id: 'nested-sequence', rate: RATE,
				trackIds: ['video-track', 'audio-track', 'spare-audio'],
			},
		],
	} }));
	const mixer = playback.mixer as Data;
	const routes = mixer.routes as Data;
	const [, routedTrackId] = ids(playback.tracks);

	assert.equal(playback.tracks.length, 3);
	assert.deepEqual(Object.keys(routes), [routedTrackId]);
	assert.deepEqual(routes[routedTrackId!], { groupId: 'group-a', sends: { 'send-a': 0.5 } });
	assert.equal((mixer.groups as readonly Data[])[0]?.id, 'group-a');
	assert.equal(Object.isFrozen(mixer), true);
});

test('a trimmed occurrence remaps untimed video source material onto the visible range', () => {
	const playback = materialize(nestedProject({ subsequences: [TRIMMED_CHILD] }));

	assert.deepEqual(pick(video(playback), [
		'sequenceStartFrame', 'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'retimeMap',
	]), {
		sequenceStartFrame: 0, sequenceFrameCount: 9,
		sourceInFrame: 1, sourceFrameCount: 9, retimeMap: null,
	});
	assert.deepEqual(pick(audio(playback), [
		'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
	]), {
		timelineStartFrame: 0, durationFrames: 43_200,
		sourceStartFrame: 4_800, sourceDurationFrames: 43_200,
	});
});

test('a retimed video occurrence is re-sliced onto the root grid instead of being remapped', () => {
	const playback = materialize(nestedProject({
		videoClip: { retimeMap: CONSTANT_RETIME },
		subsequences: [TRIMMED_CHILD],
	}));
	const requirements = (playback.featureRequirements as {
		readonly requirements: readonly Readonly<{ readonly id: string }>[];
	}).requirements;

	assert.deepEqual(video(playback).retimeMap, {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 1, den: 1 } },
			{ outerFrame: 9, sourceFrame: { num: 10, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	});
	// The retimed branch keeps the authored source window; only the outer grid is re-slid.
	assert.deepEqual(pick(video(playback), [
		'sequenceStartFrame', 'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	]), {
		sequenceStartFrame: 0, sequenceFrameCount: 9, sourceInFrame: 0, sourceFrameCount: 10,
	});
	assert.equal(requirements.some(({ id }) => id === 'framescaper.video-retime'), true);
	assert.equal(
		requirementIds(materialize(nestedProject())).includes('framescaper.video-retime'),
		false,
	);
});

test('a reversed audio occurrence is mapped from the far end of its source material', () => {
	const playback = materialize(nestedProject({
		audioClip: { reversed: true },
		subsequences: [TRIMMED_CHILD],
	}));

	assert.equal(audio(playback).reversed, true);
	assert.deepEqual(pick(audio(playback), [
		'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
	]), {
		timelineStartFrame: 0, durationFrames: 43_200,
		sourceStartFrame: 0, sourceDurationFrames: 43_200,
	});
});

test('materialization refuses a project that still carries track folders', () => {
	assert.throws(() => materialize(nestedProject({ project: {
		trackFolders: [{ id: 'captions', name: 'Captions' }],
		sequences: [
			{
				id: 'main-sequence', rate: RATE, trackNodes: [
					{ kind: 'folder', id: 'captions', parentFolderId: null },
					{ kind: 'track', id: 'label-track', parentFolderId: 'captions' },
				],
			},
			{ id: 'nested-sequence', rate: RATE, trackIds: ['video-track', 'audio-track'] },
		],
	} })), {
		name: 'RangeError',
		message: 'Nested playback track folders must be empty for exact nested playback materialization.',
	});
});

test('materialization refuses a project that still carries take groups', () => {
	assert.throws(() => materialize(nestedProject({ project: {
		sources: [
			...framescaperV20Options().sources as Data[],
			{
				kind: 'audio', id: 'take-source', name: 'Take', storageKey: 'take-source',
				mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1,
				sampleRate: 48_000, originalSampleRate: 48_000,
			},
		],
		takeGroups: [{
			id: 'take-group', sequenceId: 'nested-sequence', trackId: 'audio-track',
			startSample: 0, endSample: 8, laneOrder: ['take-lane'], lanes: [{ id: 'take-lane' }],
			takes: [{
				id: 'take-a', laneId: 'take-lane', sourceId: 'take-source',
				startSample: 0, endSample: 8, sourceStartSample: 0,
			}],
			compRegions: [],
		}],
	} })), {
		name: 'RangeError',
		message: 'Nested playback take groups must be empty for exact nested playback materialization.',
	});
});

test('materialization refuses an occurrence that lands between two primary frames', () => {
	assert.throws(() => materialize(nestedProject({
		mainRate: { num: 15, den: 1 },
		videoClip: {
			sequenceStartFrame: 1, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1,
		},
		subsequences: [{ ...WHOLE_CHILD, sequenceFrameCount: 3, sourceFrameCount: 2 }],
	})), {
		name: 'RangeError',
		message: 'Nested primary-sequence start does not align exactly to the primary frame grid.',
	});
});

test('materialization refuses video material that does not divide onto the source frame grid', () => {
	assert.throws(() => materialize(nestedProject({
		videoClip: { sourceFrameCount: 3 },
		subsequences: [TRIMMED_CHILD],
	})), {
		name: 'RangeError',
		message: 'Nested material does not align exactly to its source frame grid.',
	});
});

test('materialization refuses an audio occurrence that carries a warp map', () => {
	assert.throws(() => materialize(nestedProject({ audioClip: { warpMap: {
		feature: 'audio-warp',
		points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		],
	} } })), {
		name: 'RangeError',
		message: 'Nested playback cannot materialize a warped audio occurrence exactly.',
	});
});

test('materialization refuses to trim audio that carries fade or envelope state', () => {
	assert.throws(() => materialize(nestedProject({
		audioClip: { fadeInFrames: 100 }, subsequences: [TRIMMED_CHILD],
	})), {
		name: 'RangeError',
		message: 'Nested playback cannot exactly trim audio fade or envelope state.',
	});
	assert.throws(() => materialize(nestedProject({
		audioClip: { envelope: [{ frame: 0, value: 0.5 }] }, subsequences: [TRIMMED_CHILD],
	})), {
		name: 'RangeError',
		message: 'Nested playback cannot exactly trim audio fade or envelope state.',
	});
	// The same fade survives untouched when the occurrence covers the whole clip.
	assert.equal(audio(materialize(nestedProject({ audioClip: { fadeInFrames: 100 } }))).fadeInFrames, 100);
});

test('materialization refuses an audio trim that misses the integer source sample grid', () => {
	assert.throws(() => materialize(nestedProject({
		audioClip: { sourceDurationFrames: 24_001 }, subsequences: [TRIMMED_CHILD],
	})), {
		name: 'RangeError',
		message: 'Nested audio source start does not align exactly to the integer source grid.',
	});
});

test('materialization refuses a primary frame that misses the project sample grid', () => {
	assert.throws(() => materialize(nestedProject({
		mainRate: { num: 7, den: 1 }, nestedRate: { num: 7, den: 1 },
		subsequences: [{ ...WHOLE_CHILD, sequenceFrameCount: 1, sourceFrameCount: 1 }],
	})), {
		name: 'RangeError',
		message: 'Nested primary audio end does not align exactly to the project sample grid.',
	});
});

test('materialization rejects a foreign runtime profile and a non-project value', () => {
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationSequence({}, nestedProject()),
		{ name: 'TypeError', message: 'The authenticated Framescaper 1.0 runtime profile is required.' },
	);
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationSequence(PROFILE, {}),
		{ name: 'TypeError' },
	);
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationSequence(PROFILE, null),
		{ name: 'TypeError', message: 'Framescaper project must be an object.' },
	);
});

function materialize(project: unknown): FramescaperNestedPlaybackFoundationV17 {
	return materializeFramescaperNestedPlaybackFoundationSequence(PROFILE, project);
}

function video(playback: FramescaperNestedPlaybackFoundationV17): Record17 {
	return playback.clips.find((clip) => clip.kind === 'video')!;
}

function audio(playback: FramescaperNestedPlaybackFoundationV17): Record17 {
	return playback.clips.find((clip) => clip.kind === 'audio')!;
}

function ids(values: readonly Record17[]): string[] {
	return values.map((value) => String(value.id));
}

function pick(value: Record17, keys: readonly string[]): Data {
	return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function requirementIds(playback: FramescaperNestedPlaybackFoundationV17): string[] {
	const manifest = playback.featureRequirements as {
		readonly requirements: readonly Readonly<{ readonly id: string }>[];
	};
	return manifest.requirements.map(({ id }) => id);
}

function videoClip(id: string, overrides: Data = {}): Data {
	return {
		kind: 'video', id, sourceId: 'video-source', title: 'Video',
		sequenceId: 'nested-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null, ...overrides,
	};
}

function audioClip(id: string, overrides: Data = {}): Data {
	return {
		kind: 'audio', id, sourceId: 'audio-source', title: 'Audio',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		durationFrames: 48_000, ...overrides,
	};
}

function labelAndVideoTracks(clipIds: readonly string[]): Data[] {
	return [
		{ id: 'label-track', name: 'Captions', type: 'label' },
		{ id: 'video-track', name: 'Video', type: 'video', clipIds: [...clipIds] },
	];
}

/**
 * A two-level project: the primary sequence holds only a label track and nests
 * the sequence that actually owns the video and audio material.
 */
function nestedProject(overrides: NestedOverrides = {}): Readonly<Record<string, unknown>> & {
	readonly sources: readonly Record17[];
} {
	const options = framescaperV20Options();
	options.clips = (options.clips as Data[]).map((clip) => (clip.kind === 'video'
		? { ...clip, sequenceId: 'nested-sequence', ...overrides.videoClip }
		: { ...clip, ...overrides.audioClip }));
	options.tracks = [
		{ id: 'label-track', name: 'Captions', type: 'label' },
		...options.tracks as Data[],
	];
	options.sequences = [
		{ id: 'main-sequence', rate: overrides.mainRate ?? RATE, trackIds: ['label-track'] },
		{
			id: 'nested-sequence', rate: overrides.nestedRate ?? RATE,
			trackIds: ['video-track', 'audio-track'],
		},
	];
	options.subsequences = overrides.subsequences ?? [WHOLE_CHILD];
	return createFramescaperProjectSequence(
		PROFILE,
		{ ...options, ...overrides.project } as never,
	) as unknown as Readonly<Record<string, unknown>> & { readonly sources: readonly Record17[] };
}
