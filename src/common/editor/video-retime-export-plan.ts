/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameBoundarySample } from './sequence-frame-navigation.ts';
import type { RationalRate } from './timeline-time.ts';
import {
	createVideoRetimeFrameBindingFromSnapshot,
	snapshotVideoRetimeFrameClip,
	videoRetimeFrameClipSnapshotInfo,
	type VideoRetimeFrameBinding,
	type VideoRetimeFrameBindingSegment,
	type VideoRetimeFrameClipSnapshot,
} from './video-retime-frame-binding.ts';
import type { VideoRetimeCurveSegment } from './video-retime-curve.ts';
import {
	captureVideoRetimeExportInput,
	videoRetimeExportDecimal,
	videoRetimeExportDecimalTokenBytes,
	videoRetimeExportOutputBoundary,
	videoRetimeExportPosition,
	videoRetimeExportRequired,
	videoRetimeExportSafeAdd,
	videoRetimeInterpolateSourceTime,
	type CapturedVideoRetimeExportInput,
	type DecimalExactRationalV6,
	type VideoRetimeExportTopologyInterval,
} from './video-retime-export-domain.ts';
import {
	VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES,
	videoRetimeCanonicalJsonByteLength,
} from './video-retime-export-json.ts';
import {
	createVideoRetimeOutputCadence,
	type VideoRetimeOutputCadence,
} from './video-retime-output-cadence.ts';
import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';

const MAXIMUM_COMPILED_SEGMENTS = 16_384;
const MAXIMUM_GEOMETRIC_CANDIDATES = 16_384;

export type { DecimalExactRationalV6, VideoRetimeExportIntentInputV6 } from './video-retime-export-domain.ts';

export interface VideoRetimeExportIntersectionBaseV6 {
	readonly index: number;
	readonly topologyIntervalIndex: number;
	readonly layerIndex: number;
	readonly clipIndex: number;
	readonly clipId: string;
	readonly sourceId: string;
	readonly sequenceStartFrame: number;
	readonly outerFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceOutFrame: number;
	readonly startSample: number;
	readonly endSample: number;
	readonly startOutputFrame: number;
	readonly endOutputFrame: number;
}

export type VideoRetimeExportIntersectionV6 = Readonly<
	VideoRetimeExportIntersectionBaseV6 & (
		| {
			readonly mapping: 'curve';
			readonly segmentIndex: number;
			readonly mode: VideoRetimeCurveSegment['mode'];
			readonly segmentStartOuterCell: number;
			readonly segmentEndOuterCell: number;
			readonly sourceStart: DecimalExactRationalV6;
			readonly sourceEnd: DecimalExactRationalV6;
			readonly startVelocity?: DecimalExactRationalV6;
			readonly endVelocity?: DecimalExactRationalV6;
			readonly startOuterCell: number;
			readonly endOuterCell: number;
			readonly clippedSourceStart: DecimalExactRationalV6;
			readonly clippedSourceEnd: DecimalExactRationalV6;
			readonly drawableStartTime: DecimalExactRationalV6;
			readonly drawableEndTime: DecimalExactRationalV6;
		}
		| {
			readonly mapping: 'uniform-wall-clock';
			readonly clipStartSample: number;
			readonly clipEndSample: number;
			readonly sourceStartTime: DecimalExactRationalV6;
			readonly sourceEndTime: DecimalExactRationalV6;
			readonly clippedSourceStartTime: DecimalExactRationalV6;
			readonly clippedSourceEndTime: DecimalExactRationalV6;
		}
	)
>;

export interface VideoRetimeExportIntentV6 {
	readonly kind: 'video-retime-export-intent';
	readonly version: 6;
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly sampleRate: number;
	readonly sequenceBinding: Readonly<{ id: string; rate: RationalRate }>;
	readonly outputRate: RationalRate;
	readonly outputFrameCount: number;
	readonly intersections: readonly VideoRetimeExportIntersectionV6[];
	readonly limits: Readonly<{
		readonly topologyRecordCount: number;
		readonly compiledSegmentCount: number;
		readonly geometricCandidateCount: number;
		readonly serializedIntersectionCount: number;
		readonly decimalByteCount: number;
	}>;
}

interface ClipContext {
	readonly snapshot: VideoRetimeFrameClipSnapshot;
	readonly info: ReturnType<typeof videoRetimeFrameClipSnapshotInfo>;
	readonly timing: BoundVideoSourceTimingView;
	readonly clipStartSample: number;
	readonly clipEndSample: number;
}
interface CurveSegmentContext {
	readonly segment: VideoRetimeFrameBindingSegment;
	readonly startSample: number;
	readonly endSample: number;
}
interface CurveContext {
	readonly binding: VideoRetimeFrameBinding;
	readonly segments: readonly CurveSegmentContext[];
}

/** Build one dormant, backend-neutral exact video-retime export intent. */
export function createVideoRetimeExportIntentV6(
	inputValue: unknown,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): VideoRetimeExportIntentV6 {
	const input = captureVideoRetimeExportInput(inputValue);
	const cadence = createVideoRetimeOutputCadence({
		sampleStart: input.sampleStart,
		sampleDuration: input.sampleDuration,
		sampleRate: input.sampleRate,
		sequenceRate: input.sequenceBinding.rate,
		...(input.outputRate ? { outputRate: input.outputRate } : {}),
	});
	const zeroCountEnvelopeBytes = intentEnvelopeBytes(input, cadence);
	if (zeroCountEnvelopeBytes > VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES) {
		throw new RangeError('Video retime export canonical JSON bytes exceed their limit.');
	}
	const { clips, compiledSegmentCount } = captureClips(input, timingBySourceId);
	const fixedEnvelopeBytes = zeroCountEnvelopeBytes + numericTokenByteDelta(compiledSegmentCount);
	if (fixedEnvelopeBytes > VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES) {
		throw new RangeError('Video retime export canonical JSON bytes exceed their limit.');
	}
	const curves = createCurveContexts(clips, input.sequenceBinding.rate, input.sampleRate);
	const intersections: VideoRetimeExportIntersectionV6[] = [];
	let geometricCandidateCount = 0;
	let decimalByteCount = 0;
	let retainedRowJsonBytes = 0;
	const chargedBytes = (counts: Readonly<{
		readonly geometricCandidateCount: number;
		readonly serializedIntersectionCount: number;
		readonly decimalByteCount: number;
	}>): number => fixedEnvelopeBytes + dynamicCountByteDelta(counts) + retainedRowJsonBytes;

	const retain = (row: VideoRetimeExportIntersectionV6): void => {
		const rowDecimalBytes = videoRetimeExportDecimalTokenBytes(row);
		const nextDecimalByteCount = decimalByteCount + rowDecimalBytes;
		const rowBytes = videoRetimeCanonicalJsonByteLength(row);
		const separatorBytes = intersections.length === 0 ? 0 : 1;
		const counts = {
			geometricCandidateCount,
			serializedIntersectionCount: intersections.length + 1,
			decimalByteCount: nextDecimalByteCount,
		};
		if (chargedBytes(counts) + separatorBytes + rowBytes
			> VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES) {
			throw new RangeError('Video retime export canonical JSON bytes exceed their limit.');
		}
		decimalByteCount = nextDecimalByteCount;
		retainedRowJsonBytes += separatorBytes + rowBytes;
		intersections.push(row);
	};
	const candidate = (): void => {
		geometricCandidateCount += 1;
		if (geometricCandidateCount > MAXIMUM_GEOMETRIC_CANDIDATES) {
			throw new RangeError('Video retime export geometric candidates exceed their limit.');
		}
		const counts = {
			geometricCandidateCount,
			serializedIntersectionCount: intersections.length,
			decimalByteCount,
		};
		if (chargedBytes(counts) > VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES) {
			throw new RangeError('Video retime export canonical JSON bytes exceed their limit.');
		}
	};

	for (const [topologyIntervalIndex, interval] of input.topology.entries()) {
		for (const [layerIndex, layer] of interval.layers.entries()) {
			for (const [clipIndex, occurrence] of layer.clips.entries()) {
				const clip = videoRetimeExportRequired(clips.get(occurrence.clipId));
				assertOccurrenceInsideClip(interval, clip);
				const curve = curves.get(occurrence.clipId);
				if (!curve) {
					candidate();
					const row = createNullRow({
						clip, interval, topologyIntervalIndex, layerIndex, clipIndex,
						cadence, index: intersections.length,
					});
					if (row) retain(row);
					continue;
				}
				let segmentIndex = firstOverlappingSegment(curve.segments, interval.startSample);
				while (segmentIndex < curve.segments.length) {
					const segment = videoRetimeExportRequired(curve.segments[segmentIndex]);
					if (segment.startSample >= interval.endSample) break;
					const startSample = Math.max(interval.startSample, segment.startSample);
					const endSample = Math.min(interval.endSample, segment.endSample);
					if (endSample > startSample) {
						candidate();
						const row = createCurveRow({
							clip, curve, segment, startSample, endSample,
							topologyIntervalIndex, layerIndex, clipIndex,
							cadence, index: intersections.length,
						});
						if (row) retain(row);
					}
					segmentIndex += 1;
				}
			}
		}
	}

	const intent = deepFreeze({
		kind: 'video-retime-export-intent' as const,
		version: 6 as const,
		sampleStart: input.sampleStart,
		sampleDuration: input.sampleDuration,
		sampleRate: input.sampleRate,
		sequenceBinding: input.sequenceBinding,
		outputRate: cadence.outputRate,
		outputFrameCount: cadence.outputFrameCount,
		intersections: Object.freeze(intersections),
		limits: Object.freeze({
			topologyRecordCount: input.topologyRecordCount,
			compiledSegmentCount,
			geometricCandidateCount,
			serializedIntersectionCount: intersections.length,
			decimalByteCount,
		}),
	});
	const exactBytes = videoRetimeCanonicalJsonByteLength(intent);
	const incrementallyChargedBytes = fixedEnvelopeBytes + dynamicCountByteDelta({
		geometricCandidateCount,
		serializedIntersectionCount: intersections.length,
		decimalByteCount,
	}) + retainedRowJsonBytes;
	if (exactBytes !== incrementallyChargedBytes) {
		throw new RangeError('Video retime export incremental JSON byte accounting disagrees.');
	}
	if (exactBytes > VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES) {
		throw new RangeError('Video retime export canonical JSON bytes exceed their limit.');
	}
	const encodedBytes = new TextEncoder().encode(JSON.stringify(intent)).byteLength;
	if (encodedBytes !== exactBytes) throw new RangeError('Video retime export JSON byte accounting disagrees.');
	return intent;
}

function captureClips(
	input: CapturedVideoRetimeExportInput,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): { readonly clips: ReadonlyMap<string, ClipContext>; readonly compiledSegmentCount: number } {
	const referenced = new Set(input.topology.flatMap(({ layers }) =>
		layers.flatMap(({ clips }) => clips.map(({ clipId }) => clipId))));
	const byId = new Map<string, {
		readonly snapshot: VideoRetimeFrameClipSnapshot;
		readonly info: ReturnType<typeof videoRetimeFrameClipSnapshotInfo>;
	}>();
	const sourceIds = new Set<string>();
	let compiledSegmentCount = 0;
	for (const rawClip of input.canonicalClips) {
		const snapshot = snapshotVideoRetimeFrameClip(rawClip);
		const info = videoRetimeFrameClipSnapshotInfo(snapshot);
		if (videoRetimeCanonicalJsonByteLength(info.id) > VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES
			|| videoRetimeCanonicalJsonByteLength(info.sourceId) > VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES) {
			throw new RangeError('Video retime export string bytes exceed the canonical JSON limit.');
		}
		if (byId.has(info.id)) throw new RangeError('Video retime export canonical clip IDs must be unique.');
		if (!referenced.has(info.id)) throw new RangeError('Video retime export contains an unreferenced canonical clip.');
		if (info.sequenceId !== input.sequenceBinding.id) {
			throw new RangeError('Video retime export clips must match sequenceBinding.id.');
		}
		compiledSegmentCount += info.segmentCount;
		if (compiledSegmentCount > MAXIMUM_COMPILED_SEGMENTS) {
			throw new RangeError('Video retime export compiled segments exceed their limit.');
		}
		byId.set(info.id, { snapshot, info });
		sourceIds.add(info.sourceId);
	}
	if (byId.size !== referenced.size) throw new ReferenceError('Video retime export topology references a missing clip.');
	const timing = captureTimingMap(timingBySourceId, sourceIds);
	const clips = new Map<string, ClipContext>();
	for (const { snapshot, info } of byId.values()) {
		const token = videoRetimeExportRequired(timing.get(info.sourceId));
		const tokenInfo = boundVideoSourceTimingViewInfo(token);
		if (info.sourceOutFrame > tokenInfo.frameCount) {
			throw new RangeError('Video retime export clip source range exceeds bound timing.');
		}
		const clipStartSample = sequenceFrameBoundarySample(
			info.sequenceStartFrame, input.sequenceBinding.rate, input.sampleRate,
		);
		const clipEndSample = sequenceFrameBoundarySample(
			videoRetimeExportSafeAdd(
				info.sequenceStartFrame,
				info.outerFrameCount,
				'video retime clip sequence range',
			),
			input.sequenceBinding.rate,
			input.sampleRate,
		);
		clips.set(info.id, Object.freeze({ snapshot, info, timing: token, clipStartSample, clipEndSample }));
	}
	return { clips, compiledSegmentCount };
}

function captureTimingMap(
	value: ReadonlyMap<string, BoundVideoSourceTimingView>,
	requiredSourceIds: ReadonlySet<string>,
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	if (!(value instanceof Map)) throw new TypeError('Video retime export timing must be a ReadonlyMap.');
	const sizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
	let size: number;
	try {
		size = Number(sizeGetter?.call(value));
	} catch (error) {
		throw new TypeError('Video retime export timing must be an actual Map.', { cause: error });
	}
	if (size !== requiredSourceIds.size) {
		throw new RangeError('Video retime export timing must contain exactly the active sources.');
	}
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const [key, token] of Map.prototype.entries.call(value) as MapIterator<[
		string,
		BoundVideoSourceTimingView,
	]>) {
		const info = boundVideoSourceTimingViewInfo(token);
		if (!requiredSourceIds.has(key) || info.sourceId !== key) {
			throw new RangeError('Video retime export timing token source identity does not match.');
		}
		result.set(key, token);
	}
	return result;
}

function createCurveContexts(
	clips: ReadonlyMap<string, ClipContext>,
	rate: RationalRate,
	sampleRate: number,
): ReadonlyMap<string, CurveContext> {
	const result = new Map<string, CurveContext>();
	for (const [clipId, clip] of clips) {
		if (clip.info.mapping !== 'curve') continue;
		const binding = createVideoRetimeFrameBindingFromSnapshot(clip.snapshot, clip.timing);
		const segments = binding.segments.map((segment) => Object.freeze({
			segment,
			startSample: sequenceFrameBoundarySample(
				videoRetimeExportSafeAdd(
					clip.info.sequenceStartFrame,
					segment.startOuterCell,
					'video retime segment start',
				),
				rate,
				sampleRate,
			),
			endSample: sequenceFrameBoundarySample(
				videoRetimeExportSafeAdd(
					clip.info.sequenceStartFrame,
					segment.endOuterCell,
					'video retime segment end',
				),
				rate,
				sampleRate,
			),
		}));
		result.set(clipId, Object.freeze({ binding, segments: Object.freeze(segments) }));
	}
	return result;
}

function createNullRow(options: {
	readonly clip: ClipContext; readonly interval: VideoRetimeExportTopologyInterval;
	readonly topologyIntervalIndex: number; readonly layerIndex: number; readonly clipIndex: number;
	readonly cadence: VideoRetimeOutputCadence; readonly index: number;
}): VideoRetimeExportIntersectionV6 | null {
	const startOutputFrame = videoRetimeExportOutputBoundary(options.interval.startSample, options.cadence);
	const endOutputFrame = videoRetimeExportOutputBoundary(options.interval.endSample, options.cadence);
	if (startOutputFrame === endOutputFrame) return null;
	const sourceStartTime = videoSourceFrameTime(
		options.clip.timing,
		videoRetimeExportPosition(options.clip.info.sourceInFrame),
	);
	const sourceEndTime = videoSourceFrameTime(
		options.clip.timing,
		videoRetimeExportPosition(options.clip.info.sourceOutFrame),
	);
	return Object.freeze({
		...baseRow(options, options.interval.startSample, options.interval.endSample, startOutputFrame, endOutputFrame),
		mapping: 'uniform-wall-clock' as const,
		clipStartSample: options.clip.clipStartSample,
		clipEndSample: options.clip.clipEndSample,
		sourceStartTime: videoRetimeExportDecimal(sourceStartTime),
		sourceEndTime: videoRetimeExportDecimal(sourceEndTime),
		clippedSourceStartTime: videoRetimeExportDecimal(videoRetimeInterpolateSourceTime(
			sourceStartTime, sourceEndTime, options.interval.startSample, options.clip.clipStartSample, options.clip.clipEndSample,
		)),
		clippedSourceEndTime: videoRetimeExportDecimal(videoRetimeInterpolateSourceTime(
			sourceStartTime, sourceEndTime, options.interval.endSample, options.clip.clipStartSample, options.clip.clipEndSample,
		)),
	});
}

function createCurveRow(options: {
	readonly clip: ClipContext; readonly curve: CurveContext; readonly segment: CurveSegmentContext;
	readonly startSample: number; readonly endSample: number; readonly topologyIntervalIndex: number;
	readonly layerIndex: number; readonly clipIndex: number; readonly cadence: VideoRetimeOutputCadence;
	readonly index: number;
}): VideoRetimeExportIntersectionV6 | null {
	const startOutputFrame = videoRetimeExportOutputBoundary(options.startSample, options.cadence);
	const endOutputFrame = videoRetimeExportOutputBoundary(options.endSample, options.cadence);
	if (startOutputFrame === endOutputFrame) return null;
	const startOuterCell = videoRetimeExportRequired(options.cadence.localCellAt(
		startOutputFrame, options.clip.info.sequenceStartFrame, options.clip.info.outerFrameCount,
	));
	const endOuterCell = videoRetimeExportRequired(options.cadence.localCellAt(
		endOutputFrame - 1, options.clip.info.sequenceStartFrame, options.clip.info.outerFrameCount,
	)) + 1;
	if (startOuterCell < options.segment.segment.startOuterCell
		|| endOuterCell > options.segment.segment.endOuterCell) {
		throw new RangeError('Video retime export cadence escaped its curve segment envelope.');
	}
	const first = options.curve.binding.ownedFrameAt(startOuterCell);
	const last = options.curve.binding.ownedFrameAt(endOuterCell - 1);
	const lower = first.drawableSourceFrame <= last.drawableSourceFrame ? first : last;
	const upper = first.drawableSourceFrame <= last.drawableSourceFrame ? last : first;
	return Object.freeze({
		...baseRow(options, options.startSample, options.endSample, startOutputFrame, endOutputFrame),
		mapping: 'curve' as const,
		segmentIndex: options.segment.segment.segmentIndex,
		mode: options.segment.segment.mode,
		segmentStartOuterCell: options.segment.segment.startOuterCell,
		segmentEndOuterCell: options.segment.segment.endOuterCell,
		sourceStart: videoRetimeExportDecimal(options.segment.segment.sourceStart),
		sourceEnd: videoRetimeExportDecimal(options.segment.segment.sourceEnd),
		...(options.segment.segment.startVelocity ? {
			startVelocity: videoRetimeExportDecimal(options.segment.segment.startVelocity),
			endVelocity: videoRetimeExportDecimal(
				videoRetimeExportRequired(options.segment.segment.endVelocity),
			),
		} : {}),
		startOuterCell,
		endOuterCell,
		clippedSourceStart: videoRetimeExportDecimal(options.curve.binding.mapOuterFrame(startOuterCell)),
		clippedSourceEnd: videoRetimeExportDecimal(options.curve.binding.mapOuterFrame(endOuterCell)),
		drawableStartTime: videoRetimeExportDecimal(lower.drawableSourceStartTime),
		drawableEndTime: videoRetimeExportDecimal(upper.drawableSourceEndTime),
	});
}

function baseRow(
	options: { readonly clip: ClipContext; readonly topologyIntervalIndex: number; readonly layerIndex: number;
		readonly clipIndex: number; readonly index: number },
	startSample: number,
	endSample: number,
	startOutputFrame: number,
	endOutputFrame: number,
): VideoRetimeExportIntersectionBaseV6 {
	return {
		index: options.index,
		topologyIntervalIndex: options.topologyIntervalIndex,
		layerIndex: options.layerIndex,
		clipIndex: options.clipIndex,
		clipId: options.clip.info.id,
		sourceId: options.clip.info.sourceId,
		sequenceStartFrame: options.clip.info.sequenceStartFrame,
		outerFrameCount: options.clip.info.outerFrameCount,
		sourceInFrame: options.clip.info.sourceInFrame,
		sourceOutFrame: options.clip.info.sourceOutFrame,
		startSample, endSample, startOutputFrame, endOutputFrame,
	};
}

function intentEnvelopeBytes(
	input: CapturedVideoRetimeExportInput,
	cadence: VideoRetimeOutputCadence,
): number {
	return videoRetimeCanonicalJsonByteLength({
		kind: 'video-retime-export-intent', version: 6,
		sampleStart: input.sampleStart, sampleDuration: input.sampleDuration, sampleRate: input.sampleRate,
		sequenceBinding: input.sequenceBinding, outputRate: cadence.outputRate,
		outputFrameCount: cadence.outputFrameCount, intersections: [],
		limits: {
			topologyRecordCount: input.topologyRecordCount,
			compiledSegmentCount: 0,
			geometricCandidateCount: 0,
			serializedIntersectionCount: 0,
			decimalByteCount: 0,
		},
	});
}

function dynamicCountByteDelta(counts: Readonly<{
	readonly geometricCandidateCount: number;
	readonly serializedIntersectionCount: number;
	readonly decimalByteCount: number;
}>): number {
	return numericTokenByteDelta(counts.geometricCandidateCount)
		+ numericTokenByteDelta(counts.serializedIntersectionCount)
		+ numericTokenByteDelta(counts.decimalByteCount);
}

function numericTokenByteDelta(value: number): number { return String(value).length - 1; }

function firstOverlappingSegment(segments: readonly CurveSegmentContext[], sample: number): number {
	let lower = 0;
	let upper = segments.length;
	while (lower < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		if (videoRetimeExportRequired(segments[middle]).endSample <= sample) lower = middle + 1;
		else upper = middle;
	}
	return lower;
}

function assertOccurrenceInsideClip(interval: VideoRetimeExportTopologyInterval, clip: ClipContext): void {
	if (interval.startSample < clip.clipStartSample || interval.endSample > clip.clipEndSample) {
		throw new RangeError('Video retime export topology clip occurrence exceeds its canonical program range.');
	}
}


function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
	if (!value || typeof value !== 'object' || seen.has(value)) return value;
	seen.add(value);
	for (const nested of Object.values(value)) deepFreeze(nested, seen);
	return Object.freeze(value);
}
