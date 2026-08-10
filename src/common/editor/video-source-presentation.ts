/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveVideoDisplayGeometry,
	videoSourcePresentedSize,
} from './video-display-geometry.ts';
import {
	VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION,
	normalizeVideoSourceCharacteristics,
	type VideoSourceCharacteristics,
} from './video-source-characteristics.ts';

/**
 * What a renderer that decodes the source itself must apply to reach the
 * source's display geometry.
 *
 * A browser hands a surface frames it has already turned and stretched, so that
 * surface owes only the residual `resolveVideoDisplayGeometry` reports. A
 * renderer holding the container instead decodes coded frames — with
 * autorotation disabled, so that stays true — and owes the whole transform: the
 * pixel aspect ratio along the coded width, then the rotation.
 *
 * Nothing is applied to geometry the probe and the decoder could not reconcile.
 * A probe that contradicts the decoder is disclosed, never promoted to truth.
 */

export interface VideoSourceSampleAspect {
	readonly num: number;
	readonly den: number;
}

export interface VideoSourcePresentation {
	/** Coded frames are the contract: the caller must disable decoder autorotation. */
	readonly autorotate: false;
	readonly codedWidth: number;
	readonly codedHeight: number;
	readonly sampleAspect: VideoSourceSampleAspect | null;
	readonly scaledWidth: number;
	readonly scaledHeight: number;
	readonly rotationDegrees: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
}

const QUARTER_TURNS = new Set([90, 270]);

/**
 * Resolve the presentation a persisted video source needs, or null when a
 * decoder may simply present what it decodes.
 */
export function resolveVideoSourcePresentation(source: unknown): VideoSourcePresentation | null {
	const presented = videoSourcePresentedSize(source);
	if (!presented) return null;
	const characteristics = readCharacteristics(source);
	if (!characteristics) return null;
	const geometry = resolveVideoDisplayGeometry(characteristics, presented);
	if (geometry.reconciliation !== 'applied' && geometry.reconciliation !== 'residual') return null;
	const codedWidth = characteristics.codedWidth;
	const codedHeight = characteristics.codedHeight;
	if (codedWidth == null || codedHeight == null) return null;
	const ratio = characteristics.pixelAspectRatio;
	const aspect = ratio && ratio.num !== ratio.den ? ratio : null;
	const rotationDegrees = characteristics.rotationDegrees ?? 0;
	if (!aspect && rotationDegrees === 0) return null;
	// Scaling one axis keeps the frame small; the ratios FFmpeg reports are
	// already reduced, so the rounded width is exact for every ratio that
	// divides the coded width, and within a pixel otherwise.
	const scaledWidth = aspect
		? Math.max(1, Math.round((codedWidth * aspect.num) / aspect.den))
		: codedWidth;
	if (scaledWidth > VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION) return null;
	const turned = QUARTER_TURNS.has(rotationDegrees);
	return Object.freeze({
		autorotate: false as const,
		codedWidth,
		codedHeight,
		sampleAspect: aspect ? Object.freeze({ num: aspect.num, den: aspect.den }) : null,
		scaledWidth,
		scaledHeight: codedHeight,
		rotationDegrees,
		displayWidth: turned ? codedHeight : scaledWidth,
		displayHeight: turned ? scaledWidth : codedHeight,
	});
}

/** The size a source presents once its display geometry has been honoured. */
export function resolveVideoSourceDisplaySize(source: unknown): { width: number; height: number } | null {
	const presented = videoSourcePresentedSize(source);
	if (!presented) return null;
	const characteristics = readCharacteristics(source);
	if (!characteristics) return { width: presented.width, height: presented.height };
	const geometry = resolveVideoDisplayGeometry(characteristics, presented);
	return { width: geometry.displayWidth, height: geometry.displayHeight };
}

function readCharacteristics(source: unknown): VideoSourceCharacteristics | null {
	if (!source || typeof source !== 'object') return null;
	const record = source as Record<string, unknown>;
	const candidate = record.characteristics;
	if (!candidate) return null;
	try {
		// A persisted start timecode is only legible at the source's own rate.
		return normalizeVideoSourceCharacteristics(candidate, { rate: sourceRate(record.frameRate) });
	} catch {
		// An unreadable record is not source truth; the decoder stays authoritative.
		return null;
	}
}

function sourceRate(value: unknown): { num: number; den: number } | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const rate = value as Record<string, unknown>;
	const num = Number(rate.num);
	const den = Number(rate.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return undefined;
	return { num, den };
}
