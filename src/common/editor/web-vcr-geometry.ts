/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeWebVcrAspect,
	normalizeWebVcrDimensions,
	normalizeWebVcrNormalizedCrop,
	normalizeWebVcrResolution,
	normalizeWebVcrTargetSummary,
	type WebVcrAspect,
	type WebVcrDimensions,
	type WebVcrMediaState,
	type WebVcrNormalizedCrop,
	type WebVcrResolution,
	type WebVcrTargetSummary,
} from './web-vcr-domain.ts';

export interface WebVcrViewportProfile {
	readonly cssWidth: number;
	readonly cssHeight: number;
	readonly deviceScaleFactor: number;
	readonly captureWidth: number;
	readonly captureHeight: number;
}

export const WEB_VCR_VIEWPORT_PROFILES: Readonly<Record<WebVcrResolution, WebVcrViewportProfile>> =
	Object.freeze({
		'720p': Object.freeze({
			cssWidth: 1_280,
			cssHeight: 720,
			deviceScaleFactor: 1,
			captureWidth: 1_280,
			captureHeight: 720,
		}),
		'1080p': Object.freeze({
			cssWidth: 1_920,
			cssHeight: 1_080,
			deviceScaleFactor: 1,
			captureWidth: 1_920,
			captureHeight: 1_080,
		}),
		'4k': Object.freeze({
			cssWidth: 1_920,
			cssHeight: 1_080,
			deviceScaleFactor: 2,
			captureWidth: 3_840,
			captureHeight: 2_160,
		}),
	});

export const WEB_VCR_OBJECT_FITS = Object.freeze([
	'fill', 'contain', 'cover', 'none', 'scale-down',
] as const);
export const WEB_VCR_MANUAL_FALLBACK_REASONS = Object.freeze([
	'no-playing-video',
	'no-visible-video',
	'canvas-player',
	'inaccessible-shadow-dom',
	'unsupported-transform',
	'unmeasurable-aperture',
	'ambiguous-targets',
] as const);

export type WebVcrObjectFit = typeof WEB_VCR_OBJECT_FITS[number];
export type WebVcrManualFallbackReason = typeof WEB_VCR_MANUAL_FALLBACK_REASONS[number];

export interface WebVcrPixelRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface WebVcrObjectPositionComponent {
	/** Fraction of the free space after fitting; 0, .5, and 1 are start, center, and end. */
	readonly fraction: number;
	/** A resolved CSS-pixel offset, including any length component from calc(). */
	readonly offsetPixels: number;
}

export interface WebVcrObjectPosition {
	readonly x: WebVcrObjectPositionComponent;
	readonly y: WebVcrObjectPositionComponent;
}

export interface WebVcrVisibleMediaApertureRequest {
	readonly viewport: WebVcrDimensions;
	/** The video element's content box in guest-viewport CSS pixels. */
	readonly elementRect: WebVcrPixelRect;
	/** Optional main-observer intersection of ancestor clipping rectangles. */
	readonly clipRect: WebVcrPixelRect | null;
	readonly intrinsicSize: WebVcrDimensions;
	readonly objectFit: WebVcrObjectFit;
	readonly objectPosition: WebVcrObjectPosition;
}

export interface WebVcrVisibleMediaAperture {
	readonly renderedRect: WebVcrPixelRect;
	readonly visibleRect: WebVcrPixelRect;
	readonly normalizedAperture: WebVcrNormalizedCrop;
}

export interface WebVcrTargetGeometryCandidate {
	readonly targetId: string;
	readonly generation: number;
	readonly mediaState: WebVcrMediaState;
	readonly elementRect: WebVcrPixelRect;
	readonly clipRect: WebVcrPixelRect | null;
	readonly intrinsicSize: WebVcrDimensions;
	readonly objectFit: WebVcrObjectFit;
	readonly objectPosition: WebVcrObjectPosition;
	readonly manualFallbackReason: Exclude<
		WebVcrManualFallbackReason,
		'no-playing-video' | 'no-visible-video' | 'unmeasurable-aperture' | 'ambiguous-targets'
	> | null;
}

export interface WebVcrTargetSelectionRequest {
	readonly viewport: WebVcrDimensions;
	readonly candidates: readonly WebVcrTargetGeometryCandidate[];
}

export type WebVcrTargetSelection =
	| Readonly<{
		readonly kind: 'target';
		readonly target: Readonly<WebVcrTargetSummary>;
		readonly visibleArea: number;
	}>
	| Readonly<{ readonly kind: 'manual'; readonly reason: WebVcrManualFallbackReason }>;

export interface WebVcrEvenPixelCrop {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface WebVcrFrozenFrameCrop {
	readonly frameSize: Readonly<WebVcrDimensions>;
	readonly normalizedCrop: Readonly<WebVcrNormalizedCrop>;
	readonly pixelCrop: Readonly<WebVcrEvenPixelCrop>;
}

export function resolveWebVcrViewportProfile(
	resolution: WebVcrResolution | unknown,
): WebVcrViewportProfile {
	return WEB_VCR_VIEWPORT_PROFILES[normalizeWebVcrResolution(resolution)];
}

/** Resolve the displayed media aperture after replaced-element fit, position, and clipping. */
export function resolveWebVcrVisibleMediaAperture(
	request: WebVcrVisibleMediaApertureRequest,
): Readonly<WebVcrVisibleMediaAperture> | null {
	const viewport = normalizeWebVcrDimensions(request.viewport, 'Web VCR geometry viewport');
	const elementRect = normalizeRect(request.elementRect, 'Web VCR video content box');
	const intrinsic = normalizeWebVcrDimensions(request.intrinsicSize, 'Web VCR intrinsic size');
	const objectFit = enumValue(request.objectFit, WEB_VCR_OBJECT_FITS, 'Web VCR object fit');
	const objectPosition = normalizeObjectPosition(request.objectPosition);
	const fittedSize = resolveFittedSize(elementRect, intrinsic, objectFit);
	const renderedRect = freezeRect({
		x: elementRect.x
			+ (elementRect.width - fittedSize.width) * objectPosition.x.fraction
			+ objectPosition.x.offsetPixels,
		y: elementRect.y
			+ (elementRect.height - fittedSize.height) * objectPosition.y.fraction
			+ objectPosition.y.offsetPixels,
		width: fittedSize.width,
		height: fittedSize.height,
	});
	const viewportRect = freezeRect({ x: 0, y: 0, width: viewport.width, height: viewport.height });
	let visibleRect = intersectRects(renderedRect, elementRect);
	if (visibleRect !== null) visibleRect = intersectRects(visibleRect, viewportRect);
	if (visibleRect !== null && request.clipRect !== null) {
		visibleRect = intersectRects(
			visibleRect,
			normalizeRect(request.clipRect, 'Web VCR observer clip rectangle'),
		);
	}
	if (visibleRect === null) return null;
	const normalizedAperture = normalizeWebVcrNormalizedCrop({
		x: visibleRect.x / viewport.width,
		y: visibleRect.y / viewport.height,
		width: visibleRect.width / viewport.width,
		height: visibleRect.height / viewport.height,
	});
	return Object.freeze({ renderedRect, visibleRect, normalizedAperture });
}

/** Select a unique largest visible playing HTML-video aperture, otherwise require manual crop. */
export function selectWebVcrTarget(request: WebVcrTargetSelectionRequest): WebVcrTargetSelection {
	const viewport = normalizeWebVcrDimensions(request.viewport, 'Web VCR target-selection viewport');
	const candidates = denseCandidates(request.candidates);
	const eligible: Array<Readonly<{
		target: Readonly<WebVcrTargetSummary>;
		visibleArea: number;
	}>> = [];
	const blockers = new Set<WebVcrManualFallbackReason>();
	let sawPlaying = false;
	let sawMeasurableButInvisible = false;
	for (const candidate of candidates) {
		if (candidate.mediaState !== 'playing') continue;
		sawPlaying = true;
		if (candidate.manualFallbackReason !== null) {
			blockers.add(candidate.manualFallbackReason);
			continue;
		}
		try {
			const aperture = resolveWebVcrVisibleMediaAperture({
				viewport,
				elementRect: candidate.elementRect,
				clipRect: candidate.clipRect,
				intrinsicSize: candidate.intrinsicSize,
				objectFit: candidate.objectFit,
				objectPosition: candidate.objectPosition,
			});
			if (aperture === null) {
				sawMeasurableButInvisible = true;
				continue;
			}
			const target = normalizeWebVcrTargetSummary({
				targetId: candidate.targetId,
				generation: candidate.generation,
				mediaState: candidate.mediaState,
				aperture: aperture.normalizedAperture,
				intrinsicSize: candidate.intrinsicSize,
			});
			eligible.push(Object.freeze({
				target,
				visibleArea: aperture.visibleRect.width * aperture.visibleRect.height,
			}));
		} catch {
			blockers.add('unmeasurable-aperture');
		}
	}
	if (eligible.length === 0) {
		return manualSelection(resolveFallbackReason(blockers, sawPlaying, sawMeasurableButInvisible));
	}
	eligible.sort((left, right) => right.visibleArea - left.visibleArea);
	const first = eligible[0];
	if (!first) return manualSelection(resolveFallbackReason(blockers, sawPlaying, sawMeasurableButInvisible));
	const second = eligible[1];
	if (second && nearlyEqualArea(first.visibleArea, second.visibleArea)) {
		return manualSelection('ambiguous-targets');
	}
	return Object.freeze({
		kind: 'target',
		target: first.target,
		visibleArea: first.visibleArea,
	});
}

/** Intersect a proposed crop with the unit surface; zero-area intersections fail closed. */
export function clampWebVcrNormalizedCrop(
	value: WebVcrNormalizedCrop,
): Readonly<WebVcrNormalizedCrop> {
	const x = finiteNumber(value.x, 'Web VCR proposed crop x');
	const y = finiteNumber(value.y, 'Web VCR proposed crop y');
	const width = positiveFiniteNumber(value.width, 'Web VCR proposed crop width');
	const height = positiveFiniteNumber(value.height, 'Web VCR proposed crop height');
	const left = clamp(x, 0, 1);
	const top = clamp(y, 0, 1);
	const right = clamp(x + width, 0, 1);
	const bottom = clamp(y + height, 0, 1);
	if (right <= left || bottom <= top) {
		throw new RangeError('Web VCR proposed crop does not intersect the capture surface.');
	}
	return normalizeWebVcrNormalizedCrop({
		x: left,
		y: top,
		width: canonicalUnitArithmetic(right - left),
		height: canonicalUnitArithmetic(bottom - top),
	});
}

/** Shrink around the crop center to the requested physical-pixel aspect without leaving the crop. */
export function constrainWebVcrCropToAspect(
	value: WebVcrNormalizedCrop,
	aspect: WebVcrAspect | unknown,
	surfaceValue: WebVcrDimensions,
): Readonly<WebVcrNormalizedCrop> {
	const crop = clampWebVcrNormalizedCrop(value);
	const normalizedAspect = normalizeWebVcrAspect(aspect);
	if (normalizedAspect === 'free') return crop;
	const surface = normalizeWebVcrDimensions(surfaceValue, 'Web VCR aspect surface');
	const targetRatio = aspectRatio(normalizedAspect);
	const physicalWidth = crop.width * surface.width;
	const physicalHeight = crop.height * surface.height;
	let width = crop.width;
	let height = crop.height;
	if (physicalWidth / physicalHeight > targetRatio) {
		width = physicalHeight * targetRatio / surface.width;
	} else {
		height = physicalWidth / targetRatio / surface.height;
	}
	return normalizeWebVcrNormalizedCrop({
		x: crop.x + (crop.width - width) / 2,
		y: crop.y + (crop.height - height) / 2,
		width,
		height,
	});
}

/** Freeze a normalized aperture against the first real frame using enclosing even coordinates. */
export function mapWebVcrCropToEvenFramePixels(
	value: WebVcrNormalizedCrop,
	frameValue: WebVcrDimensions,
): Readonly<WebVcrFrozenFrameCrop> {
	const normalizedCrop = normalizeWebVcrNormalizedCrop(value);
	const frameSize = normalizeWebVcrDimensions(frameValue, 'Web VCR first frame size');
	const usableWidth = Math.floor(frameSize.width / 2) * 2;
	const usableHeight = Math.floor(frameSize.height / 2) * 2;
	if (usableWidth < 2 || usableHeight < 2) {
		throw new RangeError('Web VCR first frame must be at least 2 by 2 for an encoder-compatible crop.');
	}
	const rawLeft = normalizedCrop.x * frameSize.width;
	const rawTop = normalizedCrop.y * frameSize.height;
	const rawRight = (normalizedCrop.x + normalizedCrop.width) * frameSize.width;
	const rawBottom = (normalizedCrop.y + normalizedCrop.height) * frameSize.height;
	let x = clampEvenStart(rawLeft, usableWidth);
	let y = clampEvenStart(rawTop, usableHeight);
	let right = clampEvenEnd(rawRight, usableWidth);
	let bottom = clampEvenEnd(rawBottom, usableHeight);
	if (right <= x) x = Math.max(0, right - 2);
	if (bottom <= y) y = Math.max(0, bottom - 2);
	right = Math.max(x + 2, right);
	bottom = Math.max(y + 2, bottom);
	const pixelCrop = Object.freeze({ x, y, width: right - x, height: bottom - y });
	return Object.freeze({ frameSize, normalizedCrop, pixelCrop });
}

function resolveFittedSize(
	box: WebVcrPixelRect,
	intrinsic: WebVcrDimensions,
	fit: WebVcrObjectFit,
): Readonly<WebVcrDimensions> {
	if (fit === 'fill') return Object.freeze({ width: box.width, height: box.height });
	const containScale = Math.min(box.width / intrinsic.width, box.height / intrinsic.height);
	const scale = fit === 'cover'
		? Math.max(box.width / intrinsic.width, box.height / intrinsic.height)
		: fit === 'none'
			? 1
			: fit === 'scale-down'
				? Math.min(1, containScale)
				: containScale;
	return Object.freeze({ width: intrinsic.width * scale, height: intrinsic.height * scale });
}

function normalizeObjectPosition(value: WebVcrObjectPosition): Readonly<WebVcrObjectPosition> {
	return Object.freeze({
		x: normalizePositionComponent(value.x, 'Web VCR horizontal object position'),
		y: normalizePositionComponent(value.y, 'Web VCR vertical object position'),
	});
}

function normalizePositionComponent(
	value: WebVcrObjectPositionComponent,
	name: string,
): Readonly<WebVcrObjectPositionComponent> {
	return Object.freeze({
		fraction: finiteNumber(value.fraction, `${name} fraction`),
		offsetPixels: finiteNumber(value.offsetPixels, `${name} pixel offset`),
	});
}

function normalizeRect(value: WebVcrPixelRect, name: string): Readonly<WebVcrPixelRect> {
	return freezeRect({
		x: finiteNumber(value.x, `${name} x`),
		y: finiteNumber(value.y, `${name} y`),
		width: positiveFiniteNumber(value.width, `${name} width`),
		height: positiveFiniteNumber(value.height, `${name} height`),
	});
}

function freezeRect(value: WebVcrPixelRect): Readonly<WebVcrPixelRect> {
	return Object.freeze({
		x: finiteNumber(value.x, 'Web VCR calculated rectangle x'),
		y: finiteNumber(value.y, 'Web VCR calculated rectangle y'),
		width: positiveFiniteNumber(value.width, 'Web VCR calculated rectangle width'),
		height: positiveFiniteNumber(value.height, 'Web VCR calculated rectangle height'),
	});
}

function intersectRects(
	left: WebVcrPixelRect,
	right: WebVcrPixelRect,
): Readonly<WebVcrPixelRect> | null {
	const x = Math.max(left.x, right.x);
	const y = Math.max(left.y, right.y);
	const farX = Math.min(left.x + left.width, right.x + right.width);
	const farY = Math.min(left.y + left.height, right.y + right.height);
	if (farX <= x || farY <= y) return null;
	return freezeRect({ x, y, width: farX - x, height: farY - y });
}

function denseCandidates(
	value: readonly WebVcrTargetGeometryCandidate[],
): readonly WebVcrTargetGeometryCandidate[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) {
		throw new TypeError('Web VCR target candidates must be a standard array of at most 64 items.');
	}
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError('Web VCR target candidates must be dense.');
	}
	return value;
}

function resolveFallbackReason(
	blockers: ReadonlySet<WebVcrManualFallbackReason>,
	sawPlaying: boolean,
	sawMeasurableButInvisible: boolean,
): WebVcrManualFallbackReason {
	for (const reason of [
		'unsupported-transform',
		'inaccessible-shadow-dom',
		'canvas-player',
		'unmeasurable-aperture',
	] as const) {
		if (blockers.has(reason)) return reason;
	}
	if (sawMeasurableButInvisible) return 'no-visible-video';
	return sawPlaying ? 'unmeasurable-aperture' : 'no-playing-video';
}

function manualSelection(reason: WebVcrManualFallbackReason): WebVcrTargetSelection {
	return Object.freeze({ kind: 'manual', reason });
}

function nearlyEqualArea(left: number, right: number): boolean {
	return Math.abs(left - right) <= Math.max(1, left, right) * 1e-9;
}

function aspectRatio(aspect: Exclude<WebVcrAspect, 'free'>): number {
	switch (aspect) {
		case '16:9': return 16 / 9;
		case '9:16': return 9 / 16;
		case '1:1': return 1;
	}
}

function clampEvenStart(value: number, maximum: number): number {
	return Math.min(maximum - 2, Math.max(0, Math.floor((value + 1e-9) / 2) * 2));
}

function clampEvenEnd(value: number, maximum: number): number {
	return Math.min(maximum, Math.max(2, Math.ceil((value - 1e-9) / 2) * 2));
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new RangeError(`${name} must be a finite number.`);
	}
	return canonicalNumber(value);
}

function positiveFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	name: string,
): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function canonicalNumber(value: number): number {
	if (Object.is(value, -0) || Math.abs(value) < 1e-12) return 0;
	const nearestInteger = Math.round(value);
	if (Math.abs(value - nearestInteger) <= Math.max(1, Math.abs(value)) * 1e-12) {
		return nearestInteger;
	}
	return value;
}

function canonicalUnitArithmetic(value: number): number {
	return canonicalNumber(Number(value.toFixed(15)));
}
