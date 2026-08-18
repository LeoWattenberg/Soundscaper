/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	assertNearly,
	boundedSafeInteger,
	canonicalFinite,
	dataRecord,
	field,
	nearPositiveSafeInteger,
	nonEmptyString,
	nonNegativeNumber,
	nonNegativeSafeInteger,
	numberToken,
	planNumber,
	positiveNumber,
	positiveSafeInteger,
	unitNumber,
	type DataRecord,
} from './video-ffmpeg-plan-guards.ts';
import {
	isVideoCanvasFit,
	resolveVideoCanvasPlacement,
	type VideoCanvasFit,
} from './video-canvas-fit.ts';
import { VIDEO_CLIP_COMPOSITION_BLEND_MODES, type VideoClipCompositionBlendMode } from './video-clip-composition.ts';
import type { VideoRenderDescription } from './video-render-description.ts';
import { normalizeVideoEffects, VIDEO_EFFECT_V5_TYPES } from './video-effects.js';
import {
	nearlyEqualVideoFfmpegScalar,
	withinAuthoredVideoFfmpegScale,
} from './video-ffmpeg-scale-admission.ts';

const DESCRIPTION_FIELDS = Object.freeze([
	'crop', 'sourceDisplayToCanvas', 'opacityStart', 'opacityEnd', 'blendMode', 'compositingOrder',
]);
const CROP_FIELDS = Object.freeze(['normalized', 'sourcePixels']);
const NORMALIZED_CROP_FIELDS = Object.freeze(['left', 'top', 'right', 'bottom']);
const SOURCE_PIXEL_CROP_FIELDS = Object.freeze(['x', 'y', 'width', 'height']);
const BLEND_MODES: ReadonlySet<string> = new Set(VIDEO_CLIP_COMPOSITION_BLEND_MODES);
const MINIMUM_COMPOSITING_ORDER = -32_768;
const MAXIMUM_COMPOSITING_ORDER = 32_767;

export interface VideoFfmpegCanvas {
	readonly width: number;
	readonly height: number;
	/** Absent means `contain`, the placement every canvas meant before delivery fit. */
	readonly fit?: VideoCanvasFit;
}

interface RenderInternals {
	readonly fittedWidth: number;
	readonly fittedHeight: number;
	readonly fittedX: number;
	readonly fittedY: number;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly flipHorizontal: boolean;
	readonly flipVertical: boolean;
	readonly rotationRadians: number;
	readonly outputCenterX: number;
	readonly outputCenterY: number;
	readonly identityGeometry: boolean;
}

const TRUSTED_DESCRIPTIONS = new WeakMap<object, RenderInternals>();


/** Normalize V2-V6 composition intervals, with V6 descriptor/order authority. */
export function normalizeVideoFfmpegCompositionIntervals(
	planValue: unknown,
	inputsValue: readonly unknown[],
	durationSeconds: number,
	canvas: VideoFfmpegCanvas,
): readonly DataRecord[] {
	const plan = dataRecord(planValue, 'video export plan');
	const version = positiveSafeInteger(plan.version, 'plan.version');
	const inputs = inputsValue.map((value, index) => dataRecord(value, `plan.inputs[${String(index)}]`));
	if (!Array.isArray(plan.intervals) || plan.intervals.length === 0) {
		throw new RangeError('Video export plan must contain at least one composition interval.');
	}
	const intervals = plan.intervals.map((value, intervalIndex) => {
		const name = `plan.intervals[${String(intervalIndex)}]`;
		const interval = dataRecord(value, name);
		const duration = positiveNumber(planNumber(interval.durationSeconds, version), `${name}.durationSeconds`);
		if (!Array.isArray(interval.layers)) throw new TypeError(`${name}.layers must be an array.`);
		if (interval.kind === 'black') {
			if (interval.layers.length !== 0) {
				throw new RangeError(`${name} black intervals cannot contain video layers.`);
			}
			return { kind: 'black', color: interval.color, durationSeconds: duration, layers: [] };
		}
		if (interval.kind !== 'composition') {
			throw new TypeError(`Unsupported video composition interval kind: ${String(interval.kind)}.`);
		}
		if (interval.layers.length === 0) {
			throw new RangeError(`${name} composition intervals must contain at least one video layer.`);
		}
		const trackIds = new Set<string>();
		const trackIndexes = new Set<number>();
		const layers = interval.layers.map((trackValue, trackIndex) => {
			const trackName = `${name}.layers[${String(trackIndex)}]`;
			const track = dataRecord(trackValue, trackName);
			const trackId = nonEmptyString(track.trackId, `${trackName}.trackId`);
			if (trackIds.has(trackId)) throw new RangeError(`${name} contains duplicate track ${trackId}.`);
			trackIds.add(trackId);
			const projectTrackIndex = version < 6
				? null : nonNegativeSafeInteger(track.trackIndex, `${trackName}.trackIndex`);
			if (projectTrackIndex !== null && trackIndexes.has(projectTrackIndex))
				throw new RangeError(`${name} contains duplicate track index ${String(projectTrackIndex)}.`);
			if (projectTrackIndex !== null) trackIndexes.add(projectTrackIndex);
			if (!Array.isArray(track.clips) || track.clips.length < 1 || track.clips.length > 2) {
				throw new RangeError(`${trackName}.clips must contain one or two video clips.`);
			}
			const clips = track.clips.map((clip, clipIndex) => normalizeCompositionClip(
				clip,
				`${trackName}.clips[${String(clipIndex)}]`,
				inputs,
				version,
				canvas,
			));
			if (clips.length === 1 && clips[0]!.role !== 'single') {
				throw new TypeError(`${trackName} single-clip layers must use the single role.`);
			}
			if (clips.length === 2) {
				if (clips[0]!.role !== 'outgoing' || clips[1]!.role !== 'incoming') {
					throw new TypeError(`${trackName} crossfades must order outgoing then incoming clips.`);
				}
				if (version < 6 && (
					!nearlyEqualVideoFfmpegScalar(clips[0]!.opacityStart + clips[1]!.opacityStart, 1)
					|| !nearlyEqualVideoFfmpegScalar(clips[0]!.opacityEnd + clips[1]!.opacityEnd, 1)
				)) throw new RangeError(`${trackName} crossfade opacities must be complementary.`);
				if (version >= 6 && (
					clips[0]!.renderDescription?.blendMode !== clips[1]!.renderDescription?.blendMode
					|| clips[0]!.renderDescription?.compositingOrder
						!== clips[1]!.renderDescription?.compositingOrder
				)) throw new RangeError(`${trackName} transition render descriptions must share blend and order.`);
			}
			return { trackId, ...(projectTrackIndex === null ? {} : { trackIndex: projectTrackIndex }), clips };
		});
		if (version >= 6) for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
			const previous = layers[layerIndex - 1]!.clips[0]!.renderDescription!;
			const current = layers[layerIndex]!.clips[0]!.renderDescription!;
			if (previous.compositingOrder > current.compositingOrder) {
				throw new RangeError(`${name} layers must be in ascending compositing order.`);
			}
			if (previous.compositingOrder === current.compositingOrder
				&& layers[layerIndex - 1]!.trackIndex! <= layers[layerIndex]!.trackIndex!)
				throw new RangeError(`${name} layers must use descending track index tie order.`);
		}
		return { kind: 'composition', color: interval.color, durationSeconds: duration, layers };
	});
	const totalDuration = intervals.reduce((total, interval) => total + Number(interval.durationSeconds), 0);
	if (!nearlyEqualVideoFfmpegScalar(totalDuration, durationSeconds)) {
		throw new RangeError('Video composition interval durations must equal plan.durationSeconds.');
	}
	return intervals;
}

interface NormalizedCompositionClip extends DataRecord {
	readonly role: string;
	readonly inputIndex: number;
	readonly sourceStartTimeSeconds: number;
	readonly sourceEndTimeSeconds: number;
	readonly playbackRate: number;
	readonly opacityStart: number;
	readonly opacityEnd: number;
	readonly renderDescription?: VideoRenderDescription;
}

function normalizeCompositionClip(
	clipValue: unknown,
	name: string,
	inputs: readonly DataRecord[],
	version: number,
	canvas: VideoFfmpegCanvas,
): NormalizedCompositionClip {
	const clip = dataRecord(clipValue, name);
	const inputIndex = nonNegativeSafeInteger(planNumber(clip.inputIndex, version), `${name}.inputIndex`);
	const input = inputs[inputIndex];
	if (input?.kind !== 'video-source' || input.sourceId !== clip.sourceId) {
		throw new ReferenceError(`${name} references an incompatible input.`);
	}
	const sourceStartTimeSeconds = nonNegativeNumber(
		planNumber(clip.sourceStartTimeSeconds, version), `${name}.sourceStartTimeSeconds`,
	);
	const sourceEndTimeSeconds = positiveNumber(
		planNumber(clip.sourceEndTimeSeconds, version), `${name}.sourceEndTimeSeconds`,
	);
	if (sourceEndTimeSeconds <= sourceStartTimeSeconds) {
		throw new RangeError(`${name} source range must have positive duration.`);
	}
	const role = String(clip.role ?? '');
	if (!['single', 'outgoing', 'incoming'].includes(role)) {
		throw new TypeError(`${name}.role must be single, outgoing, or incoming.`);
	}
	const opacityStart = unitNumber(planNumber(clip.opacityStart, version), `${name}.opacityStart`);
	const opacityEnd = unitNumber(planNumber(clip.opacityEnd, version), `${name}.opacityEnd`);
	const renderDescription = version >= 6
		? normalizeVideoFfmpegRenderDescription(clip.renderDescription, `${name}.renderDescription`, canvas)
		: null;
	if (renderDescription && (
		opacityStart !== renderDescription.opacityStart
		|| opacityEnd !== renderDescription.opacityEnd
	)) throw new RangeError(`${name} opacity endpoints must match its V6 render description.`);
	if (renderDescription && role === 'single'
		&& renderDescription.opacityStart !== renderDescription.opacityEnd) {
		throw new RangeError(`${name} single-clip V6 opacity endpoints must be equal.`);
	}
	return {
		role,
		inputIndex,
		sourceStartTimeSeconds,
		sourceEndTimeSeconds,
		playbackRate: positiveNumber(planNumber(clip.playbackRate, version), `${name}.playbackRate`),
		opacityStart,
		opacityEnd,
		...(renderDescription ? { renderDescription } : {}),
		videoEffects: version >= 3
			? normalizeVideoEffects(clip.videoEffects ?? [], `${name}.videoEffects`, {
				allowedTypes: version === 3 ? VIDEO_EFFECT_V5_TYPES : undefined,
			})
			: [],
	};
}

/** Validate an exact V6 operation and bind its renderer-only decomposition privately. */
export function normalizeVideoFfmpegRenderDescription(
	value: unknown,
	name: string,
	canvas: VideoFfmpegCanvas,
): VideoRenderDescription {
	const width = positiveSafeInteger(canvas?.width, 'FFmpeg render canvas width');
	const height = positiveSafeInteger(canvas?.height, 'FFmpeg render canvas height');
	const fit = canvas?.fit ?? 'contain';
	if (!isVideoCanvasFit(fit)) throw new RangeError(`FFmpeg render canvas fit is unsupported: ${String(fit)}.`);
	const description = readClosedDomainRecord(value, name, DESCRIPTION_FIELDS);
	const crop = normalizeCrop(field(description, 'crop', name), `${name}.crop`);
	const affine = readClosedDomainArray(
		field(description, 'sourceDisplayToCanvas', name),
		`${name}.sourceDisplayToCanvas`,
		6,
		6,
	).map((entry, index) => canonicalFinite(entry, `${name}.sourceDisplayToCanvas[${String(index)}]`));
	const opacityStart = unitNumber(field(description, 'opacityStart', name), `${name}.opacityStart`);
	const opacityEnd = unitNumber(field(description, 'opacityEnd', name), `${name}.opacityEnd`);
	const blendMode = field(description, 'blendMode', name);
	if (typeof blendMode !== 'string' || !BLEND_MODES.has(blendMode)) {
		throw new RangeError(`${name}.blendMode is unsupported.`);
	}
	const compositingOrder = boundedSafeInteger(
		field(description, 'compositingOrder', name),
		`${name}.compositingOrder`,
		MINIMUM_COMPOSITING_ORDER,
		MAXIMUM_COMPOSITING_ORDER,
	);
	const normalized = Object.freeze({
		crop,
		sourceDisplayToCanvas: Object.freeze(affine) as VideoRenderDescription['sourceDisplayToCanvas'],
		opacityStart,
		opacityEnd,
		blendMode: blendMode as VideoClipCompositionBlendMode,
		compositingOrder,
	});
	TRUSTED_DESCRIPTIONS.set(normalized, renderInternals(normalized, width, height, fit, name));
	return normalized;
}

/** Return the exact delivery fit consumed before effects for one trusted V6 operation. */
export function videoFfmpegV6FitFilter(description: VideoRenderDescription): string {
	const internals = trusted(description);
	return `scale=w=${String(internals.fittedWidth)}:h=${String(internals.fittedHeight)}:flags=bicubic`;
}

export function videoFfmpegV6FittedSize(
	description: VideoRenderDescription,
): Readonly<{ width: number; height: number }> {
	const internals = trusted(description);
	return Object.freeze({ width: internals.fittedWidth, height: internals.fittedHeight });
}

export interface AppendVideoFfmpegV6ClipFiltersRequest {
	readonly filters: string[];
	readonly inputLabel: string;
	readonly outputLabel: string;
	readonly description: VideoRenderDescription;
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly frameRate: number;
	readonly durationSeconds: number;
	readonly applyStaticOpacity: boolean;
}

/** Apply crop and the resolved affine after effects, producing a premultiplied canvas layer. */
export function appendVideoFfmpegV6ClipFilters(request: AppendVideoFfmpegV6ClipFiltersRequest): void {
	const internals = trusted(request.description);
	const width = positiveSafeInteger(request.canvasWidth, 'FFmpeg V6 canvas width');
	const height = positiveSafeInteger(request.canvasHeight, 'FFmpeg V6 canvas height');
	const duration = numberToken(positiveNumber(request.durationSeconds, 'FFmpeg V6 duration'));
	const frameRate = numberToken(positiveNumber(request.frameRate, 'FFmpeg V6 frame rate'));
	const opacity = request.description.opacityStart;
	if (request.applyStaticOpacity && !nearlyEqualVideoFfmpegScalar(opacity, request.description.opacityEnd)) {
		throw new RangeError('A static V6 layer must have equal opacity endpoints.');
	}
	const alpha = request.applyStaticOpacity && opacity !== 1
		? [`colorchannelmixer=aa=${numberToken(opacity)}`]
		: [];
	if (internals.identityGeometry) {
		request.filters.push(
			`[${request.inputLabel}]`
			+ [
				`pad=w=${String(width)}:h=${String(height)}`
					+ `:x=${String(internals.fittedX)}:y=${String(internals.fittedY)}:color=black@0`,
				...alpha,
				'premultiply=inplace=1',
				'setsar=1',
				`trim=duration=${duration}`,
				'setpts=PTS-STARTPTS',
			].join(',')
			+ `[${request.outputLabel}]`,
		);
		return;
	}

	const crop = request.description.crop.normalized;
	const transformFilters = [
		`crop=w=iw*${numberToken(1 - crop.left - crop.right)}`
			+ `:h=ih*${numberToken(1 - crop.top - crop.bottom)}`
			+ `:x=iw*${numberToken(crop.left)}:y=ih*${numberToken(crop.top)}:exact=1`,
		...(internals.flipHorizontal ? ['hflip'] : []),
		...(internals.flipVertical ? ['vflip'] : []),
		...(!nearlyEqualVideoFfmpegScalar(internals.scaleX, 1) || !nearlyEqualVideoFfmpegScalar(internals.scaleY, 1)
			? [`scale=w=iw*${numberToken(internals.scaleX)}:h=ih*${numberToken(internals.scaleY)}:flags=bicubic`]
			: []),
		...(nearlyEqualVideoFfmpegScalar(internals.rotationRadians, 0)
			? []
			: [`rotate=a=${numberToken(internals.rotationRadians)}`
				+ `:ow=rotw(${numberToken(internals.rotationRadians)})`
				+ `:oh=roth(${numberToken(internals.rotationRadians)}):c=black@0`]),
		...alpha,
		'premultiply=inplace=1',
		'setsar=1',
	];
	const transformed = `${request.outputLabel}_transformed`;
	const base = `${request.outputLabel}_canvas`;
	request.filters.push(`[${request.inputLabel}]${transformFilters.join(',')}[${transformed}]`);
	request.filters.push(
		`color=c=black@0:s=${String(width)}x${String(height)}:r=${frameRate}:d=${duration}`
		+ `,format=pix_fmts=rgba,setsar=1[${base}]`,
	);
	request.filters.push(
		`[${base}][${transformed}]overlay=x=${numberToken(internals.outputCenterX)}-overlay_w/2`
		+ `:y=${numberToken(internals.outputCenterY)}-overlay_h/2`
		+ ':eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied,'
		+ `trim=duration=${duration},setpts=PTS-STARTPTS[${request.outputLabel}]`,
	);
}

export interface AppendVideoFfmpegV6LayerBlendRequest {
	readonly filters: string[];
	readonly backdropLabel: string;
	readonly layerLabel: string;
	readonly outputLabel: string;
	readonly blendMode: VideoClipCompositionBlendMode;
}

/** Composite one premultiplied track over the opaque encoded-RGB backdrop. */
export function appendVideoFfmpegV6LayerBlend(request: AppendVideoFfmpegV6LayerBlendRequest): void {
	const expression = videoFfmpegBlendExpression(request.blendMode);
	const prefix = request.outputLabel;
	request.filters.push(
		`[${request.backdropLabel}]split=2[${prefix}_backdrop_blend][${prefix}_backdrop_merge]`,
	);
	request.filters.push(
		`[${request.layerLabel}]format=pix_fmts=rgba,split=2[${prefix}_source_color][${prefix}_source_alpha]`,
	);
	request.filters.push(
		`[${prefix}_source_color]unpremultiply=inplace=1,format=pix_fmts=gbrp[${prefix}_source_rgb]`,
	);
	request.filters.push(`[${prefix}_source_alpha]alphaextract,format=pix_fmts=gbrp[${prefix}_alpha]`);
	request.filters.push(`[${prefix}_backdrop_blend]format=pix_fmts=gbrp[${prefix}_backdrop_rgb]`);
	request.filters.push(`[${prefix}_backdrop_merge]format=pix_fmts=gbrp[${prefix}_merge_rgb]`);
	request.filters.push(
		`[${prefix}_backdrop_rgb][${prefix}_source_rgb]blend=all_expr='${expression}'[${prefix}_mode]`,
	);
	request.filters.push(
		`[${prefix}_merge_rgb][${prefix}_mode][${prefix}_alpha]maskedmerge,format=pix_fmts=rgba`
		+ `[${request.outputLabel}]`,
	);
}

/** Exact encoded-RGB channel formulas; A is backdrop and B is unassociated source. */
export function videoFfmpegBlendExpression(mode: VideoClipCompositionBlendMode): string {
	switch (mode) {
		case 'normal': return 'B';
		case 'multiply': return 'A*B/255';
		case 'screen': return 'A+B-A*B/255';
		case 'overlay': return 'if(lte(A,127.5),2*A*B/255,255-2*(255-A)*(255-B)/255)';
		case 'darken': return 'min(A,B)';
		case 'lighten': return 'max(A,B)';
		case 'difference': return 'abs(A-B)';
		case 'exclusion': return 'A+B-2*A*B/255';
		default: throw new RangeError(`Unsupported FFmpeg video blend mode: ${String(mode)}.`);
	}
}

function normalizeCrop(value: unknown, name: string): VideoRenderDescription['crop'] {
	const crop = readClosedDomainRecord(value, name, CROP_FIELDS);
	const normalizedValue = readClosedDomainRecord(
		field(crop, 'normalized', name), `${name}.normalized`, NORMALIZED_CROP_FIELDS,
	);
	const normalized = Object.freeze({
		left: unitNumber(field(normalizedValue, 'left', `${name}.normalized`), `${name}.normalized.left`),
		top: unitNumber(field(normalizedValue, 'top', `${name}.normalized`), `${name}.normalized.top`),
		right: unitNumber(field(normalizedValue, 'right', `${name}.normalized`), `${name}.normalized.right`),
		bottom: unitNumber(field(normalizedValue, 'bottom', `${name}.normalized`), `${name}.normalized.bottom`),
	});
	if (normalized.left + normalized.right >= 1 || normalized.top + normalized.bottom >= 1) {
		throw new RangeError(`${name}.normalized must retain a positive aperture.`);
	}
	const pixelsValue = readClosedDomainRecord(
		field(crop, 'sourcePixels', name), `${name}.sourcePixels`, SOURCE_PIXEL_CROP_FIELDS,
	);
	const sourcePixels = Object.freeze({
		x: nonNegativeNumber(field(pixelsValue, 'x', `${name}.sourcePixels`), `${name}.sourcePixels.x`),
		y: nonNegativeNumber(field(pixelsValue, 'y', `${name}.sourcePixels`), `${name}.sourcePixels.y`),
		width: positiveNumber(field(pixelsValue, 'width', `${name}.sourcePixels`), `${name}.sourcePixels.width`),
		height: positiveNumber(field(pixelsValue, 'height', `${name}.sourcePixels`), `${name}.sourcePixels.height`),
	});
	return Object.freeze({ normalized, sourcePixels });
}

function renderInternals(
	description: VideoRenderDescription,
	canvasWidth: number,
	canvasHeight: number,
	fit: VideoCanvasFit,
	name: string,
): RenderInternals {
	const crop = description.crop;
	const sourceWidth = crop.sourcePixels.width / (1 - crop.normalized.left - crop.normalized.right);
	const sourceHeight = crop.sourcePixels.height / (1 - crop.normalized.top - crop.normalized.bottom);
	const canonicalWidth = nearPositiveSafeInteger(sourceWidth, `${name}.crop source width`);
	const canonicalHeight = nearPositiveSafeInteger(sourceHeight, `${name}.crop source height`);
	assertNearly(crop.sourcePixels.x, crop.normalized.left * canonicalWidth, `${name}.crop.sourcePixels.x`);
	assertNearly(crop.sourcePixels.y, crop.normalized.top * canonicalHeight, `${name}.crop.sourcePixels.y`);
	// The same placement the description computed, from the same function. The
	// authored transform below is recovered by dividing this back out, so a
	// second opinion here would read the delivery's own fit as clip scaling.
	const { fittedWidth, fittedHeight, fittedX, fittedY } = resolveVideoCanvasPlacement(
		fit, canvasWidth, canvasHeight, canonicalWidth, canonicalHeight,
	);
	const [a, b, c, d, e, f] = description.sourceDisplayToCanvas;
	const baseScaleX = fittedWidth / canonicalWidth;
	const baseScaleY = fittedHeight / canonicalHeight;
	const linearA = a / baseScaleX;
	const linearB = b / baseScaleX;
	const linearC = c / baseScaleY;
	const linearD = d / baseScaleY;
	const columnX = Math.hypot(linearA, linearB);
	const columnY = Math.hypot(linearC, linearD);
	if (!withinAuthoredVideoFfmpegScale(columnX) || !withinAuthoredVideoFfmpegScale(columnY)) {
		throw new RangeError(`${name}.sourceDisplayToCanvas has an unsupported scale.`);
	}
	const dot = linearA * linearC + linearB * linearD;
	if (!nearlyEqualVideoFfmpegScalar(dot, 0)) {
		throw new RangeError(`${name}.sourceDisplayToCanvas must contain only scale, reflection, and rotation.`);
	}
	const determinant = linearA * linearD - linearB * linearC;
	if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) {
		throw new RangeError(`${name}.sourceDisplayToCanvas must be invertible.`);
	}
	const primary = decomposition(linearA, linearB, determinant / columnX, false);
	const alternate = decomposition(-linearA, -linearB, -determinant / columnX, true);
	const resolved = Math.abs(alternate.rotationRadians) < Math.abs(primary.rotationRadians)
		? alternate
		: primary;
	const corners = [
		[crop.sourcePixels.x, crop.sourcePixels.y],
		[crop.sourcePixels.x + crop.sourcePixels.width, crop.sourcePixels.y],
		[crop.sourcePixels.x, crop.sourcePixels.y + crop.sourcePixels.height],
		[
			crop.sourcePixels.x + crop.sourcePixels.width,
			crop.sourcePixels.y + crop.sourcePixels.height,
		],
	] as const;
	const mapped = corners.map(([x, y]) => Object.freeze({ x: a * x + c * y + e, y: b * x + d * y + f }));
	if (mapped.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
		throw new RangeError(`${name}.sourceDisplayToCanvas produces non-finite output.`);
	}
	// The identity shortcut is a single `pad`, which cannot take a negative
	// offset or shrink its input, so a `cover` placement that overhangs the
	// canvas takes the general overlay path instead. `contain` and `stretch`
	// always land inside it and keep the filter they have always emitted.
	const padsWithinCanvas = fittedX >= 0 && fittedY >= 0
		&& fittedX + fittedWidth <= canvasWidth
		&& fittedY + fittedHeight <= canvasHeight;
	const identityGeometry = padsWithinCanvas
		&& crop.normalized.left === 0
		&& crop.normalized.top === 0
		&& crop.normalized.right === 0
		&& crop.normalized.bottom === 0
		&& nearlyEqualVideoFfmpegScalar(a, baseScaleX) && b === 0 && c === 0 && nearlyEqualVideoFfmpegScalar(d, baseScaleY)
		&& e === fittedX && f === fittedY;
	return Object.freeze({
		fittedWidth,
		fittedHeight,
		fittedX,
		fittedY,
		scaleX: Math.abs(resolved.signedScaleX),
		scaleY: Math.abs(resolved.signedScaleY),
		flipHorizontal: resolved.signedScaleX < 0,
		flipVertical: resolved.signedScaleY < 0,
		rotationRadians: resolved.rotationRadians,
		outputCenterX: (Math.min(...mapped.map(({ x }) => x)) + Math.max(...mapped.map(({ x }) => x))) / 2,
		outputCenterY: (Math.min(...mapped.map(({ y }) => y)) + Math.max(...mapped.map(({ y }) => y))) / 2,
		identityGeometry,
	});
}

function decomposition(a: number, b: number, signedScaleY: number, negativeX: boolean) {
	const angle = normalizeRadians(Math.atan2(b, a));
	return Object.freeze({
		signedScaleX: negativeX ? -Math.hypot(a, b) : Math.hypot(a, b),
		signedScaleY,
		rotationRadians: angle,
	});
}

function normalizeRadians(value: number): number {
	let result = value;
	while (result >= Math.PI) result -= Math.PI * 2;
	while (result < -Math.PI) result += Math.PI * 2;
	return Object.is(result, -0) ? 0 : result;
}

function trusted(description: VideoRenderDescription): RenderInternals {
	const internals = TRUSTED_DESCRIPTIONS.get(description);
	if (!internals) throw new TypeError('An FFmpeg V6 render description must be normalized before use.');
	return internals;
}

