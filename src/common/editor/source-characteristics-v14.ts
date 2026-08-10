/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoSourceCharacteristics,
	videoSourceCharacteristicsAreReported,
	type VideoSourceCharacteristics,
} from './video-source-characteristics.ts';
import type { SequenceRationalRate } from './sequence-timecode.ts';

/**
 * V14 persists what a probe reported about each video source. The record is
 * always present so an unreported characteristic is a stated fact rather than
 * an absent key, it is stored in exactly the canonical form the wire contract
 * produces, and a reported codec must agree with the legacy codec field it
 * duplicates — validators reject the disagreement instead of repairing it.
 */

type DataRecord = Record<string, unknown>;

/** Attach the canonical characteristics record to every video source in place. */
export function reconcileVideoSourceCharacteristicsV14(project: DataRecord): void {
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	for (const value of sources) {
		if (!isRecord(value) || value.kind !== 'video') continue;
		value.characteristics = normalizeVideoSourceCharacteristics(
			value.characteristics ?? null,
			{ rate: sourceRate(value) },
		);
	}
}

/** Validate the persisted record against the contract that produced it. */
export function validateVideoSourceCharacteristicsV14(project: DataRecord): void {
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	for (const value of sources) {
		if (!isRecord(value) || value.kind !== 'video') continue;
		const prefix = `source ${String(value.id)}`;
		if (!isRecord(value.characteristics)) {
			throw new RangeError(`${prefix}.characteristics is required, even when nothing was reported.`);
		}
		const canonical = normalizeVideoSourceCharacteristics(value.characteristics, { rate: sourceRate(value) });
		if (canonicalJson(value.characteristics) !== canonicalJson(canonical)) {
			throw new RangeError(`${prefix}.characteristics is not in its canonical reported form.`);
		}
		validateReportedCodecs(value, canonical, prefix);
	}
}

/** True when any video source carries something a probe actually reported. */
export function projectHasReportedSourceCharacteristics(project: Readonly<DataRecord>): boolean {
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	return sources.some((value) => isRecord(value) && value.kind === 'video'
		&& videoSourceCharacteristicsAreReported(value.characteristics));
}

function validateReportedCodecs(
	source: DataRecord,
	characteristics: VideoSourceCharacteristics,
	prefix: string,
): void {
	if (characteristics.videoCodec !== null && source.videoCodec !== characteristics.videoCodec) {
		throw new RangeError(`${prefix}.videoCodec disagrees with its reported source codec.`);
	}
	const extracted = characteristics.extractedAudioStreamIndex;
	if (extracted === null) return;
	const stream = characteristics.audioStreams?.find((candidate) => candidate.index === extracted);
	if (stream?.codec != null && source.audioCodec !== stream.codec) {
		throw new RangeError(`${prefix}.audioCodec disagrees with the audio stream it was extracted from.`);
	}
}

function sourceRate(source: DataRecord): SequenceRationalRate | undefined {
	const rate = source.frameRate;
	if (!isRecord(rate)) return undefined;
	const num = Number(rate.num);
	const den = Number(rate.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return undefined;
	return Object.freeze({ num, den });
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const entries = Object.entries(value as DataRecord).sort(([left], [right]) => (left < right ? -1 : 1));
	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
