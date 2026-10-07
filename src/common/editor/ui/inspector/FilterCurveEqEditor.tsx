/* SPDX-License-Identifier: AGPL-3.0-only */
import './FilterCurveEqEditor.css';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { formatAudacityCurve, parseAudacityCurve } from '../../audacity-effects/manifest.js';
import {
	filterCurvePosition,
	type FilterCurvePoint,
	type FilterCurvePosition,
	type FilterCurveViewport,
} from '../../audacity-effects/filter-curve.ts';
import { createFilterCurveGesture } from '../../controller/effects/filter-curve-gesture.ts';
import { CommitField, DesignCheckbox } from './inspector-controls.jsx';
import { useEqDraftFrame, useFilterEqGrid, useFilterEqPolyline, useFilterResponseFrequencies } from './useEqPresentation.ts';
import { moveFilterCurvePointByKey } from './filter-curve-keyboard.ts';

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
	const deletionFocus = useRef<{ index: number; count: number; control: SVGCircleElement } | null>(null);
	const [draft, setDraft] = useState<readonly FilterCurvePoint[] | null>(null);
	const draftFrame = useEqDraftFrame(setDraft);
	const [response, setResponse] = useState<readonly FilterCurvePoint[]>(EMPTY);
	const [responseError, setResponseError] = useState('');
	const [grid, setGrid] = useState(true);
	const [minimumDb, setMinimumDb] = useState(-30);
	const [maximumDb, setMaximumDb] = useState(30);
	const points = draft ?? value;
	useLayoutEffect(() => {
		const request = deletionFocus.current;
		const svg = svgRef.current;
		if (!request || !svg || disabled || points.length !== request.count) return;
		deletionFocus.current = null;
		const active = svg.ownerDocument.activeElement;
		if (active !== svg.ownerDocument.body && active !== request.control) return;
		const remaining = svg.querySelectorAll<SVGCircleElement>('.audio-editor-filter-curve__point');
		(remaining[Math.min(request.index, remaining.length - 1)] ?? svg).focus();
	}, [disabled, points]);
	const viewport = useMemo<FilterCurveViewport>(() => ({
		sampleRate, linearFrequencyScale, minimumDb, maximumDb,
	}), [sampleRate, linearFrequencyScale, minimumDb, maximumDb]);
	const text = (key: string): string => copy[key] || canonicalCopyValue(key);
	const position = (point: FilterCurvePoint): FilterCurvePosition => {
		const at = filterCurvePosition(point, viewport);
		return { x: BOX.x + at.x * BOX.width, y: BOX.y + at.y * BOX.height };
	};
	const requestedPolyline = useFilterEqPolyline(points, viewport);
	const responsePolyline = useFilterEqPolyline(response, viewport);
	const frequencies = useFilterResponseFrequencies(sampleRate, linearFrequencyScale);
	const gridModel = useFilterEqGrid(viewport);

	useEffect(() => {
		let active = true;
		setResponse(EMPTY);
		setResponseError('');
		void import('../../audacity-effects/filter-curve-response.ts')
			.then((module) => active ? module.filterCurveResponse(points, sampleRate, filterLength, linearFrequencyScale, frequencies) : EMPTY)
			.then((next) => { if (active) setResponse(next); })
			.catch((error: unknown) => { if (active) setResponseError(error instanceof Error ? error.message : String(error)); });
		return () => { active = false; };
	}, [points, sampleRate, filterLength, linearFrequencyScale, frequencies]);

	const cancel = (): void => {
		draftFrame.cancel();
		gesture.current.cancel();
		pointer.current = null;
		setDraft(null);
	};
	useEffect(() => {
		const session = gesture.current;
		return () => { session.cancel(); };
	}, []);
	const atEvent = (event: PointerEvent<SVGSVGElement>, rect = event.currentTarget.getBoundingClientRect()): FilterCurvePosition => {
		return {
			x: ((event.clientX - rect.left) * 640 / rect.width - BOX.x) / BOX.width,
			y: ((event.clientY - rect.top) * 300 / rect.height - BOX.y) / BOX.height,
		};
	};
	const begin = (event: PointerEvent<SVGSVGElement>): void => {
		if (disabled || event.button !== 0 || pointer.current !== null) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const at = atEvent(event, rect);
		if (at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) return;
		event.preventDefault();
		event.currentTarget.focus();
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
		draftFrame.cancel();
		if (disabled) { cancel(); return; }
		gesture.current.move(atEvent(event));
		const next = gesture.current.complete();
		pointer.current = null;
		setDraft(null);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		if (next) onCommit(next);
	};
	const keyPoint = (event: KeyboardEvent<SVGCircleElement>, index: number): void => {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		if (disabled || pointer.current !== null) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault(); event.stopPropagation();
			deletionFocus.current = { index, count: points.length - 1, control: event.currentTarget };
			onCommit(points.filter((_, entry) => entry !== index));
			return;
		}
		if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		const updated = moveFilterCurvePointByKey(points, index, event.key, event.shiftKey, viewport);
		if (updated !== points) onCommit(updated);
	};

	return <div className="audio-editor-filter-curve" data-effect-param={name}>
		<p id={`${id}-instructions`} className="audio-editor-filter-curve__instructions">{text('effectCurveInstructions')}</p>
		<svg ref={svgRef} viewBox="0 0 640 300" preserveAspectRatio="none" role="group"
			aria-label={text('effectCardEqualizationCurve')} aria-describedby={`${id}-instructions`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
			onPointerDown={begin} onPointerMove={(event) => {
				if (pointer.current === event.pointerId && !disabled) draftFrame.publish(gesture.current.move(atEvent(event)));
			}} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (pointer.current !== null) cancel(); }}
			onKeyDown={(event) => {
				if (event.key === 'Escape' && pointer.current !== null) {
					event.preventDefault(); event.stopPropagation(); cancel();
				}
			}}>
			<defs><clipPath id={`${id}-clip`}><rect x={BOX.x} y={BOX.y} width={BOX.width} height={BOX.height} /></clipPath></defs>
			<rect className="audio-editor-filter-curve__border" x={BOX.x} y={BOX.y} width={BOX.width} height={BOX.height} />
			{gridModel.frequencies.map(({ frequency, x, label }, index) => {
				return <g key={frequency}>
					{grid && <path className="audio-editor-filter-curve__grid" d={`M${String(x)} 16 V260`} />}
					<text x={x} y={279} textAnchor={index === 0 ? 'start' : index === gridModel.frequencies.length - 1 ? 'end' : 'middle'}>{label}</text>
				</g>;
			})}
			{gridModel.gains.map(({ gain, y }) => {
				return <g key={gain}>
					{grid && <path className="audio-editor-filter-curve__grid" d={`M56 ${String(y)} H624`} />}
					<text x={46} y={y + 4} textAnchor="end">{Number(gain.toFixed(1))}</text>
				</g>;
			})}
			<text x={24} y={12}>{'dB'}</text><text x={624} y={296} textAnchor="end">{'Hz'}</text>
			<g clipPath={`url(#${id}-clip)`}>
				<path className="audio-editor-filter-curve__zero" d={`M56 ${String(gridModel.zeroY)} H624`} />
				<polyline className="audio-editor-filter-curve__line" points={requestedPolyline} role="img" aria-label={text('effectCurveRequested')} />
				{response.length > 0 && <polyline className="audio-editor-filter-curve__response" points={responsePolyline} role="img" aria-label={text('effectCurveResponse')} />}
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
