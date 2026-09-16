/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useRef, useState } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import { audacityPortSections, isAudacityNyquistPort } from './audacity-port-layouts.ts';
import { commitAudacityLinkedTone } from './audacity-derived-controls.ts';
import AudacityPitchControls from './AudacityPitchControls.jsx';
import AudacityRateControls from './AudacityRateControls.jsx';
import AudacitySlidingStretchControls from './AudacitySlidingStretchControls.jsx';
import AudacityNoiseReductionControls from './AudacityNoiseReductionControls.tsx';
import AudacityLegacyEffectGraph from './AudacityLegacyEffectGraph.tsx';
import ParameterNumber from './inspector/EffectParameterNumber.jsx';
import { DesignCheckbox } from './inspector/inspector-controls.jsx';

/** Pinned Audacity Qt parameter geometry, with the editor owning all values. */
export default function AudacityPortEffectLayout({ effectType, definition, parameters = {}, effectContext = {}, sampleRate = undefined,
	renderParameter, before, after, copy, disabled = false, onChangeParameters = null }) {
	const [linkTone, setLinkTone] = useState(false);
	const toneGestureBase = useRef(null);
	const [initialAmplification] = useState(Number(parameters.gainDb) || 0);
	const sections = audacityPortSections(effectType, Object.keys(definition?.params || {}));
	const controls = new Map(Object.keys(definition?.params || {}).map(name => [name, renderParameter(name)]));
	const label = key => canonicalCopyValue(key, copy);
	const renderControl = name => {
		const control = controls.get(name);
		if (effectType === 'audacity-bass-treble' && linkTone && onChangeParameters
			&& ['bassDb', 'trebleDb'].includes(name) && React.isValidElement(control)) {
			const output = controls.get('volumeDb');
			const previousTone = Number(parameters[name]) || 0;
			const outputGain = Number(parameters.volumeDb) || 0;
			return React.cloneElement(control, {
				onCommit: next => commitAudacityLinkedTone(previousTone, next, outputGain,
					control.props.onCommit, output.props.onCommit),
				gestureFor: (...args) => {
					const gesture = control.props.gestureFor(...args);
					if (!gesture.onGestureCommit) return gesture;
					return {
						...gesture,
						onGestureBegin: value => {
							toneGestureBase.current = { tone: previousTone, output: outputGain };
							return gesture.onGestureBegin?.(value);
						},
						onGestureCommit: async value => {
							const base = toneGestureBase.current || { tone: previousTone, output: outputGain };
							toneGestureBase.current = null;
							await commitAudacityLinkedTone(base.tone, value, base.output,
								gesture.onGestureCommit, output.props.onCommit);
						},
						onGestureCancel: () => {
							toneGestureBase.current = null;
							return gesture.onGestureCancel?.();
						},
					};
				},
			});
		}
		return control;
	};
	const amplifyPeak = () => {
		const control = controls.get('gainDb');
		const sourcePeak = Number.isFinite(effectContext.peakAmplitudeDb)
			? effectContext.peakAmplitudeDb : -initialAmplification;
		return <ParameterNumber label={`${label('effectAudacityNewPeakAmplitude')} (dB)`}
			displayLabel={label('effectAudacityNewPeakAmplitude')} valueUnit="dB"
			value={Number(((Number(parameters.gainDb) || 0) + sourcePeak).toFixed(3))}
			range={[-50 + sourcePeak, 50 + sourcePeak]} step={0.1} presentation="slider"
			copy={copy} disabled={disabled} hook="newPeakAmplitude" timeCodeUnit={null}
			onCommit={next => control?.props?.onCommit?.(next - sourcePeak, { controlValue: next - sourcePeak })} />;
	};
	const rateControls = ['audacity-change-tempo', 'audacity-change-speed-pitch'].includes(effectType);
	const slidingControls = effectType === 'audacity-sliding-stretch';
	const noiseControls = effectType === 'audacity-noise-reduction';
	return (
		<div className={`audio-editor-audacity-layout audio-editor-audacity-layout--${effectType} audio-editor-audacity-port`}
			data-audacity-effect-layout={effectType} data-audacity-nyquist-port={isAudacityNyquistPort(effectType) || undefined}>
			{before}
			<div className="audio-editor-audacity-port__body">
				<AudacityLegacyEffectGraph effectType={effectType} parameters={parameters} sampleRate={sampleRate} copy={copy} />
				{noiseControls && <AudacityNoiseReductionControls parameters={parameters} copy={copy}
					disabled={disabled} renderParameter={name => controls.get(name)} onChangeOutput={value => {
						void controls.get('output')?.props?.onCommit?.(value, { controlValue: value === 'reduce' ? 0 : 1 });
					}} />}
				{effectType === 'audacity-change-pitch' && <AudacityPitchControls parameters={parameters}
					effectContext={effectContext} renderParameter={name => controls.get(name)} copy={copy} disabled={disabled} />}
				{rateControls && <AudacityRateControls effectType={effectType} parameters={parameters}
					sampleRate={sampleRate}
					parameterRange={[
						definition.params[effectType === 'audacity-change-tempo' ? 'tempoPercent' : 'speedPercent'].minimum,
						definition.params[effectType === 'audacity-change-tempo' ? 'tempoPercent' : 'speedPercent'].maximum,
					]}
					effectContext={effectContext} renderParameter={name => controls.get(name)} copy={copy} disabled={disabled} />}
				{slidingControls && <AudacitySlidingStretchControls parameters={parameters} definition={definition}
					renderParameter={name => controls.get(name)} copy={copy} disabled={disabled} />}
				{sections.filter(section => (!rateControls || section.id !== 'settings')
					&& !noiseControls
					&& (!slidingControls || !['initial-tempo', 'final-tempo', 'initial-pitch', 'final-pitch'].includes(section.id))
					&& (effectType !== 'audacity-change-pitch' || section.id !== 'pitch')
					&& section.names.some(name => controls.get(name) != null)).map(section => <section key={section.id}
					className={[
						'audio-editor-audacity-port__section',
						section.boxed && 'audio-editor-audacity-port__section--boxed',
						section.largeKnobs && 'audio-editor-audacity-port__section--large-knobs',
						section.divider && 'audio-editor-audacity-port__section--divider',
					].filter(Boolean).join(' ')}
					data-audacity-port-section={section.id}>
					{section.titleKey && <h3 className="audio-editor-audacity-port__heading">{canonicalCopyValue(section.titleKey, copy)}</h3>}
					<div className="audio-editor-audacity-port__parameters" style={{ '--audacity-port-columns': section.columns || 1 }}>
						{section.names.filter(name => controls.get(name) !== null).map(name => <React.Fragment key={name}>
							{effectType === 'audacity-amplify' && name === 'allowClipping' && amplifyPeak()}
							<div className="audio-editor-audacity-layout__parameter"
								data-audacity-parameter={name}>{renderControl(name)}</div>
						</React.Fragment>)}
					</div>
				</section>)}
				{effectType === 'audacity-bass-treble' && <div className="audio-editor-audacity-port__link-tone">
					<DesignCheckbox label={label('effectAudacityLinkToneVolume')} checked={linkTone} disabled={disabled || !onChangeParameters}
						onChange={setLinkTone} />
				</div>}
			</div>
			{after}
		</div>
	);
}
