/* SPDX-License-Identifier: AGPL-3.0-only */

import { addAup4CompatibilityItem } from './aup4-profile.js';
import { isActiveAudioEditorProjectSchema } from './project-schema-version.ts';

type DataRecord = Record<string, unknown>;

interface TempoEvent extends DataRecord {
	readonly id?: unknown;
	readonly beat?: unknown;
	readonly bpm?: unknown;
}

interface SignatureEvent extends DataRecord {
	readonly id?: unknown;
	readonly bar?: unknown;
	readonly numerator?: unknown;
	readonly denominator?: unknown;
}

const AUP4_MAXIMUM_SIGNATURE_DENOMINATOR = 0x4000_0000;

/** Identify documents that require the current runtime projection at the AUP4 boundary. */
export function isCurrentAup4MusicalSnapshot(project: DataRecord): boolean {
	return isActiveAudioEditorProjectSchema(project.schemaVersion);
}

/** Flatten AUP4's singleton tempo/signature while loss-accounting later map events. */
export function flattenAup4MusicalMaps(
	project: DataRecord,
	normalizedProject: DataRecord,
	report: DataRecord,
): void {
	const tempoMap = recordOrNull(project.tempoMap);
	const signatureMap = recordOrNull(project.signatureMap);
	const tempoEvents = recordArray<TempoEvent>(tempoMap?.events);
	const signatureEvents = recordArray<SignatureEvent>(signatureMap?.events);
	const firstTempo = tempoEvents[0];
	const firstSignature = signatureEvents[0];
	const sourceTempoBpm = firstTempo?.bpm ? rationalNumber(firstTempo.bpm, 'tempoMap.events[0].bpm') : 120;
	const retainedTempoBpm = sourceTempoBpm >= 1 && sourceTempoBpm <= 1_000 ? sourceTempoBpm : 120;
	const retainedTempoEventBpm = retainedTempoBpm === sourceTempoBpm ? firstTempo?.bpm : { num: 120, den: 1 };
	const sourceSignatureDenominator = firstSignature
		? positiveSafeInteger(firstSignature.denominator, 'signatureMap.events[0].denominator')
		: 4;
	const retainedSignatureDenominator = sourceSignatureDenominator <= AUP4_MAXIMUM_SIGNATURE_DENOMINATOR
		? sourceSignatureDenominator
		: 4;
	if (firstTempo?.bpm && firstSignature) {
		normalizedProject.tempo = {
			...(recordOrNull(normalizedProject.tempo) ?? {}),
			bpm: retainedTempoBpm,
			timeSignature: {
				numerator: positiveSafeInteger(firstSignature.numerator, 'signatureMap.events[0].numerator'),
				denominator: retainedSignatureDenominator,
			},
		};
		delete normalizedProject.timeSignature;
	}
	if (retainedTempoBpm !== sourceTempoBpm) addAup4CompatibilityItem(report, {
		code: 'TEMPO_ROOT_BPM_CONVERTED',
		severity: 'warning',
		disposition: 'converted',
		message: 'AUP4 cannot encode the project tempo; the retained global tempo uses 120 BPM.',
		scope: { kind: 'project' },
		data: { sourceBpm: firstTempo?.bpm, retainedBpm: retainedTempoBpm },
	});
	if (sourceSignatureDenominator !== retainedSignatureDenominator) addAup4CompatibilityItem(report, {
		code: 'SIGNATURE_ROOT_DENOMINATOR_CONVERTED',
		severity: 'warning',
		disposition: 'converted',
		message: 'AUP4 cannot encode the project signature denominator; the retained global signature uses 4.',
		scope: { kind: 'project' },
		data: {
			sourceDenominator: sourceSignatureDenominator,
			retainedDenominator: retainedSignatureDenominator,
		},
	});
	if (tempoEvents.length > 1) addAup4CompatibilityItem(report, {
		code: 'TEMPO_MAP_FLATTENED',
		severity: 'warning',
		disposition: 'converted',
		message: 'AUP4 retained the first tempo event as its global tempo. Musical clip and label positions were projected before later events were flattened.',
		scope: { kind: 'project' },
		data: {
			eventCount: tempoEvents.length,
			retainedEvent: {
				id: String(firstTempo?.id ?? ''),
				beat: firstTempo?.beat,
				bpm: retainedTempoEventBpm,
			},
			mode: String(tempoMap?.mode ?? ''),
		},
	});
	if (signatureEvents.length > 1) addAup4CompatibilityItem(report, {
		code: 'SIGNATURE_MAP_FLATTENED',
		severity: 'warning',
		disposition: 'converted',
		message: 'AUP4 retained the first signature event as its global signature. Later bar-indexed events were flattened.',
		scope: { kind: 'project' },
		data: {
			eventCount: signatureEvents.length,
			retainedEvent: {
				id: String(firstSignature?.id ?? ''),
				bar: firstSignature?.bar,
				numerator: firstSignature?.numerator,
				denominator: retainedSignatureDenominator,
			},
		},
	});
}

function rationalNumber(value: unknown, name: string): number {
	const rational = recordOrNull(value);
	if (!rational) throw new TypeError(`${name} is invalid.`);
	const numerator = Number(rational.num);
	const denominator = Number(rational.den);
	if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
		throw new RangeError(`${name} is invalid.`);
	}
	const result = numerator / denominator;
	if (!Number.isFinite(result) || result <= 0) throw new RangeError(`${name} is invalid.`);
	return result;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} is invalid.`);
	return number;
}

function recordArray<Value extends DataRecord>(value: unknown): readonly Value[] {
	return Array.isArray(value)
		? value.filter((candidate): candidate is Value => Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate))
		: [];
}

function recordOrNull(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}
