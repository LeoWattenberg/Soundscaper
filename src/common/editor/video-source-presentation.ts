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
 * What an FFmpeg render still owes a source after FFmpeg's own decode.
 *
 * FFmpeg is a decoder like any other, so it closes part of the distance to the
 * source's display geometry by itself: it applies the container display matrix
 * and it ignores the pixel aspect ratio. The residual is therefore a stretch
 * and never a turn, which is the only shape a render may apply — asking FFmpeg
 * for unrotated frames instead makes it copy the input's display matrix onto
 * the encoded output, so every player would turn the baked-in rotation again.
 *
 * Nothing is applied to geometry the probe and the decoder could not reconcile.
 * A probe that contradicts the decoder is disclosed, never promoted to truth.
 */

export interface VideoSourceSampleAspect {
	readonly num: number;
	readonly den: number;
}

export interface VideoSourcePresentation {
	/** The decode applies the display matrix, so the render must not turn frames again. */
	readonly autorotate: true;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly sampleAspect: VideoSourceSampleAspect;
	readonly scaledWidth: number;
	readonly scaledHeight: number;
}

const QUARTER_TURNS = new Set([90, 270]);

/**
 * Resolve the presentation a persisted video source needs from a render that
 * decodes the container itself, or null when the decode already presents the
 * source's display geometry.
 */
export function resolveVideoSourcePresentation(source: unknown): VideoSourcePresentation | null {
	const presented = videoSourcePresentedSize(source);
	if (!presented) return null;
	const characteristics = readCharacteristics(source);
	if (!characteristics) return null;
	// The decoder that produced the persisted size stays the authority: geometry
	// it contradicts is disclosed by the properties surface, never re-applied.
	const reconciled = resolveVideoDisplayGeometry(characteristics, presented).reconciliation;
	if (reconciled !== 'applied' && reconciled !== 'residual') return null;
	const codedWidth = characteristics.codedWidth;
	const codedHeight = characteristics.codedHeight;
	if (codedWidth == null || codedHeight == null) return null;
	const turned = QUARTER_TURNS.has(characteristics.rotationDegrees ?? 0);
	const decodedWidth = turned ? codedHeight : codedWidth;
	const decodedHeight = turned ? codedWidth : codedHeight;
	const geometry = resolveVideoDisplayGeometry(characteristics, {
		width: decodedWidth,
		height: decodedHeight,
	});
	const aspect = characteristics.pixelAspectRatio;
	if (geometry.reconciliation !== 'residual' || !aspect) return null;
	const scaledWidth = Math.max(1, Math.round(decodedWidth * geometry.residualScaleX));
	const scaledHeight = Math.max(1, Math.round(decodedHeight * geometry.residualScaleY));
	if (scaledWidth > VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION) return null;
	if (scaledHeight > VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION) return null;
	return Object.freeze({
		autorotate: true as const,
		decodedWidth,
		decodedHeight,
		sampleAspect: Object.freeze({ num: aspect.num, den: aspect.den }),
		scaledWidth,
		scaledHeight,
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
