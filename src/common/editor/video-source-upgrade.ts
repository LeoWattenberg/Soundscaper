/* SPDX-License-Identifier: AGPL-3.0-only */

import { roundRational, type RationalRate } from './timeline-time.ts';
import {
	normalizeVideoSourceCharacteristics,
	type VideoSourceCharacteristics,
} from './video-source-characteristics.ts';
import { normalizeVideoTimingAssetReference } from './video-timing-asset-reference.ts';
import type { ResolvedVideoTimingProbe } from './video-timing-probe.ts';

/**
 * What re-reading an already-imported video source changes, and what that costs
 * the edits cut against its old frame grid.
 *
 * A source records three kinds of derived fact — its timing, the characteristics
 * a probe reported, and the size the local decoder presented — and every one of
 * them can be stale: an ingest whose probe was unavailable fabricated a rate, an
 * older probe read autorotated frames and stored a presented size as the coded
 * size, and another engine's presented size is not this engine's.
 *
 * None of that can be inferred, only re-read. This module owns what re-reading
 * is allowed to conclude: it never trades a reading for a fabrication, it never
 * merges two readings of one frame, it keeps the ingest decision as provenance,
 * and it conforms a clip's source range as a change of basis on the source's
 * nominal grid while leaving the clip exactly where it sits in its sequence.
 */

export type VideoSourceUpgradeRefusal =
	/** Nothing exact was read, and the source has no exact timing to keep. */
	| 'probe-unavailable'
	/** The source carries exact timing this probe could not reproduce. */
	| 'timing-regressed'
	/** An exact probe arrived without the asset its frame timing lives in. */
	| 'timing-asset-missing'
	/** The published asset describes different content or a different length. */
	| 'timing-asset-mismatch';

/** A refusal is a stated outcome of the upgrade contract, not a failure to try. */
export class VideoSourceUpgradeRefusedError extends Error {
	readonly reason: VideoSourceUpgradeRefusal;

	constructor(reason: VideoSourceUpgradeRefusal, message: string) {
		super(message);
		this.name = 'VideoSourceUpgradeRefusedError';
		this.reason = reason;
	}
}

export interface VideoSourceUpgradeClipRange {
	readonly clipId: string;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	/** True when the conformed range had to be cut to fit the corrected media. */
	readonly clamped: boolean;
}

export interface VideoSourceUpgradePlan {
	readonly sourceId: string;
	readonly changes: Readonly<Record<string, unknown>>;
	readonly changedFields: readonly string[];
	readonly clips: readonly VideoSourceUpgradeClipRange[];
	readonly clampedClipIds: readonly string[];
	/** False when the re-read agreed with the document in every respect. */
	readonly upgraded: boolean;
}

export interface VideoSourcePresentedSize {
	readonly width: number;
	readonly height: number;
}

export interface VideoSourceUpgradeInput {
	readonly source: unknown;
	readonly probe: ResolvedVideoTimingProbe;
	/** The reference published for this probe's timing, bound to the same bytes. */
	readonly timingAsset?: unknown;
	/** What this engine's decoder presented; omitted when it could not decode. */
	readonly presented?: VideoSourcePresentedSize | null;
	/** Every timeline and Project Bin clip in the document. */
	readonly clips?: readonly unknown[];
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Derive the source changes and conformed clip ranges one re-probe justifies. */
export function planVideoSourceUpgrade(input: VideoSourceUpgradeInput): VideoSourceUpgradePlan {
	const source = record(input?.source, 'source');
	if (source.kind !== 'video') throw new TypeError('Only a video source can be re-probed.');
	const sourceId = nonEmptyString(source.id, 'source.id');
	const probe = input.probe;
	if (!probe || probe.decision !== 'timing-asset') {
		// Contract 2: an upgrade never trades a reading for a fabrication. A
		// fallback would replace an exact rate with a nominal one, and where
		// there is no exact rate to lose there is nothing to upgrade either.
		throw new VideoSourceUpgradeRefusedError(
			source.timingAsset == null ? 'probe-unavailable' : 'timing-regressed',
			source.timingAsset == null
				? 'The source could not be probed for exact timing.'
				: 'The re-probe could not reproduce the exact timing this source already carries.',
		);
	}
	const oldRate = rationalRate(source.frameRate, 'source.frameRate');
	const newRate = rationalRate(probe.nominalRate, 'probe.nominalRate');
	const newFrameCount = positiveSafeInteger(probe.timing.frameCount, 'probe.timing.frameCount');
	const timingAsset = upgradeTimingAsset(input.timingAsset, newFrameCount, source);
	const characteristics = upgradeCharacteristics(probe.characteristics, source, newRate);
	const changes = upgradeChanges(source, {
		characteristics,
		frameRate: newRate,
		presented: input.presented ?? null,
		probeBackend: nonEmptyString(probe.backend, 'probe.backend'),
		sourceFrameCount: newFrameCount,
		timingAsset,
	});
	const changedFields = Object.keys(changes).filter((field) => !sameValue(changes[field], source[field]));
	const clips = conformClips(input.clips ?? [], sourceId, oldRate, newRate, newFrameCount);
	return Object.freeze({
		sourceId,
		changes: Object.freeze(Object.fromEntries(changedFields.map((field) => [field, changes[field]]))),
		changedFields: Object.freeze(changedFields),
		clips: Object.freeze(clips),
		clampedClipIds: Object.freeze(clips.filter((clip) => clip.clamped).map((clip) => clip.clipId)),
		upgraded: changedFields.length > 0 || clips.length > 0,
	});
}

/**
 * Conform one source range onto a new nominal grid. Persisted source frames are
 * indices on the source's nominal grid, so the conform is exact integer
 * arithmetic under a named policy — not a detour through a timing index a
 * document can be missing.
 */
export function conformVideoSourceRange(
	sourceInFrame: number,
	sourceFrameCount: number,
	oldRate: RationalRate,
	newRate: RationalRate,
	newSourceFrameCount: number,
): Readonly<{ sourceInFrame: number; sourceFrameCount: number; clamped: boolean }> {
	const inFrame = nonNegativeSafeInteger(sourceInFrame, 'clip.sourceInFrame');
	const count = positiveSafeInteger(sourceFrameCount, 'clip.sourceFrameCount');
	const bound = positiveSafeInteger(newSourceFrameCount, 'source.sourceFrameCount');
	const scale = (frame: number): number => roundRational(
		BigInt(frame) * BigInt(newRate.num) * BigInt(oldRate.den),
		BigInt(newRate.den) * BigInt(oldRate.num),
		'point',
	);
	const scaledIn = scale(inFrame);
	const scaledOut = scale(inFrame + count);
	// A clip keeps at least one frame of media: an upgrade corrects what a clip
	// shows, it never deletes the clip.
	const boundedIn = Math.max(0, Math.min(scaledIn, bound - 1));
	const boundedOut = Math.max(boundedIn + 1, Math.min(scaledOut, bound));
	return Object.freeze({
		sourceInFrame: boundedIn,
		sourceFrameCount: boundedOut - boundedIn,
		clamped: boundedIn !== scaledIn || boundedOut !== scaledOut,
	});
}

function conformClips(
	clips: readonly unknown[],
	sourceId: string,
	oldRate: RationalRate,
	newRate: RationalRate,
	newFrameCount: number,
): VideoSourceUpgradeClipRange[] {
	const conformed: VideoSourceUpgradeClipRange[] = [];
	const seen = new Set<string>();
	for (const value of clips) {
		if (!isRecord(value) || value.kind !== 'video' || value.sourceId !== sourceId) continue;
		const clipId = nonEmptyString(value.id, 'clip.id');
		if (seen.has(clipId)) continue;
		seen.add(clipId);
		const range = conformVideoSourceRange(
			nonNegativeSafeInteger(value.sourceInFrame, 'clip.sourceInFrame'),
			positiveSafeInteger(value.sourceFrameCount, 'clip.sourceFrameCount'),
			oldRate,
			newRate,
			newFrameCount,
		);
		if (range.sourceInFrame === value.sourceInFrame && range.sourceFrameCount === value.sourceFrameCount) {
			continue;
		}
		conformed.push(Object.freeze({ clipId, ...range }));
	}
	return conformed;
}

interface UpgradeReading {
	readonly characteristics: VideoSourceCharacteristics;
	readonly frameRate: RationalRate;
	readonly presented: VideoSourcePresentedSize | null;
	readonly probeBackend: string;
	readonly sourceFrameCount: number;
	readonly timingAsset: DataRecord;
}

function upgradeChanges(source: DataRecord, reading: UpgradeReading): Record<string, unknown> {
	const changes: Record<string, unknown> = {
		frameRate: reading.frameRate,
		sourceFrameCount: reading.sourceFrameCount,
		timingAsset: reading.timingAsset,
		timingDecision: upgradeTimingDecision(source, reading),
		characteristics: reading.characteristics,
	};
	// The legacy codec fields duplicate reported characteristics, and V14 rejects
	// the disagreement rather than repairing it.
	if (reading.characteristics.videoCodec !== null) changes.videoCodec = reading.characteristics.videoCodec;
	const extracted = reading.characteristics.audioStreams?.find(
		(stream) => stream.index === reading.characteristics.extractedAudioStreamIndex,
	);
	if (source.hasAudio === true && extracted?.codec != null) changes.audioCodec = extracted.codec;
	if (reading.presented) {
		changes.width = positiveSafeInteger(reading.presented.width, 'presented.width');
		changes.height = positiveSafeInteger(reading.presented.height, 'presented.height');
	}
	return changes;
}

/**
 * Provenance is history, not a probe result: media conformed at ingest stays
 * described as conformed however exactly it re-probes. Only the never-probed
 * fallback — the one that carries failures instead of a backend — becomes exact.
 */
function upgradeTimingDecision(source: DataRecord, reading: UpgradeReading): DataRecord {
	const decision = isRecord(source.timingDecision) ? source.timingDecision : {};
	const conformedAtIngest = decision.mode === 'conform-cfr-at-ingest'
		&& typeof decision.backend === 'string' && decision.backend.length > 0;
	return Object.freeze({
		mode: conformedAtIngest ? 'conform-cfr-at-ingest' : 'exact',
		rate: reading.frameRate,
		backend: reading.probeBackend,
	});
}

/**
 * The probe owns every characteristic except which audio program ingest
 * extracted, which is carried by the rule ingest applied: named only when the
 * inventory reports exactly one stream to have extracted.
 */
function upgradeCharacteristics(
	probed: VideoSourceCharacteristics,
	source: DataRecord,
	rate: RationalRate,
): VideoSourceCharacteristics {
	const streams = probed.audioStreams;
	const extractedAudioStreamIndex = source.hasAudio === true && streams?.length === 1
		? streams[0].index
		: null;
	return normalizeVideoSourceCharacteristics({ ...probed, extractedAudioStreamIndex }, { rate });
}

function upgradeTimingAsset(value: unknown, frameCount: number, source: DataRecord): DataRecord {
	if (value == null) {
		throw new VideoSourceUpgradeRefusedError(
			'timing-asset-missing',
			'Exact video timing requires a published timing asset.',
		);
	}
	const reference = normalizeVideoTimingAssetReference(value) as unknown as DataRecord;
	// The validator binds an asset to the frame count it indexes and to the bytes
	// it was read from; an upgrade that re-reads other bytes is a relink.
	if (reference.frameCount !== frameCount || reference.sourceSha256 !== source.contentSha256) {
		throw new VideoSourceUpgradeRefusedError(
			'timing-asset-mismatch',
			'The published timing asset does not describe this source content.',
		);
	}
	return Object.freeze({ ...reference });
}

function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
	return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const entries = Object.entries(value as DataRecord).sort(([left], [right]) => (left < right ? -1 : 1));
	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

function rationalRate(value: unknown, name: string): RationalRate {
	const rate = record(value, name);
	return Object.freeze({
		num: positiveSafeInteger(rate.num, `${name}.num`),
		den: positiveSafeInteger(rate.den, `${name}.den`),
	});
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
