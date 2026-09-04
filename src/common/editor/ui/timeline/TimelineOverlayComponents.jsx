import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { PlayheadCursor } from '@soundscaper/design-system/PlayheadCursor';

import { audacityContextMenuAction } from '../../audacity-context-menu.js';
import { framesToSeconds, secondsToFrames } from '../../design-system-adapters.js';
import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-audio-factory.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { lowRateTimelinePositionFrame } from './timeline-playback-frame-loop.ts';
import { timelineContentLeft } from './timeline-scroll-space.ts';

export function TimelineOverlayPortal({ target, children }) {
	return target ? createPortal(children, target) : children;
}

export function manifestMenuItem(actionId, label, item, locale, disabledReason, shortcuts) {
	const action = audacityContextMenuAction(actionId, {
		locale,
		label,
		disabled: item.disabled,
		disabledReason,
		shortcut: item.shortcut,
		shortcuts,
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

export function ManifestContextMenuItem({ actionId, label, disabled, disabledReason, locale, shortcuts, onClick, ...props }) {
	const action = audacityContextMenuAction(actionId, {
		locale, label, disabled, disabledReason, shortcuts,
	});
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

export function RulerPlayhead() {
	return <div className="audio-editor-ruler-playhead" aria-hidden="true" />;
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
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => lowRateTimelinePositionFrame(telemetry, sampleRate),
	);
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
	return (
		<div
			className="audio-editor-playhead-boundary"
			data-playhead
			role="slider"
			tabIndex={0}
			aria-label={copy.playhead}
			aria-valuemin={0}
			aria-valuemax={durationFrames}
			aria-valuenow={positionFrame}
			style={{
				left: panelWidth,
				width: viewportWidth,
				touchAction: 'none',
			}}
			onPointerDownCapture={(event) => {
				if (event.button !== 0 || event.isPrimary === false || !event.target.closest?.('.playhead-cursor')) return;
				event.preventDefault();
				event.stopPropagation();
				const liveFrame = Math.max(0, Math.round(
					controller.engine?.getPositionFrames?.()
						?? controller.getTelemetrySnapshot?.().positionFrame
						?? positionFrame,
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
					const liveFrame = Math.max(0, Math.round(
						controller.getTelemetrySnapshot?.().positionFrame ?? positionFrame,
					));
					run(() => controller.actions.transport.seek(liveFrame + (event.key === 'ArrowLeft' ? -amount : amount)));
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

/**
 * The selected time range, drawn inside one track lane.
 *
 * Audacity shades the range only in the tracks the selection acts on, so each
 * row renders its own band rather than the timeline drawing a single column
 * over every track. Lane coordinates start at the clip content offset, the
 * same origin the output dock's band uses.
 */
export function TimeSelectionOverlay({ selection, pixelsPerSecond }) {
	if (!selection || selection.endTime <= selection.startTime) return null;
	return (
		<div
			className="audio-editor-time-selection-overlay"
			data-time-selection-overlay
			aria-hidden="true"
			style={{
				left: timelineContentLeft(CLIP_CONTENT_OFFSET + selection.startTime * pixelsPerSecond),
				width: Math.max(1, (selection.endTime - selection.startTime) * pixelsPerSecond),
			}}
		/>
	);
}

export function SplitToolGuideline({ guideline, panelWidth, pixelsPerSecond, sampleRate }) {
	if (!Number.isSafeInteger(guideline?.frame)) return null;
	const allTracks = guideline.allTracks === true;
	return (
		<div
			className="audio-editor-split-tool-guideline"
			data-split-tool-guideline
			data-split-tool-guideline-frame={guideline.frame}
			data-split-tool-scope={allTracks ? 'all-tracks' : 'track'}
			aria-hidden="true"
			style={{
				left: timelineContentLeft(timelineTrimPreviewGuideLeft(
					guideline.frame,
					panelWidth,
					pixelsPerSecond,
					sampleRate,
				)),
				top: allTracks ? guideline.allTop : guideline.singleTop,
				height: allTracks ? guideline.allHeight : guideline.singleHeight,
			}}
		/>
	);
}

export function TimelineTrimPreviewGuide({
	sample,
	panelWidth,
	pixelsPerSecond,
	sampleRate,
	height,
}) {
	if (!Number.isSafeInteger(sample)) return null;
	return (
		<div
			className="audio-editor-trim-preview-guide"
			data-roll-ripple-trim-guide="true"
			aria-hidden="true"
			style={{
				left: timelineContentLeft(timelineTrimPreviewGuideLeft(
					sample,
					panelWidth,
					pixelsPerSecond,
					sampleRate,
				)),
				height,
			}}
		/>
	);
}

export function TimelineRateStretchPreviewGuide({
	sample,
	edge,
	panelWidth,
	pixelsPerSecond,
	sampleRate,
	height,
}) {
	if (!Number.isSafeInteger(sample) || (edge !== 'left' && edge !== 'right')) return null;
	return (
		<div
			className="audio-editor-trim-preview-guide"
			data-rate-stretch-guide="true"
			data-rate-stretch-edge={edge}
			data-rate-stretch-boundary-sample={sample}
			aria-hidden="true"
			style={{
				left: timelineContentLeft(timelineTrimPreviewGuideLeft(
					sample,
					panelWidth,
					pixelsPerSecond,
					sampleRate,
				)),
				height,
			}}
		/>
	);
}

export function TimelineSlipSlidePreviewGuides({
	samples,
	panelWidth,
	pixelsPerSecond,
	sampleRate,
	height,
}) {
	if (!Number.isSafeInteger(samples?.start) || !Number.isSafeInteger(samples?.end)) return null;
	return <>{[
		['start', samples.start],
		['end', samples.end],
	].map(([role, sample]) => (
		<div
			key={role}
			className="audio-editor-trim-preview-guide"
			data-slip-slide-trim-guide="true"
			data-slip-slide-guide-role={role}
			aria-hidden="true"
			style={{
				left: timelineContentLeft(timelineTrimPreviewGuideLeft(
					sample,
					panelWidth,
					pixelsPerSecond,
					sampleRate,
				)),
				height,
			}}
		/>
	))}</>;
}

export function timelineTrimPreviewGuideLeft(sample, panelWidth, pixelsPerSecond, sampleRate) {
	return panelWidth + CLIP_CONTENT_OFFSET
		+ framesToSeconds(sample, { sampleRate }) * pixelsPerSecond;
}
