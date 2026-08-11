/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION,
} from '../project-schema-version.ts';
import { AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION } from '../project-v10-validation.ts';
import { videoFrameToSampleFrame, type RationalRate } from '../timeline-time.ts';
import { CONFORMED_SEQUENCE_PLACEMENT } from './command-projection-transients.ts';
import type { CanonicalVideoPlacementCommandValue } from './protocol.ts';

type DataRecord = Record<string | symbol, unknown>;

export interface AppliedCanonicalVideoTransformPlacement {
	readonly sequencePlacement: CanonicalVideoPlacementCommandValue;
	readonly updated: DataRecord & { readonly [CONFORMED_SEQUENCE_PLACEMENT]: true };
}

/** Validate serializable frame authority and apply its command-only reconciliation marker. */
export function applyCanonicalVideoTransformPlacement(
	projectValue: unknown,
	clipValue: unknown,
	trackValue: unknown,
	updatedValue: unknown,
	placementValue: unknown,
): AppliedCanonicalVideoTransformPlacement {
	const project = record(projectValue, 'project');
	const clip = record(clipValue, 'clip');
	const track = record(trackValue, 'track');
	const updated = record(updatedValue, 'updated clip');
	if (!isFoundationSchema(project.schemaVersion) || clip.kind !== 'video') {
		throw new RangeError('Canonical sequence placement requires a foundation video clip.');
	}
	const sequencePlacement = canonicalPlacement(placementValue);
	const trackId = nonEmptyString(track.id, 'target track ID');
	const sequence = uniqueTargetSequence(project, trackId);
	const rate = rationalRate(sequence.rate, 'target sequence rate');
	const sequenceStartFrame = sequencePlacement.sequenceStartFrame;
	const sequenceEndFrame = safeAdd(
		sequenceStartFrame,
		sequencePlacement.sequenceFrameCount,
		'canonical sequence placement',
	);
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const timelineStartFrame = videoFrameToSampleFrame(
		sequenceStartFrame,
		rate,
		sampleRate,
		'point',
	);
	const timelineEndFrame = videoFrameToSampleFrame(
		sequenceEndFrame,
		rate,
		sampleRate,
		'point',
	);
	if (updated.timelineStartFrame !== timelineStartFrame
		|| updated.durationFrames !== timelineEndFrame - timelineStartFrame) {
		throw new RangeError(
			`Canonical sequence placement for clip ${String(clip.id)} disagrees with its resolved aliases.`,
		);
	}
	return {
		sequencePlacement,
		updated: {
			...updated,
			...sequencePlacement,
			[CONFORMED_SEQUENCE_PLACEMENT]: true,
		},
	};
}

function canonicalPlacement(value: unknown): CanonicalVideoPlacementCommandValue {
	const placement = record(value, 'canonical sequence placement');
	const prototype = Object.getPrototypeOf(placement) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Canonical sequence placement must be a plain object.');
	}
	const keys = Reflect.ownKeys(placement);
	if (keys.length !== 2 || !keys.includes('sequenceStartFrame') || !keys.includes('sequenceFrameCount')) {
		throw new TypeError(
			'Canonical sequence placement must contain only sequenceStartFrame and sequenceFrameCount.',
		);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(placement, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Canonical sequence placement fields must be enumerable data properties.');
		}
	}
	const sequenceStartFrame = nonNegativeSafeInteger(
		placement.sequenceStartFrame,
		'canonical sequenceStartFrame',
	);
	const sequenceFrameCount = positiveSafeInteger(
		placement.sequenceFrameCount,
		'canonical sequenceFrameCount',
	);
	safeAdd(sequenceStartFrame, sequenceFrameCount, 'canonical sequence placement');
	return { sequenceStartFrame, sequenceFrameCount };
}

function uniqueTargetSequence(project: DataRecord, trackId: string): DataRecord {
	if (!Array.isArray(project.sequences)) throw new TypeError('project.sequences must be an array.');
	const matches = project.sequences
		.map((value, index) => record(value, `project.sequences[${String(index)}]`))
		.filter((sequence) => Array.isArray(sequence.trackIds) && sequence.trackIds.includes(trackId));
	if (matches.length === 0) throw new ReferenceError(`Track ${trackId} does not belong to a sequence.`);
	if (matches.length > 1) throw new RangeError(`Track ${trackId} belongs to multiple sequences.`);
	return matches[0]!;
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function rationalRate(value: unknown, name: string): RationalRate {
	const rate = record(value, name);
	return {
		num: positiveSafeInteger(rate.num, `${name}.num`),
		den: positiveSafeInteger(rate.den, `${name}.den`),
	};
}

function isFoundationSchema(value: unknown): boolean {
	return value === AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return value;
}
