/* SPDX-License-Identifier: AGPL-3.0-only */

/** Declarative sidecar identities carried by a canonical plan; never SCTI bytes. */

import {
	normalizeVideoTimingAssetReference,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

export interface NativeMediaPlanVideoTimingAssetInput {
	readonly inputIndex: number;
	readonly sourceId: string;
	readonly encoding: VideoTimingAssetReference['encoding'];
	readonly storageKey: string;
	readonly sha256: string;
	readonly sourceSha256: string;
	readonly byteLength: number;
	readonly frameCount: number;
	readonly timescale: number;
	readonly finalFrameDurationTicks: string;
}

const REFERENCE_KEYS = Object.freeze([
	'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength', 'frameCount',
	'timescale', 'finalFrameDurationTicks',
]);
const TIMING_KEYS = Object.freeze(['kind', 'reference']);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_SOURCES = 4_096;

export function nativeMediaPlanVideoTimingAssetInputs(
	value: unknown,
): readonly NativeMediaPlanVideoTimingAssetInput[] {
	const plan = record(value, 'native media plan');
	if (plan.version === 7 || plan.version === 8) return Object.freeze([]);
	if (![9, 10, 11, 12].includes(Number(plan.version))) {
		throw new RangeError('Only unified native media plans V9 through V12 may declare timing assets.');
	}
	if (!Array.isArray(plan.sources) || plan.sources.length > MAXIMUM_SOURCES) {
		throw new TypeError('A unified native media plan requires its bounded source array.');
	}
	const sourceIds = new Set<string>();
	const timingDigests = new Set<string>();
	const result: NativeMediaPlanVideoTimingAssetInput[] = [];
	for (const [inputIndex, candidate] of plan.sources.entries()) {
		const source = record(candidate, `unified source ${String(inputIndex)}`);
		if (source.inputIndex !== inputIndex || typeof source.sourceId !== 'string'
			|| source.sourceId.length === 0 || sourceIds.has(source.sourceId)
			|| typeof source.contentSha256 !== 'string' || !SHA256.test(source.contentSha256)) {
			throw new TypeError('A unified timing source has invalid input, source, or content identity.');
		}
		sourceIds.add(source.sourceId);
		const timing = record(source.timing, `unified source ${source.sourceId} timing`);
		if (timing.kind === 'cfr') continue;
		exactKeys(timing, TIMING_KEYS, 'unified VFR timing');
		if (timing.kind !== 'vfr') throw new RangeError('A unified source timing kind is unsupported.');
		const referenceRecord = record(timing.reference, 'unified VFR timing reference');
		exactKeys(referenceRecord, REFERENCE_KEYS, 'unified VFR timing reference');
		const reference = normalizeVideoTimingAssetReference(referenceRecord);
		if (reference.sourceSha256 !== source.contentSha256) {
			throw new Error('A unified VFR timing reference does not bind its source content digest.');
		}
		if (timingDigests.has(reference.sha256)) {
			throw new Error('A unified native media plan contains a duplicate timing asset reference.');
		}
		timingDigests.add(reference.sha256);
		result.push(Object.freeze({ inputIndex, sourceId: source.sourceId, ...reference }));
	}
	return Object.freeze(result);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`A ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(value);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`A ${label} must carry exactly its schema keys.`);
	}
}
