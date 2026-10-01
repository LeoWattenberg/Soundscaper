/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

import {
	observeTrackViewportRow,
	registerTrackViewportReveal,
} from './track-viewport-observer.ts';

interface TrackViewportRowProps {
	enabled: boolean;
	trackId: string;
	trackIndex: number;
	trackName: string;
	height: number;
	panelWidth: number;
	headerWidth: number;
	tabIndex: number;
	children: ReactNode;
}

/** Keep layout, tab order and pointer ownership while offscreen content sleeps. */
export function TrackViewportRow({
	enabled, trackId, trackIndex, trackName, height, panelWidth, headerWidth, tabIndex, children,
}: TrackViewportRowProps) {
	const slotRef = useRef<HTMLDivElement>(null);
	const nativeDragRef = useRef(false);
	const [visible, setVisible] = useState(false);
	const [focused, setFocused] = useState(false);
	const [interacting, setInteracting] = useState(false);
	const mounted = !enabled || visible || focused || interacting;
	const reveal = useCallback(() => {
		flushSync(() => { setVisible(true); });
		slotRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}, []);
	useLayoutEffect(() => {
		if (!enabled) return undefined;
		const slot = slotRef.current;
		if (!slot) return undefined;
		const stopObserving = observeTrackViewportRow(slot, setVisible, (nativeDrag) => {
			if (nativeDrag) nativeDragRef.current = true;
			setInteracting(true);
		});
		const stopRevealing = registerTrackViewportReveal(slot, reveal);
		return () => { stopObserving(); stopRevealing(); };
	}, [enabled, reveal]);
	useEffect(() => {
		if (!interacting) return undefined;
		const finish = (event: Event) => {
			if (event.type === 'dragend') nativeDragRef.current = false;
			if (!nativeDragRef.current) setInteracting(false);
		};
		document.addEventListener('pointerup', finish, true);
		document.addEventListener('pointercancel', finish, true);
		document.addEventListener('dragend', finish, true);
		return () => {
			document.removeEventListener('pointerup', finish, true);
			document.removeEventListener('pointercancel', finish, true);
			document.removeEventListener('dragend', finish, true);
		};
	}, [interacting]);
	return <div
		ref={slotRef}
		data-track-viewport-row
		data-track-index={trackIndex}
		data-track-mounted={mounted ? 'true' : 'false'}
		style={{ height }}
		onPointerDownCapture={() => { setInteracting(true); }}
		onDragStartCapture={() => { nativeDragRef.current = true; setInteracting(true); }}
		onFocusCapture={(event) => {
			setFocused(true);
			if (!mounted) {
				const previous = event.relatedTarget;
				const reverse = previous instanceof Node
					&& Boolean((slotRef.current?.compareDocumentPosition(previous) || 0) & Node.DOCUMENT_POSITION_FOLLOWING);
				reveal();
				const slot = slotRef.current;
				const candidates = slot?.querySelectorAll<HTMLElement>('[tabindex]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"])');
				const target = reverse ? candidates?.item((candidates?.length || 1) - 1) : slot?.querySelector<HTMLElement>('.track');
				target?.focus({ preventScroll: true });
			}
		}}
		onBlurCapture={(event) => {
			if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
				setFocused(false);
			}
		}}
	>
		{mounted ? children : <div
			className="audio-editor-track-row"
			data-track-row
			data-track-id={trackId}
			data-track-index={trackIndex}
			style={{ height }}
		>
			<div data-track-header style={{ width: headerWidth, height }} aria-hidden="true">
				<span data-track-name>{trackName}</span>
			</div>
			<div className="audio-editor-track-lane" data-track-lane data-track-id={trackId}
				style={{ marginLeft: panelWidth, width: `calc(100% - ${panelWidth}px)`, height }}>
				<div className="track" role="group" aria-label={trackName} tabIndex={tabIndex} style={{ height }} />
			</div>
		</div>}
	</div>;
}
