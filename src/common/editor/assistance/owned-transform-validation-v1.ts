/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared closed-data validation for pure owned workflow transforms. */

import {
	ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION,
	createAssistanceTranscript,
	MAX_TRANSCRIPT_SEGMENTS,
	MAX_TRANSCRIPT_WORDS_PER_SEGMENT,
	type AssistanceTranscript,
} from './transcript.ts';

export const ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS = 100_000;
export const ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_PROPOSALS = 10_000;
export const ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_TEXT_UNITS = 32 * 1024 * 1024;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export function ownedExactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(row, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The ${label}.${field} must be inert own data.`);
		}
	}
	return row as Record<Field, unknown>;
}

export function ownedArray(
	value: unknown,
	maximum: number,
	label: string,
	minimum = 0,
): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new RangeError(`The ${label} exceeds its exact bound.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The ${label} must be a dense inert array.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

export function ownedInteger(
	value: unknown,
	minimum: number,
	maximum: number,
	label: string,
): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0)
		|| Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is outside its safe integer bound.`);
	}
	return Number(value);
}

export function ownedUnit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
		|| value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and within the unit interval.`);
	}
	return value;
}

export function ownedBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`The ${label} must be boolean.`);
	return value;
}

export function ownedText(
	value: unknown,
	maximum: number,
	label: string,
	empty = false,
): string {
	if (typeof value !== 'string' || value.length > maximum
		|| (!empty && value.trim() === '') || CONTROL.test(value)) {
		throw new TypeError(`The ${label} is invalid bounded text.`);
	}
	return value;
}

export function ownedNullableText(
	value: unknown,
	maximum: number,
	label: string,
): string | null {
	return value === null ? null : ownedText(value, maximum, label);
}

/** Re-admit a complete canonical transcript body without accepting loose draft fields. */
export function reviewOwnedAssistanceTranscriptV1(value: unknown): AssistanceTranscript {
	const row = ownedExactRecord(value, [
		'schemaVersion', 'sourceId', 'sampleRate', 'language', 'modelId', 'segments',
	], 'owned transform transcript');
	if (row.schemaVersion !== ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION) {
		throw new TypeError('The owned transform transcript schema version is unsupported.');
	}
	const budget = { units: 0 };
	const sourceId = budgetedText(row.sourceId, 256, 'transcript source ID', budget);
	const sampleRate = ownedInteger(row.sampleRate, 1, 768_000, 'transcript sample rate');
	const language = row.language === null ? null
		: budgetedText(row.language, 64, 'transcript language', budget);
	const modelId = budgetedText(row.modelId, 160, 'transcript model ID', budget);
	const candidates = ownedArray(row.segments, MAX_TRANSCRIPT_SEGMENTS, 'transcript segments');
	const segments = candidates.map((candidate, segmentIndex) => {
		const label = `transcript segment ${String(segmentIndex)}`;
		const segment = ownedExactRecord(candidate, [
			'startFrame', 'endFrame', 'text', 'words', 'speaker',
		], label);
		const startFrame = ownedInteger(segment.startFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} start frame`);
		const endFrame = ownedInteger(segment.endFrame, 1, Number.MAX_SAFE_INTEGER,
			`${label} end frame`);
		const words = ownedArray(segment.words, MAX_TRANSCRIPT_WORDS_PER_SEGMENT,
			`${label} words`).map((candidateWord, wordIndex) => {
				const wordLabel = `${label} word ${String(wordIndex)}`;
				const word = ownedExactRecord(candidateWord, [
					'text', 'startFrame', 'endFrame', 'confidence',
				], wordLabel);
				return Object.freeze({
					text: budgetedText(word.text, 512, `${wordLabel} text`, budget),
					startFrame: ownedInteger(word.startFrame, 0, Number.MAX_SAFE_INTEGER,
						`${wordLabel} start frame`),
					endFrame: ownedInteger(word.endFrame, 0, Number.MAX_SAFE_INTEGER,
						`${wordLabel} end frame`),
					confidence: word.confidence === null ? null
						: ownedUnit(word.confidence, `${wordLabel} confidence`),
				});
			});
		return Object.freeze({
			startFrame,
			endFrame,
			text: budgetedText(segment.text, 16_384, `${label} text`, budget),
			words: Object.freeze(words),
			speaker: segment.speaker === null ? null
				: budgetedText(segment.speaker, 160, `${label} speaker`, budget),
		});
	});
	return createAssistanceTranscript({
		sourceId, sampleRate, language, modelId, segments: Object.freeze(segments),
	});
}

export function ownedSafeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) {
		throw new RangeError(`The ${label} exceeds safe timing.`);
	}
	return result;
}

function budgetedText(
	value: unknown,
	maximum: number,
	label: string,
	budget: { units: number },
): string {
	const text = ownedText(value, maximum, label);
	budget.units += text.length;
	if (budget.units > ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_TEXT_UNITS) {
		throw new RangeError('The owned transform transcript exceeds its bounded text budget.');
	}
	return text;
}
