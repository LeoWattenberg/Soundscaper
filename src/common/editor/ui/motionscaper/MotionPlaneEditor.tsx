/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { MotionVector2 } from '../../motion-property.ts';
import type { MotionPlaneGeometry, MotionPlanePoint } from './motion-plane-geometry.ts';
const WIDTH = 720, HEIGHT = 360, PAD = 28;
interface Gesture { readonly point: MotionPlanePoint; readonly pointerId: number; readonly x: number; readonly y: number; value: MotionVector2; changed: boolean }
export default function MotionPlaneEditor({ copy, geometry, bounds, selected, disabled, onSelect, onPreview, onCommit }: Readonly<{
	copy: Readonly<Record<string, string>>; geometry: MotionPlaneGeometry; bounds: readonly [number, number, number, number]; selected: string; disabled: boolean;
	onSelect: (id: string) => void; onPreview: (id: string | null, point?: MotionVector2) => void; onCommit: (id: string, point: MotionVector2) => void;
}>) {
	const svg = useRef<SVGSVGElement | null>(null), drag = useRef<Gesture | null>(null);
	const [minimumX, minimumY, maximumX, maximumY] = bounds, xScale = (WIDTH - 2 * PAD) / (maximumX - minimumX), yScale = (HEIGHT - 2 * PAD) / (maximumY - minimumY);
	const x = (value: number) => PAD + (value - minimumX) * xScale, y = (value: number) => PAD + (value - minimumY) * yScale;
	const begin = (event: PointerEvent<SVGCircleElement>, point: MotionPlanePoint) => {
		if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); svg.current?.setPointerCapture(event.pointerId); onSelect(point.id);
		drag.current = { point, pointerId: event.pointerId, x: event.clientX, y: event.clientY, value: point.point, changed: false };
	};
	const move = (event: PointerEvent<SVGSVGElement>) => {
		const active = drag.current, box = svg.current?.getBoundingClientRect(); if (!active || active.pointerId !== event.pointerId || !box) return;
		const precision = event.altKey ? 1000 : 1;
		active.value = [Math.round((active.point.point[0] + (event.clientX - active.x) / box.width * WIDTH / xScale) * precision) / precision, Math.round((active.point.point[1] + (event.clientY - active.y) / box.height * HEIGHT / yScale) * precision) / precision];
		active.changed = active.changed || Math.abs(event.clientX - active.x) + Math.abs(event.clientY - active.y) > 2;
		onPreview(active.point.id, active.value);
	};
	const finish = (cancelled: boolean) => { const active = drag.current; drag.current = null; onPreview(null); if (active?.changed && !cancelled) onCommit(active.point.id, active.value); };
	const keyboard = (event: KeyboardEvent<SVGCircleElement>, point: MotionPlanePoint) => {
		if (disabled) return;
		if (event.key === 'Enter' || event.key === ' ') {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) return;
			event.preventDefault(); if (!event.repeat) onSelect(point.id); return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault(); const amount = event.shiftKey ? 10 : 1; onSelect(point.id);
		onCommit(point.id, [point.point[0] + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), point.point[1] + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0)]);
	};
	return <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="motionscaper-plane" role="group" aria-label={copy.motionscaperPathPlane} data-motion-plane
		onPointerMove={move} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)}>
		{Array.from({ length: 5 }, (_, index) => { const a = minimumX + (maximumX - minimumX) * index / 4, b = minimumY + (maximumY - minimumY) * index / 4; return <g key={index} className="motionscaper-graph-grid">
			<line x1={PAD} x2={WIDTH - PAD} y1={y(b)} y2={y(b)} /><line x1={x(a)} x2={x(a)} y1={PAD} y2={HEIGHT - PAD} />
			<text x={x(a)} y={HEIGHT - 8} textAnchor="middle">{Number(a.toPrecision(4))}</text><text x={PAD - 5} y={y(b)} textAnchor="end">{Number(b.toPrecision(4))}</text>
		</g>; })}
		<path d={geometry.path} transform={`translate(${PAD - minimumX * xScale},${PAD - minimumY * yScale}) scale(${xScale},${yScale})`} className="motionscaper-graph-curve" vectorEffect="non-scaling-stroke" />
		{geometry.points.map((point) => <g key={point.id}>
			{point.connector && <line x1={x(point.connector[0])} y1={y(point.connector[1])} x2={x(point.point[0])} y2={y(point.point[1])} className="motionscaper-graph-tangent" />}
			<circle cx={x(point.point[0])} cy={y(point.point[1])} r={point.kind === 'anchor' ? 6 : 5} role="button" aria-label={point.label} aria-pressed={point.id === selected} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
				className={point.kind === 'anchor' ? 'motionscaper-graph-key' : 'motionscaper-graph-handle'} data-motion-plane-point={point.id} data-motion-plane-kind={point.kind} data-motion-point-x={point.point[0]} data-motion-point-y={point.point[1]}
				onPointerDown={(event) => begin(event, point)} onKeyDown={(event) => keyboard(event, point)} />
		</g>)}
	</svg>;
}
