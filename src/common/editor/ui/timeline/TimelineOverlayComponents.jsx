import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CLIP_CONTENT_OFFSET, ContextMenuItem, PlayheadCursor } from '@dilsonspickles/components';

import { audacityContextMenuAction } from '../../audacity-context-menu.js';
import { framesToSeconds, secondsToFrames } from '../../design-system-adapters.js';
import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-v2.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';

export function TimelineOverlayPortal({ target, children }) {
	return target ? createPortal(children, target) : children;
}

export function manifestMenuItem(actionId, label, item, locale, disabledReason) {
	const action = audacityContextMenuAction(actionId, {
		locale,
		label,
		disabled: item.disabled,
		disabledReason,
		shortcut: item.shortcut,
	});
	if (action.hidden) return null;
	return {
		...item,
		label: <ContextActionLabel action={action} />,
		shortcut: action.shortcut || undefined,
		disabled: action.disabled,
		onClick: action.disabled ? undefined : item.onClick,
	};
}

export function ManifestContextMenuItem({ actionId, label, disabled, disabledReason, locale, onClick, ...props }) {
	const action = audacityContextMenuAction(actionId, { locale, label, disabled, disabledReason });
	if (action.hidden) return null;
	return (
		<ContextMenuItem
			{...props}
			label={<ContextActionLabel action={action} />}
			shortcut={action.shortcut || undefined}
			disabled={action.disabled}
			onClick={action.disabled ? undefined : onClick}
		/>
	);
}

export function ContextActionLabel({ action }) {
	return (
		<span
			data-action-id={action.actionId}
			data-parity-status={action.parityStatus}
			data-action-origin={action.origin}
			data-enable-when={action.enableWhen || undefined}
			data-upstream-action={action.upstreamAction || undefined}
			data-disabled-reason={action.disabledReason || undefined}
			title={action.disabledReason || undefined}
		>
			{action.label}
		</span>
	);
}

export function colorName(copy, color) {
	return copy[`color${color[0].toUpperCase()}${color.slice(1)}`] || color;
}

export function resolveAudioEditorColor(color, fallback = AUDIO_EDITOR_TRACK_COLORS[0]) {
	if (AUDIO_EDITOR_TRACK_COLORS.includes(color)) return color;
	const aliases = { purple: 'violet', pink: 'magenta', grey: fallback, gray: fallback };
	if (aliases[color]) return aliases[color];
	const index = Number(color);
	return Number.isSafeInteger(index)
		? AUDIO_EDITOR_TRACK_COLORS[index % AUDIO_EDITOR_TRACK_COLORS.length]
		: fallback;
}

export function TelemetryRulerPlayhead({
	controller,
	pixelsPerSecond,
	scrollX,
	sampleRate,
	viewportWidth,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const cursorRef = useRef(null);
	useEffect(() => {
		const cursor = cursorRef.current;
		if (!cursor) return undefined;
		let animationFrame = 0;
		const update = (frame) => {
			const x = CLIP_CONTENT_OFFSET + framesToSeconds(frame, { sampleRate }) * pixelsPerSecond - scrollX;
			cursor.style.transform = `translate3d(${x}px, 0, 0)`;
			cursor.style.visibility = x >= CLIP_CONTENT_OFFSET && x <= viewportWidth ? 'visible' : 'hidden';
		};
		const draw = () => {
			update(controller.engine?.getPositionFrames?.() ?? positionFrame);
			animationFrame = globalThis.requestAnimationFrame(draw);
		};
		update(positionFrame);
		if (transportState === 'playing') animationFrame = globalThis.requestAnimationFrame(draw);
		return () => {
			if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
		};
	}, [controller, pixelsPerSecond, positionFrame, sampleRate, scrollX, transportState, viewportWidth]);
	const x = CLIP_CONTENT_OFFSET + framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond - scrollX;
	return (
		<div
			className="audio-editor-ruler-playhead"
			aria-hidden="true"
			ref={cursorRef}
			style={{
				transform: `translate3d(${x}px, 0, 0)`,
				visibility: x >= CLIP_CONTENT_OFFSET && x <= viewportWidth ? 'visible' : 'hidden',
			}}
		/>
	);
}

export function PinnedPlayheadScroller({
	controller,
	enabled,
	pixelsPerSecond,
	sampleRate,
	scrollRef,
	timelineWidth,
	transportState,
	viewportWidth,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	useEffect(() => {
		const element = scrollRef.current;
		if (!element || !enabled || transportState !== 'playing') return;
		const positionPixels = framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond;
		const maximumScroll = Math.max(0, timelineWidth - viewportWidth);
		const nextScroll = Math.max(0, Math.min(maximumScroll, positionPixels - viewportWidth / 2));
		if (Math.abs(element.scrollLeft - nextScroll) > 1) element.scrollLeft = nextScroll;
	}, [enabled, pixelsPerSecond, positionFrame, sampleRate, scrollRef, timelineWidth, transportState, viewportWidth]);
	return null;
}

export function TelemetryPlayhead({
	controller,
	copy,
	durationFrames,
	panelWidth,
	viewportWidth,
	pixelsPerSecond,
	sampleRate,
	height,
	run,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const playheadRef = useRef(null);
	const scrubbingRef = useRef(false);
	const scrubDragRef = useRef(null);
	const finishScrub = useCallback(() => {
		if (!scrubbingRef.current) return;
		scrubbingRef.current = false;
		scrubDragRef.current = null;
		run(() => controller.actions.transport.endScrub?.());
	}, [controller, run]);
	const finishPointerScrub = useCallback((event) => {
		if (event?.pointerId != null && scrubDragRef.current?.pointerId !== event.pointerId) return;
		finishScrub();
	}, [finishScrub]);
	useEffect(() => {
		globalThis.addEventListener('pointerup', finishPointerScrub);
		globalThis.addEventListener('pointercancel', finishPointerScrub);
		globalThis.addEventListener('blur', finishScrub);
		return () => {
			globalThis.removeEventListener('pointerup', finishPointerScrub);
			globalThis.removeEventListener('pointercancel', finishPointerScrub);
			globalThis.removeEventListener('blur', finishScrub);
			finishScrub();
		};
	}, [finishPointerScrub, finishScrub]);
	useEffect(() => {
		const playhead = playheadRef.current;
		if (!playhead) return undefined;
		let animationFrame = 0;
		const update = (frame) => {
			const x = CLIP_CONTENT_OFFSET + framesToSeconds(frame, { sampleRate }) * pixelsPerSecond;
			playhead.style.setProperty('--playhead-x', `${x}px`);
		};
		const draw = () => {
			update(controller.engine?.getPositionFrames?.() ?? positionFrame);
			animationFrame = globalThis.requestAnimationFrame(draw);
		};
		update(positionFrame);
		if (transportState === 'playing') animationFrame = globalThis.requestAnimationFrame(draw);
		return () => {
			if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
		};
	}, [controller, pixelsPerSecond, positionFrame, sampleRate, transportState]);
	const positionPixels = CLIP_CONTENT_OFFSET + framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond;
	return (
		<div
			className="audio-editor-playhead-boundary"
			data-playhead
			ref={playheadRef}
			role="slider"
			tabIndex={0}
			aria-label={copy.playhead}
			aria-valuemin={0}
			aria-valuemax={durationFrames}
			aria-valuenow={positionFrame}
			style={{
				'--playhead-x': `${positionPixels}px`,
				left: panelWidth,
				width: viewportWidth,
				touchAction: 'none',
			}}
			onPointerDownCapture={(event) => {
				if (event.button !== 0 || event.isPrimary === false || !event.target.closest?.('.playhead-cursor')) return;
				event.preventDefault();
				event.stopPropagation();
				const liveFrame = Math.max(0, Math.round(
					controller.engine?.getPositionFrames?.() ?? positionFrame,
				));
				scrubDragRef.current = {
					pointerId: event.pointerId,
					clientX: event.clientX,
					startFrame: liveFrame,
				};
				event.currentTarget.setPointerCapture?.(event.pointerId);
				scrubbingRef.current = true;
				// Resume Web Audio from the initiating gesture; later pointer moves
				// are not consistently treated as activation by browsers.
				run(() => controller.actions.transport.scrub(liveFrame));
			}}
			onPointerMoveCapture={(event) => {
				const drag = scrubDragRef.current;
				if (!drag || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				const frame = Math.max(0, Math.min(
					durationFrames,
					Math.round(drag.startFrame + (event.clientX - drag.clientX) / pixelsPerSecond * sampleRate),
				));
				run(() => controller.actions.transport.scrub(frame));
			}}
			onPointerUpCapture={(event) => {
				if (scrubDragRef.current?.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.releasePointerCapture?.(event.pointerId);
				finishScrub();
			}}
				onPointerCancelCapture={finishPointerScrub}
				onLostPointerCapture={finishPointerScrub}
			onKeyDown={(event) => {
				const amount = event.shiftKey ? Math.round(sampleRate / 10) : 1;
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					event.preventDefault();
					run(() => controller.actions.transport.seek(positionFrame + (event.key === 'ArrowLeft' ? -amount : amount)));
				} else if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					run(() => controller.actions.transport.seek(event.key === 'Home' ? 0 : durationFrames));
				}
			}}
		>
			<PlayheadCursor
				position={framesToSeconds(positionFrame, { sampleRate })}
				pixelsPerSecond={pixelsPerSecond}
				height={height}
				showTopIcon
				iconTopOffset={-17}
				minPosition={0}
				onPositionChange={(seconds) => {
					const frame = secondsToFrames(seconds, { maximumFrame: durationFrames, sampleRate });
					return run(() => scrubbingRef.current
						? controller.actions.transport.scrub(frame)
						: controller.actions.transport.seek(frame));
				}}
			/>
		</div>
	);
}

export function TimeSelectionOverlay({ selection, panelWidth, pixelsPerSecond, height }) {
	if (!selection || selection.endTime <= selection.startTime) return null;
	return (
		<div
			className="audio-editor-time-selection-overlay"
			data-time-selection-overlay
			aria-hidden="true"
			style={{
				left: panelWidth + CLIP_CONTENT_OFFSET + selection.startTime * pixelsPerSecond,
				width: Math.max(1, (selection.endTime - selection.startTime) * pixelsPerSecond),
				height,
			}}
		/>
	);
}
