/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeClipProjection,
	resolveRuntimeProjectProjection,
} from './runtime-clip-projection.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	sampleFrameToVideoFrame,
	subtractRationals,
	type HoldTempoMap,
	type RationalRate,
} from './timeline-time.ts';

type DataRecord = Record<string, unknown>;

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
	return projected;
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
	for (const clip of clips) if (clip.kind === 'video') {
		conformVideoClip(clip, sequenceById, sourceById, primarySequenceId, sampleRate);
	}
	const resolvedVideoByLink = new Map<string, ReturnType<typeof resolveRuntimeClipProjection>>();
	for (const clip of clips) if (clip.kind === 'video' && typeof clip.avLinkId === 'string') {
		resolvedVideoByLink.set(clip.avLinkId, resolveRuntimeClipProjection(draft, clip));
	}
	for (const clip of clips) if (clip.kind === 'audio') {
		const linked = typeof clip.avLinkId === 'string' ? resolvedVideoByLink.get(clip.avLinkId) : null;
		if (linked) {
			clip.timelineStartFrame = linked.timelineStartFrame;
			clip.durationFrames = linked.durationFrames;
		}
		conformAudioClip(clip, baseClips.get(String(clip.id)), tempoMap, sampleRate);
	}
	draft.clips = clips;
	const baseBinClips = new Map(projectBinClips(persistedBase).map((clip) => [String(clip.id), clip]));
	const bin = record(draft.projectBin, 'project.projectBin');
	const binClips = recordArray(bin.clips, 'project.projectBin.clips').map((clip) => ({ ...clip }));
	for (const clip of binClips) {
		if (clip.kind === 'video') conformVideoClip(clip, sequenceById, sourceById, primarySequenceId, sampleRate);
		else conformAudioClip(clip, baseBinClips.get(String(clip.id)), tempoMap, sampleRate);
	}
	bin.clips = binClips;
	draft.projectBin = bin;
	conformLabels(draft, persistedBase, tempoMap, sampleRate);
	reconcileSequenceTracks(draft, sequences, primarySequenceId);
	delete draft.runtimeProjectionVersion;
}

function conformVideoClip(
	clip: DataRecord,
	sequenceById: ReadonlyMap<string, DataRecord>,
	sourceById: ReadonlyMap<string, DataRecord>,
	primarySequenceId: string,
	sampleRate: number,
): void {
	const sequenceId = String(clip.sequenceId ?? primarySequenceId);
	const sequence = sequenceById.get(sequenceId);
	if (!sequence) throw new ReferenceError(`Video clip ${String(clip.id)} references a missing sequence.`);
	const source = sourceById.get(String(clip.sourceId));
	if (!source || source.kind !== 'video') throw new ReferenceError(`Video clip ${String(clip.id)} references a missing video source.`);
	const rate = rationalRate(sequence.rate, 'sequence.rate');
	if (Number.isSafeInteger(clip.timelineStartFrame) && Number.isSafeInteger(clip.durationFrames)) {
		const timelineStart = Number(clip.timelineStartFrame);
		const timelineEnd = safeAdd(timelineStart, Number(clip.durationFrames), 'clip timeline range');
		const start = sampleFrameToVideoFrame(timelineStart, rate, sampleRate, 'point');
		const end = sampleFrameToVideoFrame(timelineEnd, rate, sampleRate, 'point');
		clip.sequenceStartFrame = start;
		clip.sequenceFrameCount = Math.max(1, end - start);
	}
	clip.sequenceId = sequenceId;
	if (Number.isSafeInteger(clip.sourceStartFrame)) clip.sourceInFrame = clip.sourceStartFrame;
	if (Number.isSafeInteger(clip.sourceDurationFrames)) clip.sourceFrameCount = clip.sourceDurationFrames;
	stripProjection(clip, ['timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames']);
}

function conformAudioClip(
	clip: DataRecord,
	base: DataRecord | undefined,
	tempoMap: HoldTempoMap,
	sampleRate: number,
): void {
	if (clip.anchor === 'musical') {
		const runtimeStart = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const runtimeDuration = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
		const baseProjection = base ? resolveRuntimeClipProjection({ sampleRate, tempoMap }, base) : null;
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
			const baseStart = base ? sampleFrameToBeat(start, tempoMap, sampleRate) : null;
			if (!base || JSON.stringify(base.startBeat) !== JSON.stringify(baseStart)) label.startBeat = sampleFrameToBeat(start, tempoMap, sampleRate);
			label.endBeat = sampleFrameToBeat(end, tempoMap, sampleRate);
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

function stripProjection(clip: DataRecord, additional: readonly string[] = []): void {
	for (const name of [
		'timelineEndFrame', 'sourceEndFrame', 'sequenceEndFrame', 'coordinateDomain',
		'key', 'offsetFrame', ...additional,
	]) {
		delete clip[name];
	}
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
