/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	resolveRuntimeProjectProjection,
} from './runtime-clip-projection.ts';
import {
	isTimelineAnnotationProjectSchema,
	isTrackFolderProjectSchema,
} from './project-schema-version.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	beatToSampleFrame,
	sampleFrameToVideoFrame,
	subtractRationals,
	type HoldTempoMap,
	type RationalRate,
} from './timeline-time.ts';
import {
	CONFORMED_SEQUENCE_PLACEMENT,
	FOUNDATION_EDIT_OPERATION,
	LEGACY_TRACK_STRUCTURE_EDIT,
} from './commands/command-projection-transients.ts';

type EditOperation = object;
type DataRecord = Record<string, unknown> & {
	[CONFORMED_SEQUENCE_PLACEMENT]?: true;
	[FOUNDATION_EDIT_OPERATION]?: EditOperation;
	[LEGACY_TRACK_STRUCTURE_EDIT]?: true;
};

interface ConformedBoundaryDelta {
	readonly baseSequenceBoundary: number;
	readonly resolvedSampleDelta: number;
}

type ConformedOperationDeltas = Map<number, ConformedBoundaryDelta>;

/** Supply command implementations with legacy-shaped, transient resolved coordinates. */
export function projectV10ForCommand(project: DataRecord): DataRecord {
	const runtime = resolveRuntimeProjectProjection(project);
	const projected = {
		...runtime,
		sources: project.sources instanceof Array ? project.sources.map((value) => {
			const source = record(value, 'source');
			return source.kind === 'video' ? { ...source, frameCount: source.sampleFrameCount } : source;
		}) : [],
		projectBin: {
			...record(project.projectBin, 'project.projectBin'),
			clips: projectBinClips(project).map((clip) => resolveRuntimeClipProjection(project, clip)),
		},
	};
	return brandRuntimeProjectProjection(projected);
}

/** Convert a command's resolved-sample mutations back to one authoritative v10 domain per coordinate. */
export function reconcileProjectV10CommandResult(draft: DataRecord, persistedBase: DataRecord): void {
	const sampleRate = positiveSafeInteger(draft.sampleRate, 'project.sampleRate');
	const tempoMap = draft.tempoMap as HoldTempoMap;
	const sequences = recordArray(draft.sequences, 'project.sequences');
	const sequenceById = new Map(sequences.map((sequence) => [String(sequence.id), sequence]));
	const primarySequenceId = String(draft.primarySequenceId);
	const baseSources = new Map(recordArray(persistedBase.sources, 'project.sources').map((source) => [String(source.id), source]));
	const sources = recordArray(draft.sources, 'project.sources').map((source) => {
		if (source.kind !== 'video') return source;
		const base = baseSources.get(String(source.id));
		if (Number.isSafeInteger(source.frameCount)
			&& (!base || Number(source.frameCount) !== Number(base.sampleFrameCount))) {
			source.sampleFrameCount = source.frameCount;
		}
		delete source.frameCount;
		return source;
	});
	draft.sources = sources;
	const sourceById = new Map(sources.map((source) => [String(source.id), source]));
	const baseClips = new Map(recordArray(persistedBase.clips, 'project.clips').map((clip) => [String(clip.id), clip]));
	const clips = recordArray(draft.clips, 'project.clips').map((clip) => ({ ...clip }));
	const sequenceIdByClipId = sequenceIdsByClip(draft, sequences);
	const conformedDeltas = new Map<string, Map<EditOperation, ConformedOperationDeltas>>();
	for (const clip of clips) if (clip.kind === 'video') {
		const owningSequenceId = sequenceIdByClipId.get(String(clip.id));
		if (owningSequenceId) clip.sequenceId = owningSequenceId;
		const editOperation = clip[FOUNDATION_EDIT_OPERATION];
		const conformed = conformVideoClip(
			clip,
			baseClips.get(String(clip.id)),
			persistedBase,
			sequenceById,
			sourceById,
			primarySequenceId,
			sampleRate,
		);
		if (!conformed || !editOperation) continue;
		const byOperation = conformedDeltas.get(conformed.sequenceId) ?? new Map();
		const byDelta = byOperation.get(editOperation) ?? new Map();
		for (const boundary of conformed.boundaries) {
			const previous = byDelta.get(boundary.requestedSampleDelta);
			if (!previous || boundary.baseSequenceBoundary < previous.baseSequenceBoundary) {
				byDelta.set(boundary.requestedSampleDelta, boundary);
			}
		}
		byOperation.set(editOperation, byDelta);
		conformedDeltas.set(conformed.sequenceId, byOperation);
	}
	const resolvedVideoByLink = new Map<string, ReturnType<typeof resolveRuntimeClipProjection>>();
	for (const clip of clips) if (clip.kind === 'video' && typeof clip.avLinkId === 'string') {
		resolvedVideoByLink.set(clip.avLinkId, resolveRuntimeClipProjection(draft, clip));
	}
	for (const clip of clips) if (clip.kind === 'audio') {
		conformMixedOperationAudioPlacement(
			clip,
			baseClips.get(String(clip.id)),
			persistedBase,
			sequenceIdByClipId,
			conformedDeltas,
		);
		const linked = typeof clip.avLinkId === 'string' ? resolvedVideoByLink.get(clip.avLinkId) : null;
		if (linked) {
			clip.timelineStartFrame = linked.timelineStartFrame;
			clip.durationFrames = linked.durationFrames;
		}
		conformAudioClip(clip, baseClips.get(String(clip.id)), persistedBase, tempoMap, sampleRate);
	}
	draft.clips = clips;
	const baseBinClips = new Map(projectBinClips(persistedBase).map((clip) => [String(clip.id), clip]));
	const bin = record(draft.projectBin, 'project.projectBin');
	const binClips = recordArray(bin.clips, 'project.projectBin.clips').map((clip) => ({ ...clip }));
	for (const clip of binClips) {
		if (clip.kind === 'video') conformVideoClip(
			clip,
			baseBinClips.get(String(clip.id)),
			persistedBase,
			sequenceById,
			sourceById,
			primarySequenceId,
			sampleRate,
		);
		else conformAudioClip(clip, baseBinClips.get(String(clip.id)), persistedBase, tempoMap, sampleRate);
	}
	bin.clips = binClips;
	draft.projectBin = bin;
	conformLabels(draft, persistedBase, tempoMap, sampleRate);
	reconcileSequenceTracks(draft, sequences, primarySequenceId);
	if (isTrackFolderProjectSchema(draft.schemaVersion)) {
		reconcileV12TrackHierarchy(draft, persistedBase, sequences);
	}
	if (isTimelineAnnotationProjectSchema(draft.schemaVersion)) reconcileTimelineAnnotations(draft);
	delete draft.runtimeProjectionVersion;
	delete draft[LEGACY_TRACK_STRUCTURE_EDIT];
}

function reconcileTimelineAnnotations(draft: DataRecord): void {
	draft.timelineAnnotations = recordArray(
		draft.timelineAnnotations,
		'project.timelineAnnotations',
	).map((annotation) => {
		const persisted = { ...annotation };
		delete persisted.timelineStartFrame;
		delete persisted.timelineEndFrame;
		delete persisted.durationFrames;
		delete persisted.coordinateDomain;
		return persisted;
	});
}

function conformVideoClip(
	clip: DataRecord,
	base: DataRecord | undefined,
	persistedBase: DataRecord,
	sequenceById: ReadonlyMap<string, DataRecord>,
	sourceById: ReadonlyMap<string, DataRecord>,
	primarySequenceId: string,
	sampleRate: number,
): Readonly<{
	sequenceId: string;
	boundaries: readonly Readonly<{
		requestedSampleDelta: number;
		baseSequenceBoundary: number;
		resolvedSampleDelta: number;
	}>[];
}> | null {
	const sequenceId = String(clip.sequenceId ?? primarySequenceId);
	const sequence = sequenceById.get(sequenceId);
	if (!sequence) throw new ReferenceError(`Video clip ${String(clip.id)} references a missing sequence.`);
	const source = sourceById.get(String(clip.sourceId));
	if (!source || source.kind !== 'video') throw new ReferenceError(`Video clip ${String(clip.id)} references a missing video source.`);
	const rate = rationalRate(sequence.rate, 'sequence.rate');
	let operation = null;
	if (Number.isSafeInteger(clip.timelineStartFrame) && Number.isSafeInteger(clip.durationFrames)) {
		const timelineStart = Number(clip.timelineStartFrame);
		const timelineEnd = safeAdd(timelineStart, Number(clip.durationFrames), 'clip timeline range');
		if (base?.kind === 'video' && String(base.sequenceId) === sequenceId) {
			const baseProjection = resolveRuntimeClipProjection(persistedBase, base);
			const baseStart = nonNegativeSafeInteger(base.sequenceStartFrame, 'clip.sequenceStartFrame');
			const baseCount = positiveSafeInteger(base.sequenceFrameCount, 'clip.sequenceFrameCount');
			const requestedSampleDelta = timelineStart - baseProjection.timelineStartFrame;
			const requestedEndDelta = timelineEnd - baseProjection.timelineEndFrame;
			const startDelta = sampleFrameToVideoFrame(requestedSampleDelta, rate, sampleRate, 'point');
			const endDelta = sampleFrameToVideoFrame(requestedEndDelta, rate, sampleRate, 'point');
			const start = safeAdd(baseStart, startDelta, 'clip sequence start');
			const end = safeAdd(safeAdd(baseStart, baseCount, 'clip sequence range'), endDelta, 'clip sequence end');
			if (start < 0 || end <= start) throw new RangeError(`Video clip ${String(clip.id)} does not retain a positive frame-grid range.`);
			clip.sequenceStartFrame = start;
			clip.sequenceFrameCount = end - start;
			const conformedProjection = resolveRuntimeClipProjection(persistedBase, {
				...base,
				sequenceStartFrame: start,
				sequenceFrameCount: end - start,
			});
			operation = {
				sequenceId,
				boundaries: [
					{
						requestedSampleDelta,
						baseSequenceBoundary: baseStart,
						resolvedSampleDelta: conformedProjection.timelineStartFrame - baseProjection.timelineStartFrame,
					},
					{
						requestedSampleDelta: requestedEndDelta,
						baseSequenceBoundary: safeAdd(baseStart, baseCount, 'clip sequence range'),
						resolvedSampleDelta: conformedProjection.timelineEndFrame - baseProjection.timelineEndFrame,
					},
				],
			};
		} else if (base?.kind === 'video') {
			const baseProjection = resolveRuntimeClipProjection(persistedBase, base);
			const baseCount = positiveSafeInteger(base.sequenceFrameCount, 'clip.sequenceFrameCount');
			const requestedSampleDelta = timelineStart - baseProjection.timelineStartFrame;
			const requestedEndDelta = timelineEnd - baseProjection.timelineEndFrame;
			const start = sampleFrameToVideoFrame(timelineStart, rate, sampleRate, 'point');
			const end = requestedSampleDelta === requestedEndDelta
				? safeAdd(start, baseCount, 'clip sequence range')
				: sampleFrameToVideoFrame(timelineEnd, rate, sampleRate, 'point');
			if (start < 0 || end <= start) throw new RangeError(`Video clip ${String(clip.id)} does not retain a positive frame-grid range.`);
			clip.sequenceStartFrame = start;
			clip.sequenceFrameCount = end - start;
			const conformedProjection = resolveRuntimeClipProjection(persistedBase, {
				...base,
				sequenceId,
				sequenceStartFrame: start,
				sequenceFrameCount: end - start,
			});
			operation = {
				sequenceId,
				boundaries: [
					{
						requestedSampleDelta,
						baseSequenceBoundary: start,
						resolvedSampleDelta: conformedProjection.timelineStartFrame - baseProjection.timelineStartFrame,
					},
					{
						requestedSampleDelta: requestedEndDelta,
						baseSequenceBoundary: end,
						resolvedSampleDelta: conformedProjection.timelineEndFrame - baseProjection.timelineEndFrame,
					},
				],
			};
		} else if (clip[CONFORMED_SEQUENCE_PLACEMENT] === true) {
			const sequenceStart = nonNegativeSafeInteger(clip.sequenceStartFrame, 'clip.sequenceStartFrame');
			const sequenceCount = positiveSafeInteger(clip.sequenceFrameCount, 'clip.sequenceFrameCount');
			const resolved = resolveRuntimeClipProjection(persistedBase, {
				...clip,
				sequenceId,
				sequenceStartFrame: sequenceStart,
				sequenceFrameCount: sequenceCount,
			});
			if (resolved.timelineStartFrame !== timelineStart || resolved.timelineEndFrame !== timelineEnd) {
				throw new RangeError(`Video clip ${String(clip.id)} has inconsistent conformed sequence placement.`);
			}
		} else {
			const start = sampleFrameToVideoFrame(timelineStart, rate, sampleRate, 'point');
			const end = sampleFrameToVideoFrame(timelineEnd, rate, sampleRate, 'point');
			clip.sequenceStartFrame = start;
			clip.sequenceFrameCount = Math.max(1, end - start);
		}
	}
	clip.sequenceId = sequenceId;
	if (Number.isSafeInteger(clip.sourceStartFrame)) clip.sourceInFrame = clip.sourceStartFrame;
	if (Number.isSafeInteger(clip.sourceDurationFrames)) clip.sourceFrameCount = clip.sourceDurationFrames;
	stripProjection(clip, ['timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames']);
	delete clip[CONFORMED_SEQUENCE_PLACEMENT];
	return operation;
}

function conformMixedOperationAudioPlacement(
	clip: DataRecord,
	base: DataRecord | undefined,
	persistedBase: DataRecord,
	sequenceIdByClipId: ReadonlyMap<string, string>,
	conformedDeltas: ReadonlyMap<string, ReadonlyMap<EditOperation, ReadonlyMap<number, ConformedBoundaryDelta>>>,
): void {
	const operation = clip[FOUNDATION_EDIT_OPERATION];
	if (!operation) return;
	if (!base || base.kind !== 'audio' || !Number.isSafeInteger(clip.timelineStartFrame)
		|| !Number.isSafeInteger(clip.durationFrames)) return;
	const sequenceId = sequenceIdByClipId.get(String(clip.id));
	if (!sequenceId) return;
	const baseProjection = resolveRuntimeClipProjection(persistedBase, base);
	const requestedStart = Number(clip.timelineStartFrame);
	const requestedEnd = safeAdd(requestedStart, Number(clip.durationFrames), 'clip timeline range');
	const requestedStartDelta = requestedStart - baseProjection.timelineStartFrame;
	const requestedEndDelta = requestedEnd - baseProjection.timelineEndFrame;
	const byDelta = conformedDeltas.get(sequenceId)?.get(operation);
	if (!byDelta) return;
	const startDelta = byDelta.get(requestedStartDelta);
	if (!startDelta) return;
	const resolvedStart = baseProjection.timelineStartFrame + startDelta.resolvedSampleDelta;
	if (requestedStartDelta === requestedEndDelta) {
		clip.timelineStartFrame = resolvedStart;
		return;
	}
	const endDelta = byDelta.get(requestedEndDelta);
	if (!endDelta) return;
	const resolvedEnd = baseProjection.timelineEndFrame + endDelta.resolvedSampleDelta;
	if (resolvedEnd <= resolvedStart) {
		throw new RangeError(`Audio clip ${String(clip.id)} does not retain a positive conformed range.`);
	}
	clip.timelineStartFrame = resolvedStart;
	clip.durationFrames = resolvedEnd - resolvedStart;
	if (!Number.isSafeInteger(clip.sourceStartFrame) || !Number.isSafeInteger(clip.sourceDurationFrames)) return;
	const requestedSourceStart = Number(clip.sourceStartFrame);
	const requestedSourceEnd = safeAdd(
		requestedSourceStart,
		Number(clip.sourceDurationFrames),
		'clip source range',
	);
	const requestedSourceStartDelta = requestedSourceStart - baseProjection.sourceStartFrame;
	const requestedSourceEndDelta = requestedSourceEnd - baseProjection.sourceEndFrame;
	if (requestedSourceStartDelta !== requestedStartDelta || requestedSourceEndDelta !== requestedEndDelta) return;
	const resolvedSourceStart = baseProjection.sourceStartFrame + startDelta.resolvedSampleDelta;
	const resolvedSourceEnd = baseProjection.sourceEndFrame + endDelta.resolvedSampleDelta;
	if (resolvedSourceStart < 0 || resolvedSourceEnd <= resolvedSourceStart) {
		throw new RangeError(`Audio clip ${String(clip.id)} does not retain a positive conformed source range.`);
	}
	clip.sourceStartFrame = resolvedSourceStart;
	clip.sourceDurationFrames = resolvedSourceEnd - resolvedSourceStart;
}

function sequenceIdsByClip(project: DataRecord, sequences: readonly DataRecord[]): ReadonlyMap<string, string> {
	const sequenceIdByTrackId = new Map<string, string>();
	for (const sequence of sequences) for (const trackId of Array.isArray(sequence.trackIds) ? sequence.trackIds : []) {
		sequenceIdByTrackId.set(String(trackId), String(sequence.id));
	}
	const result = new Map<string, string>();
	for (const track of recordArray(project.tracks, 'project.tracks')) {
		const sequenceId = sequenceIdByTrackId.get(String(track.id));
		if (!sequenceId) continue;
		for (const clipId of Array.isArray(track.clipIds) ? track.clipIds : []) {
			result.set(String(clipId), sequenceId);
		}
	}
	return result;
}

function conformAudioClip(
	clip: DataRecord,
	base: DataRecord | undefined,
	persistedBase: DataRecord,
	tempoMap: HoldTempoMap,
	sampleRate: number,
): void {
	if (clip.anchor === 'musical') {
		const runtimeStart = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const runtimeDuration = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
		const baseProjection = base ? resolveRuntimeClipProjection(persistedBase, base) : null;
		if (!baseProjection || runtimeStart !== baseProjection.timelineStartFrame) {
			clip.musicalStartBeat = sampleFrameToBeat(runtimeStart, tempoMap, sampleRate);
		}
		if (clip.musicalExtent === 'beat'
			&& (!baseProjection || runtimeDuration !== baseProjection.durationFrames || runtimeStart !== baseProjection.timelineStartFrame)) {
			const endBeat = sampleFrameToBeat(safeAdd(runtimeStart, runtimeDuration, 'clip timeline range'), tempoMap, sampleRate);
			clip.musicalDurationBeats = subtractRationals(
				endBeat,
				clip.musicalStartBeat as { num: number; den: number },
			);
		}
		delete clip.timelineStartFrame;
		if (clip.musicalExtent === 'beat') delete clip.durationFrames;
	}
	delete clip.sequenceStartFrame;
	stripProjection(clip);
}

function conformLabels(draft: DataRecord, persistedBase: DataRecord, tempoMap: HoldTempoMap, sampleRate: number): void {
	const persistedTempoMap = persistedBase.tempoMap as HoldTempoMap;
	const baseLabels = new Map<string, DataRecord>();
	for (const track of recordArray(persistedBase.tracks, 'project.tracks')) {
		for (const label of track.type === 'label' ? recordArray(track.labels, 'track.labels') : []) {
			baseLabels.set(String(label.id), label);
		}
	}
	for (const track of recordArray(draft.tracks, 'project.tracks')) {
		if (track.type !== 'label') continue;
		for (const label of recordArray(track.labels, 'track.labels')) {
			if (label.anchor !== 'musical') continue;
			const start = nonNegativeSafeInteger(label.startFrame, 'label.startFrame');
			const end = nonNegativeSafeInteger(label.endFrame, 'label.endFrame');
			const base = baseLabels.get(String(label.id));
			const baseStart = base?.anchor === 'musical'
				? beatToSampleFrame(base.startBeat as { num: number; den: number }, persistedTempoMap, sampleRate)
				: null;
			const baseEnd = base?.anchor === 'musical'
				? beatToSampleFrame(base.endBeat as { num: number; den: number }, persistedTempoMap, sampleRate)
				: null;
			if (baseStart === null || start !== baseStart) label.startBeat = sampleFrameToBeat(start, tempoMap, sampleRate);
			if (baseEnd === null || end !== baseEnd) label.endBeat = sampleFrameToBeat(end, tempoMap, sampleRate);
			delete label.startFrame;
			delete label.endFrame;
			delete label.coordinateDomain;
		}
	}
}

function reconcileSequenceTracks(draft: DataRecord, sequences: readonly DataRecord[], primarySequenceId: string): void {
	const live = new Set(recordArray(draft.tracks, 'project.tracks').map(({ id }) => String(id)));
	const assigned = new Set<string>();
	for (const sequence of sequences) {
		const ids = Array.isArray(sequence.trackIds)
			? sequence.trackIds.map(String).filter((id) => live.has(id) && !assigned.has(id))
			: [];
		for (const id of ids) assigned.add(id);
		sequence.trackIds = ids;
	}
	const primary = sequences.find(({ id }) => id === primarySequenceId);
	if (!primary) throw new ReferenceError('The primary sequence is missing.');
	primary.trackIds = [...(primary.trackIds as string[]), ...[...live].filter((id) => !assigned.has(id))];
}

function reconcileV12TrackHierarchy(
	draft: DataRecord,
	persistedBase: DataRecord,
	sequences: readonly DataRecord[],
): void {
	const folders = recordArray(draft.trackFolders, 'project.trackFolders');
	const tracks = recordArray(draft.tracks, 'project.tracks');
	const trackIds = tracks.map(({ id }) => String(id));
	const baseTrackIds = recordArray(persistedBase.tracks, 'project.tracks').map(({ id }) => String(id));
	if (folders.length > 0 && draft[LEGACY_TRACK_STRUCTURE_EDIT]) {
		throw new RangeError('Structural edits to a track folder hierarchy require folder-aware track commands.');
	}
	if (folders.length > 0 && !sameStrings(trackIds, baseTrackIds)) {
		throw new RangeError('A track folder hierarchy cannot drift from its persisted track order.');
	}
	if (folders.length > 0) return;
	assertLegacyV12SequenceBoundaries(trackIds, persistedBase);
	const assigned = new Set<string>();
	for (const sequence of sequences) {
		const membership = new Set(Array.isArray(sequence.trackIds) ? sequence.trackIds.map(String) : []);
		const ordered = trackIds.filter((id) => membership.has(id) && !assigned.has(id));
		for (const id of ordered) assigned.add(id);
		sequence.trackIds = ordered;
		sequence.trackNodes = ordered.map((id) => ({ kind: 'track', id, parentFolderId: null }));
	}
	const hierarchyOrder = sequences.flatMap((sequence) => sequence.trackIds as readonly string[]);
	if (hierarchyOrder.length !== trackIds.length) {
		throw new RangeError('V12 track hierarchy must own every project track exactly once.');
	}
	const trackById = new Map(tracks.map((track) => [String(track.id), track]));
	draft.tracks = hierarchyOrder.map((id) => {
		const track = trackById.get(id);
		if (!track) throw new ReferenceError(`V12 track hierarchy references missing track ${id}.`);
		return track;
	});
}

function assertLegacyV12SequenceBoundaries(trackIds: readonly string[], persistedBase: DataRecord): void {
	const sequenceIndexByTrackId = new Map<string, number>();
	for (const [sequenceIndex, sequence] of recordArray(
		persistedBase.sequences,
		'project.sequences',
	).entries()) {
		for (const trackId of Array.isArray(sequence.trackIds) ? sequence.trackIds.map(String) : []) {
			sequenceIndexByTrackId.set(trackId, sequenceIndex);
		}
	}
	let previousSequenceIndex = -1;
	for (const trackId of trackIds) {
		const sequenceIndex = sequenceIndexByTrackId.get(trackId);
		if (sequenceIndex === undefined) continue;
		if (sequenceIndex < previousSequenceIndex) {
			throw new RangeError('Legacy track reorder cannot cross V12 sequence boundaries.');
		}
		previousSequenceIndex = sequenceIndex;
	}
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stripProjection(clip: DataRecord, additional: readonly string[] = []): void {
	for (const name of [
		'timelineEndFrame', 'sourceEndFrame', 'sequenceEndFrame', 'coordinateDomain',
		'key', 'offsetFrame', ...additional,
	]) {
		delete clip[name];
	}
	delete clip[FOUNDATION_EDIT_OPERATION];
}

function projectBinClips(project: DataRecord): DataRecord[] {
	return recordArray(record(project.projectBin, 'project.projectBin').clips, 'project.projectBin.clips');
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function rationalRate(value: unknown, name: string): RationalRate {
	const candidate = record(value, name);
	const num = positiveSafeInteger(candidate.num, `${name}.num`);
	const den = positiveSafeInteger(candidate.den, `${name}.den`);
	return { num, den };
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
