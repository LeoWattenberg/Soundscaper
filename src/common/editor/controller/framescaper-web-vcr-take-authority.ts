/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePhase } from '../framescaper-capture-domain.ts';
import {
	mapWebVcrCropToEvenFramePixels,
	type WebVcrEvenPixelCrop,
} from '../web-vcr-geometry.ts';
import type { WebVcrDimensions, WebVcrSnapshot } from '../web-vcr-domain.ts';

export interface FramescaperWebVcrFrozenTake {
	readonly sessionId: string;
	readonly generation: number;
	readonly navigationGeneration: number;
	readonly targetId: string | null;
	readonly targetGeneration: number | null;
	readonly recordingToken: string;
	readonly pixelCrop: Readonly<WebVcrEvenPixelCrop>;
	readonly surface: Readonly<WebVcrDimensions>;
	readonly output: Readonly<WebVcrDimensions>;
}

export type FramescaperWebVcrTakeObservation = 'unchanged' | 'authority-changed' | 'exact-ended';

export function createFramescaperWebVcrRecordingToken(
	fill?: (bytes: Uint8Array) => void,
): string {
	const bytes = new Uint8Array(16);
	if (fill) fill(bytes);
	else globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function freezeFramescaperWebVcrTake(
	host: Readonly<WebVcrSnapshot>,
	reference: Readonly<{ readonly sessionId: string; readonly generation: number }>,
): Readonly<FramescaperWebVcrFrozenTake> {
	const mapped = mapWebVcrCropToEvenFramePixels(host.crop, host.captureSurface);
	return Object.freeze({
		sessionId: reference.sessionId,
		generation: reference.generation,
		navigationGeneration: host.navigation.generation,
		targetId: host.target?.targetId ?? null,
		targetGeneration: host.target?.generation ?? null,
		recordingToken: createFramescaperWebVcrRecordingToken(),
		pixelCrop: mapped.pixelCrop,
		surface: host.captureSurface,
		output: Object.freeze({ width: mapped.pixelCrop.width, height: mapped.pixelCrop.height }),
	});
}

export function evaluateFramescaperWebVcrTakeObservation(
	active: Readonly<FramescaperWebVcrFrozenTake>,
	next: Readonly<WebVcrSnapshot>,
	capturePhase: CapturePhase,
): FramescaperWebVcrTakeObservation {
	const mapped = mapWebVcrCropToEvenFramePixels(next.crop, next.captureSurface);
	const targetChanged = next.sessionId !== active.sessionId
		|| next.generation !== active.generation
		|| next.navigation.generation !== active.navigationGeneration
		|| next.captureSurface.width !== active.surface.width
		|| next.captureSurface.height !== active.surface.height
		|| !samePixelCrop(mapped.pixelCrop, active.pixelCrop)
		|| (active.targetId !== null && (!next.target
			|| next.target.targetId !== active.targetId
			|| next.target.generation !== active.targetGeneration));
	if (targetChanged || next.phase === 'failed' || next.phase === 'recovery') {
		return 'authority-changed';
	}
	if (capturePhase === 'recording' && next.phase === 'recording'
		&& active.targetId !== null && next.autoStop
		&& next.target?.mediaState === 'ended'
		&& next.targetEndedRecordingToken === active.recordingToken) {
		return 'exact-ended';
	}
	return 'unchanged';
}

function samePixelCrop(
	left: Readonly<WebVcrEvenPixelCrop>,
	right: Readonly<WebVcrEvenPixelCrop>,
): boolean {
	return left.x === right.x && left.y === right.y
		&& left.width === right.width && left.height === right.height;
}
