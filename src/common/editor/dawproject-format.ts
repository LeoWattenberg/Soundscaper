/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Rational } from './timeline-time.ts';

/**
 * Constants and unit conversions the DAWproject reader and writer share.
 *
 * DAWproject 1.0 is Bitwig's open exchange format: a ZIP holding `project.xml`,
 * `metadata.xml`, and whatever media the exporting application embedded. The
 * schema is generated from the reference Java model, so the vocabulary below
 * (time units, mixer roles, parameter units, content types) is pinned to that
 * model rather than invented here.
 */

export const DAWPROJECT_VERSION = '1.0';
export const DAWPROJECT_FILE_EXTENSION = '.dawproject';
export const DAWPROJECT_PROJECT_ENTRY = 'project.xml';
export const DAWPROJECT_METADATA_ENTRY = 'metadata.xml';
/** No media type is registered for the container; it is a ZIP and is served as one. */
export const DAWPROJECT_MIME_TYPE = 'application/zip';
export const DAWPROJECT_DELIVERY_FORMAT = 'dawproject';

export type DawprojectTimeUnit = 'beats' | 'seconds';
export type DawprojectInterpolation = 'hold' | 'linear';
export type DawprojectMixerRole = 'regular' | 'master' | 'effect' | 'submix' | 'vca';
export type DawprojectParameterUnit =
	| 'linear' | 'normalized' | 'percent' | 'decibel' | 'hertz' | 'semitones' | 'seconds' | 'beats' | 'bpm';

const DAWPROJECT_FILE_PATTERN = /\.dawproject$/iu;
const RATIONAL_MAXIMUM_DENOMINATOR = 1_000_000;

export function isDawprojectFileName(value: unknown): boolean {
	return typeof value === 'string' && DAWPROJECT_FILE_PATTERN.test(terminalSegment(value));
}

/** Stable sequential `xs:ID` values, one per distinct key, in first-seen order. */
export class DawprojectIdAllocator {
	readonly #ids = new Map<string, string>();

	id(key: string): string {
		let id = this.#ids.get(key);
		if (id === undefined) {
			id = `id${String(this.#ids.size)}`;
			this.#ids.set(key, id);
		}
		return id;
	}

	has(key: string): boolean {
		return this.#ids.has(key);
	}
}

/** Soundscaper pan is -1..1 around centre; DAWproject's normalized pan is 0..1 around 0.5. */
export function panToNormalized(pan: number): number {
	return clamp((clamp(pan, -1, 1) + 1) / 2, 0, 1);
}

export function normalizedToPan(value: number): number {
	return clamp(value * 2 - 1, -1, 1);
}

/** Read a DAWproject parameter value in its declared unit as a linear gain. */
export function parameterToLinearGain(value: number, unit: string | null): number | null {
	if (unit === 'decibel' && value === Number.NEGATIVE_INFINITY) return 0;
	if (!Number.isFinite(value)) return null;
	switch (unit) {
		case 'linear':
		case null:
			return Math.max(0, value);
		case 'decibel':
			return 10 ** (value / 20);
		case 'normalized':
			// A normalized fader has no declared taper; unity is the only value
			// two applications agree on, so 1.0 maps to unity and the rest scales.
			return Math.max(0, value);
		case 'percent':
			return Math.max(0, value / 100);
		default:
			return null;
	}
}

/** Read a DAWproject pan value in its declared unit as -1..1. */
export function parameterToPan(value: number, unit: string | null): number | null {
	if (!Number.isFinite(value)) return null;
	switch (unit) {
		case 'normalized':
		case null:
			return normalizedToPan(value);
		case 'percent':
			return clamp(value / 100, -1, 1);
		case 'linear':
			return clamp(value, -1, 1);
		default:
			return null;
	}
}

/**
 * The closest bounded rational to a double, by continued fractions.
 *
 * Tempo events and beat positions are exact rationals in the project, but a
 * DAWproject file states them as doubles. Bounding the denominator keeps the
 * project's own rational limits and turns `149.0` into `149/1` rather than a
 * 2^52 monster that only looks exact.
 */
export function rationalFromDouble(value: number, maximumDenominator = RATIONAL_MAXIMUM_DENOMINATOR): Rational {
	if (!Number.isFinite(value)) throw new RangeError('A rational requires a finite number.');
	const negative = value < 0;
	const target = Math.abs(value);
	let [previousNum, num] = [1, Math.floor(target)];
	let [previousDen, den] = [0, 1];
	let remainder = target - Math.floor(target);
	while (remainder > 1e-12 && den <= maximumDenominator) {
		const inverse = 1 / remainder;
		const term = Math.floor(inverse);
		const nextNum = term * num + previousNum;
		const nextDen = term * den + previousDen;
		if (nextDen > maximumDenominator) break;
		[previousNum, num] = [num, nextNum];
		[previousDen, den] = [den, nextDen];
		remainder = inverse - term;
		if (Math.abs(num / den - target) <= Number.EPSILON * Math.max(1, target)) break;
	}
	return Object.freeze({ num: negative ? -num : num, den });
}

export function rationalToNumber(value: Readonly<{ num: number; den: number }> | number): number {
	return typeof value === 'number' ? value : value.num / value.den;
}

/**
 * A ZIP entry name for embedded media: one directory per kind, the original
 * file name reduced to a portable character set, and a counter so two sources
 * called `take.wav` never overwrite each other.
 */
export function mediaEntryName(kind: 'audio' | 'video', index: number, name: string, extension: string): string {
	const base = String(name ?? '')
		.replace(/\.[^.]+$/u, '')
		.replaceAll(/[^\w.-]+/gu, '-')
		.replaceAll(/-{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 48) || kind;
	return `${kind}/${String(index + 1).padStart(3, '0')}-${base}${extension}`;
}

/** Normalize a `File path` the way readers must: forward slashes, no leading `./`. */
export function normalizeEntryPath(path: string): string {
	return String(path ?? '')
		.replaceAll('\\', '/')
		.replace(/^(?:\.\/)+/u, '')
		.replace(/^\/+/u, '');
}

export function entryBaseName(path: string): string {
	return terminalSegment(normalizeEntryPath(path));
}

export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function isHexColor(value: unknown): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}

function terminalSegment(value: string): string {
	const boundary = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
	return boundary === -1 ? value : value.slice(boundary + 1);
}
