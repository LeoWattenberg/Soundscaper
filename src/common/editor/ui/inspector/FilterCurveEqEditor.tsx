/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { formatAudacityCurve, parseAudacityCurve } from '../../audacity-effects/manifest.js';
import {
	filterCurvePointAt,
	filterCurvePolyline,
	filterCurvePosition,
	type FilterCurvePoint,
	type FilterCurvePosition,
	type FilterCurveViewport,
} from '../../audacity-effects/filter-curve.ts';
import { createFilterCurveGesture } from '../../controller/effects/filter-curve-gesture.ts';
import { CommitField, DesignCheckbox } from './inspector-controls.jsx';

interface Props {
	readonly name: string;
	readonly label: string;
	readonly value?: readonly FilterCurvePoint[];
	readonly sampleRate: number;
	readonly linearFrequencyScale: boolean;
	readonly filterLength: number;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	onCommit(points: readonly FilterCurvePoint[]): void;
}

const BOX = { x: 56, y: 16, width: 568, height: 244 };
const EMPTY: readonly FilterCurvePoint[] = [];

export default function FilterCurveEqEditor({
	name, label, value = EMPTY, sampleRate, linearFrequencyScale, filterLength, copy, disabled, onCommit,
}: Props) {
	const id = useId();
	const svgRef = useRef<SVGSVGElement>(null);
	const gesture = useRef(createFilterCurveGesture());
	const pointer = useRef<number | null>(null);
	const [draft, setDraft] = useState<readonly FilterCurvePoint[] | null>(null);
	const [response, setResponse] = useState<readonly FilterCurvePoint[]>(EMPTY);
	const [responseError, setResponseError] = useState('');
	const [grid, setGrid] = useState(true);
	const [minimumDb, setMinimumDb] = useState(-30);
	const [maximumDb, setMaximumDb] = useState(30);
	const points = draft ?? value;
	const viewport = useMemo<FilterCurveViewport>(() => ({
		sampleRate, linearFrequencyScale, minimumDb, maximumDb,
	}), [sampleRate, linearFrequencyScale, minimumDb, maximumDb]);
	const text = (key: string): string => copy[key] || canonicalCopyValue(key);
	const position = (point: FilterCurvePoint): FilterCurvePosition => {
		const at = filterCurvePosition(point, viewport);
		return { x: BOX.x + at.x * BOX.width, y: BOX.y + at.y * BOX.height };
	};
	const polyline = (entries: readonly FilterCurvePoint[]): string => filterCurvePolyline(entries, viewport)
		.split(' ').map((pair) => {
			const [x, y] = pair.split(',').map(Number);
			return `${String(BOX.x + x! * BOX.width)},${String(BOX.y + y! * BOX.height)}`;
		}).join(' ');

	useEffect(() => {
		let active = true;
		setResponse(EMPTY);
		setResponseError('');
		const frequencies = Array.from({ length: 257 }, (_, index) => filterCurvePointAt({ x: index / 256, y: 0 }, viewport).frequency);
		void import('../../audacity-effects/filter-curve-response.ts')
			.then((module) => active ? module.filterCurveResponse(points, sampleRate, filterLength, linearFrequencyScale, frequencies) : EMPTY)
			.then((next) => { if (active) setResponse(next); })
			.catch((error: unknown) => { if (active) setResponseError(error instanceof Error ? error.message : String(error)); });
		return () => { active = false; };
	}, [points, sampleRate, filterLength, linearFrequencyScale, viewport]);

	const cancel = (): void => {
		gesture.current.cancel();
		pointer.current = null;
		setDraft(null);
	};
	useEffect(() => {
		const session = gesture.current;
		return () => { session.cancel(); };
	}, []);
	const atEvent = (event: PointerEvent<SVGSVGElement>): FilterCurvePosition => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: ((event.clientX - rect.left) * 640 / rect.width - BOX.x) / BOX.width,
			y: ((event.clientY - rect.top) * 300 / rect.height - BOX.y) / BOX.height,
		};
	};
	const begin = (event: PointerEvent<SVGSVGElement>): void => {
		if (disabled || event.button !== 0 || pointer.current !== null) return;
		const at = atEvent(event);
		if (at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) return;
		event.preventDefault();
		event.currentTarget.focus();
		const rect = event.currentTarget.getBoundingClientRect();
		const index = points.findIndex((point) => {
			const candidate = filterCurvePosition(point, viewport);
			return Math.hypot((candidate.x - at.x) * BOX.width * rect.width / 640,
				(candidate.y - at.y) * BOX.height * rect.height / 300) <= 9;
		});
		pointer.current = event.pointerId;
		event.currentTarget.setPointerCapture(event.pointerId);
		setDraft(gesture.current.begin(points, index < 0 ? null : index, at, viewport));
	};
	const finish = (event: PointerEvent<SVGSVGElement>): void => {
		if (pointer.current !== event.pointerId) return;
		if (disabled) { cancel(); return; }
		gesture.current.move(atEvent(event));
		const next = gesture.current.complete();
		pointer.current = null;
		setDraft(null);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		if (next) onCommit(next);
	};
	const keyPoint = (event: KeyboardEvent<SVGCircleElement>, index: number): void => {
		if (disabled || pointer.current !== null) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault(); event.stopPropagation();
			onCommit(points.filter((_, entry) => entry !== index));
			return;
		}
		if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		const at = filterCurvePosition(points[index]!, viewport);
		const gainStep = (event.shiftKey ? 1 : 0.1) / (maximumDb - minimumDb);
		const next = { x: at.x, y: at.y };
		if (event.key === 'ArrowUp') next.y -= gainStep;
		if (event.key === 'ArrowDown') next.y += gainStep;
		if (event.key === 'ArrowLeft') next.x -= event.shiftKey ? 0.025 : 0.005;
		if (event.key === 'ArrowRight') next.x += event.shiftKey ? 0.025 : 0.005;
		next.x = Math.max(0, Math.min(1, next.x)); next.y = Math.max(0, Math.min(1, next.y));
		gesture.current.begin(points, index, at, viewport);
		gesture.current.move(next);
		const updated = gesture.current.complete();
		if (updated) onCommit(updated);
	};
	const nyquist = sampleRate / 2;
	const candidates = linearFrequencyScale ? Array.from({ length: 7 }, (_, index) => index * nyquist / 6)
		: [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000].filter((frequency) => frequency < nyquist).concat(nyquist);
	const ticks = candidates.reduceRight<number[]>((kept, frequency) => {
		const x = filterCurvePosition({ frequency, gain: 0 }, viewport).x;
		const nextX = kept.length ? filterCurvePosition({ frequency: kept[0]!, gain: 0 }, viewport).x : 2;
		if (nextX - x >= 0.08) kept.unshift(frequency);
		return kept;
	}, []);
	const dbTicks = Array.from({ length: 7 }, (_, index) => maximumDb - index * (maximumDb - minimumDb) / 6);
	const frequencyText = (frequency: number): string => frequency >= 1_000 ? `${String(Number((frequency / 1_000).toFixed(1)))}k` : String(Math.round(frequency));

	return <div className="audio-editor-filter-curve" data-effect-param={name}>
		<p id={`${id}-instructions`} className="audio-editor-filter-curve__instructions">{text('effectCurveInstructions')}</p>
		<svg ref={svgRef} viewBox="0 0 640 300" preserveAspectRatio="none" role="group"
			aria-label={text('effectCardEqualizationCurve')} aria-describedby={`${id}-instructions`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
			onPointerDown={begin} onPointerMove={(event) => {
				if (pointer.current === event.pointerId && !disabled) setDraft(gesture.current.move(atEvent(event)));
			}} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (pointer.current !== null) cancel(); }}
			onKeyDown={(event) => {
				if (event.key === 'Escape' && pointer.current !== null) {
					event.preventDefault(); event.stopPropagation(); cancel();
				}
			}}>
			<defs><clipPath id={`${id}-clip`}><rect x={BOX.x} y={BOX.y} width={BOX.width} height={BOX.height} /></clipPath></defs>
			<rect className="audio-editor-filter-curve__border" x={BOX.x} y={BOX.y} width={BOX.width} height={BOX.height} />
			{ticks.map((frequency, index) => {
				const x = position({ frequency, gain: 0 }).x;
				return <g key={frequency}>
					{grid && <path className="audio-editor-filter-curve__grid" d={`M${String(x)} 16 V260`} />}
					<text x={x} y={279} textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}>{frequencyText(frequency)}</text>
				</g>;
			})}
			{dbTicks.map((gain) => {
				const y = position({ frequency: 20, gain }).y;
				return <g key={gain}>
					{grid && <path className="audio-editor-filter-curve__grid" d={`M56 ${String(y)} H624`} />}
					<text x={46} y={y + 4} textAnchor="end">{Number(gain.toFixed(1))}</text>
				</g>;
			})}
			<text x={24} y={12}>{'dB'}</text><text x={624} y={296} textAnchor="end">{'Hz'}</text>
			<g clipPath={`url(#${id}-clip)`}>
				<path className="audio-editor-filter-curve__zero" d={`M56 ${String(position({ frequency: 20, gain: 0 }).y)} H624`} />
				<polyline className="audio-editor-filter-curve__line" points={polyline(points)} role="img" aria-label={text('effectCurveRequested')} />
				{response.length > 0 && <polyline className="audio-editor-filter-curve__response" points={polyline(response)} role="img" aria-label={text('effectCurveResponse')} />}
				{points.map((point, index) => {
					const at = position(point);
					return <circle key={index} cx={at.x} cy={at.y} r={5} className="audio-editor-filter-curve__point"
						role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-describedby={`${id}-instructions`}
						aria-label={text('effectCurvePoint').replace('{frequency}', point.frequency.toFixed(1)).replace('{gain}', point.gain.toFixed(1))}
						onKeyDown={(event) => keyPoint(event, index)} />;
				})}
			</g>
		</svg>
		<div className="audio-editor-filter-curve__legend" aria-hidden="true"><span>{text('effectCurveRequested')}</span><span>{text('effectCurveResponse')}</span></div>
		{responseError && <p role="alert" className="audio-editor-field-error">{responseError}</p>}
		<div className="audio-editor-filter-curve__settings">
			<DesignCheckbox label={text('effectCurveGrid')} checked={grid} disabled={disabled} onChange={setGrid} />
			<GainRangeField label={text('effectCurveMinimumDb')} name="curveMinimumDb" value={minimumDb} minimum={-120} maximum={-10}
				disabled={disabled} copy={copy} onCommit={setMinimumDb} />
			<GainRangeField label={text('effectCurveMaximumDb')} name="curveMaximumDb" value={maximumDb} minimum={0} maximum={60}
				disabled={disabled} copy={copy} onCommit={setMaximumDb} />
		</div>
		<details><summary>{label}</summary><CommitField label={label} name={name} value={formatAudacityCurve(points)} disabled={disabled} readOnly={false} multiline hookName="effect-param"
			onCommit={(_field: string, next: string) => onCommit(parseAudacityCurve(next))} /></details>
		<div className="audio-editor-panel-actions audio-editor-filter-curve__actions">
			<Button variant="secondary" disabled={disabled} onClick={() => onCommit(EMPTY)}>{copy.reset}</Button>
			<Button variant="secondary" disabled={disabled} onClick={() => onCommit(points.map((point) => ({ ...point, gain: Math.max(-120, Math.min(60, -point.gain)) })))}>{copy.invert}</Button>
		</div>
	</div>;
}

function GainRangeField({ label, name, value, minimum, maximum, disabled, copy, onCommit }: Readonly<{
	label: string; name: string; value: number; minimum: number; maximum: number; disabled: boolean;
	copy: Readonly<Record<string, string>>; onCommit(value: number): void;
}>) {
	return <CommitField label={label} name={name} value={value} type="number" disabled={disabled} readOnly={false} multiline={false}
		hookName="effect-display" onCommit={(_field: string, draft: string) => {
			const next = Number(draft);
			if (!draft.trim() || !Number.isFinite(next) || next < minimum || next > maximum) {
				throw new RangeError(copy.parameterRangeError!.replace('{label}', label)
					.replace('{minimum}', String(minimum)).replace('{maximum}', String(maximum)));
			}
			onCommit(next);
		}} />;
}
