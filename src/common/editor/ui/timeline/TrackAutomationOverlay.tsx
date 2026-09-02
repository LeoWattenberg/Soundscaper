/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
	evaluateAutomationLaneAtFrameV21,
	resolveAutomationLanePointFramesV21,
	type AutomationLaneV21,
} from '../../automation-lane-v21.ts';
import {
	createAutomationLaneAtFrameV21,
	insertAutomationLanePointV21,
	moveAutomationLaneBezierControlV21,
	moveAutomationLanePointV21,
	removeAutomationLanePointV21,
	setAutomationLaneSegmentKindV21,
} from '../../automation-lane-inline-edit-v21.ts';
import { createStableId } from '../../stable-id.js';
import type { HoldTempoMap } from '../../timeline-time.ts';
import type { TrackAutomationRuntime } from '../../track-automation-runtime.ts';
import {
	automationNormalizedToValueV21,
	type TrackAutomationTargetV21,
} from '../../track-automation-targets-v21.ts';
import {
	projectTrackAutomationOverlayV21,
	type TrackAutomationOverlayClipV21,
} from './track-automation-overlay-projection.ts';
import {
	projectTrackAutomationBezierHandlesV21,
	trackAutomationPathData,
	trackAutomationSegmentKindKey,
	type ProjectedTrackAutomationBezierHandle,
	type TrackAutomationSegmentKind,
} from './track-automation-overlay-bezier.ts';
import { TrackAutomationCurveMenu } from './TrackAutomationCurveMenu.tsx';
import { useTrackAutomationEditFeedback } from './useTrackAutomationEditFeedback.ts';

type SegmentKind = TrackAutomationSegmentKind;

interface AutomationEditController {
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
	}>;
}

interface PointDragState {
	readonly kind: 'point';
	readonly expected: AutomationLaneV21 | null;
	readonly pointId: string;
}

interface BezierDragState {
	readonly kind: 'bezier';
	readonly expected: AutomationLaneV21;
	readonly segmentIndex: number;
	readonly control: 'control1' | 'control2';
	readonly segmentStartFrame: number;
	readonly segmentEndFrame: number;
}

type DragState = PointDragState | BezierDragState;

interface CurveMenuState {
	readonly x: number;
	readonly y: number;
	readonly segmentIndex: number | null;
}

export interface TrackAutomationOverlayProps {
	readonly controller: AutomationEditController;
	readonly target: TrackAutomationTargetV21;
	readonly clips: readonly TrackAutomationOverlayClipV21[];
	readonly renderViewportStartFrame: number;
	readonly viewportDurationFrames: number;
	readonly overscanStartFrame: number;
	readonly overscanEndFrame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly tempoMap?: HoldTempoMap;
	readonly runtime?: Readonly<TrackAutomationRuntime> | null;
	readonly clipGainToolEnabled?: boolean;
	readonly disabled?: boolean;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly run: (operation: () => unknown) => unknown;
}

/** Inline descriptor-aware lane editor, clipped to the audio clips it controls. */
export function TrackAutomationOverlay({
	controller,
	target,
	clips,
	renderViewportStartFrame,
	viewportDurationFrames,
	overscanStartFrame,
	overscanEndFrame,
	pixelsPerSecond,
	sampleRate,
	width,
	height,
	tempoMap,
	runtime = null,
	clipGainToolEnabled = false,
	disabled = false,
	copy,
	run,
}: TrackAutomationOverlayProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const draftLaneRef = useRef<AutomationLaneV21 | null>(null);
	const [draftLane, setDraftLane] = useState<AutomationLaneV21 | null>(null);
	const [curveMenu, setCurveMenu] = useState<CurveMenuState | null>(null);
	const { feedback, attempt } = useTrackAutomationEditFeedback();
	const lane = draftLane ?? target.lane;
	useEffect(() => {
		dragRef.current = null;
		draftLaneRef.current = null;
		setDraftLane(null);
		setCurveMenu(null);
	}, [target.key, target.lane]);
	const projection = useMemo(() => projectTrackAutomationOverlayV21({
		descriptor: target.descriptor,
		lane,
		currentValue: target.currentValue,
		clips,
		viewportStartFrame: renderViewportStartFrame,
		viewportEndFrame: renderViewportStartFrame + viewportDurationFrames,
		projectionStartFrame: overscanStartFrame,
		projectionEndFrame: overscanEndFrame,
		pixelsPerSecond,
		sampleRate,
		width,
		height,
		tempoMap,
	}), [clips, height, lane, overscanEndFrame, overscanStartFrame, pixelsPerSecond,
		renderViewportStartFrame, sampleRate, target.currentValue, target.descriptor,
		tempoMap, viewportDurationFrames, width]);
	const bezierHandles = useMemo(() => projectTrackAutomationBezierHandlesV21({
		lane,
		descriptor: target.descriptor,
		spans: projection.spans,
		coordinateStartFrame: overscanStartFrame,
		pixelsPerSecond,
		sampleRate,
		bodyTop: projection.bodyTop,
		bodyHeight: projection.bodyHeight,
		tempoMap,
	}), [lane, overscanStartFrame, pixelsPerSecond, projection.bodyHeight,
		projection.bodyTop, projection.spans, sampleRate, target.descriptor, tempoMap]);
	const interactive = !disabled && !clipGainToolEnabled && !target.disabledReason;
	const editOptions = { descriptor: target.descriptor, sampleRate, tempoMap };
	const updateDraftLane = (value: AutomationLaneV21 | null) => {
		draftLaneRef.current = value;
		setDraftLane(value);
	};
	const commitLane = (replacement: AutomationLaneV21 | null, expected = target.lane) => {
		if (replacement === null && expected === null) return;
		if (JSON.stringify(replacement) === JSON.stringify(expected)) return;
		const editRuntime = runtime;
		if (editRuntime && editRuntime.snapshot.mode !== 'read') {
			run(() => editRuntime.setMode('read', null));
		}
		const laneId = replacement?.id ?? expected?.id;
		if (!laneId) return;
		run(() => controller.actions.edit.commit(Object.freeze({
			type: 'automation-lane/set',
			laneId,
			expected,
			lane: replacement,
		})));
	};
	const beginPointDrag = (
		event: React.PointerEvent<SVGElement>,
		span: Readonly<{ startFrame: number; endFrame: number }>,
		pointId?: string,
	) => {
		if (!interactive || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const frame = frameAtPointer(event.clientX, span.startFrame, span.endFrame);
		let next = lane;
		let editPointId = pointId;
		if (!next) {
			const createdPointIds: string[] = [];
			next = createAutomationLaneAtFrameV21({
				...editOptions,
				address: target.address,
				currentValue: target.currentValue,
				frame,
				value: valueAtPointer(event.clientY, projection.bodyTop, projection.bodyHeight),
				createId: (prefix) => {
					const id = createStableId(prefix);
					if (prefix === 'automation-point') createdPointIds.push(id);
					return id;
				},
			});
			editPointId = createdPointIds.at(-1);
		} else if (!editPointId) {
			const existing = resolvedPoints(next).find((point) => point.frame === frame);
			if (existing) editPointId = existing.id;
			else {
				editPointId = createStableId('automation-point');
				next = insertAutomationLanePointV21(next, {
					...editOptions,
					frame,
					value: evaluateAutomationLaneAtFrameV21(next, frame, editOptions),
					pointId: editPointId,
				});
			}
		}
		if (!editPointId) return;
		updateDraftLane(next);
		dragRef.current = {
			kind: 'point',
			expected: target.lane,
			pointId: editPointId,
		};
		svgRef.current?.setPointerCapture?.(event.pointerId);
	};
	const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
		const drag = dragRef.current;
		const current = draftLaneRef.current;
		if (!drag || !current) return;
		event.preventDefault();
		event.stopPropagation();
		if (drag.kind === 'bezier') {
			const requestedFrame = frameAtPointer(
				event.clientX, drag.segmentStartFrame, drag.segmentEndFrame,
			);
			const value = valueAtPointer(event.clientY, projection.bodyTop, projection.bodyHeight);
			updateDraftLane(moveAutomationLaneBezierControlV21(current, {
				...editOptions, segmentIndex: drag.segmentIndex, control: drag.control,
				frame: requestedFrame, value,
			}));
			return;
		}
		const requestedFrame = frameAtPointer(
			event.clientX, 0, Number.MAX_SAFE_INTEGER,
		);
		const nextFrame = constrainedFrame(current, drag.pointId, requestedFrame);
		const value = valueAtPointer(event.clientY, projection.bodyTop, projection.bodyHeight);
		updateDraftLane(moveAutomationLanePointV21(current, {
			...editOptions, pointId: drag.pointId, frame: nextFrame, value,
		}));
	};
	const finishPointDrag = (event: React.PointerEvent<SVGSVGElement>, cancel = false) => {
		const drag = dragRef.current;
		if (!drag) return;
		event.preventDefault();
		event.stopPropagation();
		dragRef.current = null;
		const replacement = draftLaneRef.current;
		updateDraftLane(null);
		if (!cancel && replacement) commitLane(replacement, drag.expected);
	};
	const removePoint = (pointId: string, explicitLaneDelete = false) => {
		if (!interactive || !lane) return;
		if (lane.points.length === 1) {
			if (explicitLaneDelete) commitLane(null);
			return;
		}
		commitLane(removeAutomationLanePointV21(lane, {
			pointId, descriptor: target.descriptor,
		}));
	};
	const editPointFromKeyboard = (event: React.KeyboardEvent<SVGCircleElement>, pointId: string) => {
		if (!interactive || !lane) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			removePoint(pointId, event.shiftKey);
			return;
		}
		const kind = trackAutomationSegmentKindKey(event.key);
		if (kind) {
			event.preventDefault();
			setOutgoingSegmentKind(lane, pointId, kind);
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		const points = resolvedPoints(lane);
		const point = points.find((candidate) => candidate.id === pointId);
		if (!point) return;
		const horizontal = event.shiftKey ? Math.max(1, Math.round(sampleRate / 10)) : 1;
		const vertical = target.descriptor.step
			?? (target.descriptor.maximum - target.descriptor.minimum) / 100;
		const requestedFrame = point.frame + (event.key === 'ArrowLeft' ? -horizontal
			: event.key === 'ArrowRight' ? horizontal : 0);
		const requestedValue = point.value + (event.key === 'ArrowUp' ? vertical
			: event.key === 'ArrowDown' ? -vertical : 0) * (event.shiftKey ? 10 : 1);
		commitLane(moveAutomationLanePointV21(lane, {
			...editOptions,
			pointId,
			frame: constrainedFrame(lane, pointId, Math.max(0, requestedFrame)),
			value: requestedValue,
		}));
	};
	const insertPointAtFrame = (frame: number) => {
		if (!interactive) return;
		if (!lane) {
			commitLane(createAutomationLaneAtFrameV21({
				...editOptions,
				address: target.address,
				currentValue: target.currentValue,
				frame,
				value: target.currentValue,
				createId: createStableId,
			}), null);
			return;
		}
		if (resolvedPoints(lane).some((point) => point.frame === frame)) return;
		commitLane(insertAutomationLanePointV21(lane, {
			...editOptions,
			frame,
			value: evaluateAutomationLaneAtFrameV21(lane, frame, editOptions),
			pointId: createStableId('automation-point'),
		}));
	};
	const editCurveFromKeyboard = (
		event: React.KeyboardEvent<SVGPathElement>,
		span: Readonly<{ startFrame: number; endFrame: number }>,
	) => {
		if (!interactive) return;
		if (event.key === 'Enter' || event.key.toLowerCase() === 'i') {
			event.preventDefault();
			event.stopPropagation();
			insertPointAtFrame(Math.round((span.startFrame + span.endFrame) / 2));
		} else if (event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace') && lane) {
			event.preventDefault();
			event.stopPropagation();
			commitLane(null);
		}
	};
	const beginBezierDrag = (
		event: React.PointerEvent<SVGCircleElement>,
		handle: ProjectedTrackAutomationBezierHandle,
	) => {
		if (!interactive || !lane || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		setCurveMenu(null);
		updateDraftLane(lane);
		dragRef.current = {
			kind: 'bezier',
			expected: target.lane!,
			segmentIndex: handle.segmentIndex,
			control: handle.control,
			segmentStartFrame: handle.segmentStartFrame,
			segmentEndFrame: handle.segmentEndFrame,
		};
		svgRef.current?.setPointerCapture?.(event.pointerId);
	};
	const editBezierFromKeyboard = (
		event: React.KeyboardEvent<SVGCircleElement>,
		handle: ProjectedTrackAutomationBezierHandle,
	) => {
		if (!interactive || !lane
			|| !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const horizontal = event.shiftKey ? Math.max(1, Math.round(sampleRate / 10)) : 1;
		const vertical = target.descriptor.step
			?? (target.descriptor.maximum - target.descriptor.minimum) / 100;
		commitLane(moveAutomationLaneBezierControlV21(lane, {
			...editOptions,
			segmentIndex: handle.segmentIndex,
			control: handle.control,
			frame: Math.max(0, handle.frame + (event.key === 'ArrowLeft' ? -horizontal
				: event.key === 'ArrowRight' ? horizontal : 0)),
			value: handle.value + (event.key === 'ArrowUp' ? vertical
				: event.key === 'ArrowDown' ? -vertical : 0) * (event.shiftKey ? 10 : 1),
		}));
	};
	const renderedPointIds = new Set<string>();

	return (
		<svg
			ref={svgRef}
			className="audio-editor-track-automation-overlay"
			data-track-automation-overlay
			data-track-automation-target={target.key}
			data-track-automation-interactive={interactive ? 'true' : undefined}
			data-clip-gain-precedence={clipGainToolEnabled ? 'true' : undefined}
			width={width}
			height={height}
			role="group"
			aria-label={`${target.label} ${copy.automation || 'automation'}`}
			onClick={interactive ? (event) => event.stopPropagation() : undefined}
			onPointerMove={(event) => attempt(() => movePoint(event))}
			onPointerUp={(event) => attempt(() => finishPointDrag(event))}
			onPointerCancel={(event) => finishPointDrag(event, true)}
		>
			{projection.spans.map((span) => {
				const path = trackAutomationPathData(span.samples);
				return <g key={span.clipId} data-automation-clip-id={span.clipId}>
					<path className="audio-editor-track-automation-curve" d={path} />
					{interactive && <path
						className="audio-editor-track-automation-hit"
						data-track-automation-interactive
						data-automation-insert-point
						d={path}
						role="button"
						aria-label={`${copy.automationInsertPoint || 'Insert automation point'}: ${target.label}`}
						tabIndex={0}
						onPointerDown={(event) => attempt(() => beginPointDrag(event, span))}
						onKeyDown={(event) => attempt(() => editCurveFromKeyboard(event, span))}
						onContextMenu={(event) => attempt(() => openCurveMenu(event, span))}
					/>}
					{span.points.map((point) => {
						if (renderedPointIds.has(point.id)) return null;
						renderedPointIds.add(point.id);
						return <circle
							key={point.id}
							className="audio-editor-track-automation-point"
							data-track-automation-interactive={interactive ? '' : undefined}
							data-automation-point-id={point.id}
							cx={point.x}
							cy={point.y}
							r={4}
							role="slider"
							aria-label={`${target.label}: ${String(point.value)}`}
							aria-valuemin={target.descriptor.minimum}
							aria-valuemax={target.descriptor.maximum}
							aria-valuenow={point.value}
							tabIndex={interactive ? 0 : -1}
							onPointerDown={(event) => attempt(() => event.altKey
								? (event.preventDefault(), event.stopPropagation(), removePoint(point.id))
								: beginPointDrag(event, span, point.id))}
							onKeyDown={(event) => attempt(() => editPointFromKeyboard(event, point.id))}
						/>;
					})}
				</g>;
			})}
			{bezierHandles.map((handle) => <g
				key={handle.key}
				className="audio-editor-track-automation-bezier"
				data-automation-bezier-segment={handle.segmentIndex}
			>
				<line
					className="audio-editor-track-automation-bezier-guide"
					x1={handle.anchorX}
					y1={handle.anchorY}
					x2={handle.x}
					y2={handle.y}
				/>
				<circle
					className="audio-editor-track-automation-bezier-handle"
					data-track-automation-interactive={interactive ? '' : undefined}
					data-automation-bezier-control={`${String(handle.segmentIndex)}:${handle.control}`}
					cx={handle.x}
					cy={handle.y}
					r={4}
					role="slider"
					aria-label={`${target.label} ${handle.control === 'control1'
						? copy.automationFirstBezierControl || 'first Bézier control'
						: copy.automationSecondBezierControl || 'second Bézier control'}`}
					aria-valuemin={target.descriptor.minimum}
					aria-valuemax={target.descriptor.maximum}
					aria-valuenow={handle.value}
					tabIndex={interactive ? 0 : -1}
					onPointerDown={(event) => attempt(() => beginBezierDrag(event, handle))}
					onKeyDown={(event) => attempt(() => editBezierFromKeyboard(event, handle))}
				/>
			</g>)}
			{feedback && <text role="status" aria-live="polite" className="kw-audio-editor-sr-only">{feedback}</text>}
			{curveMenu && interactive && <TrackAutomationCurveMenu
				menu={curveMenu} lane={lane} descriptor={target.descriptor}
				width={width} height={height} bodyTop={projection.bodyTop} copy={copy}
				onKind={(kind) => attempt(() => applyMenuSegmentKind(kind))}
				onDelete={() => attempt(() => { setCurveMenu(null); commitLane(null); })}
				onClose={() => setCurveMenu(null)}
			/>}
		</svg>
	);

	function frameAtPointer(clientX: number, minimum: number, maximum: number): number {
		const rect = svgRef.current?.getBoundingClientRect();
		const x = rect ? clientX - rect.left : 12;
		const requested = Math.round(overscanStartFrame
			+ (x - 12) / pixelsPerSecond * sampleRate);
		return Math.max(minimum, Math.min(maximum, requested));
	}

	function valueAtPointer(clientY: number, bodyTop: number, bodyHeight: number): number {
		const rect = svgRef.current?.getBoundingClientRect();
		const y = rect ? clientY - rect.top : bodyTop + bodyHeight / 2;
		return automationNormalizedToValueV21(
			target.descriptor,
			1 - (y - bodyTop) / bodyHeight,
		);
	}

	function resolvedPoints(value: AutomationLaneV21) {
		return resolveAutomationLanePointFramesV21(value, { sampleRate, tempoMap });
	}

	function setOutgoingSegmentKind(value: AutomationLaneV21, pointId: string, kind: SegmentKind) {
		const index = value.points.findIndex((point) => point.id === pointId);
		if (index < 0 || index >= value.segments.length) return;
		commitLane(setAutomationLaneSegmentKindV21(value, {
			segmentIndex: index, kind, descriptor: target.descriptor,
		}));
	}

	function openCurveMenu(
		event: React.MouseEvent<SVGPathElement>,
		span: Readonly<{ startFrame: number; endFrame: number }>,
	) {
		if (!interactive) return;
		event.preventDefault();
		event.stopPropagation();
		const frame = frameAtPointer(event.clientX, span.startFrame, span.endFrame);
		const points = lane ? resolvedPoints(lane) : [];
		const segmentIndex = points.findIndex((point, pointIndex) => (
			pointIndex < points.length - 1 && frame >= point.frame && frame <= points[pointIndex + 1]!.frame
		));
		const rect = svgRef.current?.getBoundingClientRect();
		setCurveMenu({
			x: rect ? event.clientX - rect.left : 12,
			y: rect ? event.clientY - rect.top : projection.bodyTop,
			segmentIndex: segmentIndex < 0 ? null : segmentIndex,
		});
	}

	function applyMenuSegmentKind(kind: SegmentKind) {
		if (!lane || curveMenu?.segmentIndex === null || curveMenu?.segmentIndex === undefined) return;
		try {
			commitLane(setAutomationLaneSegmentKindV21(lane, {
				segmentIndex: curveMenu.segmentIndex,
				kind,
				descriptor: target.descriptor,
			}));
		} finally {
			setCurveMenu(null);
		}
	}

	function constrainedFrame(value: AutomationLaneV21, pointId: string, requested: number): number {
		const points = resolvedPoints(value);
		const index = points.findIndex((point) => point.id === pointId);
		if (index < 0) return requested;
		const minimum = index > 0 ? points[index - 1]!.frame + 1 : 0;
		const maximum = index < points.length - 1 ? points[index + 1]!.frame - 1 : Number.MAX_SAFE_INTEGER;
		return Math.max(minimum, Math.min(maximum, requested));
	}
}
