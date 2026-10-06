/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useLayoutEffect, useRef } from 'react';

import type { AutomationLaneV21 } from '../../automation-lane-v21.ts';
import type { ParameterDescriptor } from '../../parameter-address.ts';
import {
	selectedTrackAutomationSegmentKind,
	trackAutomationSegmentKindLabel,
	trackAutomationSegmentKinds,
	type TrackAutomationSegmentKind,
} from './track-automation-overlay-bezier.ts';

export interface TrackAutomationCurveMenuState {
	readonly x: number;
	readonly y: number;
	readonly segmentIndex: number | null;
	readonly returnFocus: SVGPathElement;
}

function createTrackAutomationCurveMenuState(
	returnFocus: SVGPathElement,
	frame: number,
	x: number,
	y: number,
	points: readonly Readonly<{ frame: number }>[],
): TrackAutomationCurveMenuState {
	const segmentIndex = points.findIndex((point, index) => (
		index < points.length - 1 && frame >= point.frame && frame <= points[index + 1]!.frame
	));
	return { x, y, segmentIndex: segmentIndex < 0 ? null : segmentIndex, returnFocus };
}

export function createPointerTrackAutomationCurveMenuState(
	event: React.MouseEvent<SVGPathElement>,
	frame: number,
	svg: SVGSVGElement | null,
	bodyTop: number,
	points: readonly Readonly<{ frame: number }>[],
): TrackAutomationCurveMenuState {
	const rect = svg?.getBoundingClientRect();
	return createTrackAutomationCurveMenuState(event.currentTarget, frame,
		rect ? event.clientX - rect.left : 12,
		rect ? event.clientY - rect.top : bodyTop,
		points);
}

export function createKeyboardTrackAutomationCurveMenuState(
	path: SVGPathElement,
	span: Readonly<{ startFrame: number; endFrame: number }>,
	svg: SVGSVGElement | null,
	bodyTop: number,
	points: readonly Readonly<{ frame: number }>[],
): TrackAutomationCurveMenuState {
	const rect = path.getBoundingClientRect();
	const svgRect = svg?.getBoundingClientRect();
	return createTrackAutomationCurveMenuState(path,
		Math.round((span.startFrame + span.endFrame) / 2),
		svgRect ? rect.left + rect.width / 2 - svgRect.left : 12,
		svgRect ? rect.top + rect.height / 2 - svgRect.top : bodyTop,
		points);
}

export function TrackAutomationCurveMenu({
	menu,
	lane,
	descriptor,
	width,
	height,
	bodyTop,
	copy,
	onKind,
	onDelete,
	onClose,
}: Readonly<{
	menu: TrackAutomationCurveMenuState;
	lane: AutomationLaneV21 | null;
	descriptor: ParameterDescriptor;
	width: number;
	height: number;
	bodyTop: number;
	copy: Readonly<Record<string, string | undefined>>;
	onKind: (kind: TrackAutomationSegmentKind) => void;
	onDelete: () => void;
	onClose: () => void;
}>) {
	const surfaceRef = useRef<HTMLDivElement>(null);
	const returnFocus = menu.returnFocus;
	useEffect(() => {
		const surface = surfaceRef.current;
		const document = surface?.ownerDocument;
		if (!surface || !document) return;
		const closeOutside = (event: PointerEvent) => {
			if (!surface.contains(event.target as Node | null)) onClose();
		};
		document.addEventListener('pointerdown', closeOutside, true);
		return () => document.removeEventListener('pointerdown', closeOutside, true);
	}, [onClose]);
	useLayoutEffect(() => {
		surfaceRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]')
			?.focus({ preventScroll: true });
	}, [menu]);
	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
			if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		const items = Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>(
			'[role="menuitemradio"], [role="menuitem"]',
		) || []);
		if (!items.length) return;
		event.preventDefault();
		event.stopPropagation();
		const current = items.indexOf(event.target as HTMLButtonElement);
		const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
			: (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next]?.focus({ preventScroll: true });
	};
	const activate = (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
		action();
		if (event.detail === 0 && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
	};
	return <foreignObject
		className="audio-editor-track-automation-menu"
		data-track-automation-interactive
		x={Math.max(2, Math.min(width - 154, menu.x))}
		y={Math.max(bodyTop, Math.min(height - 154, menu.y))}
		width={152}
		height={152}
	>
		<div
			ref={surfaceRef}
			className="audio-editor-track-automation-menu__surface"
			role="menu"
			aria-label={copy.automationCurveMenu || 'Automation curve'}
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={onKeyDown}
		>
			{menu.segmentIndex !== null && trackAutomationSegmentKinds(descriptor).map((kind) => <button
				key={kind}
				type="button"
				role="menuitemradio"
				aria-checked={selectedTrackAutomationSegmentKind(lane, menu.segmentIndex) === kind}
				onClick={(event) => activate(event, () => onKind(kind))}
			>
				{trackAutomationSegmentKindLabel(kind, copy)}
			</button>)}
			{lane && <button
				type="button"
				role="menuitem"
				className="audio-editor-track-automation-menu__delete"
				onClick={(event) => activate(event, onDelete)}
			>
				{copy.automationDeleteLane || 'Delete automation lane'}
			</button>}
			<button type="button" role="menuitem" onClick={(event) => activate(event, onClose)}>{copy.close || 'Close'}</button>
		</div>
	</foreignObject>;
}
