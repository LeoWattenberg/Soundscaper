/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import type { VideoCurvePointsV1 } from '../../video-curve-types-v1.ts';
import { normalizePointCurvesParamsV1 } from '../../video-curves-v1.ts';
import VideoEffectNumberInput from './VideoEffectNumberInput.tsx';

export interface VideoCurveControlCopy {
	readonly addPoint: string; readonly removePoint: string; readonly input: string; readonly output: string; readonly invalid: string;
}
export default function VideoCurveControl(props: Readonly<{ label: string; points: VideoCurvePointsV1; messages: VideoCurveControlCopy;
	disabled: boolean; isCurrent: () => boolean; onBegin: () => void; onPreview: (points: VideoCurvePointsV1) => void;
	onCommit: () => void; onCancel: () => void; onChange?: (points: VideoCurvePointsV1) => void }>) {
	const { label, points, messages, disabled } = props, [error, setError] = useState('');
	const live = useRef(true), invalid = useRef(false), latest = useRef<object | null>(null), generation = {};
	const publishing = useRef(false);
	latest.current = generation;
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const current = () => live.current && latest.current === generation && !disabled && props.isCurrent();
	const invoke = (run: () => void) => {
		if (!current() || publishing.current) return; publishing.current = true;
		try { run(); } finally { publishing.current = false; }
	};
	const admit = (next: VideoCurvePointsV1) => {
		try { const admitted = normalizePointCurvesParamsV1({ master: next }).master;
			invalid.current = false; setError(''); return admitted;
		} catch { invalid.current = true; setError(messages.invalid); return null; }
	};
	const preview = (next: VideoCurvePointsV1) => { if (!current() || publishing.current) return; const admitted = admit(next); if (admitted) invoke(() => { props.onPreview(admitted); }); };
	const change = (next: VideoCurvePointsV1) => { if (!current() || publishing.current) return; const admitted = admit(next); if (!admitted) return;
		invoke(() => { if (props.onChange) { props.onChange(admitted); return; }
			props.onBegin(); if (!current()) return; props.onPreview(admitted); if (current()) props.onCommit(); }); };
	const commit = () => { invoke(() => {
		if (invalid.current) { props.onCancel(); setError(''); invalid.current = false; } else props.onCommit(); }); };
	return <fieldset aria-label={label} disabled={disabled} data-video-curve-control>
		<legend>{label}</legend>
		<svg role="img" aria-label={label} viewBox="0 0 100 100" width="128" height="96">
			<polyline points={points.map(point => `${String(point.x * 100)},${String((1 - point.y) * 100)}`).join(' ')} fill="none" stroke="currentColor" />
		</svg>
		<button type="button" disabled={disabled || points.length >= 32} aria-label={`${messages.addPoint}: ${label}`} onClick={() => {
			if (!current() || points.length >= 32) return; let left = 0;
			for (let n = 1; n < points.length - 1; n++) if (points[n + 1]!.x - points[n]!.x > points[left + 1]!.x - points[left]!.x) left = n;
			const a = points[left]!, b = points[left + 1]!, x = (a.x + b.x) / 2;
			change([...points.slice(0, left + 1), { x, y: (a.y + b.y) / 2 }, ...points.slice(left + 1)]);
		}}>{messages.addPoint}</button>
		<ol>{points.map((point, index) => <li key={index}>
			{(['x', 'y'] as const).map(coordinate => {
				const text = coordinate === 'x' ? messages.input : messages.output;
				return <VideoEffectNumberInput key={coordinate} label={`${label}: ${text} ${String(index + 1)}`} value={point[coordinate]}
					minimum={0} maximum={1} step={0.01} disabled={disabled || coordinate === 'x' && (index === 0 || index === points.length - 1)}
					onBegin={() => { invoke(() => { props.onBegin(); }); }} onPreview={value => {
						preview(points.map((point, n) => n === index ? { ...point, [coordinate]: value } : point));
					}} onCommit={commit} onCancel={() => { invoke(() => { props.onCancel(); setError(''); invalid.current = false; }); }} />;
			})}
			{index > 0 && index < points.length - 1 && <button type="button" disabled={disabled}
				aria-label={`${messages.removePoint}: ${label} ${String(index + 1)}`} onClick={() => { change(points.filter((_, n) => n !== index)); }}>{messages.removePoint}</button>}
		</li>)}</ol>
		{error && <p role="alert">{error}</p>}
	</fieldset>;
}
