/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	useEffect,
	useRef,
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	type WheelEvent,
} from 'react';

import {
	adjustWebVcrCropByPixels,
	adjustWebVcrCropFromKeyboard,
	type WebVcrCrop,
	type WebVcrCropHandle,
	type WebVcrInputModifier,
	type WebVcrKeyInput,
	type WebVcrPointerInput,
	type WebVcrUiSnapshot,
} from '../web-vcr-ui-model.ts';

interface WebVcrPreviewProps {
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly snapshot: WebVcrUiSnapshot;
	readonly disabled: boolean;
	onCrop(crop: WebVcrCrop): void;
	onPointerInput(input: WebVcrPointerInput): void;
	onKeyInput(input: WebVcrKeyInput): void;
	onReleaseFocus(): void;
}

interface CropDragSession {
	readonly pointerId: number;
	readonly handle: WebVcrCropHandle;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly crop: WebVcrCrop;
}

const HANDLES = Object.freeze([
	['top-left', 'webVcrResizeTopLeft'],
	['top-right', 'webVcrResizeTopRight'],
	['bottom-left', 'webVcrResizeBottomLeft'],
	['bottom-right', 'webVcrResizeBottomRight'],
] as const satisfies readonly (readonly [Exclude<WebVcrCropHandle, 'move'>, string])[]);

export default function WebVcrPreview({
	copy,
	snapshot,
	disabled,
	onCrop,
	onPointerInput,
	onKeyInput,
	onReleaseFocus,
}: WebVcrPreviewProps) {
	const previewRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const dragRef = useRef<CropDragSession | null>(null);
	useEffect(() => assignWebVcrPreviewStream(videoRef.current, snapshot.previewStream), [snapshot.previewStream]);
	const cropStyle = cropPosition(snapshot.crop);
	const manualCropDisabled = disabled || snapshot.autoCrop || !snapshot.surface;
	const inputDisabled = disabled || !snapshot.previewStream;
	const forwardPointer = (
		event: PointerEvent<HTMLDivElement>,
		action: WebVcrPointerInput['action'],
	): void => {
		if (inputDisabled) return;
		const point = normalizeWebVcrPreviewPoint(event.currentTarget.getBoundingClientRect(), {
			x: event.clientX,
			y: event.clientY,
		});
		if (action === 'down') {
			event.currentTarget.focus({ preventScroll: true });
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		event.preventDefault();
		onPointerInput(Object.freeze({
			action,
			...point,
			button: pointerButton(event.button, action),
			deltaX: 0,
			deltaY: 0,
			modifiers: inputModifiers(event),
		}));
	};
	const forwardWheel = (event: WheelEvent<HTMLDivElement>): void => {
		if (inputDisabled) return;
		event.preventDefault();
		onPointerInput(Object.freeze({
			action: 'wheel',
			...normalizeWebVcrPreviewPoint(event.currentTarget.getBoundingClientRect(), {
				x: event.clientX,
				y: event.clientY,
			}),
			button: 'none',
			deltaX: clamp(event.deltaX, -10_000, 10_000),
			deltaY: clamp(event.deltaY, -10_000, 10_000),
			modifiers: inputModifiers(event),
		}));
	};
	const forwardKey = (event: KeyboardEvent<HTMLDivElement>, action: WebVcrKeyInput['action']): void => {
		if (inputDisabled || !event.key || !event.code) return;
		const disposition = webVcrPreviewKeyDisposition(event.key);
		if (disposition === 'local-navigation') return;
		if (disposition === 'release-focus') {
			event.preventDefault();
			event.stopPropagation();
			if (action === 'down') onReleaseFocus();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onKeyInput(Object.freeze({
			action,
			key: event.key.slice(0, 64),
			code: event.code.slice(0, 64),
			repeat: event.repeat,
			modifiers: inputModifiers(event),
		}));
	};
	const updateFromKeyboard = (
		event: KeyboardEvent<HTMLButtonElement>,
		handle: WebVcrCropHandle,
	): void => {
		if (manualCropDisabled || !snapshot.surface) return;
		const next = adjustWebVcrCropFromKeyboard(
			snapshot.crop, handle, event.key, event.shiftKey, snapshot.surface, snapshot.aspect,
		);
		if (!next) return;
		event.preventDefault();
		onCrop(next);
	};
	const beginDrag = (
		event: PointerEvent<HTMLButtonElement>,
		handle: WebVcrCropHandle,
	): void => {
		if (manualCropDisabled || !snapshot.surface || event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			handle,
			startClientX: event.clientX,
			startClientY: event.clientY,
			crop: snapshot.crop,
		};
	};
	const continueDrag = (event: PointerEvent<HTMLButtonElement>): void => {
		const drag = dragRef.current;
		const bounds = previewRef.current?.getBoundingClientRect();
		if (!drag || drag.pointerId !== event.pointerId || !bounds || !snapshot.surface) return;
		event.preventDefault();
		onCrop(adjustWebVcrCropByPixels(
			drag.crop,
			drag.handle,
			(event.clientX - drag.startClientX) * snapshot.surface.width / Math.max(1, bounds.width),
			(event.clientY - drag.startClientY) * snapshot.surface.height / Math.max(1, bounds.height),
			snapshot.surface,
			snapshot.aspect,
		));
	};
	const finishDrag = (event: PointerEvent<HTMLButtonElement>): void => {
		if (dragRef.current?.pointerId !== event.pointerId) return;
		dragRef.current = null;
	};

	return <section className="kw-web-vcr__preview-section" aria-labelledby="web-vcr-preview-title">
		<h4 id="web-vcr-preview-title" className="kw-audio-editor-sr-only">{copy.webVcrPreview}</h4>
		<div ref={previewRef} className="kw-web-vcr__preview" data-web-vcr-preview>
			{snapshot.previewStream
				? <video ref={videoRef} aria-label={copy.webVcrPreview} autoPlay playsInline muted />
				: <div className="kw-web-vcr__preview-empty" role="status">{copy.capturePreviewUnavailable}</div>}
			<div className="kw-web-vcr__interaction" role="application"
				tabIndex={inputDisabled ? -1 : 0} aria-disabled={inputDisabled || undefined}
				aria-label={copy.webVcrInteract}
				onPointerDown={(event) => forwardPointer(event, 'down')}
				onPointerMove={(event) => forwardPointer(event, 'move')}
				onPointerUp={(event) => forwardPointer(event, 'up')}
				onPointerCancel={(event) => forwardPointer(event, 'up')}
				onWheel={forwardWheel}
				onKeyDown={(event) => forwardKey(event, 'down')}
				onKeyUp={(event) => forwardKey(event, 'up')} />
				{snapshot.surface && <>
					{snapshot.autoCrop
						? <div className="kw-web-vcr__crop kw-web-vcr__crop--automatic" style={cropStyle} aria-hidden="true" />
						: <>
							<div className="kw-web-vcr__crop kw-web-vcr__crop--manual" style={cropStyle} aria-hidden="true" />
							<button type="button" className="kw-web-vcr__crop-handle kw-web-vcr__crop-handle--move"
								style={cropMoveHandlePosition(snapshot.crop)} aria-label={copy.webVcrMoveCrop} disabled={manualCropDisabled}
							onKeyDown={(event) => updateFromKeyboard(event, 'move')}
							onPointerDown={(event) => beginDrag(event, 'move')}
							onPointerMove={continueDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} />
						{HANDLES.map(([handle, copyKey]) => <button key={handle} type="button"
							className={`kw-web-vcr__crop-handle kw-web-vcr__crop-handle--${handle}`}
							style={cropHandlePosition(snapshot.crop, handle)}
							aria-label={copy[copyKey]} disabled={manualCropDisabled}
							onKeyDown={(event) => updateFromKeyboard(event, handle)}
							onPointerDown={(event) => beginDrag(event, handle)}
							onPointerMove={continueDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} />)}
					</>}
			</>}
		</div>
		<p className="kw-audio-editor-sr-only">{copy.webVcrCropKeyboardHint}</p>
	</section>;
}

export function webVcrPreviewKeyDisposition(
	key: string,
): 'forward' | 'local-navigation' | 'release-focus' {
	if (key === 'Tab') return 'local-navigation';
	if (key === 'Escape') return 'release-focus';
	return 'forward';
}

export function normalizeWebVcrPreviewPoint(
	bounds: Readonly<{ readonly left: number; readonly top: number; readonly width: number; readonly height: number }>,
	point: Readonly<{ readonly x: number; readonly y: number }>,
): Readonly<{ readonly x: number; readonly y: number }> {
	const width = Math.max(1, Number.isFinite(bounds.width) ? bounds.width : 1);
	const height = Math.max(1, Number.isFinite(bounds.height) ? bounds.height : 1);
	return Object.freeze({
		x: clamp((point.x - bounds.left) / width, 0, 1),
		y: clamp((point.y - bounds.top) / height, 0, 1),
	});
}

function pointerButton(
	button: number,
	action: WebVcrPointerInput['action'],
): WebVcrPointerInput['button'] {
	if (action === 'move' || action === 'wheel') return 'none';
	return button === 1 ? 'middle' : button === 2 ? 'right' : 'left';
}

function inputModifiers(value: Readonly<{
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}>): readonly WebVcrInputModifier[] {
	return Object.freeze([
		...(value.altKey ? ['alt' as const] : []),
		...(value.ctrlKey ? ['control' as const] : []),
		...(value.metaKey ? ['meta' as const] : []),
		...(value.shiftKey ? ['shift' as const] : []),
	]);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}

export function assignWebVcrPreviewStream(
	element: Pick<HTMLVideoElement, 'srcObject'> | null,
	stream: unknown,
): () => void {
	if (!element) return () => undefined;
	element.srcObject = (stream ?? null) as MediaProvider | null;
	return () => {
		if (element.srcObject === stream) element.srcObject = null;
	};
}

function cropPosition(crop: WebVcrCrop): CSSProperties {
	return {
		left: `${crop.x * 100}%`,
		top: `${crop.y * 100}%`,
		width: `${crop.width * 100}%`,
		height: `${crop.height * 100}%`,
	};
}

function cropHandlePosition(
	crop: WebVcrCrop,
	handle: Exclude<WebVcrCropHandle, 'move'>,
): CSSProperties {
	return {
		left: `${(handle.endsWith('left') ? crop.x : crop.x + crop.width) * 100}%`,
		top: `${(handle.startsWith('top') ? crop.y : crop.y + crop.height) * 100}%`,
	};
}

function cropMoveHandlePosition(crop: WebVcrCrop): CSSProperties {
	return { left: `${(crop.x + crop.width / 2) * 100}%`, top: `${(crop.y + crop.height / 2) * 100}%` };
}
