/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection } from './runtime-clip-projection.ts';
import {
	SEQUENCE_DROP_FRAME_RATES,
	sequenceTimecodeFrameRate,
	sequenceTimecodeGeometry,
} from './sequence-timecode.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from './timeline-coordinate-limits.ts';
import {
	beatToSampleFrame,
	compareRationals,
	normalizeRational,
	type BreakpointMap,
	type HoldTempoMap,
	type Rational,
	validateBreakpointMap,
} from './timeline-time.ts';
import {
	validateSampleLockedTempoBeatAuthority,
	validateTempoInverseRationalClosure,
} from './timeline-tempo-inverse.ts';
import { assertHoldTempoMapWireKeys } from './musical-map-contract.ts';
import { normalizeVideoTimingAssetReference } from './video-timing-asset-reference.ts';
import { validateVideoTrackComposition } from './video-timeline.js';
import { isVideoRetimeCurveProjectSchema } from './project-schema-version.ts';
import { normalizeVideoRetimeCurveV16 } from './video-retime-v16.ts';
import {
	projectArray,
	projectBoolean,
	projectOptionalId,
	projectRecord,
	projectSafeInteger,
	projectString,
	projectUniqueIds,
	projectUniqueStrings,
	type ProjectDataRecord,
} from './project-validation-primitives.ts';

export const AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE = 8_000;
export const AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE = 768_000;
export const AUDIO_EDITOR_RATIONAL_MAXIMUM_DENOMINATOR = 1_000_000;
export { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from './timeline-coordinate-limits.ts';
export const AUDIO_EDITOR_FOUNDATION_MAXIMUM_EVENTS = 4_096;

const SHA256 = /^[a-f0-9]{64}$/u;
const DROP_FRAME_RATES = new Set(SEQUENCE_DROP_FRAME_RATES);

export interface ProjectFoundationCollections {
	readonly sources: readonly ProjectDataRecord[];
	readonly clips: readonly ProjectDataRecord[];
	readonly tracks: readonly ProjectDataRecord[];
	readonly binClips: readonly ProjectDataRecord[];
}

/** Validate the shared project foundation layer; the document validator owns unchanged fields. */
export function validateProjectFoundation(
	project: ProjectDataRecord,
	media: ProjectFoundationCollections,
): true {
	const sampleRate = projectSafeInteger(
		project.sampleRate,
		AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
		'project.sampleRate',
	);
	if (sampleRate > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
		throw new RangeError(`project.sampleRate cannot exceed ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`);
	}
	const sequences = validateSequences(project, media.tracks, sampleRate);
	validateTempoMap(project.tempoMap, sampleRate);
	validateSignatureMap(project.signatureMap);
	validateLegacyMusicalProjection(project);
	const sourceById = new Map(media.sources.map((source) => [String(source.id), source]));
	const sequenceById = new Map(sequences.map((sequence) => [String(sequence.id), sequence]));
	const sequenceIdByTrackId = new Map<string, string>();
	for (const sequence of sequences) for (const trackId of sequence.trackIds as readonly string[]) {
		sequenceIdByTrackId.set(trackId, String(sequence.id));
	}
	const sequenceIdByClipId = new Map<string, string>();
	for (const track of media.tracks) {
		const sequenceId = sequenceIdByTrackId.get(String(track.id));
		if (!sequenceId || !Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) sequenceIdByClipId.set(String(clipId), sequenceId);
	}
	for (const source of media.sources) validateFoundationSource(source);
	for (const clip of media.clips) {
		validateFoundationClip(
			project, clip, sourceById, sequenceById, sampleRate,
			sequenceIdByClipId.get(String(clip.id)) ?? null,
		);
	}
	for (const clip of media.binClips) {
		validateFoundationClip(project, clip, sourceById, sequenceById, sampleRate, null);
	}
	validateFoundationBinItems(project, media.binClips);
	for (const track of media.tracks) validateFoundationTrack(track, project, sampleRate);
	const resolvedClipById = new Map(media.clips.map((clip) => {
		const resolved = resolveRuntimeClipProjection(project, clip);
		return [String(resolved.id), resolved];
	}));
	for (const track of media.tracks) {
		if (track.type === 'video') validateVideoTrackComposition(track, resolvedClipById);
	}
	validateDerivedAvLinks(project, media.clips, media.tracks);
	return true;
}

function validateLegacyMusicalProjection(project: ProjectDataRecord): void {
	const legacy = projectRecord(project.tempo, 'project.tempo');
	const legacySignature = projectRecord(legacy.timeSignature, 'project.tempo.timeSignature');
	const tempoMap = projectRecord(project.tempoMap, 'project.tempoMap');
	const tempoEvent = projectRecord(projectArray(tempoMap.events, 'tempoMap.events')[0], 'tempoMap.events[0]');
	const bpm = projectRecord(tempoEvent.bpm, 'tempoMap.events[0].bpm');
	if (legacy.bpm !== Number(bpm.num) / Number(bpm.den)) {
		throw new RangeError('The legacy tempo projection must agree with the authoritative tempo map.');
	}
	const signatureMap = projectRecord(project.signatureMap, 'project.signatureMap');
	const signature = projectRecord(projectArray(signatureMap.events, 'signatureMap.events')[0], 'signatureMap.events[0]');
	if (legacySignature.numerator !== signature.numerator || legacySignature.denominator !== signature.denominator) {
		throw new RangeError('The legacy signature projection must agree with the authoritative signature map.');
	}
}

function validateFoundationBinItems(project: ProjectDataRecord, clips: readonly ProjectDataRecord[]): void {
	const byItem = new Map<string, ProjectDataRecord[]>();
	for (const clip of clips) {
		const id = String(clip.binItemId);
		const entries = byItem.get(id) ?? [];
		entries.push(clip);
		byItem.set(id, entries);
	}
	for (const [id, entries] of byItem) {
		const audio = entries.find(({ kind }) => kind === 'audio');
		const video = entries.find(({ kind }) => kind === 'video');
		if (!audio || !video) continue;
		if (audio.musicalExtent !== 'fixedSamples') {
			throw new RangeError(`Project Bin item ${id} audio must use a fixed-sample extent to retain video duration.`);
		}
		const audioRange = resolveRuntimeClipProjection(project, audio);
		const videoRange = resolveRuntimeClipProjection(project, video);
		if (audioRange.durationFrames !== videoRange.durationFrames) {
			throw new RangeError(`Project Bin item ${id} clips must have aligned resolved durations.`);
		}
	}
}

function validateSequences(
	project: ProjectDataRecord,
	tracks: readonly ProjectDataRecord[],
	sampleRate: number,
): readonly ProjectDataRecord[] {
	const sequences = recordArray(project.sequences, 'project.sequences');
	if (!sequences.length || sequences.length > 1_024) throw new RangeError('A project requires 1 through 1024 sequences.');
	projectUniqueIds(sequences, 'project.sequences');
	const trackIds = new Set(tracks.map((track) => String(track.id)));
	const assigned = new Set<string>();
	for (const sequence of sequences) {
		const prefix = `sequence ${String(sequence.id)}`;
		projectString(sequence.id, `${prefix}.id`);
		projectString(sequence.name, `${prefix}.name`);
		const rate = boundedFrameRate(sequence.rate, `${prefix}.rate`, sampleRate);
		const dropFrame = projectBoolean(sequence.dropFrame, `${prefix}.dropFrame`);
		if (dropFrame && !DROP_FRAME_RATES.has(`${String(rate.num)}/${String(rate.den)}`)) {
			throw new RangeError(`${prefix} uses an illegal drop-frame rate combination.`);
		}
		validateStartTimecode(sequence.startTimecode, rate, dropFrame, prefix);
		for (const trackId of projectUniqueStrings(sequence.trackIds, `${prefix}.trackIds`)) {
			if (!trackIds.has(trackId)) throw new ReferenceError(`${prefix} references missing track ${trackId}.`);
			if (assigned.has(trackId)) throw new RangeError(`Track ${trackId} belongs to more than one sequence.`);
			assigned.add(trackId);
		}
	}
	if (assigned.size !== trackIds.size) throw new RangeError('Every track must belong to exactly one sequence.');
	const primary = projectString(project.primarySequenceId, 'project.primarySequenceId');
	if (!sequences.some(({ id }) => id === primary)) throw new ReferenceError('The primary sequence is missing.');
	return sequences;
}

function validateStartTimecode(
	value: unknown,
	rate: { num: number; den: number },
	dropFrame: boolean,
	prefix: string,
): void {
	const timecode = projectRecord(value, `${prefix}.startTimecode`);
	projectBoolean(timecode.negative, `${prefix}.startTimecode.negative`);
	projectSafeInteger(timecode.hours, 0, `${prefix}.startTimecode.hours`);
	const minutes = projectSafeInteger(timecode.minutes, 0, `${prefix}.startTimecode.minutes`);
	const seconds = projectSafeInteger(timecode.seconds, 0, `${prefix}.startTimecode.seconds`);
	const frames = projectSafeInteger(timecode.frames, 0, `${prefix}.startTimecode.frames`);
	if (minutes >= 60 || seconds >= 60 || frames >= sequenceTimecodeFrameRate(rate)) {
		throw new RangeError(`${prefix}.startTimecode is outside the sequence rate.`);
	}
	// A label the drop-frame sequence skips does not exist: every derived
	// timing view throws on it, so it is rejected here like any other
	// out-of-range field rather than admitted and crashed on later.
	const { droppedLabels } = sequenceTimecodeGeometry(rate, dropFrame);
	if (droppedLabels > 0 && seconds === 0 && minutes % 10 !== 0 && frames < droppedLabels) {
		throw new RangeError(`${prefix}.startTimecode is a skipped drop-frame label.`);
	}
}

function validateTempoMap(value: unknown, sampleRate: number): void {
	const map = projectRecord(value, 'project.tempoMap');
	assertHoldTempoMapWireKeys(map);
	if (map.mode !== 'musical' && map.mode !== 'sampleLocked') throw new RangeError('tempoMap.mode is unsupported.');
	const events = boundedEvents(map.events, 'tempoMap.events');
	projectUniqueIds(events, 'tempoMap.events');
	let previousBeat: { num: number; den: number } | null = null;
	let previousSample = -1;
	for (const [index, event] of events.entries()) {
		projectString(event.id, `tempoMap.events[${String(index)}].id`);
		const beat = canonicalCoordinateRational(event.beat, `tempoMap.events[${String(index)}].beat`);
		const bpm = canonicalRational(event.bpm, `tempoMap.events[${String(index)}].bpm`, true);
		if (bpm.num / bpm.den > 1_000) throw new RangeError('Tempo values cannot exceed 1000 BPM.');
		if (index === 0 && compareRationals(beat, 0) !== 0) throw new RangeError('The first tempo event must begin at beat zero.');
		if (previousBeat && compareRationals(previousBeat, beat) >= 0) throw new RangeError('Tempo beats must increase.');
		if (map.mode === 'sampleLocked') {
			const sample = projectSafeInteger(event.samplePosition, 0, `tempoMap.events[${String(index)}].samplePosition`);
			if (sample <= previousSample && index > 0) throw new RangeError('Sample-locked tempo positions must increase.');
			if (index === 0 && sample !== 0) throw new RangeError('The first sample-locked tempo position must begin at sample zero.');
			previousSample = sample;
		} else if (Object.hasOwn(event, 'samplePosition')) {
			throw new RangeError('Musical tempo events cannot persist derived sample positions.');
		}
		previousBeat = beat;
	}
	if (map.mode === 'sampleLocked') validateSampleLockedTempoBeatAuthority(map as unknown as HoldTempoMap, sampleRate);
	if (map.mode === 'musical') {
		const tempoMap = map as unknown as HoldTempoMap;
		beatToSampleFrame(events.at(-1)!.beat as Rational, tempoMap, sampleRate);
	}
	validateTempoInverseRationalClosure(map as unknown as HoldTempoMap, sampleRate);
}

function validateSignatureMap(value: unknown): void {
	const map = projectRecord(value, 'project.signatureMap');
	const events = boundedEvents(map.events, 'signatureMap.events');
	projectUniqueIds(events, 'signatureMap.events');
	let previousBar = -1;
	for (const [index, event] of events.entries()) {
		projectString(event.id, `signatureMap.events[${String(index)}].id`);
		const bar = projectSafeInteger(event.bar, 0, `signatureMap.events[${String(index)}].bar`);
		const numerator = projectSafeInteger(event.numerator, 1, `signatureMap.events[${String(index)}].numerator`);
		const denominator = projectSafeInteger(event.denominator, 1, `signatureMap.events[${String(index)}].denominator`);
		if (index === 0 && bar !== 0) throw new RangeError('The first signature event must begin at bar zero.');
		if (bar <= previousBar && index > 0) throw new RangeError('Signature bars must increase.');
		if (!isPowerOfTwo(denominator) || numerator > 1_000) {
			throw new RangeError('Signature events require a bounded numerator and power-of-two denominator.');
		}
		previousBar = bar;
	}
}

function validateFoundationSource(source: ProjectDataRecord): void {
	if (source.kind !== 'video') return;
	const prefix = `source ${String(source.id)}`;
	forbidDerived(source, ['frameCount'], prefix);
	projectSafeInteger(source.sampleFrameCount, 1, `${prefix}.sampleFrameCount`);
	const sourceFrameCount = projectSafeInteger(source.sourceFrameCount, 1, `${prefix}.sourceFrameCount`);
	const sourceSampleRate = projectSafeInteger(source.sampleRate, 1, `${prefix}.sampleRate`);
	const frameRate = boundedFrameRate(source.frameRate, `${prefix}.frameRate`, sourceSampleRate);
	const decision = projectRecord(source.timingDecision, `${prefix}.timingDecision`);
	if (decision.mode !== 'exact' && decision.mode !== 'conform-cfr-at-ingest') {
		throw new RangeError(`${prefix}.timingDecision.mode is unsupported.`);
	}
	const decisionRate = boundedFrameRate(decision.rate, `${prefix}.timingDecision.rate`, sourceSampleRate);
	if (compareRationals(decisionRate, frameRate) !== 0) {
		throw new RangeError(`${prefix}.timingDecision.rate must equal its canonical frame rate.`);
	}
	if (source.timingAsset === null) {
		if (decision.mode === 'exact') throw new RangeError(`${prefix} exact timing requires a timing asset.`);
		return;
	}
	const reference = normalizeVideoTimingAssetReference(source.timingAsset);
	if (reference.frameCount !== sourceFrameCount) throw new RangeError(`${prefix} timing asset frame count disagrees.`);
	if (typeof source.contentSha256 !== 'string' || !SHA256.test(source.contentSha256)
		|| reference.sourceSha256 !== source.contentSha256) {
		throw new RangeError(`${prefix} timing asset is not bound to its source content digest.`);
	}
}

function validateFoundationClip(
	project: ProjectDataRecord,
	clip: ProjectDataRecord,
	sourceById: ReadonlyMap<string, ProjectDataRecord>,
	sequenceById: ReadonlyMap<string, ProjectDataRecord>,
	sampleRate: number,
	owningSequenceId: string | null,
): void {
	const prefix = `clip ${String(clip.id)}`;
	const source = sourceById.get(String(clip.sourceId));
	if (!source) throw new ReferenceError(`${prefix} references a missing source.`);
	if (source.kind !== clip.kind) throw new RangeError(`${prefix} references a different source kind.`);
	if (clip.kind === 'audio') {
		validateAudioAuthority(clip, prefix);
		const sourceStart = projectSafeInteger(clip.sourceStartFrame, 0, `${prefix}.sourceStartFrame`);
		const sourceDuration = projectSafeInteger(clip.sourceDurationFrames, 1, `${prefix}.sourceDurationFrames`);
		if (sourceStart + sourceDuration > Number(source.frameCount)) throw new RangeError(`${prefix} exceeds source bounds.`);
		if (isVideoRetimeCurveProjectSchema(project) && clip.retimeMap != null) {
			throw new RangeError(`${prefix}.retimeMap is supported only on video clips.`);
		}
		validateOptionalBreakpoint(clip.warpMap, 'audio-warp', `${prefix}.warpMap`);
		validateResolvedClipRange(resolveRuntimeClipProjection(project, clip), prefix);
		return;
	}
	forbidDerived(clip, ['timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames'], prefix);
	const sequenceId = projectString(clip.sequenceId, `${prefix}.sequenceId`);
	if (!sequenceById.has(sequenceId)) throw new ReferenceError(`${prefix} references missing sequence ${sequenceId}.`);
	if (owningSequenceId && sequenceId !== owningSequenceId) {
		throw new RangeError(`${prefix} must use its owning track sequence ${owningSequenceId}.`);
	}
	const sequenceStart = projectSafeInteger(clip.sequenceStartFrame, 0, `${prefix}.sequenceStartFrame`);
	const sequenceCount = projectSafeInteger(clip.sequenceFrameCount, 1, `${prefix}.sequenceFrameCount`);
	const sourceIn = projectSafeInteger(clip.sourceInFrame, 0, `${prefix}.sourceInFrame`);
	const sourceCount = projectSafeInteger(clip.sourceFrameCount, 1, `${prefix}.sourceFrameCount`);
	if (sourceIn + sourceCount > Number(source.sourceFrameCount)) throw new RangeError(`${prefix} exceeds source-frame bounds.`);
	if (isVideoRetimeCurveProjectSchema(project)) {
		normalizeVideoRetimeCurveV16(clip.retimeMap, {
			sequenceFrameCount: sequenceCount,
			sourceInFrame: sourceIn,
			sourceFrameCount: sourceCount,
		});
	} else {
		validateOptionalBreakpoint(clip.retimeMap, 'video-retime', `${prefix}.retimeMap`);
	}
	const resolved = resolveRuntimeClipProjection(project, clip);
	validateResolvedClipRange(resolved, prefix);
	if (sequenceStart + sequenceCount > Number.MAX_SAFE_INTEGER) {
		throw new RangeError(`${prefix} does not resolve to a positive frame-grid range at ${String(sampleRate)} Hz.`);
	}
}

function validateAudioAuthority(clip: ProjectDataRecord, prefix: string): void {
	if (clip.anchor === 'sample') {
		projectSafeInteger(clip.timelineStartFrame, 0, `${prefix}.timelineStartFrame`);
		projectSafeInteger(clip.durationFrames, 1, `${prefix}.durationFrames`);
		if (clip.musicalStartBeat !== null || clip.musicalDurationBeats !== null) {
			throw new RangeError(`${prefix} cannot persist musical coordinates for a sample anchor.`);
		}
		if (clip.musicalExtent !== 'fixedSamples') throw new RangeError(`${prefix}.musicalExtent must be fixedSamples.`);
		return;
	}
	if (clip.anchor !== 'musical') throw new RangeError(`${prefix}.anchor is unsupported.`);
	forbidDerived(clip, ['timelineStartFrame'], prefix);
	canonicalCoordinateRational(clip.musicalStartBeat, `${prefix}.musicalStartBeat`);
	if (clip.musicalExtent === 'fixedSamples') {
		projectSafeInteger(clip.durationFrames, 1, `${prefix}.durationFrames`);
		if (clip.musicalDurationBeats !== null) throw new RangeError(`${prefix} fixed extent cannot carry beat duration.`);
		return;
	}
	if (clip.musicalExtent !== 'beat') throw new RangeError(`${prefix}.musicalExtent is unsupported.`);
	forbidDerived(clip, ['durationFrames'], prefix);
	const duration = canonicalCoordinateRational(clip.musicalDurationBeats, `${prefix}.musicalDurationBeats`, true);
	if (duration.num <= 0) throw new RangeError(`${prefix}.musicalDurationBeats must be positive.`);
}

function validateFoundationTrack(track: ProjectDataRecord, project: ProjectDataRecord, sampleRate: number): void {
	if (track.type !== 'label') return;
	for (const label of recordArray(track.labels, `track ${String(track.id)}.labels`)) {
		const prefix = `label ${String(label.id)}`;
		if (label.anchor === 'sample') {
			projectSafeInteger(label.startFrame, 0, `${prefix}.startFrame`);
			projectSafeInteger(label.endFrame, 0, `${prefix}.endFrame`);
			if (label.startBeat !== null || label.endBeat !== null) throw new RangeError(`${prefix} has conflicting anchors.`);
		} else if (label.anchor === 'musical') {
			forbidDerived(label, ['startFrame', 'endFrame'], prefix);
			const start = canonicalCoordinateRational(label.startBeat, `${prefix}.startBeat`);
			const end = canonicalCoordinateRational(label.endBeat, `${prefix}.endBeat`);
			if (compareRationals(start, end) > 0) throw new RangeError(`${prefix} has a negative musical range.`);
			const tempoMap = project.tempoMap as HoldTempoMap;
			const resolvedStart = beatToSampleFrame(start, tempoMap, sampleRate);
			const resolvedEnd = beatToSampleFrame(end, tempoMap, sampleRate);
			if (resolvedStart < 0 || resolvedEnd < resolvedStart
				|| (compareRationals(start, end) < 0 && resolvedStart === resolvedEnd)) {
				throw new RangeError(`${prefix} must resolve to an ordered positive runtime range.`);
			}
		} else throw new RangeError(`${prefix}.anchor is unsupported.`);
	}
}

function validateDerivedAvLinks(
	project: ProjectDataRecord,
	clips: readonly ProjectDataRecord[],
	tracks: readonly ProjectDataRecord[],
): void {
	const trackByClip = new Map<string, ProjectDataRecord>();
	for (const track of tracks) for (const clipId of Array.isArray(track.clipIds) ? track.clipIds : []) {
		trackByClip.set(String(clipId), track);
	}
	const links = new Map<string, ProjectDataRecord[]>();
	for (const clip of clips) {
		const id = projectOptionalId(clip.avLinkId, `clip ${String(clip.id)}.avLinkId`);
		if (!id) continue;
		const entries = links.get(id) ?? [];
		entries.push(clip);
		links.set(id, entries);
	}
	for (const [id, entries] of links) {
		const audio = entries.find(({ kind }) => kind === 'audio');
		const video = entries.find(({ kind }) => kind === 'video');
		if (entries.length !== 2 || !audio || !video) throw new RangeError(`A/V link ${id} must contain one audio and one video clip.`);
		if (audio.anchor !== 'sample') {
			throw new RangeError(`A/V link ${id} audio clips must use a sample anchor to remain frame-locked.`);
		}
		const a = resolveRuntimeClipProjection(project, audio);
		const v = resolveRuntimeClipProjection(project, video);
		if (a.timelineStartFrame !== v.timelineStartFrame || a.timelineEndFrame !== v.timelineEndFrame) {
			throw new RangeError(`A/V link ${id} clips must have derived-equal presentation ranges.`);
		}
		if (!trackByClip.get(String(audio.id))?.laneGroupId
			|| trackByClip.get(String(audio.id))?.laneGroupId !== trackByClip.get(String(video.id))?.laneGroupId) {
			throw new RangeError(`A/V link ${id} clips must share a media lane group.`);
		}
	}
}

function canonicalRational(value: unknown, name: string, positive = false): { num: number; den: number } {
	return canonicalRationalWithBound(value, name, AUDIO_EDITOR_RATIONAL_MAXIMUM_DENOMINATOR, positive);
}

function canonicalCoordinateRational(value: unknown, name: string, positive = false): { num: number; den: number } {
	return canonicalRationalWithBound(value, name, AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR, positive);
}

function canonicalRationalWithBound(
	value: unknown,
	name: string,
	maximumDenominator: number,
	positive: boolean,
): { num: number; den: number } {
	const candidate = projectRecord(value, name);
	const num = projectSafeInteger(candidate.num, positive ? 1 : 0, `${name}.num`);
	const den = projectSafeInteger(candidate.den, 1, `${name}.den`);
	if (den > maximumDenominator) throw new RangeError(`${name}.den exceeds its bound.`);
	const normalized = normalizeRational({ num, den }, { maximumDenominator });
	if (normalized.num !== num || normalized.den !== den) throw new RangeError(`${name} must be canonically reduced.`);
	return normalized;
}

function validateOptionalBreakpoint(value: unknown, feature: BreakpointMap['feature'], name: string): void {
	if (value === null) return;
	const map = value as BreakpointMap;
	if (map?.feature !== feature) throw new RangeError(`${name} has the wrong breakpoint feature.`);
	validateBreakpointMap(map);
	const points = projectArray(map.points, `${name}.points`);
	for (const [index, value] of points.entries()) {
		const point = projectRecord(value, `${name}.points[${String(index)}]`);
		canonicalBreakpointCoordinate(point.outer, `${name}.points[${String(index)}].outer`);
		canonicalBreakpointCoordinate(point.source, `${name}.points[${String(index)}].source`);
	}
}

function canonicalBreakpointCoordinate(value: unknown, name: string): void {
	if (typeof value === 'number') {
		projectSafeInteger(value, Number.MIN_SAFE_INTEGER, name);
		return;
	}
	const candidate = projectRecord(value, name);
	const num = projectSafeInteger(candidate.num, Number.MIN_SAFE_INTEGER, `${name}.num`);
	const den = projectSafeInteger(candidate.den, 1, `${name}.den`);
	if (den > AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR) throw new RangeError(`${name}.den exceeds its bound.`);
	const normalized = normalizeRational({ num, den }, { maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR });
	if (normalized.num !== num || normalized.den !== den) throw new RangeError(`${name} must be canonically reduced.`);
}

function boundedFrameRate(value: unknown, name: string, sampleRate: number): { num: number; den: number } {
	const rate = canonicalRational(value, name, true);
	if (compareRationals(rate, { num: sampleRate, den: 1 }) > 0) {
		throw new RangeError(`${name} cannot exceed its sample-rate bound.`);
	}
	return rate;
}

function validateResolvedClipRange(
	resolved: Readonly<{ timelineStartFrame: number; timelineEndFrame: number; durationFrames: number }>,
	prefix: string,
): void {
	if (!Number.isSafeInteger(resolved.timelineStartFrame) || resolved.timelineStartFrame < 0
		|| !Number.isSafeInteger(resolved.timelineEndFrame)
		|| !Number.isSafeInteger(resolved.durationFrames) || resolved.durationFrames < 1
		|| resolved.timelineEndFrame - resolved.timelineStartFrame !== resolved.durationFrames) {
		throw new RangeError(`${prefix} must resolve to a positive safe runtime range.`);
	}
}

function isPowerOfTwo(value: number): boolean {
	if (!Number.isSafeInteger(value) || value <= 0) return false;
	const integer = BigInt(value);
	return (integer & (integer - 1n)) === 0n;
}

function boundedEvents(value: unknown, name: string): readonly ProjectDataRecord[] {
	const events = recordArray(value, name);
	if (!events.length || events.length > AUDIO_EDITOR_FOUNDATION_MAXIMUM_EVENTS) {
		throw new RangeError(`${name} must contain 1 through ${String(AUDIO_EDITOR_FOUNDATION_MAXIMUM_EVENTS)} events.`);
	}
	return events;
}

function recordArray(value: unknown, name: string): readonly ProjectDataRecord[] {
	return projectArray(value, name).map((item, index) => projectRecord(item, `${name}[${String(index)}]`));
}

function forbidDerived(value: ProjectDataRecord, names: readonly string[], prefix: string): void {
	for (const name of names) if (Object.hasOwn(value, name)) {
		throw new RangeError(`${prefix} cannot persist derived ${name} cache fields.`);
	}
}
