/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
	createAudioClip as createFoundationAudioClip,
	createAudioSource as createFoundationAudioSource,
	createAudioTrack as createFoundationAudioTrack,
	createLabel as createFoundationLabel,
	createLabelTrack as createFoundationLabelTrack,
} from './project-audio-factory.js';
import {
	AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
} from './project-foundation-validation.ts';
import type {
	AudioClipLeaf,
	AudioSourceLeaf,
	AudioTrackLeaf,
	LabelLeaf,
	LabelTrackLeaf,
	MediaClipLeafFor,
	MediaFactoryInput,
	MediaFactoryResult,
	MediaSourceLeafFor,
	MediaTrackLeafFor,
	VideoClipFixtureLeaf,
	VideoClipLeaf,
	VideoSourceLeaf,
	VideoTrackLeaf,
} from './project-media-types.ts';
import { createStableId } from './stable-id.js';
import {
	addRationals,
	beatToSampleFrame,
	normalizeRational,
	sampleFrameToVideoFrame,
	type BreakpointMap,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
	type RationalRate,
	validateBreakpointMap,
	videoFrameRangeToSampleRange,
} from './timeline-time.ts';
import { normalizeVideoEffects } from './video-effects.js';
import { normalizeVideoTimingAssetReference } from './video-timing-asset-reference.ts';

export {
	AUDIO_EDITOR_DISPLAY_MODES,
	AUDIO_EDITOR_PROJECT_DEFAULT_MASTER_CHANNELS,
	AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
	AUDIO_EDITOR_SAMPLE_FORMATS,
	AUDIO_EDITOR_SOURCE_CHUNK_FRAMES,
	AUDIO_EDITOR_TRACK_COLORS,
	audioTrackChannelCount,
	createAudioMaster,
	createAudioMixerBus,
	normalizeAudioMixer,
} from './project-audio-factory.js';
export type * from './project-media-types.ts';

export const AUDIO_EDITOR_MEDIA_KINDS = Object.freeze(['audio', 'video']);
export const AUDIO_EDITOR_TRACK_TYPES = Object.freeze(['audio', 'video', 'label']);

export interface AudioClipContext {
	readonly projectSampleRate: number;
	readonly tempoMap: HoldTempoMap;
}

export interface VideoClipContext {
	readonly projectSampleRate: number;
	readonly sequence: Readonly<Record<string, unknown>>;
	readonly source: Readonly<Record<string, unknown>>;
}

export type MediaClipContext = AudioClipContext & VideoClipContext;
export type MediaClipContextResolver = (
	clip: Readonly<Record<string, unknown>>,
) => MediaClipContext;

const DEFAULT_RATE = Object.freeze({ num: 30, den: 1 });

/** Normalize one audio source into the exact current media leaf contract. */
export function createAudioSource<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
): MediaFactoryResult<Options, AudioSourceLeaf> {
	return {
		...clone(options),
		...createFoundationAudioSource(options),
		kind: 'audio',
	} as MediaFactoryResult<Options, AudioSourceLeaf>;
}

/** Normalize one video source into rational source-frame authority. */
export function createVideoSource<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
	projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
): MediaFactoryResult<Options, VideoSourceLeaf> {
	const sampleRate = boundedSampleRate(options.sampleRate ?? projectSampleRate);
	const sampleFrameCount = positiveSafeInteger(
		options.sampleFrameCount ?? options.frameCount,
		'source.sampleFrameCount',
	);
	const frameRate = rationalRate(
		options.frameRate ?? options.sourceFrameRate ?? DEFAULT_RATE,
		'source.frameRate',
	);
	const sourceFrameCount = positiveSafeInteger(
		options.sourceFrameCount ?? Math.max(1, sampleFrameToVideoFrame(
			sampleFrameCount,
			frameRate,
			sampleRate,
			'enclosingEnd',
		)),
		'source.sourceFrameCount',
	);
	const legacy = createFoundationVideoSource({
		...options,
		frameCount: sampleFrameCount,
		frameRate: frameRate.num / frameRate.den,
	}, sampleRate);
	const timingAsset = options.timingAsset == null
		? null
		: normalizeVideoTimingAssetReference(options.timingAsset);
	const timingDecision = normalizeTimingDecision(options.timingDecision, frameRate);
	if (timingDecision.mode === 'exact' && timingAsset === null) {
		throw new RangeError('An exact video timing decision requires a timing asset.');
	}
	const result: Record<string, unknown> = {
		...clone(options),
		...legacy,
		kind: 'video',
		sampleFrameCount,
		frameRate,
		sourceFrameCount,
		timingAsset,
		timingDecision,
	};
	delete result.frameCount;
	return result as MediaFactoryResult<Options, VideoSourceLeaf>;
}

export function createMediaSource<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
	projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
): MediaSourceLeafFor<Options> {
	return options.kind === 'video'
		? createVideoSource(options, projectSampleRate) as unknown as MediaSourceLeafFor<Options>
		: createAudioSource(options) as MediaSourceLeafFor<Options>;
}

/** Normalize one audio clip into exact sample or musical authority. */
export function createAudioClip<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
	context?: Readonly<AudioClipContext>,
): MediaFactoryResult<Options, AudioClipLeaf> {
	const anchor = options.anchor === 'musical' ? 'musical' : 'sample';
	const musicalExtent = options.musicalExtent === 'beat' ? 'beat' : 'fixedSamples';
	const musicalStartBeat = anchor === 'musical'
		? coordinateRational(options.musicalStartBeat ?? 0, 'clip.musicalStartBeat')
		: null;
	const musicalDurationBeats = anchor === 'musical' && musicalExtent === 'beat'
		? positiveCoordinateRational(options.musicalDurationBeats, 'clip.musicalDurationBeats')
		: null;
	const derivedDuration = context && musicalStartBeat && musicalDurationBeats
		? beatToSampleFrame(
			addRationals(musicalStartBeat, musicalDurationBeats),
			context.tempoMap,
			context.projectSampleRate,
		) - beatToSampleFrame(musicalStartBeat, context.tempoMap, context.projectSampleRate)
		: 1;
	const legacy = createFoundationAudioMediaClip({
		...options,
		timelineStartFrame: options.timelineStartFrame ?? 0,
		durationFrames: options.durationFrames ?? derivedDuration,
		sourceDurationFrames: options.sourceDurationFrames ?? options.durationFrames ?? derivedDuration,
	});
	const result: Record<string, unknown> = {
		...clone(options),
		...legacy,
		kind: 'audio',
		anchor,
		musicalStartBeat,
		musicalExtent,
		musicalDurationBeats,
		warpMap: normalizeBreakpoint(options.warpMap, 'audio-warp', 'clip.warpMap'),
	};
	if (anchor === 'musical') delete result.timelineStartFrame;
	if (anchor === 'musical' && musicalExtent === 'beat') delete result.durationFrames;
	return result as MediaFactoryResult<Options, AudioClipLeaf>;
}

/** Normalize one video clip into exact sequence- and source-frame authority. */
export function createVideoClip<const Options extends MediaFactoryInput>(
	options: Options, context: Readonly<VideoClipContext>,
): MediaFactoryResult<Options, VideoClipLeaf>;
export function createVideoClip<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options?: Options,
): MediaFactoryResult<Options, VideoClipFixtureLeaf>;
export function createVideoClip(
	options: MediaFactoryInput = {}, context?: Readonly<VideoClipContext>,
): Record<string, unknown> {
	if (!context) return { ...clone(options), ...createFoundationVideoClip(options), kind: 'video' };
	const sampleRate = boundedSampleRate(context.projectSampleRate);
	const sequenceRate = rationalRate(context.sequence.rate, 'sequence.rate');
	const sourceRate = rationalRate(context.source.frameRate, 'source.frameRate');
	const legacyStart = nonNegativeSafeInteger(options.timelineStartFrame ?? 0, 'clip.timelineStartFrame');
	const legacyDuration = positiveSafeInteger(options.durationFrames ?? 1, 'clip.durationFrames');
	const sequenceStartFrame = nonNegativeSafeInteger(
		options.sequenceStartFrame ?? sampleFrameToVideoFrame(legacyStart, sequenceRate, sampleRate, 'point'),
		'clip.sequenceStartFrame',
	);
	const legacyEnd = safeAdd(legacyStart, legacyDuration, 'clip timeline range');
	const sequenceFrameCount = positiveSafeInteger(
		options.sequenceFrameCount ?? Math.max(
			1,
			sampleFrameToVideoFrame(legacyEnd, sequenceRate, sampleRate, 'point') - sequenceStartFrame,
		),
		'clip.sequenceFrameCount',
	);
	const legacySourceStart = nonNegativeSafeInteger(options.sourceStartFrame ?? 0, 'clip.sourceStartFrame');
	const legacySourceDuration = positiveSafeInteger(
		options.sourceDurationFrames ?? legacyDuration,
		'clip.sourceDurationFrames',
	);
	const sourceInFrame = nonNegativeSafeInteger(
		options.sourceInFrame ?? sampleFrameToVideoFrame(legacySourceStart, sourceRate, sampleRate, 'point'),
		'clip.sourceInFrame',
	);
	const sourceFrameCount = positiveSafeInteger(
		options.sourceFrameCount ?? Math.max(
			1,
			sampleFrameToVideoFrame(
				safeAdd(legacySourceStart, legacySourceDuration, 'clip source range'),
				sourceRate,
				sampleRate,
				'point',
			) - sourceInFrame,
		),
		'clip.sourceFrameCount',
	);
	const resolved = videoFrameRangeToSampleRange(
		sequenceStartFrame,
		sequenceFrameCount,
		sequenceRate,
		sampleRate,
	);
	const sourceResolved = videoFrameRangeToSampleRange(
		sourceInFrame,
		sourceFrameCount,
		sourceRate,
		sampleRate,
	);
	const legacy = createFoundationVideoClip({
		...options,
		timelineStartFrame: resolved.startFrame,
		durationFrames: resolved.durationFrames,
		sourceStartFrame: sourceResolved.startFrame,
		sourceDurationFrames: sourceResolved.durationFrames,
	});
	const result: Record<string, unknown> = {
		...clone(options),
		...legacy,
		kind: 'video',
		sequenceId: nonEmptyString(options.sequenceId ?? context.sequence.id, 'clip.sequenceId'),
		sequenceStartFrame,
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount,
		retimeMap: normalizeBreakpoint(options.retimeMap, 'video-retime', 'clip.retimeMap'),
	};
	for (const name of [
		'timelineStartFrame',
		'durationFrames',
		'sourceStartFrame',
		'sourceDurationFrames',
	]) delete result[name];
	return result;
}

export function createMediaClip<const Options extends MediaFactoryInput>(
	options: Options,
	context: Readonly<MediaClipContext>,
): MediaClipLeafFor<Options> {
	return options.kind === 'video'
		? createVideoClip(options, context) as unknown as MediaClipLeafFor<Options>
		: createAudioClip(options, context) as MediaClipLeafFor<Options>;
}

export function createAudioTrack<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
	projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
): MediaFactoryResult<Options, AudioTrackLeaf> {
	return {
		...clone(options),
		...createFoundationAudioTrack(options, projectSampleRate),
		type: 'audio',
		laneGroupId: optionalId(options.laneGroupId, 'track.laneGroupId'),
	} as MediaFactoryResult<Options, AudioTrackLeaf>;
}

export function createVideoTrack<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
): MediaFactoryResult<Options, VideoTrackLeaf> {
	return {
		...clone(options),
		...createFoundationVideoTrack(options),
		type: 'video',
	} as unknown as MediaFactoryResult<Options, VideoTrackLeaf>;
}

export function createLabelTrack<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
): MediaFactoryResult<Options, LabelTrackLeaf> {
	if (options.laneGroupId != null) {
		throw new RangeError('Label tracks cannot belong to a media lane group.');
	}
	const legacy = {
		...createFoundationLabelTrack(options),
		laneGroupId: null,
	};
	const labels = (Array.isArray(options.labels) ? options.labels : []).map((value) => (
		createLabel(object(value, 'label'))
	));
	return { ...clone(options), ...legacy, type: 'label', labels } as unknown as MediaFactoryResult<Options, LabelTrackLeaf>;
}

export function createLabel<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
): MediaFactoryResult<Options, LabelLeaf> {
	return normalizeLabel(options.anchor === 'musical'
		? options
		: createFoundationLabel(options) as Record<string, unknown>) as MediaFactoryResult<Options, LabelLeaf>;
}

export function createMediaTrack<const Options extends MediaFactoryInput = MediaFactoryInput>(
	options: Options = {} as Options,
	projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
): MediaTrackLeafFor<Options> {
	if (options.type === 'video') return createVideoTrack(options) as unknown as MediaTrackLeafFor<Options>;
	if (options.type === 'label') return createLabelTrack(options) as unknown as MediaTrackLeafFor<Options>;
	return createAudioTrack(options, projectSampleRate) as MediaTrackLeafFor<Options>;
}

/** Normalize an insertable bin through the same exact clip context as timeline media. */
export function createProjectBin(
	value: Record<string, unknown> = {},
	contextForClip: MediaClipContextResolver,
): Record<string, unknown> & { readonly clips: readonly Record<string, unknown>[] } {
	const bin = object(value, 'project.projectBin');
	if (bin.clips != null && !Array.isArray(bin.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}
	const clips = (bin.clips ?? []) as readonly unknown[];
	return {
		...clone(bin),
		clips: clips.map((candidate) => {
			const clip = object(candidate, 'projectBin clip');
			return {
				...createMediaClip(clip, contextForClip(clip)),
				binItemId: clip.binItemId || clip.id,
			};
		}),
	};
}

function createFoundationAudioMediaClip(options: Record<string, unknown>): Record<string, unknown> {
	return {
		...createFoundationAudioClip(options),
		kind: 'audio',
		avLinkId: optionalId(options.avLinkId, 'clip.avLinkId'),
		binItemId: optionalId(options.binItemId, 'clip.binItemId'),
	};
}

function createFoundationVideoSource(
	options: Record<string, unknown>,
	projectSampleRate: number,
): Record<string, unknown> {
	const sampleRate = safeInteger(options.sampleRate ?? projectSampleRate, 1, 'source.sampleRate');
	const hasAudio = Boolean(options.hasAudio ?? options.audioCodec);
	return {
		kind: 'video',
		id: options.id || createStableId('video-source'),
		name: String(options.name || 'Video source'),
		mimeType: String(options.mimeType || 'video/mp4'),
		storageKey: nonEmptyString(
			String(options.storageKey || options.id || createStableId('video')),
			'source.storageKey',
		),
		frameCount: safeInteger(options.frameCount, 1, 'source.frameCount'),
		sampleRate,
		width: safeInteger(options.width, 1, 'source.width'),
		height: safeInteger(options.height, 1, 'source.height'),
		frameRate: positiveFinite(options.frameRate ?? 30, 'source.frameRate'),
		videoCodec: String(options.videoCodec || 'unknown'),
		audioCodec: optionalString(options.audioCodec, 'source.audioCodec'),
		hasAudio,
		posterStorageKey: optionalString(options.posterStorageKey, 'source.posterStorageKey'),
		thumbnailStorageKey: optionalString(options.thumbnailStorageKey, 'source.thumbnailStorageKey'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

function createFoundationVideoClip(options: Record<string, unknown>): Record<string, unknown> {
	const durationFrames = safeInteger(options.durationFrames, 1, 'clip.durationFrames');
	return {
		kind: 'video',
		id: options.id || createStableId('video-clip'),
		sourceId: nonEmptyString(options.sourceId, 'clip.sourceId'),
		title: String(options.title || 'Video clip'),
		timelineStartFrame: safeInteger(options.timelineStartFrame ?? 0, 0, 'clip.timelineStartFrame'),
		sourceStartFrame: safeInteger(options.sourceStartFrame ?? 0, 0, 'clip.sourceStartFrame'),
		sourceDurationFrames: safeInteger(
			options.sourceDurationFrames ?? durationFrames,
			1,
			'clip.sourceDurationFrames',
		),
		durationFrames,
		trimStartFrames: safeInteger(options.trimStartFrames ?? 0, 0, 'clip.trimStartFrames'),
		trimEndFrames: safeInteger(options.trimEndFrames ?? 0, 0, 'clip.trimEndFrames'),
		groupId: optionalId(options.groupId, 'clip.groupId'),
		color: nonEmptyString(options.color || 'auto', 'clip.color'),
		speedRatio: positiveFinite(options.speedRatio ?? 1, 'clip.speedRatio'),
		avLinkId: optionalId(options.avLinkId, 'clip.avLinkId'),
		binItemId: optionalId(options.binItemId, 'clip.binItemId'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
		videoEffects: normalizeVideoEffects(
			Object.hasOwn(options, 'videoEffects') ? options.videoEffects : [],
			'clip.videoEffects',
		),
	};
}

function createFoundationVideoTrack(options: Record<string, unknown>): Record<string, unknown> {
	return {
		type: 'video',
		id: options.id || createStableId('video-track'),
		name: String(options.name || 'Video track'),
		clipIds: uniqueStrings(options.clipIds ?? [], 'track.clipIds'),
		mute: Boolean(options.mute),
		solo: Boolean(options.solo),
		hidden: Boolean(options.hidden),
		collapsed: Boolean(options.collapsed),
		height: safeInteger(options.height ?? 120, 40, 'track.height'),
		laneGroupId: optionalId(options.laneGroupId, 'track.laneGroupId'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

function normalizeLabel(value: Record<string, unknown>): Record<string, unknown> {
	const anchor = value.anchor === 'musical' ? 'musical' : 'sample';
	const result: Record<string, unknown> = {
		...clone(value),
		id: nonEmptyString(value.id ?? createStableId('label'), 'label.id'),
		anchor,
		startBeat: anchor === 'musical' ? coordinateRational(value.startBeat ?? 0, 'label.startBeat') : null,
		endBeat: anchor === 'musical'
			? coordinateRational(value.endBeat ?? value.startBeat ?? 0, 'label.endBeat')
			: null,
	};
	if (anchor === 'musical') {
		delete result.startFrame;
		delete result.endFrame;
	}
	return result;
}

function normalizeTimingDecision(value: unknown, fallbackRate: RationalRate): Record<string, unknown> {
	const decision = value == null ? {} : object(value, 'source.timingDecision');
	const mode = decision.mode === 'exact' ? 'exact' : 'conform-cfr-at-ingest';
	return {
		...clone(decision),
		mode,
		rate: rationalRate(decision.rate ?? fallbackRate, 'source.timingDecision.rate'),
	};
}

function normalizeBreakpoint(
	value: unknown,
	feature: BreakpointMap['feature'],
	name: string,
): BreakpointMap | null {
	if (value == null) return null;
	const map = clone(object(value, name)) as unknown as BreakpointMap;
	if (map.feature !== feature) throw new RangeError(`${name} has the wrong feature.`);
	validateBreakpointMap(map);
	return map;
}

function coordinateRational(value: RationalInput | unknown, name: string): Rational {
	if (typeof value !== 'number' && (!value || typeof value !== 'object' || Array.isArray(value))) {
		throw new TypeError(`${name} must be rational.`);
	}
	return normalizeRational(value as RationalInput, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
}

function positiveCoordinateRational(value: RationalInput | unknown, name: string): Rational {
	const result = coordinateRational(value, name);
	if (result.num <= 0 || result.den <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function rational(value: RationalInput | unknown, name: string): Rational {
	if (typeof value !== 'number' && (!value || typeof value !== 'object' || Array.isArray(value))) {
		throw new TypeError(`${name} must be rational.`);
	}
	return normalizeRational(value as RationalInput);
}

function rationalRate(value: unknown, name: string): RationalRate {
	const result = rational(value, name);
	if (result.num <= 0 || result.den <= 0) throw new RangeError(`${name} must be positive.`);
	return { num: result.num, den: result.den };
}

function boundedSampleRate(value: unknown): number {
	const result = positiveSafeInteger(value, 'project.sampleRate');
	if (result < AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE || result > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
		throw new RangeError(
			`project.sampleRate must be between ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} and ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`,
		);
	}
	return result;
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function optionalId(value: unknown, name: string): string | null {
	return value == null ? null : nonEmptyString(value, name);
}

function optionalString(value: unknown, name: string): string | null {
	if (value == null || value === '') return null;
	return nonEmptyString(value, name);
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeInteger(value: unknown, minimum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${String(minimum)}.`);
	}
	return number;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function uniqueStrings(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const result = value.map((item, index) => nonEmptyString(item, `${name}[${String(index)}]`));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicates.`);
	return result;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
