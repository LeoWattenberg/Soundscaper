/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import { audacityCompressionCurve } from './audacity-compression-curve.ts';
import DynamicsActivityPanel from './DynamicsActivityPanel.jsx';

/** Layout follows the pinned Audacity 4 CompressorView and LimiterView QML. */
export default function AudacityDynamicsEffectLayout({
	effectType, definition, parameters = {}, renderParameter, copy,
	readDynamicsAnalysis = /** @type {null | (() => object | null)} */ (null), before = null, after = null,
}) {
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
