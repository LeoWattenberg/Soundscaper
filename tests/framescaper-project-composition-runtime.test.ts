/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The composition runtime is the only boundary that carries renderer-owned
 * clip composition across the transient V17 playback foundation, so these
 * cases pin both what survives the crossing and what the boundary refuses.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/soundscaper/editor-project-runtime-profile.ts';
import {
	FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE as PROFILE,
	FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	assertFramescaperProjectCompositionProfile,
} from '../src/framescaper/editor-project-composition-profile.ts';
import {
	framescaperProjectForPlaybackFoundationComposition,
	framescaperProjectForRuntimeConsumersComposition,
} from '../src/framescaper/editor-project-composition-runtime.ts';
import {
	createFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from '../src/framescaper/editor-project-composition.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function project(): FramescaperProjectComposition {
	return createFramescaperProjectComposition(PROFILE, framescaperV20Options() as never);
}

/** Two aliases of one nested sequence: the same authored clip, twice on the primary grid. */
function nestedProject(): FramescaperProjectComposition {
	const options = framescaperV20Options();
	const main = (options.sequences as Data[])[0]!;
	options.clips = (options.clips as Data[]).map((clip) => (
		clip.kind === 'video' ? { ...clip, sequenceId: 'nested-sequence' } : clip
	));
	options.tracks = [
		createLabelTrack({ id: 'label-track', name: 'Captions' }),
		...(options.tracks as Data[]),
	];
	options.sequences = [
		{ ...main, trackIds: ['label-track'] },
		{ ...main, id: 'nested-sequence', trackIds: ['video-track', 'audio-track'] },
	];
	options.subsequences = [
		{
			id: 'first-alias', sequenceId: 'main-sequence', sourceSequenceId: 'nested-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		},
		{
			id: 'second-alias', sequenceId: 'main-sequence', sourceSequenceId: 'nested-sequence',
			sequenceStartFrame: 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		},
	];
	return createFramescaperProjectComposition(PROFILE, options as never);
}

function records(value: unknown, label: string): readonly Data[] {
	assert.ok(Array.isArray(value), label);
	return value as readonly Data[];
}

function clipsOf(document: unknown): readonly Data[] {
	return records((document as Data).clips, 'document clips');
}

function clipById(document: unknown, id: string): Data {
	const clip = clipsOf(document).find((candidate) => candidate.id === id);
	assert.ok(clip, `clip ${id}`);
	return clip;
}

function replaceClip(document: FramescaperProjectComposition, id: string, replacement: Data): Data {
	return {
		...(document as unknown as Data),
		clips: clipsOf(document).map((clip) => (clip.id === id ? replacement : clip)),
	};
}

test('the composition profile assertion accepts the one process-local composition authority', () => {
	assert.doesNotThrow(() => { assertFramescaperProjectCompositionProfile(PROFILE); });

	// The domain aliases are seams over a single object, not separate authorities.
	assert.equal(FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE, PROFILE);
	assert.equal(FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE, PROFILE);
	assert.doesNotThrow(() => {
		assertFramescaperProjectCompositionProfile(FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE);
	});
});

test('the composition profile assertion rejects every value that is not that exact object', () => {
	const message = 'The exact Framescaper composition runtime profile is required.';
	const rejected: readonly (readonly [string, unknown])[] = [
		['undefined', undefined],
		['null', null],
		['a plain record', {}],
		['a null-prototype record', Object.create(null)],
		['a string', 'framescaper'],
		// Authentic, but the authority of another product rather than this one.
		['the Soundscaper profile', SOUNDSCAPER_PROJECT_RUNTIME_PROFILE],
	];
	for (const [label, candidate] of rejected) {
		assert.throws(
			() => { assertFramescaperProjectCompositionProfile(candidate); },
			(error: unknown) => error instanceof TypeError && error.message === message,
			label,
		);
	}
});

test('the playback foundation restates a composition project as a V17 timing document', () => {
	const playback = framescaperProjectForPlaybackFoundationComposition(PROFILE, project());
	const document = playback as unknown as Data;

	assert.equal(document.schemaVersion, 17);
	assert.equal(document.id, 'framescaper-v20');
	assert.equal(Object.hasOwn(document, 'schemaFamily'), false);
	assert.equal(Object.hasOwn(document, 'subsequences'), false);
	assert.equal(Object.hasOwn(document, 'multicameraGroups'), false);
	assert.deepEqual(clipsOf(playback).map((clip) => clip.id), ['video-clip', 'audio-clip']);
});

test('the playback foundation drops the private proxy attachment the persisted sources carry', () => {
	const persisted = project();
	const playback = framescaperProjectForPlaybackFoundationComposition(PROFILE, persisted);
	const persistedVideo = persisted.sources.find((source) => source.kind === 'video');
	const foundationVideo = records((playback as unknown as Data).sources, 'sources')
		.find((source) => source.kind === 'video');

	assert.ok(persistedVideo);
	assert.equal(Object.hasOwn(persistedVideo, 'proxyAttachment'), true);
	assert.equal(persistedVideo.proxyAttachment, null);
	assert.ok(foundationVideo);
	assert.equal(Object.hasOwn(foundationVideo, 'proxyAttachment'), false);
});

test('the playback foundation retains a video composition and leaves audio clips without one', () => {
	const playback = framescaperProjectForPlaybackFoundationComposition(PROFILE, project());
	const video = clipById(playback, 'video-clip');
	const audio = clipById(playback, 'audio-clip');

	assert.deepEqual(video.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(Object.isFrozen(video.videoComposition), true);
	assert.equal(Object.hasOwn(audio, 'videoComposition'), false);
});

test('the playback foundation detaches each clip composition from the persisted document', () => {
	const persisted = project();
	const playback = framescaperProjectForPlaybackFoundationComposition(PROFILE, persisted);
	const persistedComposition = (clipById(persisted, 'video-clip')).videoComposition;
	const playbackComposition = clipById(playback, 'video-clip').videoComposition;

	assert.deepEqual(playbackComposition, persistedComposition);
	assert.notEqual(playbackComposition, persistedComposition);
});

test('the playback foundation carries an authored non-default composition through unchanged', () => {
	const options = framescaperV20Options();
	options.clips = (options.clips as Data[]).map((clip) => (clip.kind === 'video' ? {
		...clip,
		videoComposition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			crop: { left: 0.1, top: 0.2, right: 0.05, bottom: 0.05 },
			opacity: 0.5,
			blendMode: 'screen',
			compositingOrder: 3,
		},
	} : clip));
	const playback = framescaperProjectForPlaybackFoundationComposition(
		PROFILE,
		createFramescaperProjectComposition(PROFILE, options as never),
	);
	const composition = clipById(playback, 'video-clip').videoComposition as Data;

	assert.equal(composition.opacity, 0.5);
	assert.equal(composition.blendMode, 'screen');
	assert.equal(composition.compositingOrder, 3);
	assert.deepEqual(composition.crop, { left: 0.1, top: 0.2, right: 0.05, bottom: 0.05 });
});

test('each nested alias occurrence receives its own composition object rather than a shared one', () => {
	const playback = framescaperProjectForPlaybackFoundationComposition(PROFILE, nestedProject());
	const video = clipsOf(playback).filter((clip) => clip.kind === 'video');

	assert.equal(video.length, 2);
	assert.notEqual(video[0]!.id, video[1]!.id);
	assert.deepEqual(video[0]!.videoComposition, video[1]!.videoComposition);
	assert.notEqual(video[0]!.videoComposition, video[1]!.videoComposition);
	assert.deepEqual(
		video.map((clip) => clip.sequenceStartFrame).sort((left, right) => Number(left) - Number(right)),
		[0, 10],
	);
});

test('the playback foundation refuses a runtime profile that is not the composition authority', () => {
	const persisted = project();
	const message = 'The exact Framescaper composition runtime profile is required.';

	for (const candidate of [{}, null, SOUNDSCAPER_PROJECT_RUNTIME_PROFILE]) {
		assert.throws(
			() => framescaperProjectForPlaybackFoundationComposition(candidate, persisted),
			(error: unknown) => error instanceof TypeError && error.message === message,
		);
		assert.throws(
			() => framescaperProjectForRuntimeConsumersComposition(candidate, persisted),
			(error: unknown) => error instanceof TypeError && error.message === message,
		);
	}
});

test('the playback foundation refuses a document that is not a composition record at all', () => {
	for (const candidate of [null, undefined, 'project', []]) {
		assert.throws(
			() => framescaperProjectForPlaybackFoundationComposition(PROFILE, candidate),
			TypeError,
			String(candidate),
		);
	}
});

test('the playback foundation refuses a project whose schema version is not the composition one', () => {
	const persisted = project() as unknown as Data;

	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(PROFILE, { ...persisted, schemaVersion: 17 }),
		(error: unknown) => error instanceof RangeError
			&& error.message === 'Unsupported Framescaper project schema version: 17.',
	);
});

test('the playback foundation refuses a video clip whose composition is not a data property', () => {
	const persisted = project();
	const video = clipById(persisted, 'video-clip');
	const accessor: Data = {};
	for (const [key, value] of Object.entries(video)) {
		if (key !== 'videoComposition') accessor[key] = value;
	}
	Object.defineProperty(accessor, 'videoComposition', {
		configurable: true, enumerable: true, get: () => video.videoComposition,
	});

	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(
			PROFILE,
			replaceClip(persisted, 'video-clip', accessor),
		),
		(error: unknown) => error instanceof TypeError
			&& error.message.includes('videoComposition must be an own enumerable data property'),
	);
});

test('the playback foundation refuses an audio clip that carries a video composition', () => {
	const persisted = project();
	const audio = { ...clipById(persisted, 'audio-clip'), videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION };

	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(
			PROFILE,
			replaceClip(persisted, 'audio-clip', audio),
		),
		(error: unknown) => error instanceof TypeError
			&& error.message === 'Framescaper audio clip audio-clip must not carry videoComposition.',
	);
});

test('the playback foundation refuses a composition clip that still carries retime keyframes', () => {
	const persisted = project();
	const video = { ...clipById(persisted, 'video-clip'), videoKeyframes: opacityKeyframes() };

	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(
			PROFILE,
			replaceClip(persisted, 'video-clip', video),
		),
		(error: unknown) => error instanceof TypeError
			&& error.message === 'Framescaper composition clip video-clip must not carry retime videoKeyframes.',
	);
});

test('the playback foundation refuses a video composition value outside its declared domain', () => {
	const persisted = project();
	const video = {
		...clipById(persisted, 'video-clip'),
		videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: 4 },
	};

	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(
			PROFILE,
			replaceClip(persisted, 'video-clip', video),
		),
		RangeError,
	);
});

/** Two overlapping video clips on one track are the transition shape the composition rules police. */
function overlappingProject(): FramescaperProjectComposition {
	const options = framescaperV20Options();
	const clips = options.clips as Data[];
	const video = clips.find((clip) => clip.kind === 'video')!;
	options.clips = [...clips, { ...video, id: 'second-video-clip', sequenceStartFrame: 6 }];
	options.tracks = (options.tracks as Data[]).map((track) => (
		track.id === 'video-track' ? { ...track, clipIds: ['video-clip', 'second-video-clip'] } : track
	));
	return createFramescaperProjectComposition(PROFILE, options as never);
}

test('the playback foundation refuses a transition whose two clips disagree on composition', () => {
	const persisted = overlappingProject();
	assert.doesNotThrow(() => framescaperProjectForPlaybackFoundationComposition(PROFILE, persisted));

	// The foundation rejects a divergent composition at creation, so the composition-layer
	// rule is only reachable for a document mutated after it was created.
	const divergent = (composition: Data) => replaceClip(persisted, 'second-video-clip', {
		...clipById(persisted, 'second-video-clip'), videoComposition: composition,
	});

	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(
			PROFILE,
			divergent({ ...DEFAULT_VIDEO_CLIP_COMPOSITION, blendMode: 'screen' }),
		),
		(error: unknown) => error instanceof RangeError
			&& error.message === 'A transition on video-track requires one blend mode across both clips.',
	);
	assert.throws(
		() => framescaperProjectForPlaybackFoundationComposition(
			PROFILE,
			divergent({ ...DEFAULT_VIDEO_CLIP_COMPOSITION, compositingOrder: 2 }),
		),
		(error: unknown) => error instanceof RangeError
			&& error.message === 'A transition on video-track requires one compositing order across both clips.',
	);
});

test('the runtime projection brands the composition foundation and resolves clip timing', () => {
	const projection = framescaperProjectForRuntimeConsumersComposition(PROFILE, project());
	const document = projection as unknown as Data;

	assert.equal(isRuntimeProjectProjection(projection), true);
	assert.equal(document.runtimeProjectionVersion, 2);
	assert.equal(Object.isFrozen(projection), true);
	const video = clipById(projection, 'video-clip');
	assert.deepEqual({
		coordinateDomain: video.coordinateDomain,
		timelineStartFrame: video.timelineStartFrame,
		timelineEndFrame: video.timelineEndFrame,
		durationFrames: video.durationFrames,
		sequenceStartFrame: video.sequenceStartFrame,
		sequenceEndFrame: video.sequenceEndFrame,
		sourceStartFrame: video.sourceStartFrame,
		sourceEndFrame: video.sourceEndFrame,
		sourceDurationFrames: video.sourceDurationFrames,
	}, {
		coordinateDomain: 'resolved-samples',
		timelineStartFrame: 0,
		timelineEndFrame: 48_000,
		durationFrames: 48_000,
		sequenceStartFrame: 0,
		sequenceEndFrame: 10,
		sourceStartFrame: 0,
		sourceEndFrame: 10,
		sourceDurationFrames: 10,
	});
	const audio = clipById(projection, 'audio-clip');
	assert.equal(audio.sequenceStartFrame, null);
	assert.equal(audio.timelineEndFrame, 48_000);
});

test('the runtime projection keeps the detached composition on the resolved clips', () => {
	const persisted = project();
	const projection = framescaperProjectForRuntimeConsumersComposition(PROFILE, persisted);
	const resolved = clipById(projection, 'video-clip');

	assert.deepEqual(resolved.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.notEqual(resolved.videoComposition, clipById(persisted, 'video-clip').videoComposition);
});

test('the runtime projection resolves the Project Bin alongside the timeline clips', () => {
	const projection = framescaperProjectForRuntimeConsumersComposition(PROFILE, project());
	const bin = (projection as unknown as Data).projectBin as Data;
	const binClips = records(bin.clips, 'projectBin.clips');

	assert.equal(binClips.length, 1);
	assert.equal(binClips[0]!.id, 'bin-video');
	assert.equal(binClips[0]!.coordinateDomain, 'resolved-samples');
	assert.deepEqual(binClips[0]!.videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
});

test('the runtime projection resolves every nested alias occurrence onto the primary grid', () => {
	const projection = framescaperProjectForRuntimeConsumersComposition(PROFILE, nestedProject());
	const video = clipsOf(projection).filter((clip) => clip.kind === 'video');

	assert.equal(isRuntimeProjectProjection(projection), true);
	assert.equal(video.length, 2);
	assert.deepEqual(
		video.map((clip) => [clip.timelineStartFrame, clip.timelineEndFrame])
			.sort((left, right) => Number(left[0]) - Number(right[0])),
		[[0, 48_000], [48_000, 96_000]],
	);
});
