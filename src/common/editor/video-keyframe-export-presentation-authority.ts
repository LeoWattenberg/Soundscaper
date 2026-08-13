/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	VideoKeyframeExportPresentationRequest,
	VideoKeyframeExportPresentationResolver,
} from './video-keyframe-export-frame-source.ts';
import {
	createVideoRetimeFrameBindingFromSnapshot,
	snapshotVideoRetimeFrameClip,
	type VideoRetimeFrameBinding,
	type VideoRetimeFrameClipSnapshot,
	type VideoRetimeFrameDescriptor,
} from './video-retime-frame-binding.ts';
import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
	type ExactSourcePosition,
	type ExactSourceTime,
} from './video-source-timing-view.ts';

export interface VideoKeyframeExportPresentationAuthorityOptions {
	readonly project: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
}

export interface VideoKeyframeExportPresentationAuthority {
	readonly resolvePresentationDescriptor: VideoKeyframeExportPresentationResolver;
	readonly presentationForEntry: (
		entry: Readonly<Record<string, unknown>>,
	) => VideoRetimeFrameDescriptor;
}

interface SourceContext {
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly frameCount: number;
	readonly timing: BoundVideoSourceTimingView;
	readonly verifiedObjects: WeakSet<object>;
}

interface ClipContext {
	readonly clipId: string;
	readonly source: SourceContext;
	readonly snapshot: VideoRetimeFrameClipSnapshot;
	readonly binding: VideoRetimeFrameBinding | null;
	readonly sourceStartTime: ExactSourceTime;
	readonly sourceEndTime: ExactSourceTime;
	readonly verifiedObjects: WeakSet<object>;
}

interface DescriptorOwner {
	readonly authority: object;
	readonly clip: ClipContext;
}

const MAXIMUM_SOURCE_COUNT = 4_096;
const MAXIMUM_CLIP_COUNT = 100_000;
const MAXIMUM_EXACT_BITS = 4_096;
const SHA256 = /^[a-f0-9]{64}$/u;
const DESCRIPTOR_OWNERS = new WeakMap<object, DescriptorOwner>();

/** Compile one immutable exact presentation authority for a captured export project. */
export function createVideoKeyframeExportPresentationAuthority(
	optionsValue: VideoKeyframeExportPresentationAuthorityOptions,
): VideoKeyframeExportPresentationAuthority {
	const options = closedRecord(
		optionsValue,
		'video keyframe export presentation authority options',
		['project', 'timingBySourceId'],
	);
	const project = record(options.project, 'video keyframe export presentation project');
	const timingBySourceId = options.timingBySourceId;
	if (!(timingBySourceId instanceof Map)) {
		throw new TypeError('Video keyframe export presentation timing must be a ReadonlyMap.');
	}
	const sourceValues = denseArray(
		data(project, 'sources', 'video keyframe export presentation project'),
		'video keyframe export presentation project.sources',
		MAXIMUM_SOURCE_COUNT,
	);
	const clipValues = denseArray(
		data(project, 'clips', 'video keyframe export presentation project'),
		'video keyframe export presentation project.clips',
		MAXIMUM_CLIP_COUNT,
	);
	const sources = captureSources(sourceValues, timingBySourceId);
	const clips = captureClips(clipValues, sources);
	if (clips.size < 1) throw new RangeError('Video keyframe export presentation requires a video clip.');
	const authority = Object.freeze({});

	const resolvePresentationDescriptor = (
		requestValue: VideoKeyframeExportPresentationRequest,
	): VideoRetimeFrameDescriptor => {
		const request = closedRecord(
			requestValue,
			'video keyframe export presentation request',
			['clip', 'source', 'localSequencePosition'],
		);
		const clipValue = record(request.clip, 'video keyframe export presentation clip');
		const sourceValue = record(request.source, 'video keyframe export presentation source');
		const clipId = id(data(clipValue, 'id', 'video keyframe export presentation clip'), 'clip.id');
		const clip = clips.get(clipId);
		if (!clip) throw new ReferenceError(`Video keyframe export clip ${clipId} is not canonical.`);
		verifySourceClone(sourceValue, clip.source);
		verifyClipClone(clipValue, clip);
		const position = localPosition(request.localSequencePosition, clip.snapshot.outerFrameCount);
		const descriptor = clip.binding === null
			? uniformDescriptor(clip, position)
			: clip.binding.ownedFrameAt(position.outerCell);
		DESCRIPTOR_OWNERS.set(descriptor, Object.freeze({ authority, clip }));
		return descriptor;
	};

	const presentationForEntry = (
		entryValue: Readonly<Record<string, unknown>>,
	): VideoRetimeFrameDescriptor => {
		const entry = record(entryValue, 'video keyframe export presentation entry');
		if (data(entry, 'kind', 'video keyframe export presentation entry') !== 'video') {
			throw new TypeError('A video keyframe export presentation entry requires video kind.');
		}
		const clipId = id(data(entry, 'clipId', 'video keyframe export presentation entry'), 'entry.clipId');
		const sourceId = id(data(entry, 'sourceId', 'video keyframe export presentation entry'), 'entry.sourceId');
		const clip = clips.get(clipId);
		if (!clip || clip.source.sourceId !== sourceId) {
			throw new Error('The video keyframe export presentation entry has no canonical clip/source binding.');
		}
		verifySourceClone(
			record(data(entry, 'source', 'video keyframe export presentation entry'), 'entry.source'),
			clip.source,
		);
		verifyClipClone(
			record(data(entry, 'clip', 'video keyframe export presentation entry'), 'entry.clip'),
			clip,
		);
		const descriptor = data(
			entry,
			'presentationDescriptor',
			'video keyframe export presentation entry',
		);
		if (!descriptor || typeof descriptor !== 'object') {
			throw new TypeError('The video keyframe export presentation entry requires an exact descriptor.');
		}
		const owner = DESCRIPTOR_OWNERS.get(descriptor);
		if (owner?.authority !== authority || owner.clip !== clip) {
			throw new TypeError('The presentation descriptor was not produced by this clip authority.');
		}
		return descriptor as VideoRetimeFrameDescriptor;
	};

	return Object.freeze({ resolvePresentationDescriptor, presentationForEntry });
}

function captureSources(
	values: readonly unknown[],
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): ReadonlyMap<string, SourceContext> {
	const sources = new Map<string, SourceContext>();
	for (const [index, value] of values.entries()) {
		const source = record(value, `video keyframe export source ${String(index)}`);
		if (data(source, 'kind', `video keyframe export source ${String(index)}`) !== 'video') continue;
		const sourceId = id(data(source, 'id', `video keyframe export source ${String(index)}`), 'source.id');
		if (sources.has(sourceId)) throw new RangeError(`Duplicate video source ID ${sourceId}.`);
		const contentSha256 = digest(
			data(source, 'contentSha256', `video keyframe export source ${sourceId}`),
			`video source ${sourceId}.contentSha256`,
		);
		const frameCount = positiveSafeInteger(
			data(source, 'sourceFrameCount', `video keyframe export source ${sourceId}`),
			`video source ${sourceId}.sourceFrameCount`,
		);
		const timing = timingBySourceId.get(sourceId);
		if (timing === undefined) {
			throw new ReferenceError(`Video source ${sourceId} has no exact timing token.`);
		}
		const timingInfo = boundVideoSourceTimingViewInfo(timing);
		if (timingInfo.sourceId !== sourceId || timingInfo.frameCount !== frameCount) {
			throw new RangeError(`Video source ${sourceId} does not match its exact timing token.`);
		}
		sources.set(sourceId, Object.freeze({
			sourceId,
			contentSha256,
			frameCount,
			timing,
			verifiedObjects: new WeakSet<object>(),
		}));
	}
	return sources;
}

function captureClips(
	values: readonly unknown[],
	sources: ReadonlyMap<string, SourceContext>,
): ReadonlyMap<string, ClipContext> {
	const clips = new Map<string, ClipContext>();
	for (const [index, value] of values.entries()) {
		const raw = record(value, `video keyframe export clip ${String(index)}`);
		if (data(raw, 'kind', `video keyframe export clip ${String(index)}`) !== 'video') continue;
		const persisted = persistedClip(raw, `video keyframe export clip ${String(index)}`);
		const snapshot = snapshotVideoRetimeFrameClip(persisted);
		if (clips.has(snapshot.id)) throw new RangeError(`Duplicate video clip ID ${snapshot.id}.`);
		const source = sources.get(snapshot.sourceId);
		if (!source) throw new ReferenceError(`Video clip ${snapshot.id} references an unavailable timed source.`);
		if (snapshot.sourceOutFrame > source.frameCount) {
			throw new RangeError(`Video clip ${snapshot.id} exceeds its timed source range.`);
		}
		const binding = snapshot.mapping === 'curve'
			? createVideoRetimeFrameBindingFromSnapshot(snapshot, source.timing)
			: null;
		clips.set(snapshot.id, Object.freeze({
			clipId: snapshot.id,
			source,
			snapshot,
			binding,
			sourceStartTime: videoSourceFrameTime(source.timing, integer(snapshot.sourceInFrame)),
			sourceEndTime: videoSourceFrameTime(source.timing, integer(snapshot.sourceOutFrame)),
			verifiedObjects: new WeakSet<object>(),
		}));
	}
	return clips;
}

function verifySourceClone(value: Readonly<Record<string, unknown>>, expected: SourceContext): void {
	if (expected.verifiedObjects.has(value)) return;
	if (data(value, 'kind', 'video keyframe export presentation source') !== 'video'
		|| data(value, 'id', 'video keyframe export presentation source') !== expected.sourceId
		|| data(value, 'contentSha256', 'video keyframe export presentation source') !== expected.contentSha256
		|| data(value, 'sourceFrameCount', 'video keyframe export presentation source') !== expected.frameCount) {
		throw new Error('The video keyframe export source does not match its canonical digest and timing identity.');
	}
	expected.verifiedObjects.add(value);
}

function verifyClipClone(value: Readonly<Record<string, unknown>>, expected: ClipContext): void {
	if (expected.verifiedObjects.has(value)) return;
	let snapshot: VideoRetimeFrameClipSnapshot;
	try {
		snapshot = snapshotVideoRetimeFrameClip(persistedClip(value, 'video keyframe export presentation clip'));
	} catch (cause) {
		throw new TypeError('The video keyframe export clip does not match its canonical structure.', { cause });
	}
	if (!sameClipInfo(snapshot, expected.snapshot)) {
		throw new Error('The video keyframe export clip does not match its canonical source range.');
	}
	if (expected.binding !== null) {
		const candidate = createVideoRetimeFrameBindingFromSnapshot(snapshot, expected.source.timing);
		if (!sameBinding(candidate, expected.binding)) {
			throw new Error('The video keyframe export clip does not match its canonical retime curve.');
		}
	}
	expected.verifiedObjects.add(value);
}

function uniformDescriptor(
	clip: ClipContext,
	position: Readonly<{ num: number; den: number; outerCell: number }>,
): VideoRetimeFrameDescriptor {
	const progress = normalizeExact(BigInt(position.num), BigInt(position.den) * BigInt(clip.snapshot.outerFrameCount));
	const sourceTime = addExact(
		clip.sourceStartTime,
		multiplyExact(subtractExact(clip.sourceEndTime, clip.sourceStartTime), progress),
	);
	let lower = clip.snapshot.sourceInFrame;
	let upper = clip.snapshot.sourceOutFrame;
	while (lower + 1 < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		const boundary = videoSourceFrameTime(clip.source.timing, integer(middle));
		if (compareExact(boundary, sourceTime) <= 0) lower = middle;
		else upper = middle;
	}
	const drawableSourceStartTime = videoSourceFrameTime(clip.source.timing, integer(lower));
	const drawableSourceEndTime = videoSourceFrameTime(clip.source.timing, integer(lower + 1));
	if (compareExact(sourceTime, drawableSourceStartTime) < 0
		|| compareExact(sourceTime, drawableSourceEndTime) >= 0) {
		throw new RangeError('Uniform video presentation escaped its exact drawable interval.');
	}
	const intervalProgress = divideExact(
		subtractExact(sourceTime, drawableSourceStartTime),
		subtractExact(drawableSourceEndTime, drawableSourceStartTime),
	);
	const sourceFrame = addExact(integer(lower), intervalProgress);
	return Object.freeze({
		outerCell: position.outerCell,
		segmentIndex: 0,
		mode: 'constant-forward' as const,
		sourceFrame,
		sourceTime,
		drawableSourceFrame: lower,
		drawableSourceStartTime,
		drawableSourceEndTime,
	});
}

function localPosition(
	value: unknown,
	outerFrameCount: number,
): Readonly<{ num: number; den: number; outerCell: number }> {
	const position = closedRecord(value, 'video keyframe export local sequence position', ['num', 'den']);
	const num = nonNegativeSafeInteger(position.num, 'localSequencePosition.num');
	const den = positiveSafeInteger(position.den, 'localSequencePosition.den');
	if (greatestCommonDivisor(BigInt(num), BigInt(den)) !== 1n) {
		throw new RangeError('Video keyframe export local sequence position must be canonically reduced.');
	}
	const outerCell = Math.floor(num / den);
	if (outerCell >= outerFrameCount) {
		throw new RangeError('Video keyframe export local sequence position exceeds its clip.');
	}
	return Object.freeze({ num, den, outerCell });
}

function sameClipInfo(left: VideoRetimeFrameClipSnapshot, right: VideoRetimeFrameClipSnapshot): boolean {
	return left.id === right.id
		&& left.sourceId === right.sourceId
		&& left.sequenceId === right.sequenceId
		&& left.sequenceStartFrame === right.sequenceStartFrame
		&& left.outerFrameCount === right.outerFrameCount
		&& left.sourceInFrame === right.sourceInFrame
		&& left.sourceOutFrame === right.sourceOutFrame
		&& left.mapping === right.mapping
		&& left.segmentCount === right.segmentCount;
}

function sameBinding(left: VideoRetimeFrameBinding, right: VideoRetimeFrameBinding): boolean {
	if (left.segments.length !== right.segments.length
		|| !sameExact(left.terminal.sourceFrame, right.terminal.sourceFrame)
		|| !sameExact(left.terminal.sourceTime, right.terminal.sourceTime)) return false;
	return left.segments.every((segment, index) => {
		const expected = right.segments[index];
		return expected !== undefined
			&& segment.segmentIndex === expected.segmentIndex
			&& segment.mode === expected.mode
			&& segment.startOuterCell === expected.startOuterCell
			&& segment.endOuterCell === expected.endOuterCell
			&& sameExact(segment.sourceStart, expected.sourceStart)
			&& sameExact(segment.sourceEnd, expected.sourceEnd)
			&& optionalExact(segment.startVelocity, expected.startVelocity)
			&& optionalExact(segment.endVelocity, expected.endVelocity);
	});
}

function optionalExact(
	left: Readonly<{ numerator: bigint; denominator: bigint }> | undefined,
	right: Readonly<{ numerator: bigint; denominator: bigint }> | undefined,
): boolean {
	return left === undefined || right === undefined ? left === right : sameExact(left, right);
}

function sameExact(
	left: Readonly<{ numerator: bigint; denominator: bigint }>,
	right: Readonly<{ numerator: bigint; denominator: bigint }>,
): boolean {
	return left.numerator === right.numerator && left.denominator === right.denominator;
}

function persistedClip(value: Readonly<Record<string, unknown>>, name: string): Readonly<Record<string, unknown>> {
	const fields = [
		'kind', 'id', 'sourceId', 'sequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'retimeMap',
	] as const;
	return Object.freeze(Object.fromEntries(fields.map((key) => [key, data(value, key, name)])));
}

function integer(value: number): ExactSourcePosition {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

function addExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	const common = greatestCommonDivisor(left.denominator, right.denominator);
	const leftScale = right.denominator / common;
	const rightScale = left.denominator / common;
	return normalizeExact(
		checkedAdd(checkedMultiply(left.numerator, leftScale), checkedMultiply(right.numerator, rightScale)),
		checkedMultiply(left.denominator, leftScale),
	);
}

function subtractExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	return addExact(left, Object.freeze({ numerator: -right.numerator, denominator: right.denominator }));
}

function multiplyExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	const leftCancellation = greatestCommonDivisor(absolute(left.numerator), right.denominator);
	const rightCancellation = greatestCommonDivisor(absolute(right.numerator), left.denominator);
	return normalizeExact(
		checkedMultiply(left.numerator / leftCancellation, right.numerator / rightCancellation),
		checkedMultiply(left.denominator / rightCancellation, right.denominator / leftCancellation),
	);
}

function divideExact(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	if (right.numerator === 0n) throw new RangeError('An exact video interval cannot have zero duration.');
	return multiplyExact(left, normalizeExact(right.denominator, right.numerator));
}

function normalizeExact(numerator: bigint, denominator: bigint): ExactSourceTime {
	if (denominator === 0n) throw new RangeError('An exact video denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = greatestCommonDivisor(absolute(numerator), denominator);
	const result = Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
	assertExact(result.numerator);
	assertExact(result.denominator);
	return result;
}

function compareExact(left: ExactSourceTime, right: ExactSourceTime): -1 | 0 | 1 {
	const difference = checkedAdd(
		checkedMultiply(left.numerator, right.denominator),
		-checkedMultiply(right.numerator, left.denominator),
	);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function checkedMultiply(left: bigint, right: bigint): bigint {
	if (left !== 0n && right !== 0n && bitLength(left) + bitLength(right) - 1 > MAXIMUM_EXACT_BITS) {
		throw new RangeError('Video keyframe export exact presentation complexity exceeds its limit.');
	}
	const result = left * right;
	assertExact(result);
	return result;
}

function checkedAdd(left: bigint, right: bigint): bigint {
	const result = left + right;
	assertExact(result);
	return result;
}

function assertExact(value: bigint): void {
	if (bitLength(value) > MAXIMUM_EXACT_BITS) {
		throw new RangeError('Video keyframe export exact presentation complexity exceeds its limit.');
	}
}

function bitLength(value: bigint): number {
	return absolute(value).toString(2).length;
}

function absolute(value: bigint): bigint {
	return value < 0n ? -value : value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	left = absolute(left);
	right = absolute(right);
	while (right !== 0n) [left, right] = [right, left % right];
	return left || 1n;
}

function closedRecord(value: unknown, name: string, fields: readonly string[]): Readonly<Record<string, unknown>> {
	const source = record(value, name);
	const keys = Reflect.ownKeys(source);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| fields.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} must be a closed own-data record.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of fields) result[key] = data(source, key, name);
	return Object.freeze(result);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} cannot contain named properties.`);
	}
	return Object.freeze(result);
}

function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`${name} must be a bounded nonempty string.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}
