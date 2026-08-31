/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, non-biometric ByteTrack-style association for reviewed reframes. */

import type {
	AssistanceReframeNormalizedBoxV1,
	AssistanceReframeSubjectV1,
} from './reframe-planner-v1.ts';

export const ASSISTANCE_SUBJECT_TRACKING_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_SUBJECT_TRACKING_SAMPLES_PER_SECOND = 2 as const;
export const ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_GAP_SECONDS = 1 as const;
export const ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_FRAMES = 100_000;
export const ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_DETECTIONS_PER_FRAME = 256;

const MAXIMUM_SHOT_ANCHORS = 100_000;
const MAXIMUM_ACTIVE_TRACKS = 1_024;
const MAXIMUM_TIMESCALE = 0x7fff_ffff;
const MAXIMUM_SOURCE_FRAME = 0xffff_ffff;
const MAXIMUM_PRESENTATION_TICK = 0x7fff_ffff_ffff_ffffn;
const HIGH_CONFIDENCE = 0.5;
const LOW_CONFIDENCE = 0.1;
const ASSOCIATION_IOU = 0.25;
const TICK = /^(?:0|[1-9]\d*)$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

const REQUEST_FIELDS = Object.freeze([
	'schemaVersion', 'width', 'height', 'timescale', 'shotAnchorFrames', 'frames',
] as const);
const FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'subjects'] as const);
const DETECTION_FIELDS = Object.freeze([
	'kind', 'classId', 'label', 'confidence', 'box',
] as const);
const BOX_FIELDS = Object.freeze(['x', 'y', 'width', 'height'] as const);

export interface AssistanceSubjectTrackingRequestV1 {
	readonly schemaVersion: typeof ASSISTANCE_SUBJECT_TRACKING_SCHEMA_VERSION;
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	/** Exact first-frame anchors from the canonical shot table. */
	readonly shotAnchorFrames: readonly number[];
	readonly frames: readonly AssistanceSubjectTrackingFrameV1[];
}

export interface AssistanceSubjectTrackingFrameV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly subjects: readonly AssistanceSubjectTrackingDetectionV1[];
}

export interface AssistanceSubjectTrackingDetectionV1 {
	readonly kind: 'face' | 'person' | 'object';
	readonly classId: number | null;
	readonly label: string;
	readonly confidence: number;
	readonly box: AssistanceReframeNormalizedBoxV1;
}

export type AssistanceTrackedSubjectV1 = AssistanceReframeSubjectV1;

export interface AssistanceTrackedSubjectFrameV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly subjects: readonly AssistanceTrackedSubjectV1[];
}

export interface AssistanceTrackedSubjectResultV1 {
	readonly schemaVersion: typeof ASSISTANCE_SUBJECT_TRACKING_SCHEMA_VERSION;
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frames: readonly AssistanceTrackedSubjectFrameV1[];
}

interface NormalizedDetection {
	readonly kind: AssistanceReframeSubjectV1['kind'];
	readonly associationKey: string;
	readonly confidence: number;
	readonly box: AssistanceReframeNormalizedBoxV1;
	readonly inputIndex: number;
}

interface NormalizedFrame {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly tick: bigint;
	readonly detections: readonly NormalizedDetection[];
}

interface ActiveTrack {
	readonly ordinal: number;
	readonly trackId: string;
	readonly kind: AssistanceReframeSubjectV1['kind'];
	readonly associationKey: string;
	lastFrameIndex: number;
	lastTick: bigint;
	lastConfidence: number;
	lastBox: AssistanceReframeNormalizedBoxV1;
}

interface Assignment {
	readonly track: ActiveTrack;
	readonly detection: NormalizedDetection;
	readonly overlap: number;
	readonly distance: number;
}

interface MutableOutputFrame {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly subjects: AssistanceTrackedSubjectV1[];
}

/** Associate reviewed detections, recover low-score observations, and fill only observed gaps. */
export function trackAssistanceSubjectsV1(value: unknown): AssistanceTrackedSubjectResultV1 {
	const request = exactRecord(value, REQUEST_FIELDS, 'subject tracking request');
	if (request.schemaVersion !== ASSISTANCE_SUBJECT_TRACKING_SCHEMA_VERSION) {
		throw new TypeError('The subject tracking schema version is unsupported.');
	}
	const width = integer(request.width, 1, 4_096, 'subject tracking width');
	const height = integer(request.height, 1, 4_096, 'subject tracking height');
	const timescale = integer(request.timescale, 1, MAXIMUM_TIMESCALE,
		'subject tracking timescale');
	const frames = normalizeFrames(request.frames);
	const anchors = normalizeShotAnchors(request.shotAnchorFrames, frames);
	const mutable: MutableOutputFrame[] = frames.map(({ sourceFrame, presentationTick }) => ({
		sourceFrame,
		presentationTick,
		subjects: [],
	}));
	const active = new Map<number, ActiveTrack>();
	let nextTrackOrdinal = 1;

	for (const [frameIndex, frame] of frames.entries()) {
		if (frameIndex > 0 && anchors.has(frame.sourceFrame)) active.clear();
		for (const track of active.values()) {
			if (frame.tick - track.lastTick
				> BigInt(timescale * ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_GAP_SECONDS)) {
				active.delete(track.ordinal);
			}
		}
		const high = frame.detections.filter(({ confidence }) => confidence >= HIGH_CONFIDENCE);
		const low = frame.detections.filter(({ confidence }) =>
			confidence >= LOW_CONFIDENCE && confidence < HIGH_CONFIDENCE);
		const tracks = [...active.values()].sort(compareTrack);
		const highAssignments = assign(tracks, high);
		const highTrackIds = new Set(highAssignments.map(({ track }) => track.ordinal));
		const highDetectionIds = new Set(highAssignments.map(({ detection }) => detection.inputIndex));
		const lowAssignments = assign(
			tracks.filter(({ ordinal }) => !highTrackIds.has(ordinal)),
			low,
		);
		for (const { track, detection } of [...highAssignments, ...lowAssignments]) {
			observe(track, detection, frameIndex, frames, mutable);
		}
		for (const detection of high) {
			if (highDetectionIds.has(detection.inputIndex)) continue;
			if (active.size >= MAXIMUM_ACTIVE_TRACKS) {
				throw new RangeError('The subject tracking active inventory exceeds its bound.');
			}
			const ordinal = nextTrackOrdinal;
			nextTrackOrdinal += 1;
			const track: ActiveTrack = {
				ordinal,
				trackId: `subject-${String(ordinal).padStart(6, '0')}`,
				kind: detection.kind,
				associationKey: detection.associationKey,
				lastFrameIndex: frameIndex,
				lastTick: frame.tick,
				lastConfidence: detection.confidence,
				lastBox: detection.box,
			};
			active.set(ordinal, track);
			mutable[frameIndex]!.subjects.push(subject(track, detection.confidence, detection.box));
		}
	}

	const outputFrames = mutable.map((frame): AssistanceTrackedSubjectFrameV1 => Object.freeze({
		sourceFrame: frame.sourceFrame,
		presentationTick: frame.presentationTick,
		subjects: boundedOutputSubjects(frame.subjects),
	}));
	return Object.freeze({
		schemaVersion: ASSISTANCE_SUBJECT_TRACKING_SCHEMA_VERSION,
		width,
		height,
		timescale,
		frames: Object.freeze(outputFrames),
	});
}

function normalizeFrames(value: unknown): readonly NormalizedFrame[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_FRAMES) {
		throw new RangeError('The subject tracking frame inventory exceeds its exact bound.');
	}
	let priorFrame = -1;
	let priorTick = -1n;
	return Object.freeze(value.map((candidate, frameIndex): NormalizedFrame => {
		const label = `subject tracking frame ${String(frameIndex)}`;
		const record = exactRecord(candidate, FRAME_FIELDS, label);
		const sourceFrame = integer(record.sourceFrame, 0, MAXIMUM_SOURCE_FRAME,
			`${label} source frame`);
		const presentationTick = canonicalTick(record.presentationTick, `${label} presentation tick`);
		const tick = BigInt(presentationTick);
		if (sourceFrame <= priorFrame || tick <= priorTick) {
			throw new RangeError('Subject tracking frames must be strictly ordered in both timing domains.');
		}
		priorFrame = sourceFrame;
		priorTick = tick;
		if (!Array.isArray(record.subjects)
			|| record.subjects.length > ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_DETECTIONS_PER_FRAME) {
			throw new RangeError(`${label} detection inventory exceeds its exact bound.`);
		}
		const detections = record.subjects.map((detection, detectionIndex) =>
			normalizeDetection(detection, frameIndex, detectionIndex))
			.sort(compareDetection)
			.map((detection, inputIndex) => Object.freeze({ ...detection, inputIndex }));
		return Object.freeze({
			sourceFrame,
			presentationTick,
			tick,
			detections: Object.freeze(detections),
		});
	}));
}

function normalizeDetection(value: unknown, frameIndex: number, detectionIndex: number): NormalizedDetection {
	const label = `subject tracking frame ${String(frameIndex)} detection ${String(detectionIndex)}`;
	const record = exactRecord(value, DETECTION_FIELDS, label);
	if (record.kind !== 'face' && record.kind !== 'person' && record.kind !== 'object') {
		throw new TypeError(`The ${label} kind is unsupported.`);
	}
	const classId = record.classId === null ? null
		: integer(record.classId, 0, 9_999, `${label} class ID`);
	const labelText = text(record.label, 160, `${label} label`);
	if (record.kind === 'face' && (classId !== null || labelText !== 'face')) {
		throw new TypeError('A face track cannot carry biometric identity or an object class.');
	}
	const kind = record.kind === 'face' ? 'face' : 'object';
	return Object.freeze({
		kind,
		associationKey: record.kind === 'face'
			? 'face'
			: `${record.kind}:${classId === null ? 'none' : String(classId)}:${labelText}`,
		confidence: unit(record.confidence, `${label} confidence`),
		box: normalizedBox(record.box, `${label} box`),
		inputIndex: detectionIndex,
	});
}

function normalizeShotAnchors(value: unknown, frames: readonly NormalizedFrame[]): ReadonlySet<number> {
	if (!Array.isArray(value) || value.length > MAXIMUM_SHOT_ANCHORS) {
		throw new RangeError('The subject tracking shot-anchor inventory exceeds its bound.');
	}
	const admittedFrames = new Set(frames.map(({ sourceFrame }) => sourceFrame));
	let prior = -1;
	const anchors = value.map((candidate, index) => {
		const sourceFrame = integer(candidate, 0, MAXIMUM_SOURCE_FRAME,
			`subject tracking shot anchor ${String(index)}`);
		if (sourceFrame <= prior) throw new RangeError('Subject tracking shot anchors must be ordered.');
		if (!admittedFrames.has(sourceFrame)) {
			throw new RangeError('Every subject tracking shot anchor must name an exact sampled frame.');
		}
		prior = sourceFrame;
		return sourceFrame;
	});
	return new Set(anchors);
}

function assign(
	tracks: readonly ActiveTrack[],
	detections: readonly NormalizedDetection[],
): readonly Assignment[] {
	const candidates: Assignment[] = [];
	for (const track of tracks) {
		for (const detection of detections) {
			if (track.associationKey !== detection.associationKey) continue;
			const overlap = intersectionOverUnion(track.lastBox, detection.box);
			if (overlap < ASSOCIATION_IOU) continue;
			candidates.push(Object.freeze({
				track,
				detection,
				overlap,
				distance: centerDistanceSquared(track.lastBox, detection.box),
			}));
		}
	}
	candidates.sort((left, right) => right.overlap - left.overlap
		|| left.distance - right.distance
		|| left.track.ordinal - right.track.ordinal
		|| left.detection.inputIndex - right.detection.inputIndex);
	const usedTracks = new Set<number>();
	const usedDetections = new Set<number>();
	const result: Assignment[] = [];
	for (const candidate of candidates) {
		if (usedTracks.has(candidate.track.ordinal)
			|| usedDetections.has(candidate.detection.inputIndex)) continue;
		usedTracks.add(candidate.track.ordinal);
		usedDetections.add(candidate.detection.inputIndex);
		result.push(candidate);
	}
	return result;
}

function observe(
	track: ActiveTrack,
	detection: NormalizedDetection,
	frameIndex: number,
	frames: readonly NormalizedFrame[],
	output: readonly MutableOutputFrame[],
): void {
	const current = frames[frameIndex]!;
	const duration = current.tick - track.lastTick;
	for (let index = track.lastFrameIndex + 1; index < frameIndex; index += 1) {
		const intermediate = frames[index]!;
		const weight = Number(intermediate.tick - track.lastTick) / Number(duration);
		const box = interpolateBox(track.lastBox, detection.box, weight);
		const confidence = interpolate(track.lastConfidence, detection.confidence, weight);
		output[index]!.subjects.push(subject(track, confidence, box));
	}
	output[frameIndex]!.subjects.push(subject(track, detection.confidence, detection.box));
	track.lastFrameIndex = frameIndex;
	track.lastTick = current.tick;
	track.lastConfidence = detection.confidence;
	track.lastBox = detection.box;
}

function subject(
	track: ActiveTrack,
	confidence: number,
	box: AssistanceReframeNormalizedBoxV1,
): AssistanceTrackedSubjectV1 {
	return Object.freeze({
		trackId: track.trackId,
		kind: track.kind,
		confidence: canonical(confidence),
		box,
	});
}

function boundedOutputSubjects(
	value: AssistanceTrackedSubjectV1[],
): readonly AssistanceTrackedSubjectV1[] {
	return Object.freeze(value
		.sort((left, right) => right.confidence - left.confidence
			|| (left.kind === right.kind ? 0 : left.kind === 'face' ? -1 : 1)
			|| compareText(left.trackId, right.trackId))
		.slice(0, ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_DETECTIONS_PER_FRAME)
		.sort((left, right) => compareText(left.trackId, right.trackId)));
}

function interpolateBox(
	left: AssistanceReframeNormalizedBoxV1,
	right: AssistanceReframeNormalizedBoxV1,
	weight: number,
): AssistanceReframeNormalizedBoxV1 {
	const width = interpolate(left.width, right.width, weight);
	const height = interpolate(left.height, right.height, weight);
	return Object.freeze({
		x: Math.min(interpolate(left.x, right.x, weight), canonical(1 - width)),
		y: Math.min(interpolate(left.y, right.y, weight), canonical(1 - height)),
		width,
		height,
	});
}

function intersectionOverUnion(
	left: AssistanceReframeNormalizedBoxV1,
	right: AssistanceReframeNormalizedBoxV1,
): number {
	const intersectionWidth = Math.max(0,
		Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
	const intersectionHeight = Math.max(0,
		Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
	const intersection = intersectionWidth * intersectionHeight;
	const union = left.width * left.height + right.width * right.height - intersection;
	return union > 0 ? canonical(intersection / union) : 0;
}

function centerDistanceSquared(
	left: AssistanceReframeNormalizedBoxV1,
	right: AssistanceReframeNormalizedBoxV1,
): number {
	const x = left.x + left.width / 2 - right.x - right.width / 2;
	const y = left.y + left.height / 2 - right.y - right.height / 2;
	return canonical(x * x + y * y);
}

function compareDetection(left: NormalizedDetection, right: NormalizedDetection): number {
	return compareText(left.associationKey, right.associationKey)
		|| left.box.x - right.box.x
		|| left.box.y - right.box.y
		|| left.box.width - right.box.width
		|| left.box.height - right.box.height
		|| right.confidence - left.confidence
		|| left.inputIndex - right.inputIndex;
}

function compareTrack(left: ActiveTrack, right: ActiveTrack): number {
	return left.ordinal - right.ordinal;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedBox(value: unknown, label: string): AssistanceReframeNormalizedBoxV1 {
	const record = exactRecord(value, BOX_FIELDS, label);
	const box = Object.freeze({
		x: unit(record.x, `${label} x`),
		y: unit(record.y, `${label} y`),
		width: positiveUnit(record.width, `${label} width`),
		height: positiveUnit(record.height, `${label} height`),
	});
	if (box.x + box.width > 1 || box.y + box.height > 1) {
		throw new RangeError(`The ${label} escapes normalized frame geometry.`);
	}
	return box;
}

function canonicalTick(value: unknown, label: string): string {
	if (typeof value !== 'string' || !TICK.test(value) || BigInt(value) > MAXIMUM_PRESENTATION_TICK) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return value;
}

function text(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum
		|| CONTROL.test(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} has unsupported fields.`);
	}
	return record as Record<Field, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and between zero and one.`);
	}
	return value;
}

function positiveUnit(value: unknown, label: string): number {
	const result = unit(value, label);
	if (result === 0) throw new RangeError(`The ${label} must be positive.`);
	return result;
}

function interpolate(left: number, right: number, weight: number): number {
	return canonical(left + (right - left) * weight);
}

function canonical(value: number): number {
	if (Math.abs(value) < 1e-15) return 0;
	if (Math.abs(value - 1) < 1e-15) return 1;
	return Math.round(value * 1e12) / 1e12;
}
