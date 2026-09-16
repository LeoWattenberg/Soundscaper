/* SPDX-License-Identifier: GPL-3.0-only */

import React, { useState } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import {
	audacityAutoDuckEnvelope,
	audacityClassicFilterResponse,
	audacityLegacyCompressorResponse,
} from './audacity-legacy-effect-graphs.ts';
import './AudacityLegacyEffectGraph.css';

interface GraphProps {
	readonly effectType: string;
	readonly parameters: Readonly<Record<string, unknown>>;
	readonly sampleRate?: number;
	readonly copy?: Parameters<typeof canonicalCopyValue>[1];
}
interface Tick { readonly position: number; readonly label: string; readonly minor?: boolean }
const DECIBEL_UNIT = 'dB';

export default function AudacityLegacyEffectGraph({ effectType, parameters, sampleRate = 48_000, copy = {} }: GraphProps) {
	if (effectType === 'audacity-auto-duck') return <AutoDuckGraph parameters={parameters} copy={copy} />;
	if (effectType === 'audacity-classic-filters') return <ClassicFilterGraph parameters={parameters} sampleRate={sampleRate} copy={copy} />;
	if (effectType !== 'audacity-legacy-compressor') return null;
	const curve = audacityLegacyCompressorResponse(parameters);
	const ticks = Array.from({ length: 7 }, (_, index) => index * -10);
	return <div data-audacity-effect-graph={effectType} className="audio-editor-audacity-wx-graph">
		<Plot line={curve.line} label={String(canonicalCopyValue('effectCompressionCurve', copy))}
			xTicks={ticks.slice().reverse().map(value => ({ position: (value + 60) / 60 * 100, label: `${value} dB` }))}
			yTicks={ticks.map(value => ({ position: -value / 60 * 100, label: `${value} dB` }))} />
	</div>;
}

function Plot({ line, label, xTicks, yTicks, grid = false }: {
	readonly line: string; readonly label: string;
	readonly xTicks: readonly Tick[]; readonly yTicks: readonly Tick[]; readonly grid?: boolean;
}) {
	return <div className="audio-editor-audacity-wx-graph__plot" role="img" aria-label={label}>
		<div className="audio-editor-audacity-wx-graph__y-ticks" aria-hidden="true">
			{yTicks.map(tick => <span key={tick.position} style={{ top: `${tick.position}%` }}>{tick.label}</span>)}
		</div>
		<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
			<path className="audio-editor-audacity-wx-graph__line" d={line} />
			{grid && <g className="audio-editor-audacity-wx-graph__grid">
				{xTicks.map(tick => <path key={`x-${tick.position}`} className={tick.minor ? 'is-minor' : undefined} d={`M${tick.position} 0 V100`} />)}
				{yTicks.map(tick => <path key={`y-${tick.position}`} className={tick.label === '0 dB' ? 'is-zero' : undefined} d={`M0 ${tick.position} H100`} />)}
			</g>}
		</svg>
		<div className="audio-editor-audacity-wx-graph__x-ticks" aria-hidden="true">
			{xTicks.filter(tick => tick.label).map(tick => <span key={tick.position} style={{ left: `${tick.position}%` }}>{tick.label}</span>)}
		</div>
	</div>;
}

function AutoDuckGraph({ parameters, copy }: Pick<GraphProps, 'parameters' | 'copy'>) {
	const envelope = audacityAutoDuckEnvelope(parameters);
	return <div data-audacity-effect-graph="audacity-auto-duck" className="audio-editor-audacity-wx-graph audio-editor-audacity-wx-graph--duck"
		role="img" aria-label={String(canonicalCopyValue('effectCardEnvelope', copy))}>
		<svg viewBox="0 0 600 300" aria-hidden="true" focusable="false">
			<path className="audio-editor-audacity-wx-graph__duck-boundaries" d="M150 10 V290 M450 10 V290" />
			<path className="audio-editor-audacity-wx-graph__line" d={envelope.line} />
			{envelope.controls.map(control => <g key={control.id} data-audacity-duck-control={control.id}>
				<circle cx={control.x} cy={control.y} r="3" />
				<text x={control.x} y={control.y + (control.above ? -18 : 28)} textAnchor="middle">
					{`${control.value.toFixed(control.unit === 'dB' ? 1 : 2)} ${control.unit}`}
				</text>
			</g>)}
		</svg>
	</div>;
}

function ClassicFilterGraph({ parameters, sampleRate, copy }: Pick<GraphProps, 'parameters' | 'sampleRate' | 'copy'>) {
	const [minimumDb, setMinimumDb] = useState(-30);
	const [maximumDb, setMaximumDb] = useState(20);
	const response = audacityClassicFilterResponse(parameters, sampleRate, { minimumDb, maximumDb });
	const frequencyPosition = (value: number) => Math.log(value / response.minimumFrequency) / Math.log(response.maximumFrequency / response.minimumFrequency) * 100;
	const frequencyLabel = (value: number) => value >= 1000 ? `${value / 1000}k` : String(value);
	const frequencies: Tick[] = [{ position: 0, label: '20 Hz' }];
	for (let decade = 10; decade < response.maximumFrequency; decade *= 10) {
		for (let multiplier = 1; multiplier < 10; multiplier += 1) {
			const value = decade * multiplier;
			if (value <= response.minimumFrequency || value >= response.maximumFrequency) continue;
			frequencies.push({ position: frequencyPosition(value), label: multiplier === 1 ? frequencyLabel(value) : '', minor: multiplier !== 1 });
		}
	}
	frequencies.push({ position: 100, label: `${frequencyLabel(response.maximumFrequency)} Hz` });
	const dbValues = new Set([minimumDb, maximumDb]);
	for (let db = Math.ceil(minimumDb / 10) * 10; db <= maximumDb; db += 10) dbValues.add(db);
	const dbTicks = [...dbValues].sort((left, right) => right - left).map(value => ({ position: (maximumDb - value) / (maximumDb - minimumDb) * 100, label: `${value} dB` }));
	return <div data-audacity-effect-graph="audacity-classic-filters" className="audio-editor-audacity-wx-graph audio-editor-audacity-wx-graph--filter">
		<Plot line={response.line} label={String(canonicalCopyValue('effectCurveResponse', copy))} xTicks={frequencies} yTicks={dbTicks} grid />
		<div className="audio-editor-audacity-wx-graph__ranges">
			<span aria-hidden="true">{`+ ${DECIBEL_UNIT}`}</span>
			<input type="range" min="0" max="20" step="1" value={maximumDb}
				aria-label={String(canonicalCopyValue('effectClassicMaxDb', copy))} onChange={event => setMaximumDb(Number(event.currentTarget.value))} />
			<input type="range" min="-120" max="-10" step="1" value={minimumDb}
				aria-label={String(canonicalCopyValue('effectClassicMinDb', copy))} onChange={event => setMinimumDb(Number(event.currentTarget.value))} />
			<span aria-hidden="true">{`- ${DECIBEL_UNIT}`}</span>
		</div>
	</div>;
}
