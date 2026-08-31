/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic local speaker-turn attribution for canonical transcripts. */

import {
	createAssistanceTranscript,
	type AssistanceTranscript,
	type TranscriptSegment,
} from './transcript.ts';

const MAXIMUM_TURNS = 100_000;

export interface AssistanceSpeakerTurn {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly speakerId: number;
}

export interface AssistanceSpeakerTimeline {
	readonly sampleRate: number;
	readonly turns: readonly AssistanceSpeakerTurn[];
}

type NormalizedTurn = AssistanceSpeakerTurn;

interface ScaledInterval {
	readonly start: bigint;
	readonly end: bigint;
}

/**
 * Assign each transcript segment to the anonymous local cluster with the
 * greatest aggregate overlap. Equal overlap resolves to the lowest stable
 * cluster number; no overlap clears any prior attribution.
 */
export function attributeTranscriptSpeakers(
	transcript: AssistanceTranscript,
	timeline: AssistanceSpeakerTimeline,
): AssistanceTranscript {
	const turns = normalizeTimeline(timeline);
	const bySpeaker = mergeSpeakerTurns(turns);
	const speakers = speakersForSegments(transcript.segments, transcript.sampleRate,
		timeline.sampleRate, bySpeaker);
	const segments = transcript.segments.map((segment, index) => Object.freeze({
		startFrame: segment.startFrame,
		endFrame: segment.endFrame,
		text: segment.text,
		words: segment.words,
		speaker: speakers[index] ?? null,
	}));
	return createAssistanceTranscript({
		sourceId: transcript.sourceId,
		sampleRate: transcript.sampleRate,
		language: transcript.language,
		modelId: transcript.modelId,
		segments,
	});
}

function normalizeTimeline(value: AssistanceSpeakerTimeline): readonly NormalizedTurn[] {
	if (!value || !Number.isSafeInteger(value.sampleRate) || value.sampleRate < 1) {
		throw new RangeError('A speaker timeline needs a positive integer sample rate.');
	}
	if (!Array.isArray(value.turns) || value.turns.length > MAXIMUM_TURNS) {
		throw new RangeError('A speaker timeline exceeds its turn bound.');
	}
	let prior: NormalizedTurn | null = null;
	const turns = value.turns.map((turn, index): NormalizedTurn => {
		if (!turn || !Number.isSafeInteger(turn.startFrame) || turn.startFrame < 0
			|| !Number.isSafeInteger(turn.endFrame) || turn.endFrame <= turn.startFrame) {
			throw new RangeError(`Speaker turn ${index} must have a positive integer duration.`);
		}
		if (!Number.isSafeInteger(turn.speakerId) || turn.speakerId < 0
			|| turn.speakerId >= Number.MAX_SAFE_INTEGER) {
			throw new RangeError(`Speaker turn ${index} has an invalid anonymous cluster id.`);
		}
		const normalized = Object.freeze({
			startFrame: turn.startFrame,
			endFrame: turn.endFrame,
			speakerId: turn.speakerId,
		});
		if (prior && compareTurns(prior, normalized) > 0) {
			throw new RangeError('Speaker turns must be ordered by start, speaker, and end.');
		}
		prior = normalized;
		return normalized;
	});
	return Object.freeze(turns);
}

function mergeSpeakerTurns(
	turns: readonly NormalizedTurn[],
): ReadonlyMap<number, readonly NormalizedTurn[]> {
	const grouped = new Map<number, NormalizedTurn[]>();
	for (const turn of turns) {
		const speakerTurns = grouped.get(turn.speakerId) ?? [];
		const prior = speakerTurns.at(-1);
		if (prior && turn.startFrame <= prior.endFrame) {
			speakerTurns[speakerTurns.length - 1] = Object.freeze({
				startFrame: prior.startFrame,
				endFrame: Math.max(prior.endFrame, turn.endFrame),
				speakerId: turn.speakerId,
			});
		} else {
			speakerTurns.push(turn);
		}
		grouped.set(turn.speakerId, speakerTurns);
	}
	return new Map([...grouped].map(([speakerId, speakerTurns]) => [
		speakerId, Object.freeze(speakerTurns),
	]));
}

function speakersForSegments(
	segments: readonly TranscriptSegment[],
	transcriptRate: number,
	turnRate: number,
	turnsBySpeaker: ReadonlyMap<number, readonly NormalizedTurn[]>,
): readonly (string | null)[] {
	const segmentScale = BigInt(turnRate);
	const turnScale = BigInt(transcriptRate);
	const scaledSegments = segments.map(({ startFrame, endFrame }): ScaledInterval => ({
		start: BigInt(startFrame) * segmentScale,
		end: BigInt(endFrame) * segmentScale,
	}));
	const selectedIds: Array<number | null> = Array.from({ length: segments.length }, () => null);
	const selectedOverlaps = Array.from({ length: segments.length }, () => 0n);
	for (const [speakerId, turns] of turnsBySpeaker) {
		const overlaps = new Map<number, bigint>();
		for (const turn of turns) {
			const scaledTurn = { start: BigInt(turn.startFrame) * turnScale,
				end: BigInt(turn.endFrame) * turnScale };
			for (let index = firstIntervalEndingAfter(scaledSegments, scaledTurn.start);
				index < scaledSegments.length && scaledSegments[index]!.start < scaledTurn.end;
				index += 1) {
				const segment = scaledSegments[index]!;
				const start = segment.start > scaledTurn.start ? segment.start : scaledTurn.start;
				const end = segment.end < scaledTurn.end ? segment.end : scaledTurn.end;
				if (end > start) overlaps.set(index, (overlaps.get(index) ?? 0n) + end - start);
			}
		}
		for (const [index, overlap] of overlaps) {
			const selectedId = selectedIds[index];
			const selectedOverlap = selectedOverlaps[index]!;
			if (overlap > selectedOverlap
				|| (overlap === selectedOverlap
					&& (selectedId === null || speakerId < selectedId))) {
				selectedIds[index] = speakerId;
				selectedOverlaps[index] = overlap;
			}
		}
	}
	return Object.freeze(selectedIds.map((speakerId) => speakerId === null
		? null : `Speaker ${String(speakerId + 1)}`));
}

function firstIntervalEndingAfter(intervals: readonly ScaledInterval[], start: bigint): number {
	let low = 0;
	let high = intervals.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (intervals[middle]!.end <= start) low = middle + 1;
		else high = middle;
	}
	return low;
}

function compareTurns(left: AssistanceSpeakerTurn, right: AssistanceSpeakerTurn): number {
	if (left.startFrame !== right.startFrame) return left.startFrame < right.startFrame ? -1 : 1;
	if (left.speakerId !== right.speakerId) return left.speakerId < right.speakerId ? -1 : 1;
	if (left.endFrame !== right.endFrame) return left.endFrame < right.endFrame ? -1 : 1;
	return 0;
}
