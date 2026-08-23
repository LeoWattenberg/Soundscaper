/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSetVideoKeyframesCommand } from '../commands/factories.ts';
import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../closed-domain-value.ts';
import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../edit-blocking.ts';
import type { InterpolationShape } from '../interpolation-curve.ts';
import {
	compareRationalSum,
	compareRationals,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	subtractRationals,
	type Rational,
	type RationalInput,
} from '../timeline-time.ts';
import {
	VIDEO_CLIP_COMPOSITION_NUMERIC_PARAMETER_DESCRIPTORS,
	normalizeVideoClipComposition,
	type VideoClipComposition,
	type VideoClipCompositionNumericParameterId,
} from '../video-clip-composition.ts';
import {
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
	type VideoKeyframeTarget,
} from '../video-keyframe-curves.ts';
import { isFramescaperVideoKeyframeProjectSchema } from '../project-schema-version.ts';
import { mapVideoKeyframeVisiblePosition } from '../video-keyframe-time-domain.ts';
import { normalizeVideoEffects, videoEffectDefinition } from '../video-effects.js';
import {
	canonicalVideoKeyframeUiString as canonicalString,
	nonNegativeVideoKeyframeUiInteger as nonNegativeSafeInteger,
	ordinaryVideoKeyframeUiRecord as ordinaryRecord,
	ordinaryVideoKeyframeUiRecords as ordinaryRecords,
	positiveVideoKeyframeUiInteger as positiveSafeInteger,
	requiredVideoKeyframeUiDataProperty as requiredDataProperty,
	safeVideoKeyframeUiDataProperty as safeDataProperty,
	videoKeyframeUiStringArray as stringArray,
	type VideoKeyframeUiDataRecord as DataRecord,
} from './video-keyframe-dialog-input.ts';

type MutableRecord = Record<string, unknown>;
type BlockReason = 'unsupported' | 'no-video-clip' | 'read-only' | 'busy' | 'locked';

interface VideoEffectParameterDescriptor {
	readonly label: string;
	readonly labelKey: string;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly integer: boolean;
}

interface VideoEffectDefinition {
	readonly label: string;
	readonly params: Readonly<Record<string, VideoEffectParameterDescriptor>>;
}

interface NormalizedVideoEffect {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, number>>;
}

export interface VideoKeyframeDialogModelInput {
	readonly productId: string; readonly capability: boolean; readonly project: unknown;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<{
		readonly selectedClipId?: unknown;
	}>;
}

export interface VideoKeyframeDialogModel {
	readonly clipId: string | null;
	readonly clipName: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly composition: VideoClipComposition | null;
	readonly videoEffects: readonly NormalizedVideoEffect[];
	readonly keyframes: VideoKeyframeCurves | null;
	readonly operationsBlocked: boolean;
	readonly blockReason: BlockReason | null;
}

export interface VideoKeyframeTargetChoice {
	readonly key: string;
	readonly target: VideoKeyframeTarget;
	readonly labelKey: string;
	readonly fallbackLabel: string;
	readonly minimum: number;
	readonly maximum: number;
	readonly step: number;
	readonly integer: boolean;
	readonly baseValue: number;
}

export interface VideoKeyframeVisibleAnchor {
	readonly position: RationalInput; readonly value: number;
}

export type VideoKeyframeVisibleSegment = Readonly<
	| { readonly kind: 'hold' | 'linear' | 'eased' }
	| {
		readonly kind: 'bezier';
		readonly control1: VideoKeyframeVisibleAnchor;
		readonly control2: VideoKeyframeVisibleAnchor;
	}
>;

export interface CreateVideoKeyframeCurveInput {
	readonly target: VideoKeyframeTarget; readonly start: VideoKeyframeVisibleAnchor;
	readonly end: VideoKeyframeVisibleAnchor; readonly segment: VideoKeyframeVisibleSegment;
}

export interface AddVideoKeyframeAnchorInput {
	readonly target: VideoKeyframeTarget; readonly position: RationalInput; readonly value: number;
	readonly incomingSegment?: VideoKeyframeVisibleSegment;
	readonly outgoingSegment?: VideoKeyframeVisibleSegment;
}

export interface UpdateVideoKeyframeAnchorInput {
	readonly target: VideoKeyframeTarget; readonly anchorIndex: number;
	readonly position: RationalInput; readonly value: number;
}

export interface RemoveVideoKeyframeAnchorInput {
	readonly target: VideoKeyframeTarget; readonly anchorIndex: number;
	readonly bridgeSegment?: VideoKeyframeVisibleSegment;
}

export interface SetVideoKeyframeSegmentInput {
	readonly target: VideoKeyframeTarget; readonly segmentIndex: number;
	readonly segment: VideoKeyframeVisibleSegment;
}

interface EditableModel extends VideoKeyframeDialogModel {
	readonly clipId: string;
	readonly composition: VideoClipComposition;
	readonly keyframes: VideoKeyframeCurves;
}

const COMPOSITION_LABELS = Object.freeze({
	'crop.left': ['videoKeyframeTargetCropLeft', 'Crop left'],
	'crop.top': ['videoKeyframeTargetCropTop', 'Crop top'],
	'crop.right': ['videoKeyframeTargetCropRight', 'Crop right'],
	'crop.bottom': ['videoKeyframeTargetCropBottom', 'Crop bottom'],
	'transform.anchorX': ['videoKeyframeTargetAnchorX', 'Anchor X'],
	'transform.anchorY': ['videoKeyframeTargetAnchorY', 'Anchor Y'],
	'transform.positionX': ['videoKeyframeTargetPositionX', 'Position X'],
	'transform.positionY': ['videoKeyframeTargetPositionY', 'Position Y'],
	'transform.scaleX': ['videoKeyframeTargetScaleX', 'Scale X'],
	'transform.scaleY': ['videoKeyframeTargetScaleY', 'Scale Y'],
	'transform.rotationDegrees': ['videoKeyframeTargetRotation', 'Rotation'],
	opacity: ['videoKeyframeTargetOpacity', 'Opacity'],
} as const satisfies Readonly<Record<VideoClipCompositionNumericParameterId, readonly [string, string]>>);

/** Resolve one selected keyframe-route timeline occurrence without selecting a route. */
export function createVideoKeyframeDialogModel(
	input: VideoKeyframeDialogModelInput,
): Readonly<VideoKeyframeDialogModel> {
	if (input.productId !== 'framescaper' || !input.capability) return emptyModel('unsupported');
	const project = ordinaryRecord(input.project);
	if (!project || !isFramescaperVideoKeyframeProjectSchema(safeDataProperty(project, 'schemaVersion'))) return emptyModel('unsupported');
	let selected: Readonly<EditableModel> | null;
	try {
		selected = selectedVideo(project, input.snapshot.selectedClipId);
	} catch {
		selected = null;
	}
	if (!selected) return emptyModel('no-video-clip');
	const editBlock = selectAudioEditorEditBlock(input.snapshot);
	const blockReason = selected.blockReason === 'locked'
		? 'locked' as const
		: editBlock.blocked
			? editBlock.reason === 'read-only' ? 'read-only' as const : 'busy' as const
			: null;
	return Object.freeze({
		...selected,
		operationsBlocked: blockReason !== null,
		blockReason,
	});
}

/** Enumerate only numeric composition properties and parameters registered by owned effects. */
export function listVideoKeyframeTargetChoices(
	modelValue: VideoKeyframeDialogModel,
): readonly Readonly<VideoKeyframeTargetChoice>[] {
	const model = editableModel(modelValue);
	const compositionChoices = Object.entries(VIDEO_CLIP_COMPOSITION_NUMERIC_PARAMETER_DESCRIPTORS)
		.map(([parameterId, descriptor]) => {
			const stableId = parameterId as VideoClipCompositionNumericParameterId;
			const [labelKey, fallbackLabel] = COMPOSITION_LABELS[stableId];
			return Object.freeze({
				key: videoKeyframeTargetKey({ kind: 'composition', parameterId: stableId }),
				target: Object.freeze({ kind: 'composition' as const, parameterId: stableId }),
				labelKey, fallbackLabel,
				minimum: descriptor.minimum,
				maximum: descriptor.maximum,
				step: stableId === 'transform.rotationDegrees' ? 1 : 0.01,
				integer: false,
				baseValue: compositionValue(model.composition, stableId),
			});
		});
	const effectChoices = model.videoEffects.flatMap((effect) => {
		const definition = videoEffectDefinition(effect.type) as VideoEffectDefinition;
		return Object.entries(definition.params).map(([parameterId, descriptor]) => Object.freeze({
			key: videoKeyframeTargetKey({ kind: 'video-effect', effectId: effect.id, parameterId }),
			target: Object.freeze({ kind: 'video-effect' as const, effectId: effect.id, parameterId }),
			labelKey: descriptor.labelKey,
			fallbackLabel: `${definition.label} — ${descriptor.label}`,
			minimum: descriptor.min,
			maximum: descriptor.max,
			step: descriptor.step,
			integer: descriptor.integer,
			baseValue: requiredNumber(effect.params[parameterId], `video effect ${effect.id}.${parameterId}`),
		}));
	});
	return Object.freeze([...compositionChoices, ...effectChoices]);
}

/** Invert the exact affine view map for an authored anchor inside the visible window. */
export function visiblePositionForVideoKeyframeAnchor(
	modelValue: VideoKeyframeDialogModel,
	authoredPositionValue: RationalInput,
): Rational | null {
	const model = editableModel(modelValue);
	const authoredPosition = safeRational(authoredPositionValue, 'authored keyframe position');
	const { viewStart, viewDuration } = model.keyframes.timeDomain;
	if (compareRationals(authoredPosition, viewStart) < 0
		|| compareRationalSum(viewStart, viewDuration, authoredPosition) < 0) return null;
	return multiplyRationals(
		divideRationals(subtractRationals(authoredPosition, viewStart), viewDuration),
		rationalDuration(model),
	);
}

/** Create a curve from two explicitly authored visible-local points. */
export function createVideoKeyframeCurve(
	modelValue: VideoKeyframeDialogModel,
	input: CreateVideoKeyframeCurveInput,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const target = canonicalTarget(input.target);
	if (curveIndex(model, target) >= 0) throw new RangeError('The video keyframe target already has a curve.');
	return normalizeCandidate(model, [...wireCurves(model.keyframes), {
		target,
		curve: {
			anchors: [authoredAnchor(model, input.start), authoredAnchor(model, input.end)],
			segments: [authoredSegment(model, input.segment)],
		},
	}]);
}

/** Insert one explicit point and explicit adjacent segment shapes. */
export function addVideoKeyframeAnchor(
	modelValue: VideoKeyframeDialogModel,
	input: AddVideoKeyframeAnchorInput,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const located = requiredCurve(model, input.target);
	const anchor = authoredAnchor(model, { position: input.position, value: input.value });
	const anchors = located.curve.anchors.map(cloneAnchor);
	const segments = located.curve.segments.map(cloneSegment);
	const insertion = anchors.findIndex(({ position }) => compareRationals(anchor.position, position) < 0);
	if (anchors.some(({ position }) => compareRationals(anchor.position, position) === 0)) {
		throw new RangeError('A video keyframe anchor already exists at that exact position.');
	}
	const index = insertion < 0 ? anchors.length : insertion;
	anchors.splice(index, 0, anchor);
	if (index === 0) segments.unshift(authoredSegment(model, requiredSegment(input.outgoingSegment)));
	else if (index === anchors.length - 1) segments.push(authoredSegment(model, requiredSegment(input.incomingSegment)));
	else segments.splice(index - 1, 1,
		authoredSegment(model, requiredSegment(input.incomingSegment)),
		authoredSegment(model, requiredSegment(input.outgoingSegment)));
	return replaceCurve(model, located.index, { target: located.target, curve: { anchors, segments } });
}

/** Move or change one point while preserving every explicitly authored segment. */
export function updateVideoKeyframeAnchor(
	modelValue: VideoKeyframeDialogModel,
	input: UpdateVideoKeyframeAnchorInput,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const located = requiredCurve(model, input.target);
	const anchors = located.curve.anchors.map(cloneAnchor);
	const index = boundedIndex(input.anchorIndex, anchors.length, 'video keyframe anchor');
	anchors[index] = authoredAnchor(model, { position: input.position, value: input.value });
	return replaceCurve(model, located.index, {
		target: located.target,
		curve: { anchors, segments: located.curve.segments.map(cloneSegment) },
	});
}

/** Remove one point; a middle removal requires its replacement segment explicitly. */
export function removeVideoKeyframeAnchor(
	modelValue: VideoKeyframeDialogModel,
	input: RemoveVideoKeyframeAnchorInput,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const located = requiredCurve(model, input.target);
	if (located.curve.anchors.length <= 2) {
		throw new RangeError('Remove the curve instead of reducing it below two anchors.');
	}
	const anchors = located.curve.anchors.map(cloneAnchor);
	const segments = located.curve.segments.map(cloneSegment);
	const index = boundedIndex(input.anchorIndex, anchors.length, 'video keyframe anchor');
	anchors.splice(index, 1);
	if (index === 0) segments.shift();
	else if (index === anchors.length) segments.pop();
	else segments.splice(index - 1, 2, authoredSegment(model, requiredSegment(input.bridgeSegment)));
	return replaceCurve(model, located.index, { target: located.target, curve: { anchors, segments } });
}

/** Replace one segment, including exact visible-local Bezier controls. */
export function setVideoKeyframeSegment(
	modelValue: VideoKeyframeDialogModel,
	input: SetVideoKeyframeSegmentInput,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const located = requiredCurve(model, input.target);
	const segments = located.curve.segments.map(cloneSegment);
	const index = boundedIndex(input.segmentIndex, segments.length, 'video keyframe segment');
	segments[index] = authoredSegment(model, input.segment);
	return replaceCurve(model, located.index, {
		target: located.target,
		curve: { anchors: located.curve.anchors.map(cloneAnchor), segments },
	});
}

export function removeVideoKeyframeCurve(
	modelValue: VideoKeyframeDialogModel,
	targetValue: VideoKeyframeTarget,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const index = curveIndex(model, canonicalTarget(targetValue));
	if (index < 0) throw new ReferenceError('The video keyframe curve is missing.');
	const curves = wireCurves(model.keyframes);
	curves.splice(index, 1);
	return normalizeCandidate(model, curves);
}

/** Bind the immutable optimistic snapshot to the shared command authority. */
export function createVideoKeyframeSetCommand(
	modelValue: VideoKeyframeDialogModel,
	keyframesValue: unknown,
) {
	const model = editableModel(modelValue);
	const keyframes = normalizeVideoKeyframeCurves(keyframesValue, normalizationContext(model));
	return createSetVideoKeyframesCommand(model.clipId, model.keyframes, keyframes);
}

function selectedVideo(project: DataRecord, selectedClipId: unknown): Readonly<EditableModel> | null {
	const clips = ordinaryRecords(requiredDataProperty(project, 'clips', 'project'), 'project.clips');
	const tracks = ordinaryRecords(requiredDataProperty(project, 'tracks', 'project'), 'project.tracks');
	const selectedIds = selectedVideoIds(project, clips, selectedClipId);
	if (selectedIds.length !== 1) return null;
	const clip = clips.find((candidate) => (
		requiredDataProperty(candidate, 'id', 'clip') === selectedIds[0]
			&& requiredDataProperty(candidate, 'kind', 'clip') === 'video'
	));
	if (!clip) return null;
	const owners = tracks.filter((track) => (
		requiredDataProperty(track, 'type', 'track') === 'video'
			&& stringArray(requiredDataProperty(track, 'clipIds', 'track'), 'track.clipIds').includes(selectedIds[0]!)
	));
	if (owners.length !== 1) return null;
	const clipId = canonicalString(requiredDataProperty(clip, 'id', 'video clip'), 'video clip.id');
	const sequenceStartFrame = nonNegativeSafeInteger(requiredDataProperty(clip, 'sequenceStartFrame', `video clip ${clipId}`), 'sequenceStartFrame');
	const sequenceFrameCount = positiveSafeInteger(requiredDataProperty(clip, 'sequenceFrameCount', `video clip ${clipId}`), 'sequenceFrameCount');
	const composition = normalizeVideoClipComposition(requiredDataProperty(clip, 'videoComposition', `video clip ${clipId}`));
	const videoEffects = Object.freeze((normalizeVideoEffects(
		requiredDataProperty(clip, 'videoEffects', `video clip ${clipId}`),
		`video clip ${clipId}.videoEffects`,
	) as NormalizedVideoEffect[]).map((effect) => Object.freeze({
		id: effect.id, type: effect.type, enabled: effect.enabled,
		params: Object.freeze({ ...effect.params }),
	})));
	const keyframes = normalizeVideoKeyframeCurves(
		requiredDataProperty(clip, 'videoKeyframes', `video clip ${clipId}`),
		{ duration: rational(sequenceFrameCount), composition, videoEffects },
		`video clip ${clipId}.videoKeyframes`,
	);
	return Object.freeze({
		clipId,
		clipName: String(safeDataProperty(clip, 'title') ?? safeDataProperty(clip, 'name') ?? clipId),
		sequenceStartFrame,
		sequenceFrameCount,
		composition,
		videoEffects,
		keyframes,
		operationsBlocked: requiredDataProperty(owners[0]!, 'locked', 'video track') === true,
		blockReason: requiredDataProperty(owners[0]!, 'locked', 'video track') === true ? 'locked' : null,
	});
}

function selectedVideoIds(project: DataRecord, clips: readonly DataRecord[], focused: unknown): readonly string[] {
	const selectionValue = safeDataProperty(project, 'selection');
	const selection = selectionValue === undefined ? null : ordinaryRecord(selectionValue);
	const selected = selection ? stringArray(requiredDataProperty(selection, 'clipIds', 'project.selection'), 'project.selection.clipIds') : [];
	if (selected.length === 0) return typeof focused === 'string' ? Object.freeze([focused]) : Object.freeze([]);
	if (typeof focused === 'string' && selected.includes(focused)) {
		const focusedClip = clips.find((clip) => safeDataProperty(clip, 'id') === focused);
		const videoCount = selected.filter((id) => clips.some((clip) => (
			safeDataProperty(clip, 'id') === id && safeDataProperty(clip, 'kind') === 'video'
		))).length;
		if (safeDataProperty(focusedClip ?? {}, 'kind') === 'video' && videoCount === 1) return Object.freeze([focused]);
	}
	return selected;
}

function replaceCurve(model: EditableModel, index: number, curve: MutableRecord): VideoKeyframeCurves {
	const curves = wireCurves(model.keyframes);
	curves[index] = curve;
	return normalizeCandidate(model, curves);
}

function normalizeCandidate(model: EditableModel, curves: readonly unknown[]): VideoKeyframeCurves {
	return normalizeVideoKeyframeCurves({
		schemaVersion: 1,
		timeDomain: model.keyframes.timeDomain,
		curves,
	}, normalizationContext(model), 'edited video keyframes');
}

function normalizationContext(model: EditableModel) {
	return Object.freeze({
		duration: rationalDuration(model),
		composition: model.composition,
		videoEffects: model.videoEffects,
	});
}

function requiredCurve(model: EditableModel, targetValue: VideoKeyframeTarget) {
	const target = canonicalTarget(targetValue);
	const index = curveIndex(model, target);
	if (index < 0) throw new ReferenceError('The video keyframe curve is missing.');
	const entry = model.keyframes.curves[index];
	if (!entry) throw new Error('The bounded video keyframe curve is unavailable.');
	return { index, target, curve: entry.curve };
}

function curveIndex(model: EditableModel, target: VideoKeyframeTarget): number {
	const key = videoKeyframeTargetKey(target);
	return model.keyframes.curves.findIndex((entry) => videoKeyframeTargetKey(entry.target) === key);
}

function authoredAnchor(model: EditableModel, value: VideoKeyframeVisibleAnchor): Readonly<{ position: Rational; value: number }> {
	const anchor = readClosedDomainRecord(value, 'visible video keyframe anchor', ['position', 'value']);
	return Object.freeze({
		position: mapVideoKeyframeVisiblePosition(
			model.keyframes.timeDomain,
			rationalDuration(model),
			field(anchor, 'position', 'visible video keyframe anchor') as RationalInput,
		),
		value: requiredNumber(field(anchor, 'value', 'visible video keyframe anchor'), 'video keyframe value'),
	});
}

function authoredSegment(model: EditableModel, value: VideoKeyframeVisibleSegment): InterpolationShape {
	const base = readClosedDomainRecord(value, 'visible video keyframe segment', ['kind', 'control1', 'control2'], ['kind']);
	const kind = field(base, 'kind', 'visible video keyframe segment');
	if (kind === 'hold' || kind === 'linear' || kind === 'eased') return Object.freeze({ kind });
	if (kind !== 'bezier') throw new RangeError('The video keyframe segment kind is unsupported.');
	const bezier = readClosedDomainRecord(value, 'visible video keyframe segment', ['kind', 'control1', 'control2']);
	return Object.freeze({
		kind,
		control1: authoredAnchor(model, field(bezier, 'control1', 'visible video keyframe segment') as VideoKeyframeVisibleAnchor),
		control2: authoredAnchor(model, field(bezier, 'control2', 'visible video keyframe segment') as VideoKeyframeVisibleAnchor),
	});
}

function wireCurves(keyframes: VideoKeyframeCurves): MutableRecord[] {
	return keyframes.curves.map(({ target, curve }) => ({
		target: cloneTarget(target),
		curve: {
			anchors: curve.anchors.map(cloneAnchor),
			segments: curve.segments.map(cloneSegment),
		},
	}));
}

function cloneAnchor(anchor: Readonly<{ position: Rational; value: number }>) {
	return { position: { num: anchor.position.num, den: anchor.position.den }, value: anchor.value };
}

function cloneSegment(segment: InterpolationShape) {
	return segment.kind === 'bezier'
		? { kind: segment.kind, control1: cloneAnchor(segment.control1), control2: cloneAnchor(segment.control2) }
		: { kind: segment.kind };
}

function canonicalTarget(value: VideoKeyframeTarget): VideoKeyframeTarget {
	const base = readClosedDomainRecord(value, 'video keyframe target', ['kind', 'effectId', 'parameterId'], ['kind', 'parameterId']);
	const kind = field(base, 'kind', 'video keyframe target');
	const parameterId = canonicalString(field(base, 'parameterId', 'video keyframe target'), 'target.parameterId');
	if (kind === 'composition') {
		return Object.freeze({ kind, parameterId: parameterId as VideoClipCompositionNumericParameterId });
	}
	if (kind !== 'video-effect') throw new RangeError('The video keyframe target kind is unsupported.');
	const exact = readClosedDomainRecord(value, 'video keyframe target', ['kind', 'effectId', 'parameterId']);
	return Object.freeze({
		kind,
		effectId: canonicalString(field(exact, 'effectId', 'video keyframe target'), 'target.effectId'),
		parameterId,
	});
}

function cloneTarget(target: VideoKeyframeTarget): MutableRecord {
	return target.kind === 'composition'
		? { kind: target.kind, parameterId: target.parameterId }
		: { kind: target.kind, effectId: target.effectId, parameterId: target.parameterId };
}

export function videoKeyframeTargetKey(target: VideoKeyframeTarget): string {
	const canonical = canonicalTarget(target);
	return canonical.kind === 'composition'
		? JSON.stringify([canonical.kind, canonical.parameterId])
		: JSON.stringify([canonical.kind, canonical.effectId, canonical.parameterId]);
}

function compositionValue(composition: VideoClipComposition, id: VideoClipCompositionNumericParameterId): number {
	switch (id) {
		case 'crop.left': return composition.crop.left;
		case 'crop.top': return composition.crop.top;
		case 'crop.right': return composition.crop.right;
		case 'crop.bottom': return composition.crop.bottom;
		case 'transform.anchorX': return composition.transform.anchorX;
		case 'transform.anchorY': return composition.transform.anchorY;
		case 'transform.positionX': return composition.transform.positionX;
		case 'transform.positionY': return composition.transform.positionY;
		case 'transform.scaleX': return composition.transform.scaleX;
		case 'transform.scaleY': return composition.transform.scaleY;
		case 'transform.rotationDegrees': return composition.transform.rotationDegrees;
		case 'opacity': return composition.opacity;
	}
}

function editableModel(value: VideoKeyframeDialogModel): EditableModel {
	if (!value.clipId || !value.composition || !value.keyframes || value.sequenceFrameCount <= 0) {
		throw new TypeError('An editable V20 video keyframe model is required.');
	}
	return value as EditableModel;
}

function emptyModel(blockReason: BlockReason): Readonly<VideoKeyframeDialogModel> {
	return Object.freeze({
		clipId: null,
		clipName: '',
		sequenceStartFrame: 0,
		sequenceFrameCount: 0,
		composition: null,
		videoEffects: Object.freeze([]),
		keyframes: null,
		operationsBlocked: true,
		blockReason,
	});
}

function requiredSegment(value: VideoKeyframeVisibleSegment | undefined): VideoKeyframeVisibleSegment {
	if (!value) throw new TypeError('An explicit video keyframe segment is required.');
	return value;
}

function boundedIndex(value: number, length: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
		throw new RangeError(`${name} index is outside its bounded collection.`);
	}
	return value;
}

function safeRational(value: RationalInput, name: string): Rational {
	if (typeof value === 'number') return normalizeRational(value);
	const record = readClosedDomainRecord(value, name, ['num', 'den']);
	return normalizeRational({
		num: field(record, 'num', name) as number,
		den: field(record, 'den', name) as number,
	});
}

function rationalDuration(model: VideoKeyframeDialogModel): Rational {
	return rational(model.sequenceFrameCount);
}

function rational(num: number): Rational { return Object.freeze({ num, den: 1 }); }

function requiredNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new TypeError(`${name} must be a finite number without negative zero.`);
	}
	return value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
