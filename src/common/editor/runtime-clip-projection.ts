/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addRationals,
	beatToSampleFrame,
	type HoldTempoMap,
	type RationalInput,
	type RationalRate,
	videoFrameToSampleFrame,
} from './timeline-time.ts';

export const RUNTIME_CLIP_PROJECTION_VERSION = 1;

export interface RuntimeClipProject extends Readonly<Record<string, unknown>> {
	readonly schemaVersion?: number;
	readonly sampleRate?: number;
	readonly primarySequenceId?: string;
	readonly sequences?: readonly Readonly<Record<string, unknown>>[];
	readonly tempoMap?: HoldTempoMap;
	readonly clips?: readonly RuntimePersistedClip[];
	readonly tracks?: readonly object[];
	readonly projectBin?: Readonly<Record<string, unknown>> & {
		readonly clips?: readonly RuntimePersistedClip[];
	};
}

export interface RuntimePersistedClip extends Readonly<Record<string, unknown>> {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly timelineStartFrame?: unknown;
	readonly durationFrames?: unknown;
	readonly sourceStartFrame?: unknown;
	readonly sourceDurationFrames?: unknown;
	readonly anchor?: unknown;
	readonly musicalStartBeat?: unknown;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: unknown;
	readonly sequenceId?: unknown;
	readonly sequenceStartFrame?: unknown;
	readonly sequenceFrameCount?: unknown;
	readonly sourceInFrame?: unknown;
	readonly sourceFrameCount?: unknown;
}

export interface RuntimeClipProjection extends Readonly<Record<string, unknown>> {
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly sourceDurationFrames: number;
	readonly sequenceStartFrame: number | null;
	readonly sequenceEndFrame: number | null;
	readonly coordinateDomain: 'resolved-samples';
}

export type RuntimeProjectProjection<Project extends RuntimeClipProject> = Omit<Project, 'clips' | 'tracks' | 'projectBin'> & Readonly<{
	clips: readonly RuntimeClipProjection[];
	tracks: readonly Readonly<Record<string, unknown>>[];
	projectBin: Readonly<Record<string, unknown>> & { readonly clips: readonly RuntimeClipProjection[] };
	runtimeProjectionVersion: typeof RUNTIME_CLIP_PROJECTION_VERSION;
}>;

/** Resolve one persisted clip into the only timing surface runtime consumers read. */
export function resolveRuntimeClipProjection(
	project: RuntimeClipProject,
	clip: RuntimePersistedClip,
): RuntimeClipProjection {
	if (!project || typeof project !== 'object') throw new TypeError('A project is required for clip projection.');
	if (!clip || typeof clip !== 'object') throw new TypeError('A persisted clip is required for projection.');
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const resolved = clip.kind === 'video' && usesFoundationCoordinates(project, clip)
		? resolveVideoCoordinates(project, clip, sampleRate)
		: resolveAudioOrLegacyCoordinates(project, clip, sampleRate);
	return Object.freeze({
		...clip,
		...resolved,
		coordinateDomain: 'resolved-samples',
	}) as RuntimeClipProjection;
}

/** Clone a document into a transient runtime-only project projection. */
export function resolveRuntimeProjectProjection<Project extends RuntimeClipProject>(
	project: Project,
): RuntimeProjectProjection<Project> {
	if (!project || typeof project !== 'object') throw new TypeError('A project is required for runtime projection.');
	if (!Array.isArray(project.clips)) throw new TypeError('project.clips must be an array.');
	return Object.freeze({
		...project,
		clips: Object.freeze(project.clips.map((clip) => resolveRuntimeClipProjection(project, clip))),
		tracks: Object.freeze((Array.isArray(project.tracks) ? project.tracks : []).map((track) => (
			resolveRuntimeTrackProjection(project, track)
		))),
		projectBin: Object.freeze({
			...(project.projectBin ?? {}),
			clips: Object.freeze((Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [])
				.map((clip) => resolveRuntimeClipProjection(project, clip))),
		}),
		runtimeProjectionVersion: RUNTIME_CLIP_PROJECTION_VERSION,
	}) as RuntimeProjectProjection<Project>;
}

function resolveRuntimeTrackProjection(
	project: RuntimeClipProject,
	value: object,
): Readonly<Record<string, unknown>> {
	const track = value as Readonly<Record<string, unknown>>;
	if (track.type !== 'label' || !Array.isArray(track.labels)) return track;
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	return Object.freeze({
		...track,
		labels: Object.freeze(track.labels.map((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A label must be an object.');
			const label = value as Readonly<Record<string, unknown>>;
			if (label.anchor !== 'musical') return label;
			if (!project.tempoMap) throw new TypeError('A musical label requires project.tempoMap.');
			return Object.freeze({
				...label,
				startFrame: beatToSampleFrame(rationalInput(label.startBeat, 'label.startBeat'), project.tempoMap, sampleRate),
				endFrame: beatToSampleFrame(rationalInput(label.endBeat, 'label.endBeat'), project.tempoMap, sampleRate),
				coordinateDomain: 'resolved-samples',
			});
		})),
	});
}

function usesFoundationCoordinates(project: RuntimeClipProject, clip: RuntimePersistedClip): boolean {
	return Number(project.schemaVersion) >= 10
		|| clip.sequenceStartFrame !== undefined
		|| clip.sourceInFrame !== undefined;
}

function resolveAudioOrLegacyCoordinates(
	project: RuntimeClipProject,
	clip: RuntimePersistedClip,
	sampleRate: number,
): Omit<RuntimeClipProjection, 'coordinateDomain'> {
	let timelineStartFrame: number;
	let timelineEndFrame: number;
	if (clip.anchor === 'musical') {
		if (!project.tempoMap) throw new TypeError('A musical clip requires project.tempoMap.');
		const startBeat = rationalInput(clip.musicalStartBeat, 'clip.musicalStartBeat');
		timelineStartFrame = beatToSampleFrame(startBeat, project.tempoMap, sampleRate);
		if (clip.musicalExtent === 'beat') {
			const durationBeat = rationalInput(clip.musicalDurationBeats, 'clip.musicalDurationBeats');
			timelineEndFrame = beatToSampleFrame(addRationals(startBeat, durationBeat), project.tempoMap, sampleRate);
		} else if (clip.musicalExtent === 'fixedSamples') {
			timelineEndFrame = safeAdd(
				timelineStartFrame,
				positiveSafeInteger(clip.durationFrames, 'clip.durationFrames'),
				'clip timeline range',
			);
		} else {
			throw new RangeError('A musical clip requires beat or fixedSamples extent semantics.');
		}
	} else {
		timelineStartFrame = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		timelineEndFrame = safeAdd(
			timelineStartFrame,
			positiveSafeInteger(clip.durationFrames, 'clip.durationFrames'),
			'clip timeline range',
		);
	}
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(
		clip.sourceDurationFrames ?? clip.durationFrames,
		'clip.sourceDurationFrames',
	);
	return Object.freeze({
		timelineStartFrame,
		timelineEndFrame,
		durationFrames: timelineEndFrame - timelineStartFrame,
		sourceStartFrame,
		sourceEndFrame: safeAdd(sourceStartFrame, sourceDurationFrames, 'clip source range'),
		sourceDurationFrames,
		sequenceStartFrame: null,
		sequenceEndFrame: null,
	});
}

function resolveVideoCoordinates(
	project: RuntimeClipProject,
	clip: RuntimePersistedClip,
	sampleRate: number,
): Omit<RuntimeClipProjection, 'coordinateDomain'> {
	const sequence = projectSequence(project, String(clip.sequenceId ?? project.primarySequenceId ?? ''));
	const rate = rationalRate(sequence.rate, 'sequence.rate');
	const sequenceStartFrame = nonNegativeSafeInteger(clip.sequenceStartFrame, 'clip.sequenceStartFrame');
	const sequenceFrameCount = positiveSafeInteger(clip.sequenceFrameCount, 'clip.sequenceFrameCount');
	const sequenceEndFrame = safeAdd(sequenceStartFrame, sequenceFrameCount, 'clip sequence range');
	const timelineStartFrame = videoFrameToSampleFrame(sequenceStartFrame, rate, sampleRate, 'point');
	const timelineEndFrame = videoFrameToSampleFrame(sequenceEndFrame, rate, sampleRate, 'point');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceInFrame, 'clip.sourceInFrame');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceFrameCount, 'clip.sourceFrameCount');
	return Object.freeze({
		timelineStartFrame,
		timelineEndFrame,
		durationFrames: timelineEndFrame - timelineStartFrame,
		sourceStartFrame,
		sourceEndFrame: safeAdd(sourceStartFrame, sourceDurationFrames, 'clip source range'),
		sourceDurationFrames,
		sequenceStartFrame,
		sequenceEndFrame,
	});
}

function projectSequence(
	project: RuntimeClipProject,
	sequenceId: string,
): Readonly<Record<string, unknown>> {
	if (!sequenceId) throw new TypeError('A video clip requires a sequenceId.');
	const sequence = project.sequences?.find((candidate) => candidate.id === sequenceId);
	if (!sequence) throw new ReferenceError(`Video clip sequence ${sequenceId} is missing.`);
	return sequence;
}

function rationalInput(value: unknown, name: string): RationalInput {
	if (typeof value === 'number') return value;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is required.`);
	const candidate = value as Readonly<Record<string, unknown>>;
	return { num: safeInteger(candidate.num, `${name}.num`), den: nonZeroSafeInteger(candidate.den, `${name}.den`) };
}

function rationalRate(value: unknown, name: string): RationalRate {
	const rational = rationalInput(value, name);
	if (typeof rational === 'number') throw new TypeError(`${name} must be a rational object.`);
	if (rational.num <= 0 || rational.den <= 0) throw new RangeError(`${name} must be positive.`);
	return rational;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer domain.`);
	return result;
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return value as number;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function nonZeroSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (!result) throw new RangeError(`${name} cannot be zero.`);
	return result;
}
