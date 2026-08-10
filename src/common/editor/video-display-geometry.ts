/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION,
	type VideoSourceCharacteristics,
} from './video-source-characteristics.ts';

/**
 * Reconcile probed coded geometry with what a decoder actually presented.
 *
 * Browsers apply a container display matrix and pixel aspect ratio before
 * reporting intrinsic dimensions, so the probe and the decoder usually agree
 * and nothing must be re-applied. The decoder stays the authority on what it
 * already did: this resolver reports only the residual a surface still has to
 * apply, prefers the hypothesis in which the decoder already applied a
 * transform, and says plainly when the two cannot be reconciled at all.
 *
 * A half turn is invisible in an aspect ratio, so it can never be detected as
 * residual and is therefore never re-applied.
 */

export type VideoDisplayReconciliation = 'unreported' | 'applied' | 'residual' | 'disagreed';

export interface VideoPresentedSize {
	readonly width: number;
	readonly height: number;
}

export interface VideoDisplayGeometry {
	readonly reconciliation: VideoDisplayReconciliation;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly residualRotationDegrees: number;
	readonly residualScaleX: number;
	readonly residualScaleY: number;
}

const IDENTITY_SCALE = 1;

/** Resolve what a preview or export surface should present for one video source. */
export function resolveVideoDisplayGeometry(
	characteristics: VideoSourceCharacteristics | null | undefined,
	presented: VideoPresentedSize,
): VideoDisplayGeometry {
	const width = presentedDimension(presented?.width, 'presented width');
	const height = presentedDimension(presented?.height, 'presented height');
	const codedWidth = characteristics?.codedWidth ?? null;
	const codedHeight = characteristics?.codedHeight ?? null;
	if (codedWidth == null || codedHeight == null) return unreconciled('unreported', width, height);
	const rotation = characteristics?.rotationDegrees ?? null;
	const quarterTurn = rotation === 90 || rotation === 270;
	const aspectNum = characteristics?.pixelAspectRatio?.num ?? 1;
	const aspectDen = characteristics?.pixelAspectRatio?.den ?? 1;
	const anamorphic = aspectNum !== aspectDen;
	for (const rotationApplied of quarterTurn ? [true, false] : [false]) {
		for (const aspectApplied of anamorphic ? [true, false] : [false]) {
			const expectedWidth = codedWidth * (aspectApplied ? aspectNum : aspectDen);
			const expectedHeight = codedHeight * aspectDen;
			const orientedWidth = rotationApplied ? expectedHeight : expectedWidth;
			const orientedHeight = rotationApplied ? expectedWidth : expectedHeight;
			if (orientedWidth * height !== orientedHeight * width) continue;
			const residualRotation = rotationApplied || !quarterTurn ? 0 : Number(rotation);
			const residualScaleX = aspectApplied || !anamorphic ? IDENTITY_SCALE : aspectNum / aspectDen;
			const scaledWidth = Math.max(1, Math.round(width * residualScaleX));
			const applied = residualRotation === 0 && residualScaleX === IDENTITY_SCALE;
			return Object.freeze({
				reconciliation: applied ? 'applied' : 'residual',
				displayWidth: residualRotation === 0 ? scaledWidth : height,
				displayHeight: residualRotation === 0 ? height : scaledWidth,
				residualRotationDegrees: residualRotation,
				residualScaleX,
				residualScaleY: IDENTITY_SCALE,
			});
		}
	}
	return unreconciled('disagreed', width, height);
}

/** The size a persisted source presents before any surface has decoded it. */
export function videoSourcePresentedSize(source: unknown): VideoPresentedSize | null {
	if (!source || typeof source !== 'object') return null;
	const candidate = source as Record<string, unknown>;
	const width = Number(candidate.width);
	const height = Number(candidate.height);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
	return Object.freeze({ width, height });
}

function unreconciled(
	reconciliation: VideoDisplayReconciliation,
	width: number,
	height: number,
): VideoDisplayGeometry {
	return Object.freeze({
		reconciliation,
		displayWidth: width,
		displayHeight: height,
		residualRotationDegrees: 0,
		residualScaleX: IDENTITY_SCALE,
		residualScaleY: IDENTITY_SCALE,
	});
}

function presentedDimension(value: unknown, name: string): number {
	const result = Math.round(Number(value));
	if (!Number.isSafeInteger(result) || result < 1 || result > VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION) {
		throw new RangeError(`A ${name} must be a positive integer within the coded dimension bound.`);
	}
	return result;
}
