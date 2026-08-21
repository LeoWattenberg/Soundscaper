/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	WebVcrAspect,
	WebVcrCommandV1,
	WebVcrDimensions,
	WebVcrLifecyclePhase,
	WebVcrNormalizedCrop,
	WebVcrResolution,
} from '../web-vcr-domain.ts';

export type {
	WebVcrAspect,
	WebVcrDimensions,
	WebVcrInputModifier,
	WebVcrResolution,
} from '../web-vcr-domain.ts';

export const WEB_VCR_PANEL_ID = 'web-vcr' as const;

export type WebVcrPhase = WebVcrLifecyclePhase;
export type WebVcrCrop = WebVcrNormalizedCrop;

export type WebVcrCropHandle = 'move' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type WebVcrPointerInput = Omit<
	Extract<WebVcrCommandV1, { readonly kind: 'pointer-input' }>,
	'version' | 'sessionId' | 'generation' | 'kind'
>;
export type WebVcrKeyInput = Omit<
	Extract<WebVcrCommandV1, { readonly kind: 'key-input' }>,
	'version' | 'sessionId' | 'generation' | 'kind'
>;

export interface WebVcrUiSnapshot {
	readonly capability: Readonly<{
		readonly status: 'checking' | 'available' | 'unavailable';
		readonly reason: string | null;
	}>;
	readonly phase: WebVcrPhase;
	readonly modeActive: boolean;
	readonly navigation: Readonly<{
		readonly url: string;
		readonly canGoBack: boolean;
		readonly canGoForward: boolean;
		readonly loading: boolean;
		readonly generation: number;
	}>;
	readonly resolution: WebVcrResolution;
	readonly availableResolutions: readonly WebVcrResolution[];
	readonly autoCrop: boolean;
	readonly aspect: WebVcrAspect;
	readonly crop: WebVcrCrop;
	readonly monitorMuted: boolean;
	readonly autoStop: boolean;
	readonly surface: WebVcrDimensions | null;
	readonly output: WebVcrDimensions | null;
	readonly intrinsic: WebVcrDimensions | null;
	readonly target: Readonly<{ readonly id: string; readonly generation: number }> | null;
	readonly lowerResolutionWarning: boolean;
	readonly previewStream?: unknown;
	readonly error: string | null;
}

export interface WebVcrUiActions {
	activate?(): unknown;
	close?(): unknown;
	navigate?(url: string): unknown;
	back?(): unknown;
	forward?(): unknown;
	reload?(): unknown;
	setResolution?(resolution: WebVcrResolution): unknown;
	setAutoCrop?(enabled: boolean): unknown;
	setAspect?(aspect: WebVcrAspect): unknown;
	setCrop?(crop: WebVcrCrop): unknown;
	setMonitorMuted?(muted: boolean): unknown;
	setAutoStop?(enabled: boolean): unknown;
	sendPointerInput?(input: WebVcrPointerInput): unknown;
	sendKeyInput?(input: WebVcrKeyInput): unknown;
	record?(): unknown;
	stopAndImport?(): unknown;
	clearBrowserData?(): unknown;
}

export function webVcrCapabilityAvailable(
	snapshot: Pick<WebVcrUiSnapshot, 'capability'> | null | undefined,
): boolean {
	return snapshot?.capability.status === 'available';
}

export function webVcrPhaseLocksControls(phase: WebVcrPhase): boolean {
	return ['preparing', 'recording', 'finalizing', 'recovery'].includes(phase);
}

export function webVcrPhaseIsActive(phase: WebVcrPhase): boolean {
	return ['preparing', 'recording', 'finalizing', 'recovery'].includes(phase);
}

export function webVcrPrimaryAction(
	snapshot: Pick<WebVcrUiSnapshot, 'modeActive' | 'phase' | 'navigation'> | null | undefined,
): Readonly<{ kind: 'record' | 'stop' | 'finalizing' | 'none'; disabled: boolean }> {
	if (!snapshot?.modeActive) return Object.freeze({ kind: 'none', disabled: false });
	switch (snapshot.phase) {
		case 'ready': return Object.freeze({ kind: 'record', disabled: snapshot.navigation.loading });
		case 'preparing':
		case 'recording': return Object.freeze({ kind: 'stop', disabled: false });
		case 'finalizing': return Object.freeze({ kind: 'finalizing', disabled: true });
		default: return Object.freeze({ kind: 'none', disabled: true });
	}
}

export function adjustWebVcrCropFromKeyboard(
	crop: WebVcrCrop,
	handle: WebVcrCropHandle,
	key: string,
	largeStep: boolean,
	surface: WebVcrDimensions,
	aspect: WebVcrAspect,
): WebVcrCrop | null {
	const step = largeStep ? 10 : 1;
	const delta = arrowDelta(key, step);
	if (!delta) return null;
	return adjustWebVcrCropByPixels(crop, handle, delta.x, delta.y, surface, aspect);
}

export function adjustWebVcrCropByPixels(
	crop: WebVcrCrop,
	handle: WebVcrCropHandle,
	deltaX: number,
	deltaY: number,
	surface: WebVcrDimensions,
	aspect: WebVcrAspect,
): WebVcrCrop {
	const width = positiveDimension(surface.width);
	const height = positiveDimension(surface.height);
	const rectangle = cropPixels(crop, width, height);
	if (handle === 'move') {
		const nextWidth = rectangle.right - rectangle.left;
		const nextHeight = rectangle.bottom - rectangle.top;
		const left = clamp(rectangle.left + finite(deltaX), 0, width - nextWidth);
		const top = clamp(rectangle.top + finite(deltaY), 0, height - nextHeight);
		return normalizedCrop(left, top, left + nextWidth, top + nextHeight, width, height);
	}

	const leftHandle = handle.endsWith('left');
	const topHandle = handle.startsWith('top');
	const anchorX = leftHandle ? rectangle.right : rectangle.left;
	const anchorY = topHandle ? rectangle.bottom : rectangle.top;
	const directionX = leftHandle ? -1 : 1;
	const directionY = topHandle ? -1 : 1;
	const requestedX = (leftHandle ? rectangle.left : rectangle.right) + finite(deltaX);
	const requestedY = (topHandle ? rectangle.top : rectangle.bottom) + finite(deltaY);
	let requestedWidth = Math.max(2, Math.abs(anchorX - requestedX));
	let requestedHeight = Math.max(2, Math.abs(anchorY - requestedY));
	const ratio = aspectRatio(aspect);
	if (ratio) {
		if (Math.abs(deltaX) >= Math.abs(deltaY)) requestedHeight = requestedWidth / ratio;
		else requestedWidth = requestedHeight * ratio;
	}
	const maximumWidth = directionX < 0 ? anchorX : width - anchorX;
	const maximumHeight = directionY < 0 ? anchorY : height - anchorY;
	if (ratio) {
		const scale = Math.min(1, maximumWidth / requestedWidth, maximumHeight / requestedHeight);
		requestedWidth = Math.max(Math.min(2, maximumWidth), requestedWidth * scale);
		requestedHeight = Math.max(Math.min(2, maximumHeight), requestedHeight * scale);
	} else {
		requestedWidth = clamp(requestedWidth, Math.min(2, maximumWidth), maximumWidth);
		requestedHeight = clamp(requestedHeight, Math.min(2, maximumHeight), maximumHeight);
	}
	const movingX = anchorX + directionX * requestedWidth;
	const movingY = anchorY + directionY * requestedHeight;
	return normalizedCrop(
		Math.min(anchorX, movingX),
		Math.min(anchorY, movingY),
		Math.max(anchorX, movingX),
		Math.max(anchorY, movingY),
		width,
		height,
	);
}

function arrowDelta(key: string, step: number): Readonly<{ x: number; y: number }> | null {
	switch (key) {
		case 'ArrowLeft': return { x: -step, y: 0 };
		case 'ArrowRight': return { x: step, y: 0 };
		case 'ArrowUp': return { x: 0, y: -step };
		case 'ArrowDown': return { x: 0, y: step };
		default: return null;
	}
}

function cropPixels(crop: WebVcrCrop, width: number, height: number) {
	const left = clamp(finite(crop.x), 0, 1) * width;
	const top = clamp(finite(crop.y), 0, 1) * height;
	const right = clamp(finite(crop.x) + finite(crop.width), 0, 1) * width;
	const bottom = clamp(finite(crop.y) + finite(crop.height), 0, 1) * height;
	return {
		left: Math.min(left, Math.max(0, right - 2)),
		top: Math.min(top, Math.max(0, bottom - 2)),
		right: Math.max(right, Math.min(width, left + 2)),
		bottom: Math.max(bottom, Math.min(height, top + 2)),
	};
}

function normalizedCrop(
	left: number,
	top: number,
	right: number,
	bottom: number,
	width: number,
	height: number,
): WebVcrCrop {
	return Object.freeze({
		x: left / width,
		y: top / height,
		width: (right - left) / width,
		height: (bottom - top) / height,
	});
}

function aspectRatio(aspect: WebVcrAspect): number | null {
	switch (aspect) {
		case '16:9': return 16 / 9;
		case '9:16': return 9 / 16;
		case '1:1': return 1;
		case 'free': return null;
	}
}

function positiveDimension(value: number): number {
	return Math.max(2, Math.round(finite(value)));
}

function finite(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, Math.min(minimum, maximum)), Math.max(minimum, maximum));
}
