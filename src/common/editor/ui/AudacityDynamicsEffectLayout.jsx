/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import { audacityCompressionCurve } from './audacity-compression-curve.ts';
import DynamicsActivityPanel from './DynamicsActivityPanel.jsx';

const MULTIBAND_GROUPS = Object.freeze([
	{ id: 'crossovers', titleKey: 'effectCardCrossovers', names: ['lowCrossover', 'highCrossover'] },
	{ id: 'timing', titleKey: 'effectCardTiming', names: ['attack', 'release'] },
	{ id: 'low', titleKey: 'effectCardLowBand', names: ['lowThreshold', 'lowRatio', 'lowGain'] },
	{ id: 'mid', titleKey: 'effectCardMidBand', names: ['midThreshold', 'midRatio', 'midGain'] },
	{ id: 'high', titleKey: 'effectCardHighBand', names: ['highThreshold', 'highRatio', 'highGain'] },
]);

/** Audacity dynamics layout, with its live history shared by the multiband compressor. */
export default function AudacityDynamicsEffectLayout({
	effectType, definition, parameters = {}, renderParameter, copy,
	readDynamicsAnalysis = /** @type {null | (() => object | null)} */ (null), before = null, after = null,
}) {
	if (effectType === 'multiband-compressor') return <MultibandCompressorLayout
		definition={definition}
		renderParameter={renderParameter}
		copy={copy}
		readDynamicsAnalysis={readDynamicsAnalysis}
		before={before}
		after={after}
	/>;
	const limiter = effectType === 'audacity-limiter';
	const names = Object.keys(definition?.params || {});
	const parameter = (name) => names.includes(name) ? (
		<div className="audio-editor-audacity-layout__parameter" data-audacity-parameter={name} key={name}>
			{renderParameter(name)}
		</div>
	) : null;
	const assigned = limiter
		? ['thresholdDb', 'makeupTargetDb', 'lookaheadMs', 'kneeWidthDb', 'releaseMs']
		: ['attackMs', 'releaseMs', 'lookaheadMs', 'thresholdDb', 'ratio', 'kneeWidthDb', 'makeupGainDb'];
	return (
		<div
			className={`audio-editor-audacity-layout audio-editor-audacity-dynamics audio-editor-audacity-dynamics--${limiter ? 'limiter' : 'compressor'}`}
			data-audacity-effect-layout={effectType}
			data-audacity-dynamics-layout
		>
			{before}
			{readDynamicsAnalysis && <DynamicsActivityPanel readAnalysis={readDynamicsAnalysis} copy={copy} audacity limiter={limiter} />}
			<div className="audio-editor-audacity-dynamics__controls">
				<div className="audio-editor-audacity-dynamics__primary">
					{(limiter ? ['thresholdDb', 'makeupTargetDb'] : ['attackMs', 'releaseMs', 'lookaheadMs']).map(parameter)}
				</div>
				<div className="audio-editor-audacity-dynamics__secondary">
					{(limiter ? ['lookaheadMs', 'kneeWidthDb', 'releaseMs'] : ['thresholdDb', 'ratio', 'kneeWidthDb', 'makeupGainDb']).map(parameter)}
				</div>
				{!limiter && <CompressionCurve parameters={parameters} copy={copy} />}
			</div>
			{names.filter(name => !assigned.includes(name)).map(parameter)}
			{after}
		</div>
	);
}

function MultibandCompressorLayout({ definition, renderParameter, copy, readDynamicsAnalysis, before, after }) {
	const names = Object.keys(definition?.params || {});
	const assigned = new Set(MULTIBAND_GROUPS.flatMap(group => group.names));
	const groups = [
		...MULTIBAND_GROUPS,
		...(names.some(name => !assigned.has(name)) ? [{
			id: 'settings', titleKey: 'effectCardSettings', names: names.filter(name => !assigned.has(name)),
		}] : []),
	];
	return (
		<div
			className="audio-editor-audacity-layout audio-editor-audacity-dynamics audio-editor-audacity-dynamics--multiband"
			data-audacity-effect-layout="multiband-compressor"
			data-audacity-dynamics-layout
		>
			{before}
			{readDynamicsAnalysis && <DynamicsActivityPanel
				readAnalysis={readDynamicsAnalysis}
				copy={copy}
				audacity
			/>}
			<div className="audio-editor-audacity-dynamics__multiband-controls">
				{groups.map(group => (
					<section
						className="audio-editor-audacity-dynamics__multiband-group"
						data-multiband-compressor-group={group.id}
						key={group.id}
					>
						<h3>{canonicalCopyValue(group.titleKey, copy)}</h3>
						<div className="audio-editor-audacity-dynamics__multiband-parameters">
							{group.names.filter(name => names.includes(name)).map(name => (
								<div className="audio-editor-audacity-layout__parameter" data-audacity-parameter={name} key={name}>
									{renderParameter(name)}
								</div>
							))}
						</div>
					</section>
				))}
			</div>
			{after}
		</div>
	);
}

function CompressionCurve({ parameters, copy }) {
	const curve = audacityCompressionCurve(parameters);
	const ticks = [-36, -30, -24, -18, -12, -6, 0];
	return (
		<div className="audio-editor-audacity-dynamics__curve" role="img" aria-label={canonicalCopyValue('effectCompressionCurve', copy)}>
			<div className="audio-editor-audacity-dynamics__x-ticks" aria-hidden="true">
				{ticks.map(tick => <span key={tick}>{tick}</span>)}
			</div>
			<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
				<g className="audio-editor-audacity-dynamics__curve-grid">
					{ticks.map((tick, index) => <path key={tick} d={`M${index * 100 / 6} 0 V100 M0 ${index * 100 / 6} H100`} />)}
				</g>
				<path className="audio-editor-audacity-dynamics__curve-fill" d={curve.area} />
				<path className="audio-editor-audacity-dynamics__curve-line" d={curve.line} />
			</svg>
			<div className="audio-editor-audacity-dynamics__y-ticks" aria-hidden="true">
				{ticks.toReversed().map(tick => <span key={tick}>{tick}</span>)}
			</div>
		</div>
	);
}
