/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import {
	audioEditorStereoChannelHeightRatioAtPointer,
} from './stereo-channel-height-runtime.ts';

export interface StereoChannelDividerProps {
	readonly enabled: boolean;
	readonly top?: number;
	readonly height: number;
	readonly ratio: number;
	readonly label: string;
	readonly onPreview: (ratio: number | null) => void;
	readonly onCommit: (ratio: number) => void;
}

/** The opt-in interaction surface over the divider already painted by the canvases. */
export function StereoChannelDivider({
	enabled,
	top = 0,
	height,
	ratio,
	label,
	onPreview,
	onCommit,
}: StereoChannelDividerProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const pointerIdRef = useRef<number | null>(null);
	if (!enabled || !(height > 0)) return null;
	const minimumRatio = audioEditorStereoChannelHeightRatioAtPointer(0, 0, height);
	const maximumRatio = audioEditorStereoChannelHeightRatioAtPointer(height, 0, height);
	const pointerRatio = (event: Pick<PointerEvent<HTMLDivElement>, 'clientY'>): number => {
		const rect = rootRef.current?.getBoundingClientRect();
		return audioEditorStereoChannelHeightRatioAtPointer(
			event.clientY,
			rect?.top ?? 0,
			rect?.height || height,
		);
	};
	const stopPointerEvent = (event: Pick<PointerEvent<HTMLDivElement>, 'preventDefault' | 'stopPropagation'>) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const previewPointer = (event: PointerEvent<HTMLDivElement>) => {
		const nextRatio = pointerRatio(event);
		onPreview(nextRatio);
		return nextRatio;
	};
	const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
		if (pointerIdRef.current !== event.pointerId) return;
		const nextRatio = previewPointer(event);
		pointerIdRef.current = null;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		onCommit(nextRatio);
		onPreview(null);
		stopPointerEvent(event);
	};
	const cancelPointer = (event: PointerEvent<HTMLDivElement>) => {
		if (pointerIdRef.current !== event.pointerId) return;
		pointerIdRef.current = null;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		onPreview(null);
		stopPointerEvent(event);
	};
	const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		let nextRatio: number;
		switch (event.key) {
		case 'ArrowUp': nextRatio = ratio - 0.05; break;
		case 'ArrowDown': nextRatio = ratio + 0.05; break;
		case 'Home': nextRatio = minimumRatio; break;
		case 'End': nextRatio = maximumRatio; break;
		default: return;
		}
		event.preventDefault();
		event.stopPropagation();
		onCommit(Math.max(minimumRatio, Math.min(maximumRatio, nextRatio)));
	};
	return (
		<div
			ref={rootRef}
			data-stereo-channel-divider-root
			style={{
				position: 'absolute',
				top,
				left: 0,
				right: 0,
				height,
				pointerEvents: 'none',
				zIndex: 1002,
			}}
		>
			<div
				data-stereo-channel-divider
				role="separator"
				aria-label={label}
				aria-orientation="horizontal"
				aria-valuemin={Math.round(minimumRatio * 100)}
				aria-valuemax={Math.round(maximumRatio * 100)}
				aria-valuenow={Math.round(ratio * 100)}
				tabIndex={0}
				style={{
					position: 'absolute',
					top: `${String(ratio * 100)}%`,
					left: 0,
					width: '100%',
					height: 5,
					transform: 'translateY(-2px)',
					cursor: 'ns-resize',
					pointerEvents: 'auto',
					background: 'transparent',
				}}
				onPointerDown={(event) => {
					if (event.button !== 0 || pointerIdRef.current !== null) return;
					pointerIdRef.current = event.pointerId;
					event.currentTarget.setPointerCapture(event.pointerId);
					previewPointer(event);
					stopPointerEvent(event);
				}}
				onPointerMove={(event) => {
					if (pointerIdRef.current !== event.pointerId) return;
					previewPointer(event);
					stopPointerEvent(event);
				}}
				onPointerUp={finishPointer}
				onPointerCancel={cancelPointer}
				onKeyDown={resizeFromKeyboard}
			/>
		</div>
	);
}
