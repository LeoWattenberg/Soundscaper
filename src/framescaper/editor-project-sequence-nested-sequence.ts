/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection } from '../common/editor/runtime-clip-projection.ts';
import { validateFramescaperProjectSequence, type FramescaperProjectSequence } from './editor-project-sequence-validation.ts';
import {
	FRAMESCAPER_SEQUENCE_MAXIMUM_NESTING_DEPTH,
	assertFramescaperFlatteningBudgetSequence,
	type FramescaperSubsequenceSequence,
} from './editor-project-sequence-subsequence.ts';

export {
	FRAMESCAPER_SEQUENCE_MAXIMUM_FLATTENED_OCCURRENCES,
	FRAMESCAPER_SEQUENCE_MAXIMUM_NESTING_DEPTH,
} from './editor-project-sequence-subsequence.ts';

export interface FramescaperExactSequenceFrameSequence {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export interface FramescaperNestedSequenceFrameRequestSequence {
	readonly rootSequenceId: string;
	readonly subsequenceIds: readonly string[];
	readonly sourceFrame: number;
}

export interface FramescaperFlattenedSequenceClipSequence {
	readonly clipId: string;
	readonly trackId: string;
	readonly sourceId: string;
	readonly kind: 'audio' | 'video';
	readonly leafSequenceId: string;
	readonly sequencePath: readonly string[];
	readonly subsequencePath: readonly string[];
	readonly leafStartFrame: FramescaperExactSequenceFrameSequence;
	readonly leafEndFrame: FramescaperExactSequenceFrameSequence;
	readonly startFrame: FramescaperExactSequenceFrameSequence;
	readonly endFrame: FramescaperExactSequenceFrameSequence;
}

interface Fraction {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

interface AffineTransform {
	readonly scale: Fraction;
	readonly offset: Fraction;
}

interface SequenceBinding {
	readonly id: string;
	readonly rate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly trackIds: readonly string[];
}

interface ClipBinding {
	readonly clip: Readonly<Record<string, unknown>>;
	readonly trackId: string;
}

/** Map an exact terminal-sequence frame through a continuous nested path into its root grid. */
export function mapFramescaperNestedSequenceFrameSequence(
	profile: unknown,
	projectValue: FramescaperProjectSequence | unknown,
	requestValue: FramescaperNestedSequenceFrameRequestSequence | unknown,
): Readonly<FramescaperExactSequenceFrameSequence> {
	validateFramescaperProjectSequence(profile, projectValue);
	const project = projectValue as FramescaperProjectSequence;
	const request = requestRecord(requestValue);
	const sequenceIds = new Set(project.sequences.map((value) => String(value.id)));
	if (!sequenceIds.has(request.rootSequenceId)) throw new ReferenceError('The nested-sequence root is missing.');
	if (request.subsequenceIds.length < 1
		|| request.subsequenceIds.length > FRAMESCAPER_SEQUENCE_MAXIMUM_NESTING_DEPTH) {
		throw new RangeError('A nested-sequence mapping requires a maintained-depth path.');
	}
	const byId = new Map((project.subsequences ?? []).map((value) => [value.id, value]));
	const path: FramescaperSubsequenceSequence[] = [];
	let expectedSequenceId = request.rootSequenceId;
	for (const id of request.subsequenceIds) {
		const subsequence = byId.get(id);
		if (!subsequence) throw new ReferenceError(`Nested-sequence path references missing subsequence ${id}.`);
		if (subsequence.sequenceId !== expectedSequenceId) {
			throw new RangeError(`Subsequence ${id} is not continuous with its path.`);
		}
		path.push(subsequence);
		expectedSequenceId = subsequence.sourceSequenceId;
	}
	const rates = sequenceRates(project);
	let frame = integer(request.sourceFrame);
	for (let index = path.length - 1; index >= 0; index -= 1) {
		const subsequence = path[index]!;
		const sourceStart = integer(subsequence.sourceInFrame);
		const sourceEnd = integer(subsequence.sourceInFrame + subsequence.sourceFrameCount);
		if (compare(frame, sourceStart) < 0 || compare(frame, sourceEnd) > 0) {
			throw new RangeError(`Subsequence ${subsequence.id} mapping lies outside its source range.`);
		}
		const scale = frameScale(rates.get(subsequence.sequenceId)!, rates.get(subsequence.sourceSequenceId)!);
		frame = add(integer(subsequence.sequenceStartFrame), multiply(subtract(frame, sourceStart), scale));
	}
	return exactFrame(frame);
}

/** Flatten all timeline clips reachable from one sequence into exact root-frame ranges. */
export function flattenFramescaperSequenceSequence(
	profile: unknown,
	projectValue: FramescaperProjectSequence | unknown,
	rootSequenceIdValue?: string,
): readonly Readonly<FramescaperFlattenedSequenceClipSequence>[] {
	validateFramescaperProjectSequence(profile, projectValue);
	const project = projectValue as FramescaperProjectSequence;
	const rootSequenceId = rootSequenceIdValue ?? String(project.primarySequenceId);
	const sequences = sequenceBindings(project);
	if (!sequences.has(rootSequenceId)) throw new ReferenceError(`Sequence ${rootSequenceId} is missing.`);
	const outgoing = new Map<string, FramescaperSubsequenceSequence[]>();
	for (const subsequence of project.subsequences ?? []) {
		const values = outgoing.get(subsequence.sequenceId) ?? [];
		values.push(subsequence);
		outgoing.set(subsequence.sequenceId, values);
	}
	const clips = clipBindings(project, sequences);
	assertFramescaperFlatteningBudgetSequence(
		[rootSequenceId],
		new Map([...outgoing].map(([id, values]) => [id, values.map((value) => value.sourceSequenceId)])),
		new Map([...clips].map(([id, values]) => [id, values.length])),
	);
	const flattened: FramescaperFlattenedSequenceClipSequence[] = [];
	walk(rootSequenceId, identityTransform(), null, null, [rootSequenceId], []);
	flattened.sort(compareFlattened);
	return Object.freeze(flattened.map(freezeFlattened));

	function walk(
		sequenceId: string,
		transform: AffineTransform,
		visibleStart: Fraction | null,
		visibleEnd: Fraction | null,
		sequencePath: readonly string[],
		subsequencePath: readonly string[],
	): void {
		const sequence = sequences.get(sequenceId)!;
		for (const binding of clips.get(sequenceId) ?? []) {
			const range = clipFrameRange(project, sequence, binding.clip);
			const start = visibleStart === null || compare(range.start, visibleStart) >= 0 ? range.start : visibleStart;
			const end = visibleEnd === null || compare(range.end, visibleEnd) <= 0 ? range.end : visibleEnd;
			if (compare(start, end) >= 0) continue;
			flattened.push({
				clipId: String(binding.clip.id),
				trackId: binding.trackId,
				sourceId: String(binding.clip.sourceId),
				kind: binding.clip.kind as 'audio' | 'video',
				leafSequenceId: sequenceId,
				sequencePath: [...sequencePath],
				subsequencePath: [...subsequencePath],
				leafStartFrame: exactFrame(start),
				leafEndFrame: exactFrame(end),
				startFrame: exactFrame(applyTransform(transform, start)),
				endFrame: exactFrame(applyTransform(transform, end)),
			});
		}
		for (const subsequence of outgoing.get(sequenceId) ?? []) {
			const parentStart = integer(subsequence.sequenceStartFrame);
			const parentEnd = integer(subsequence.sequenceStartFrame + subsequence.sequenceFrameCount);
			const start = visibleStart === null || compare(parentStart, visibleStart) >= 0 ? parentStart : visibleStart;
			const end = visibleEnd === null || compare(parentEnd, visibleEnd) <= 0 ? parentEnd : visibleEnd;
			if (compare(start, end) >= 0) continue;
			const child = sequences.get(subsequence.sourceSequenceId)!;
			const scale = frameScale(sequence.rate, child.rate);
			const sourceStart = integer(subsequence.sourceInFrame);
			const childStart = add(sourceStart, divide(subtract(start, parentStart), scale));
			const childEnd = add(sourceStart, divide(subtract(end, parentStart), scale));
			const childToParent = {
				scale,
				offset: subtract(parentStart, multiply(scale, sourceStart)),
			};
			walk(
				child.id,
				compose(transform, childToParent),
				childStart,
				childEnd,
				[...sequencePath, child.id],
				[...subsequencePath, subsequence.id],
			);
		}
	}
}

function sequenceBindings(project: FramescaperProjectSequence): ReadonlyMap<string, SequenceBinding> {
	return new Map(project.sequences.map((value) => [String(value.id), {
		id: String(value.id),
		rate: value.rate as Readonly<{ num: number; den: number }>,
		trackIds: value.trackIds as readonly string[],
	}]));
}

function sequenceRates(project: FramescaperProjectSequence): ReadonlyMap<string, SequenceBinding['rate']> {
	return new Map([...sequenceBindings(project)].map(([id, sequence]) => [id, sequence.rate]));
}

function clipBindings(
	project: FramescaperProjectSequence,
	sequences: ReadonlyMap<string, SequenceBinding>,
): ReadonlyMap<string, readonly ClipBinding[]> {
	const tracks = new Map((project.tracks as readonly Readonly<Record<string, unknown>>[])
		.map((track) => [String(track.id), track]));
	const clips = new Map((project.clips as readonly Readonly<Record<string, unknown>>[])
		.map((clip) => [String(clip.id), clip]));
	const result = new Map<string, ClipBinding[]>();
	for (const sequence of sequences.values()) for (const trackId of sequence.trackIds) {
		const track = tracks.get(trackId)!;
		for (const clipId of track.clipIds as readonly string[]) {
			const values = result.get(sequence.id) ?? [];
			values.push({ clip: clips.get(clipId)!, trackId });
			result.set(sequence.id, values);
		}
	}
	return result;
}

function clipFrameRange(
	project: FramescaperProjectSequence,
	sequence: SequenceBinding,
	clip: Readonly<Record<string, unknown>>,
): Readonly<{ readonly start: Fraction; readonly end: Fraction }> {
	if (clip.kind === 'video') {
		const start = integer(Number(clip.sequenceStartFrame));
		return { start, end: add(start, integer(Number(clip.sequenceFrameCount))) };
	}
	const runtime = resolveRuntimeClipProjection(project, clip);
	const denominator = BigInt(Number(project.sampleRate)) * BigInt(sequence.rate.den);
	return {
		start: fraction(BigInt(runtime.timelineStartFrame) * BigInt(sequence.rate.num), denominator),
		end: fraction(BigInt(runtime.timelineEndFrame) * BigInt(sequence.rate.num), denominator),
	};
}

function requestRecord(value: unknown): FramescaperNestedSequenceFrameRequestSequence {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A nested-sequence mapping request is required.');
	const record = value as Record<string, unknown>;
	for (const key of Reflect.ownKeys(record)) if (key !== 'rootSequenceId' && key !== 'subsequenceIds' && key !== 'sourceFrame') {
		throw new TypeError('The nested-sequence mapping request has an unsupported field.');
	}
	const rootSequenceId = ownData(record, 'rootSequenceId');
	const ids = ownData(record, 'subsequenceIds');
	const sourceFrame = ownData(record, 'sourceFrame');
	if (typeof rootSequenceId !== 'string' || rootSequenceId.length === 0) throw new TypeError('A nested-sequence root ID is required.');
	if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
		throw new TypeError('Nested-sequence path IDs must be non-empty strings.');
	}
	if (!Number.isSafeInteger(sourceFrame) || Number(sourceFrame) < 0) {
		throw new RangeError('A nested-sequence source frame must be a non-negative safe integer.');
	}
	return { rootSequenceId, subsequenceIds: [...ids], sourceFrame: Number(sourceFrame) };
}

function ownData(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Nested-sequence mapping request.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function identityTransform(): AffineTransform {
	return { scale: integer(1), offset: integer(0) };
}

function frameScale(parent: SequenceBinding['rate'], child: SequenceBinding['rate']): Fraction {
	return fraction(BigInt(parent.num) * BigInt(child.den), BigInt(parent.den) * BigInt(child.num));
}

function applyTransform(transform: AffineTransform, value: Fraction): Fraction {
	return add(multiply(transform.scale, value), transform.offset);
}

function compose(outer: AffineTransform, inner: AffineTransform): AffineTransform {
	return {
		scale: multiply(outer.scale, inner.scale),
		offset: add(multiply(outer.scale, inner.offset), outer.offset),
	};
}

function integer(value: number): Fraction {
	return fraction(BigInt(value), 1n);
}

function add(left: Fraction, right: Fraction): Fraction {
	return fraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtract(left: Fraction, right: Fraction): Fraction {
	return fraction(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiply(left: Fraction, right: Fraction): Fraction {
	return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Fraction, right: Fraction): Fraction {
	if (right.numerator === 0n) throw new RangeError('An exact nested-sequence scale cannot be zero.');
	return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

function compare(left: Fraction, right: Fraction): number {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
	if (denominator === 0n) throw new RangeError('An exact nested-sequence denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left === 0n ? 1n : left;
}

function exactFrame(value: Fraction): Readonly<FramescaperExactSequenceFrameSequence> {
	return Object.freeze({ numerator: value.numerator, denominator: value.denominator });
}

function compareFlattened(left: FramescaperFlattenedSequenceClipSequence, right: FramescaperFlattenedSequenceClipSequence): number {
	return compare(left.startFrame, right.startFrame)
		|| compare(left.endFrame, right.endFrame)
		|| compareStringArrays(left.subsequencePath, right.subsequencePath)
		|| compareStringArrays(left.sequencePath, right.sequencePath)
		|| compareStrings(left.clipId, right.clipId)
		|| compareStrings(left.trackId, right.trackId);
}

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
	for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
		const result = compareStrings(left[index]!, right[index]!);
		if (result !== 0) return result;
	}
	return left.length - right.length;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function freezeFlattened(value: FramescaperFlattenedSequenceClipSequence): Readonly<FramescaperFlattenedSequenceClipSequence> {
	return Object.freeze({
		...value,
		sequencePath: Object.freeze([...value.sequencePath]),
		subsequencePath: Object.freeze([...value.subsequencePath]),
		leafStartFrame: exactFrame(value.leafStartFrame),
		leafEndFrame: exactFrame(value.leafEndFrame),
		startFrame: exactFrame(value.startFrame),
		endFrame: exactFrame(value.endFrame),
	});
}
