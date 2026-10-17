/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Rational } from '../../timeline-time.ts';
import { formatMotionExactInput } from './motion-exact-input.ts';
import { motionPropertyChannel, type MotionNumericProperty } from './motion-property-ui.ts';
import { moveMotionGraphHandle, moveMotionGraphKey } from './motion-graph-edit.ts';
import { graphFrame, graphNumber, motionGraphGeometry, type MotionGraphMode } from './motion-graph-geometry.ts';

type Target = { readonly kind: 'key'; readonly from: Rational; readonly value: number } | { readonly kind: 'handle'; readonly segment: number; readonly handle: 1 | 2; readonly from: Rational; readonly value: number };
interface Drag { readonly pointerId: number; readonly target: Target; readonly startX: number; readonly startY: number; changed: boolean; result: MotionNumericProperty | null; error: unknown }
const WIDTH = 720, HEIGHT = 240, LEFT = 56, TOP = 20, PLOT_WIDTH = 640, PLOT_HEIGHT = 184;

export default function MotionPropertyGraph({ copy, property, channel, duration, frameRate, selected, disabled, onSelect, onCommit }: Readonly<{
	copy: Readonly<Record<string, string>>; property: MotionNumericProperty; channel: number; duration: number; frameRate: Rational;
	selected: readonly Rational[]; disabled: boolean; onSelect: (positions: readonly Rational[]) => void; onCommit: (create: () => MotionNumericProperty) => void;
}>) {
	const id = useId(), svg = useRef<SVGSVGElement | null>(null), drag = useRef<Drag | null>(null);
	const [mode, setMode] = useState<MotionGraphMode>('value'), [draft, setDraft] = useState<MotionNumericProperty | null>(null);
	const axes = useMemo(() => motionGraphGeometry(property, channel, duration, frameRate, mode), [property, channel, duration, frameRate, mode]);
	const display = useMemo(() => draft ? motionGraphGeometry(draft, channel, duration, frameRate, mode) : axes, [draft, channel, duration, frameRate, mode, axes]);
	const x = (frame: number) => LEFT + frame / axes.maximumFrame * PLOT_WIDTH;
	const y = (value: number) => TOP + (axes.maximumValue - value) / (axes.maximumValue - axes.minimumValue) * PLOT_HEIGHT;
	const path = display.points.reduce((result, point, index) => point.value === null ? result : `${result}${index === 0 || display.points[index - 1]?.value === null ? 'M' : 'L'}${x(point.frame)},${y(point.value)} `, '');
	const chosen = new Set(selected.map((at) => `${at.num}/${at.den}`));
	const handles = display.handles.filter((handle) => { const at = display.curve!.anchors[handle.segment]!.position; return chosen.has(`${at.num}/${at.den}`); });
	const apply = (target: Target, frame: number, value: number) => target.kind === 'key'
		? moveMotionGraphKey(property, channel, target.from, graphFrame(Math.max(0, frame)), value)
		: moveMotionGraphHandle(property, channel, target.segment, target.handle, graphFrame(frame), value, mode, frameRate);
	const begin = (event: PointerEvent<SVGCircleElement>, target: Target) => {
		if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); svg.current?.setPointerCapture(event.pointerId);
		if (target.kind === 'key') onSelect([target.from]);
		drag.current = { pointerId: event.pointerId, target, startX: event.clientX, startY: event.clientY, changed: false, result: null, error: null };
	};
	const move = (event: PointerEvent<SVGSVGElement>) => {
		const active = drag.current, box = svg.current?.getBoundingClientRect(); if (!active || active.pointerId !== event.pointerId || !box) return;
		const deltaFrame = (event.clientX - active.startX) / box.width * WIDTH / PLOT_WIDTH * axes.maximumFrame;
		const frame = active.target.kind === 'key' && !event.altKey ? Math.round(graphNumber(active.target.from) + deltaFrame) : graphNumber(active.target.from) + deltaFrame;
		const value = active.target.value - (event.clientY - active.startY) / box.height * HEIGHT / PLOT_HEIGHT * (axes.maximumValue - axes.minimumValue);
		active.changed = active.changed || Math.abs(event.clientX - active.startX) + Math.abs(event.clientY - active.startY) > 2;
		try { active.result = apply(active.target, frame, value); active.error = null; setDraft(active.result); } catch (error) { active.result = null; active.error = error; }
	};
	const finish = (cancelled: boolean) => {
		const active = drag.current; drag.current = null; setDraft(null);
		if (!active?.changed || cancelled) return;
		onCommit(() => { if (active.error) throw active.error; if (!active.result) throw new Error('The graph edit is unavailable.'); return active.result; });
	};
	const keyboard = (event: KeyboardEvent<SVGCircleElement>, target: Target) => {
		if (disabled) return;
		if (target.kind === 'key' && (event.key === 'Enter' || event.key === ' ')) {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) return;
			event.preventDefault(); if (!event.repeat) onSelect([target.from]); return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
		onCommit(() => apply(target, graphNumber(target.from) + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), target.value + (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0)));
	};
	return <section className="motionscaper-property-graph">
		<label htmlFor={id}>{copy.motionscaperGraphView}</label><select id={id} value={mode} disabled={disabled} onChange={(event) => { finish(true); setMode(event.currentTarget.value as MotionGraphMode); }}>
			<option value="value">{copy.motionscaperValueGraph}</option><option value="speed">{copy.motionscaperSpeedGraph}</option>
		</select>
		<p>{mode === 'value' ? copy.motionscaperValueGraphHint : copy.motionscaperSpeedGraphHint}</p>
		<svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} data-motion-property-graph data-motion-graph-mode={mode} role="group" aria-label={mode === 'value' ? copy.motionscaperValueGraph : copy.motionscaperSpeedGraph}
			onPointerMove={move} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)}>
			<defs><clipPath id={`${id}-plot`}><rect x={LEFT - 6} y={TOP - 6} width={PLOT_WIDTH + 12} height={PLOT_HEIGHT + 12} /></clipPath></defs>
			{Array.from({ length: 5 }, (_, index) => { const value = axes.minimumValue + (axes.maximumValue - axes.minimumValue) * index / 4, frame = axes.maximumFrame * index / 4; return <g key={index} className="motionscaper-graph-grid">
				<line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={y(value)} y2={y(value)} /><text x={LEFT - 8} y={y(value) + 4} textAnchor="end">{Number(value.toPrecision(4))}</text>
				<line x1={x(frame)} x2={x(frame)} y1={TOP} y2={TOP + PLOT_HEIGHT} /><text x={x(frame)} y={HEIGHT - 12} textAnchor="middle">{Number(frame.toPrecision(4))}</text>
			</g>; })}
			<g clipPath={`url(#${id}-plot)`}>
				<path d={path} className="motionscaper-graph-curve" />
				{handles.map((handle) => { const target: Target = { kind: 'handle', segment: handle.segment, handle: handle.handle, from: handle.position, value: handle.value }; return <g key={`${handle.segment}-${handle.handle}`}>
					<line className="motionscaper-graph-tangent" x1={x(handle.anchorFrame)} y1={y(handle.anchorValue)} x2={x(handle.frame)} y2={y(handle.value)} />
					<circle cx={x(handle.frame)} cy={y(handle.value)} r={5} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`${copy.motionscaperGraphHandle} ${handle.handle}`} data-motion-graph-handle={`${handle.segment}-${handle.handle}`} data-motion-ordinate={Number(handle.value.toPrecision(12))}
						onPointerDown={(event) => begin(event, target)} onKeyDown={(event) => keyboard(event, target)} className="motionscaper-graph-handle" />
				</g>; })}
				{mode === 'value' && display.curve?.anchors.map((anchor, index) => { const position = `${anchor.position.num}/${anchor.position.den}`, target: Target = { kind: 'key', from: anchor.position, value: anchor.value }; return <circle key={index} cx={x(graphNumber(anchor.position))} cy={y(anchor.value)} r={6}
					role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`${copy.motionscaperKeyframe} ${formatMotionExactInput(anchor.position)}`} data-motion-key-point={position} aria-pressed={chosen.has(position)}
					onPointerDown={(event) => begin(event, target)} onKeyDown={(event) => keyboard(event, target)} className="motionscaper-graph-key" />; })}
			</g>
		</svg>
		{!motionPropertyChannel(property, channel).curve && <p>{copy.motionscaperGraphNoKeys}</p>}
	</section>;
}
