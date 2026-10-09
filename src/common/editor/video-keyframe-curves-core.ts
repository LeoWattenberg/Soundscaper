/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	evaluateInterpolationCurveAtExactPosition,
	type CompiledInterpolationCurve,
} from './interpolation-curve.ts';
import {
	addRationals,
	compareRationals,
	normalizeRational,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	createVideoKeyframeTimeDomain,
	joinVideoKeyframeTimeDomains,
	mapVideoKeyframeVisiblePosition,
	normalizeVideoKeyframeTimeDomain,
	splitVideoKeyframeTimeDomain,
	stretchVideoKeyframeTimeDomain,
	trimVideoKeyframeTimeDomain,
	type VideoKeyframeTimeDomain,
	type VideoKeyframeTimeRange,
} from './video-keyframe-time-domain.ts';
import {
	VIDEO_CLIP_COMPOSITION_NUMERIC_PARAMETER_DESCRIPTORS,
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from './video-clip-composition.ts';

import { VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION, MAXIMUM_VIDEO_KEYFRAME_CURVES, VIDEO_KEYFRAME_MINIMUM_APERTURE, VIDEO_KEYFRAME_COMPOSITION_PARAMETER_IDS, type VideoKeyframeCompositionParameterId, type VideoKeyframeTarget, type VideoKeyframeCurve, type VideoKeyframeCurves, type VideoKeyframeNormalizationOptions, type EvaluatedVideoKeyframeValue, type SplitVideoKeyframeCurves } from './video-keyframe-curves-types.ts';
import { normalizeCurve, validateCurveDomain, validateCurveValues, exactRational } from './video-keyframe-curve-values.ts';

interface NumericParameterDescriptor {
	readonly minimum: number;
	readonly maximum: number;
	readonly integer: boolean;
}
interface VideoEffectParameterDescriptor {
	readonly min?: number; readonly max?: number; readonly integer?: boolean;
}
interface VideoEffectDefinition {
	readonly params: Readonly<Record<string, VideoEffectParameterDescriptor>>;
}
interface NormalizationContext {
	readonly duration: Rational;
	readonly composition: VideoClipComposition;
	readonly videoEffects: readonly ContextEffect[];
}
interface NormalizedCurveEntry extends VideoKeyframeCurve { readonly key: string }

interface ContextEffect { readonly id: string; readonly type: string; readonly enabled: boolean; readonly params: Readonly<Record<string, unknown>>; }
interface CurveOwners {
 readonly normalizeEffects: (value: unknown, name: string) => readonly ContextEffect[];
 readonly definition: (type: string) => VideoEffectDefinition;
}
/** Internal curve algorithm. Public V1/V2 wrappers pin their owning effect
 * admission; this core never converts resource references into numeric state. */
export function createVideoKeyframeCurveOwner(owners: CurveOwners) {
	const NORMALIZED_COLLECTIONS = new WeakMap<object, Readonly<{
		duration: Rational;
		timeDomain: VideoKeyframeTimeDomain;
	}>>();
	const COMPOSITION_PARAMETER_SET: ReadonlySet<string> = new Set(
		VIDEO_KEYFRAME_COMPOSITION_PARAMETER_IDS,
	);
	/** Create one contextual empty value for a fresh clip. */
	function createDefaultVideoKeyframeCurves(duration: RationalInput): VideoKeyframeCurves {
		return Object.freeze({
			schemaVersion: VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION,
			timeDomain: createVideoKeyframeTimeDomain(duration),
			curves: Object.freeze([]),
		});
	}
	function cloneVideoKeyframeCurves(
		value: unknown,
		options: VideoKeyframeNormalizationOptions | unknown,
		name = 'video keyframes',
	): VideoKeyframeCurves {
		return normalizeVideoKeyframeCurves(value, options, name);
	}
	function isDefaultVideoKeyframeCurves(
		value: unknown,
		options: VideoKeyframeNormalizationOptions | unknown,
	): boolean {
		return normalizeVideoKeyframeCurves(value, options).curves.length === 0;
	}
	function videoKeyframeCurvesEqual(
		left: unknown,
		right: unknown,
		options: VideoKeyframeNormalizationOptions | unknown,
	): boolean {
		const normalizedLeft = normalizeVideoKeyframeCurves(left, options, 'left video keyframes');
		const normalizedRight = normalizeVideoKeyframeCurves(right, options, 'right video keyframes');
		return timeDomainsEqual(normalizedLeft.timeDomain, normalizedRight.timeDomain)
			&& curveCollectionsEqual(normalizedLeft, normalizedRight);
	}
	/** Trim or extend one visible range while retaining the complete authored path. */
	function trimVideoKeyframeCurvesToRange(
		value: unknown,
		optionsValue: VideoKeyframeNormalizationOptions | unknown,
		range: VideoKeyframeTimeRange | unknown,
	): VideoKeyframeCurves {
		const context = normalizationContext(optionsValue, 'video keyframe trim context');
		const source = normalizeVideoKeyframeCurves(value, context, 'video keyframe trim source');
		const trimmed = trimVideoKeyframeTimeDomain(source.timeDomain, context.duration, range);
		return normalizeVideoKeyframeCurves(collectionSnapshot(
			source,
			trimmed.timeDomain,
			trimmed.curveOffset,
		), { ...context, duration: trimmed.duration }, 'trimmed video keyframes');
	}

	/** Split a view; both detached children retain the complete authored path. */
	function splitVideoKeyframeCurvesAt(
		value: unknown,
		optionsValue: VideoKeyframeNormalizationOptions | unknown,
		position: RationalInput,
	): SplitVideoKeyframeCurves {
		const context = normalizationContext(optionsValue, 'video keyframe split context');
		const source = normalizeVideoKeyframeCurves(value, context, 'video keyframe split source');
		const split = splitVideoKeyframeTimeDomain(source.timeDomain, context.duration, position);
		return Object.freeze({
			left: normalizeVideoKeyframeCurves(
				collectionSnapshot(source, split.left.timeDomain),
				{ ...context, duration: split.left.duration },
				'left split video keyframes',
			),
			right: normalizeVideoKeyframeCurves(
				collectionSnapshot(source, split.right.timeDomain),
				{ ...context, duration: split.right.duration },
				'right split video keyframes',
			),
		});
	}

	/** Stretch visible time without rewriting authored coordinates. */
	function stretchVideoKeyframeCurves(
		value: unknown,
		optionsValue: VideoKeyframeNormalizationOptions | unknown,
		destinationDuration: RationalInput,
	): VideoKeyframeCurves {
		const context = normalizationContext(optionsValue, 'video keyframe stretch context');
		const source = normalizeVideoKeyframeCurves(value, context, 'video keyframe stretch source');
		const timeDomain = stretchVideoKeyframeTimeDomain(source.timeDomain, destinationDuration);
		return normalizeVideoKeyframeCurves(collectionSnapshot(source, timeDomain), {
			...context,
			duration: destinationDuration,
		}, 'stretched video keyframes');
	}

	/** Rejoin two adjacent same-rate views over one byte-equivalent authored path. */
	function joinVideoKeyframeCurves(
		leftValue: unknown,
		leftOptionsValue: VideoKeyframeNormalizationOptions | unknown,
		rightValue: unknown,
		rightOptionsValue: VideoKeyframeNormalizationOptions | unknown,
	): VideoKeyframeCurves {
		const leftContext = normalizationContext(leftOptionsValue, 'left video keyframe join context');
		const rightContext = normalizationContext(rightOptionsValue, 'right video keyframe join context');
		const left = normalizeVideoKeyframeCurves(leftValue, leftContext, 'left video keyframe join source');
		const right = normalizeVideoKeyframeCurves(rightValue, rightContext, 'right video keyframe join source');
		if (!curveCollectionsEqual(left, right)) {
			throw new RangeError('Joined video keyframes must retain an identical complete authored path.');
		}
		const timeDomain = joinVideoKeyframeTimeDomains(
			left.timeDomain,
			leftContext.duration,
			right.timeDomain,
			rightContext.duration,
		);
		return normalizeVideoKeyframeCurves(collectionSnapshot(left, timeDomain), {
			...leftContext,
			duration: addRationals(leftContext.duration, rightContext.duration),
		}, 'joined video keyframes');
	}

	/** Validate one clip's persisted V1 curves into a detached canonical value. */
	function normalizeVideoKeyframeCurves(
		value: unknown,
		optionsValue: VideoKeyframeNormalizationOptions | unknown,
		name = 'video keyframes',
	): VideoKeyframeCurves {
		const context = normalizationContext(optionsValue, `${name} context`);
		const collection = readClosedDomainRecord(value, name, ['schemaVersion', 'timeDomain', 'curves']);
		if (field(collection, 'schemaVersion', name) !== VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION) {
			throw new RangeError(`${name}.schemaVersion must be 1.`);
		}
		const timeDomain = normalizeVideoKeyframeTimeDomain(field(collection, 'timeDomain', name), `${name}.timeDomain`);
		const curveValues = readClosedDomainArray(
			field(collection, 'curves', name), `${name}.curves`, 0, MAXIMUM_VIDEO_KEYFRAME_CURVES,
		);
		const entries = curveValues.map((candidate, index) => normalizeCurveEntry(
			candidate, context, timeDomain, `${name}.curves[${String(index)}]`,
		));
		entries.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
		for (let index = 1; index < entries.length; index += 1) {
			if (entries[index - 1]?.key === entries[index]?.key) {
				throw new RangeError(`${name}.curves contains a duplicate target.`);
			}
		}
		validateCropPaths(entries, context.composition, name);
		const result = Object.freeze({
			schemaVersion: VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION,
			timeDomain,
			curves: Object.freeze(entries.map(({ target, curve }) => Object.freeze({ target, curve }))),
		});
		NORMALIZED_COLLECTIONS.set(result, Object.freeze({ duration: context.duration, timeDomain }));
		return result;
	}

	/** Evaluate one visible-local position through the exact authored view map. */
	function evaluateVideoKeyframeCurves(
		value: unknown,
		positionValue: RationalInput,
	): readonly EvaluatedVideoKeyframeValue[] {
		if (!value || typeof value !== 'object') throw new TypeError('A normalized video keyframe collection is required.');
		const metadata = NORMALIZED_COLLECTIONS.get(value);
		if (!metadata) throw new TypeError('The video keyframe collection was not produced by normalization.');
		const authoredPosition = mapVideoKeyframeVisiblePosition(
			metadata.timeDomain, metadata.duration, positionValue,
		);
		const collection = value as VideoKeyframeCurves;
		return Object.freeze(collection.curves.map(({ target, curve }) => Object.freeze({
			target: cloneTarget(target),
			value: canonicalEvaluatedValue(evaluateInterpolationCurveAtExactPosition(curve, authoredPosition)),
		})));
	}

	function normalizeCurveEntry(
		value: unknown,
		context: NormalizationContext,
		timeDomain: VideoKeyframeTimeDomain,
		name: string,
	): NormalizedCurveEntry {
		const entry = readClosedDomainRecord(value, name, ['target', 'curve']);
		const normalizedTarget = normalizeTarget(field(entry, 'target', name), context, `${name}.target`);
		const curve = normalizeCurve(field(entry, 'curve', name), `${name}.curve`);
		validateCurveDomain(curve, timeDomain.authoredDuration, `${name}.curve`);
		validateCurveValues(curve, normalizedTarget.descriptor, `${name}.curve`);
		return Object.freeze({ target: normalizedTarget.target, curve, key: normalizedTarget.key });
	}

	function normalizeTarget(value: unknown, context: NormalizationContext, name: string): Readonly<{
		target: VideoKeyframeTarget;
		key: string;
		descriptor: NumericParameterDescriptor;
	}> {
		const base = readClosedDomainRecord(value, name, ['kind', 'parameterId', 'effectId'], ['kind', 'parameterId']);
		const kind = field(base, 'kind', name);
		if (kind === 'composition') {
			const target = readClosedDomainRecord(value, name, ['kind', 'parameterId']);
			const parameterId = nonEmptyString(field(target, 'parameterId', name), `${name}.parameterId`);
			if (!COMPOSITION_PARAMETER_SET.has(parameterId)) {
				throw new RangeError(`${name}.parameterId is not an interpolable numeric composition target.`);
			}
			const stableId = parameterId as VideoKeyframeCompositionParameterId;
			const owned = VIDEO_CLIP_COMPOSITION_NUMERIC_PARAMETER_DESCRIPTORS[stableId];
			return Object.freeze({
				target: Object.freeze({ kind, parameterId: stableId }),
				key: JSON.stringify([kind, stableId]),
				descriptor: descriptor(owned.minimum, owned.maximum),
			});
		}
		if (kind !== 'video-effect') throw new RangeError(`${name}.kind is unsupported.`);
		const target = readClosedDomainRecord(value, name, ['kind', 'effectId', 'parameterId']);
		const effectId = nonEmptyString(field(target, 'effectId', name), `${name}.effectId`);
		const parameterId = nonEmptyString(field(target, 'parameterId', name), `${name}.parameterId`);
		const effect = context.videoEffects.find((candidate) => candidate.id === effectId);
		if (!effect) throw new ReferenceError(`${name} references a missing video effect: ${effectId}.`);
		const parameters = effectDefinition(effect.type).params;
		if (!Object.hasOwn(parameters, parameterId)) throw new RangeError(`${name}.parameterId is not registered for video effect ${effectId}.`);
		const parameter = parameters[parameterId];
		if (!parameter) throw new Error('A registered video effect parameter descriptor is unavailable.');
		if (typeof effect.params[parameterId] !== 'number') throw new RangeError(`${name}.parameterId is not an interpolable numeric target.`);
		return Object.freeze({
			target: Object.freeze({ kind, effectId, parameterId }),
			key: JSON.stringify([kind, effectId, parameterId]),
			descriptor: descriptor(numericBound(parameter.min), numericBound(parameter.max), parameter.integer),
		});
	}
	function validateCropPaths(entries: readonly NormalizedCurveEntry[], composition: VideoClipComposition, name: string): void {
		validateCropPair(entries, 'crop.left', 'crop.right', composition.crop.left, composition.crop.right, name);
		validateCropPair(entries, 'crop.top', 'crop.bottom', composition.crop.top, composition.crop.bottom, name);
	}

	function validateCropPair(
		entries: readonly NormalizedCurveEntry[],
		firstId: 'crop.left' | 'crop.top',
		secondId: 'crop.right' | 'crop.bottom',
		firstBase: number,
		secondBase: number,
		name: string,
	): void {
		const first = compositionCurve(entries, firstId);
		const second = compositionCurve(entries, secondId);
		if (!first && !second) return;
		if (!first) return validateCropAgainstConstant(nonNullable(second), firstBase, `${name} ${firstId}/${secondId}`);
		if (!second) return validateCropAgainstConstant(first, secondBase, `${name} ${firstId}/${secondId}`);
		assertMatchingCropGeometry(first, second, `${name} ${firstId}/${secondId}`);
		for (let index = 0; index < first.anchors.length; index += 1) {
			assertCropAperture(nonNullable(first.anchors[index]).value, nonNullable(second.anchors[index]).value, name);
		}
		for (let index = 0; index < first.segments.length; index += 1) {
			const left = nonNullable(first.segments[index]);
			const right = nonNullable(second.segments[index]);
			if (left.kind !== 'bezier' || right.kind !== 'bezier') continue;
			assertCropAperture(left.control1.value, right.control1.value, name);
			assertCropAperture(left.control2.value, right.control2.value, name);
		}
	}

	function compositionCurve(entries: readonly NormalizedCurveEntry[], parameterId: VideoKeyframeCompositionParameterId): CompiledInterpolationCurve | null {
		return entries.find(({ target }) => target.kind === 'composition' && target.parameterId === parameterId)?.curve ?? null;
	}

	function validateCropAgainstConstant(curve: CompiledInterpolationCurve, constant: number, name: string): void {
		for (const anchor of curve.anchors) assertCropAperture(anchor.value, constant, name);
		for (const segment of curve.segments) {
			if (segment.kind !== 'bezier') continue;
			assertCropAperture(segment.control1.value, constant, name);
			assertCropAperture(segment.control2.value, constant, name);
		}
	}

	function assertMatchingCropGeometry(first: CompiledInterpolationCurve, second: CompiledInterpolationCurve, name: string): void {
		if (first.anchors.length !== second.anchors.length || first.segments.length !== second.segments.length) {
			throw new RangeError(`${name} crop curves must have matching anchor and segment geometry.`);
		}
		for (let index = 0; index < first.anchors.length; index += 1) {
			if (!rationalsEqual(nonNullable(first.anchors[index]).position, nonNullable(second.anchors[index]).position)) {
				throw new RangeError(`${name} crop curves must have matching anchor positions.`);
			}
		}
		for (let index = 0; index < first.segments.length; index += 1) {
			const left = nonNullable(first.segments[index]);
			const right = nonNullable(second.segments[index]);
			if (left.kind !== right.kind) throw new RangeError(`${name} crop curves must have matching segment kinds.`);
			if (left.kind !== 'bezier' || right.kind !== 'bezier') continue;
			if (!rationalsEqual(left.control1.position, right.control1.position)
				|| !rationalsEqual(left.control2.position, right.control2.position)) {
				throw new RangeError(`${name} crop curves must have matching Bezier control positions.`);
			}
		}
	}

	function assertCropAperture(first: number, second: number, name: string): void {
		if (1 - (first + second) < VIDEO_KEYFRAME_MINIMUM_APERTURE) {
			throw new RangeError(`${name} paired crop values must retain the keyframed minimum aperture.`);
		}
	}

	function normalizationContext(value: unknown, name: string): NormalizationContext {
		const options = readClosedDomainRecord(value, name, ['duration', 'composition', 'videoEffects']);
		const duration = exactRational(field(options, 'duration', name), `${name}.duration`);
		if (compareRationals(duration, 0) <= 0) throw new RangeError(`${name}.duration must be positive.`);
		return Object.freeze({
			duration,
			composition: normalizeVideoClipComposition(field(options, 'composition', name), `${name}.composition`),
			videoEffects: owners.normalizeEffects(field(options, 'videoEffects', name), `${name}.videoEffects`),
		});
	}

	function collectionSnapshot(
		source: VideoKeyframeCurves,
		timeDomain: VideoKeyframeTimeDomain,
		offset: Rational = normalizeRational(0),
	): Record<string, unknown> {
		return {
			schemaVersion: VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION,
			timeDomain,
			curves: source.curves.map(({ target, curve }) => ({
				target: cloneTarget(target),
				curve: {
					anchors: curve.anchors.map((anchor) => shiftedAnchor(anchor, offset)),
					segments: curve.segments.map((segment) => segment.kind === 'bezier' ? {
						kind: segment.kind,
						control1: shiftedAnchor(segment.control1, offset),
						control2: shiftedAnchor(segment.control2, offset),
					} : { kind: segment.kind }),
				},
			})),
		};
	}

	function curveCollectionsEqual(left: VideoKeyframeCurves, right: VideoKeyframeCurves): boolean {
		return left.curves.length === right.curves.length && left.curves.every((entry, index) => (
			curveEntriesEqual(entry, nonNullable(right.curves[index]))
		));
	}

	function curveEntriesEqual(left: VideoKeyframeCurve, right: VideoKeyframeCurve): boolean {
		if (!targetsEqual(left.target, right.target)
			|| left.curve.anchors.length !== right.curve.anchors.length
			|| left.curve.segments.length !== right.curve.segments.length) return false;
		for (let index = 0; index < left.curve.anchors.length; index += 1) {
			if (!anchorsEqual(nonNullable(left.curve.anchors[index]), nonNullable(right.curve.anchors[index]))) return false;
		}
		for (let index = 0; index < left.curve.segments.length; index += 1) {
			const first = nonNullable(left.curve.segments[index]);
			const second = nonNullable(right.curve.segments[index]);
			if (first.kind !== second.kind) return false;
			if (first.kind === 'bezier' && second.kind === 'bezier'
				&& (!anchorsEqual(first.control1, second.control1) || !anchorsEqual(first.control2, second.control2))) return false;
		}
		return true;
	}

	function timeDomainsEqual(left: VideoKeyframeTimeDomain, right: VideoKeyframeTimeDomain): boolean {
		return rationalsEqual(left.authoredDuration, right.authoredDuration)
			&& rationalsEqual(left.viewStart, right.viewStart)
			&& rationalsEqual(left.viewDuration, right.viewDuration);
	}

	function targetsEqual(left: VideoKeyframeTarget, right: VideoKeyframeTarget): boolean {
		return left.kind === right.kind && left.parameterId === right.parameterId
			&& (left.kind === 'composition' || (right.kind === 'video-effect' && left.effectId === right.effectId));
	}

	function cloneTarget(target: VideoKeyframeTarget): VideoKeyframeTarget {
		return target.kind === 'composition'
			? Object.freeze({ kind: target.kind, parameterId: target.parameterId })
			: Object.freeze({ kind: target.kind, effectId: target.effectId, parameterId: target.parameterId });
	}

	function shiftedAnchor(anchor: Readonly<{ position: Rational; value: number }>, offset: Rational): Readonly<{ position: Rational; value: number }> {
		return Object.freeze({ position: addRationals(anchor.position, offset), value: anchor.value });
	}

	function anchorsEqual(left: Readonly<{ position: Rational; value: number }>, right: Readonly<{ position: Rational; value: number }>): boolean {
		return rationalsEqual(left.position, right.position) && left.value === right.value;
	}

	function rationalsEqual(left: Rational, right: Rational): boolean {
		return left.num === right.num && left.den === right.den;
	}

	function descriptor(minimum: number, maximum: number, integer = false): NumericParameterDescriptor {
		return Object.freeze({ minimum, maximum, integer });
	}

	function effectDefinition(type: string): VideoEffectDefinition {
		return owners.definition(type);
	}

	function canonicalEvaluatedValue(value: number): number { return Object.is(value, -0) ? 0 : value; }
	function field(record: ClosedDomainRecord, key: string, name: string): unknown { return readClosedDomainField(record, key, name); }
	function nonEmptyString(value: unknown, name: string): string {
		if (typeof value !== 'string' || !value.length) throw new TypeError(`${name} must be a non-empty string.`);
		return value;
	}
	function nonNullable<Value>(value: Value | null | undefined): Value {
		if (value === null || value === undefined) throw new Error('Expected a bounded collection value.');
		return value;
	}

	function numericBound(value: number | undefined): number {
		if (typeof value !== 'number') throw new RangeError('The numeric target requires registered numeric bounds.');
		return value;
	}

	return Object.freeze({ createDefaultVideoKeyframeCurves, cloneVideoKeyframeCurves, isDefaultVideoKeyframeCurves, videoKeyframeCurvesEqual, trimVideoKeyframeCurvesToRange, splitVideoKeyframeCurvesAt, stretchVideoKeyframeCurves, joinVideoKeyframeCurves, normalizeVideoKeyframeCurves, evaluateVideoKeyframeCurves });
}
