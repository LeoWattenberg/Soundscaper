import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	audioEffectParamChoices,
	audioEffectParamRange,
} from '../../effects.js';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectOptionLabel,
	audacityEffectParameterLabel,
	formatAudacityCurve,
	parseAudacityCurve,
} from '../../audacity-effects/manifest.js';
import { AUDIO_EDITOR_SAMPLE_RATE } from '../../project.js';
import { AudacityEffectLayout } from '../AudacityEffectLayout.jsx';
import { ParametricEqEditor } from '../ParametricEqEditor.jsx';
import { CommitField, DesignCheckbox, LabeledDropdown, SteppedSlider } from './inspector-controls.jsx';
import ParameterNumber, { durationUnit } from './EffectParameterNumber.jsx';
import {
	audacityCurvePolyline,
	audacityParameterPresentation,
	audacityParameterVisible,
	audioEffectParamRangeFromDescriptor,
	isAudacityDefinition,
	nativeEffectOptionLabel,
	nativeEffectParameterLabel,
	safeEffectLabel,
} from './effect-helpers.ts';
import { createParameterAutomationControlRouterV21 } from '../soundscaper-workflow-product-runtime.tsx';

export default function EffectParameterEditor({
	effect,
	copy,
	disabled,
	tracks,
	targetTrackId,
	sampleRate = AUDIO_EDITOR_SAMPLE_RATE,
	captureNoiseProfile,
	captureNoiseProfileDisabled = false,
	noiseProfileLabel,
	hideControlTrack = false,
	onRackEffectGestureBegin,
	onRackEffectPreview,
	onRackEffectCommit,
	onRackEffectCancel,
	onParametricEqGestureBegin,
	onParametricEqPreview,
	onParametricEqCommit,
	onParametricEqCancel,
	onParametricEqAudition,
	readParametricEqSpectrum,
	readDynamicsAnalysis = null,
	automationRuntime,
	automationProject,
	automationStrip,
	onChange,
}) {
	const [error, setError] = useState('');
	const automationRouterRef = useRef(null);
	if (!automationRouterRef.current) {
		automationRouterRef.current = createParameterAutomationControlRouterV21();
	}
	const automationRouter = automationRouterRef.current;
	automationRouter.setContext({
		runtime: automationRuntime,
		project: automationProject,
		onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
	});
	useEffect(() => () => { automationRouter.cancel(); }, [automationProject?.id, automationRouter, effect.id]);
	if (effect.type === 'missing') {
		return (
			<div className="audio-editor-effect-parameters audio-editor-effect-parameters--missing" data-missing-effect>
				<strong>{safeEffectLabel(effect, copy)}</strong>
				<p className="audio-editor-panel-hint">{copy.missingEffectReadOnly}</p>
			</div>
		);
	}
	const definition = isAudacityDefinition(effect.type) ? AUDACITY_EFFECT_DEFINITIONS[effect.type] : null;
	const invoke = (callback) => {
		setError('');
		return Promise.resolve().then(callback).catch((cause) => {
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	};
	const update = (changes) => invoke(() => onChange(changes));
	const parameterAddress = (parameterId, elementId) => automationStrip ? {
		kind: 'effect',
		strip: automationStrip,
		effectId: effect.id,
		...(elementId ? { elementId } : {}),
		parameterId,
	} : null;
	const updateParam = (name, value, automation = {}) => {
		const address = parameterAddress(automation.parameterId || name, automation.elementId);
		if (address && Number.isFinite(automation.controlValue)
			&& automationRouter.performAtomic(address, automation.controlValue)) return undefined;
		return update({ params: { [name]: value } });
	};
	const parameterGestureProps = (parameterId, elementId = null, fallback = null) => {
		const address = parameterAddress(parameterId, elementId);
		const routed = Boolean(address && (
			automationRouter.owns(address) || automationRouter.captureAvailable(address)
		));
		if (!routed && !fallback) return {};
		const reserved = () => Boolean(address && (
			automationRouter.owns(address) || automationRouter.captureAvailable(address)
		));
		return {
			onGestureBegin: (value) => {
				if (address && (automationRouter.begin(address, value) || reserved())) return undefined;
				return fallback?.begin?.(value);
			},
			onGesturePreview: (value) => {
				if (address && (automationRouter.preview(address, value) || reserved())) return undefined;
				return fallback?.preview?.(value);
			},
			onGestureCommit: (value) => {
				if (address && (automationRouter.release(address, value) || reserved())) return undefined;
				return fallback?.commit?.(value);
			},
			onGestureCancel: () => {
				if (address && (automationRouter.cancel(address) || reserved())) return undefined;
				return fallback?.cancel?.();
			},
		};
	};

	if (!definition) {
		if (effect.type === 'eq') {
			return (
				<div className="audio-editor-effect-parameters audio-editor-effect-parameters--parametric-eq" data-effect-parameters>
					<ParametricEqEditor
						params={effect.params}
						effectId={effect.id || 'selection-eq'}
						sampleRate={sampleRate}
						copy={copy}
						disabled={disabled}
						onGestureBegin={onParametricEqGestureBegin}
						onPreview={onParametricEqPreview}
						onCommit={(params) => onParametricEqCommit ? onParametricEqCommit(params) : update({ params })}
						onCancel={onParametricEqCancel}
							onAudition={onParametricEqAudition}
							readSpectrum={readParametricEqSpectrum}
							parameterAutomation={automationStrip ? {
								captureAvailable: (parameterId, elementId) => {
									const address = parameterAddress(parameterId, elementId);
									return Boolean(address && (automationRouter.owns(address)
										|| automationRouter.captureAvailable(address)));
								},
								begin: (parameterId, elementId, value) => automationRouter.begin(
									parameterAddress(parameterId, elementId), value,
								),
								preview: (parameterId, elementId, value) => automationRouter.preview(
									parameterAddress(parameterId, elementId), value,
								),
								release: (parameterId, elementId, value) => automationRouter.release(
									parameterAddress(parameterId, elementId), value,
								),
								cancel: (parameterId, elementId) => automationRouter.cancel(
									parameterAddress(parameterId, elementId),
								),
								performAtomic: (parameterId, elementId, value) => automationRouter.performAtomic(
									parameterAddress(parameterId, elementId), value,
								),
							} : null}
						/>
					{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
				</div>
			);
		}
		const parameterNames = Object.entries(effect.params || {}).filter(([name, value]) => (
			typeof value === 'number' || audioEffectParamChoices(effect.type, name) !== null
		)).map(([name]) => name);
		const nativeDefinition = { params: Object.fromEntries(parameterNames.map((name) => [name, {}])) };
			const renderNativeParameter = (name) => {
			const choices = audioEffectParamChoices(effect.type, name);
			if (choices) {
				return (
					<LabeledDropdown
						label={nativeEffectParameterLabel(effect.type, name, copy)}
						value={String(effect.params?.[name])}
						options={choices.map((option) => ({
							value: String(option),
							label: nativeEffectOptionLabel(effect.type, name, option, copy),
						}))}
						onChange={(next) => updateParam(name, next, {
							controlValue: Math.max(0, choices.findIndex((option) => (
								String(option) === String(next)
							))),
						})}
						disabled={disabled}
						hook={`effect-param-${name}`}
					/>
				);
			}
			const descriptor = AUDIO_EFFECT_DEFINITIONS[effect.type]?.ranges?.[name]
				|| AUDIO_SELECTION_EFFECT_DEFINITIONS[effect.type]?.ranges?.[name];
				const unit = descriptor?.[2]?.unit;
				const fallback = onRackEffectGestureBegin && onRackEffectPreview && onRackEffectCommit
					? {
						begin: () => invoke(onRackEffectGestureBegin),
						preview: (next) => invoke(() => onRackEffectPreview({
							...effect.params, [name]: next,
						})),
						commit: (next) => invoke(() => onRackEffectCommit({
							...effect.params, [name]: next,
						})),
						cancel: onRackEffectCancel ? () => invoke(onRackEffectCancel) : null,
					} : null;
				return (
					<ParameterNumber
					label={nativeEffectParameterLabel(effect.type, name, copy)}
					value={effect.params?.[name]}
					range={audioEffectParamRange(effect.type, name) || descriptor?.slice(0, 2)}
					step={descriptor?.[2]?.step}
					copy={copy}
					disabled={disabled}
					hook={name}
					durationUnit={durationUnit(effect.type, name, unit)}
					sampleRate={sampleRate}
						onCommit={(next) => updateParam(name, next, { controlValue: next })}
						{...parameterGestureProps(name, null, fallback)}
					/>
			);
		};
		return (
			<div className="audio-editor-effect-parameters" data-effect-parameters>
				<AudacityEffectLayout
					effectType={effect.type}
					definition={nativeDefinition}
					parameters={effect.params}
					copy={copy}
					renderParameter={renderNativeParameter}
					readDynamicsAnalysis={readDynamicsAnalysis}
					after={error && <p className="audio-editor-field-error" role="alert">{error}</p>}
				/>
			</div>
		);
	}

	const candidates = tracks.filter((track) => track.id !== targetTrackId);
	const renderParameter = (name) => (
		audacityParameterVisible(effect, name) ? (
			<AudacityParameter
				name={name}
				effectType={effect.type}
				descriptor={definition.params[name]}
				value={effect.params?.[name]}
				effectParams={effect.params}
				copy={copy}
				disabled={disabled}
				sampleRate={sampleRate}
				onCommit={(value, automation) => updateParam(name, value, automation)}
				gestureFor={(parameterId = name, elementId = null) => (
					parameterGestureProps(parameterId, elementId)
				)}
			/>
		) : null
	);
	const contextControls = (
		<>
			{definition.requiresControlTrack && !hideControlTrack && (
				<section className="audio-editor-audacity-layout__context-card">
					<h3>{copy.controlTrack}</h3>
					<LabeledDropdown
						label={copy.controlTrack}
						value={effect.context?.controlTrackId || ''}
						options={candidates.map((track) => ({ value: track.id, label: track.name }))}
						onChange={(controlTrackId) => update({ context: { controlTrackId: controlTrackId || null } })}
						disabled={disabled || candidates.length === 0}
						hook="effect-context-controlTrackId"
					/>
				</section>
			)}
			{definition.requiresNoiseProfile && (
				<section className="audio-editor-audacity-layout__context-card audio-editor-audacity-layout__context-card--profile">
					<div>
						<h3>{copy.noiseProfileStep}</h3>
						{!effect.context?.noiseProfile && <p className="audio-editor-panel-hint">{copy.rackNoiseProfileMissing}</p>}
					</div>
					{captureNoiseProfile && (
						<span data-effect-noise-profile data-audacity-noise-profile>
							<Button disabled={disabled || captureNoiseProfileDisabled} onClick={captureNoiseProfile}>{noiseProfileLabel}</Button>
						</span>
					)}
				</section>
			)}
		</>
	);
	return (
		<div className="audio-editor-effect-parameters" data-effect-parameters>
			<AudacityEffectLayout
				effectType={effect.type}
				definition={definition}
				parameters={effect.params}
				copy={copy}
				renderParameter={renderParameter}
				readDynamicsAnalysis={readDynamicsAnalysis}
				before={contextControls}
				after={(
					<>
						{Object.keys(definition.params).length === 0 && (
							<p className="audio-editor-audacity-layout__empty">{copy.noAdjustableSettings}</p>
						)}
						{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
					</>
				)}
			/>
		</div>
	);
}

function AudacityParameter({ name, effectType, descriptor, value, effectParams, copy, disabled,
	sampleRate, onCommit, gestureFor }) {
	const label = audacityEffectParameterLabel(effectType, name, copy);
	if (descriptor.kind === 'boolean') {
		return (
			<div data-effect-param={name}>
				<DesignCheckbox
					label={label}
					checked={Boolean(value)}
					disabled={disabled}
					onChange={(next) => onCommit(next, { controlValue: next ? 1 : 0 })}
				/>
			</div>
		);
	}
	if (descriptor.kind === 'enum') {
		return (
			<LabeledDropdown
				label={label}
				value={String(value)}
				options={descriptor.options.map((option) => ({
					value: String(option.value),
					label: audacityEffectOptionLabel(effectType, name, option.value, copy),
				}))}
				onChange={(next) => onCommit(next, {
					controlValue: Math.max(0, descriptor.options.findIndex((option) => (
						String(option.value) === String(next)
					))),
				})}
				disabled={disabled}
				hook={`effect-param-${name}`}
			/>
		);
	}
	if (descriptor.kind === 'curve') {
		return (
			<div className="audio-editor-filter-curve" data-effect-param={name}>
				<svg viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-label={label}>
					<g className="audio-editor-filter-curve__grid">
						<path d="M16 16 H624 M16 63 H624 M16 110 H624 M16 157 H624 M16 204 H624" />
						<path d="M16 16 V204 M117 16 V204 M218 16 V204 M320 16 V204 M421 16 V204 M522 16 V204 M624 16 V204" />
					</g>
					<polyline className="audio-editor-filter-curve__line" points={audacityCurvePolyline(value, Boolean(effectParams?.linearFrequencyScale))} />
				</svg>
				<details>
					<summary>{label}</summary>
					<CommitField
						label={label}
						name={name}
						value={formatAudacityCurve(value)}
						disabled={disabled}
						multiline
						hookName="effect-param"
						onCommit={(_field, next) => onCommit(parseAudacityCurve(next))}
					/>
				</details>
				<div className="audio-editor-panel-actions audio-editor-filter-curve__actions">
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit([{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }])}>{copy.reset}</Button>
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit((value || []).map((point) => ({ ...point, gain: -point.gain })))}>{copy.invert}</Button>
				</div>
			</div>
		);
	}
	if (descriptor.kind === 'bands') {
		return (
			<fieldset className="audio-editor-graphic-eq">
				<legend>{label}</legend>
				<div className="audio-editor-graphic-eq__faders">
					{descriptor.frequencies.map((frequency, index) => {
						const gain = value?.[index] ?? 0;
						const elementId = `frequency:${String(frequency)}`;
						const gestures = gestureFor('gains', elementId);
						return (
							<div className="audio-editor-graphic-eq__fader" data-effect-param={`${name}.${index}`} key={frequency}>
								<output>{Number(gain).toFixed(1)}</output>
								<div className="audio-editor-graphic-eq__slider">
									<SteppedSlider
										value={gain}
										min={descriptor.minimum}
										max={descriptor.maximum}
										step={descriptor.step}
										ariaLabel={`${frequency} Hz`}
										disabled={disabled}
											onChange={(next) => {
												const values = Array.isArray(value) ? [...value] : [...descriptor.default];
												values[index] = Math.round(next / descriptor.step) * descriptor.step;
												if (gestures.onGesturePreview) {
													gestures.onGesturePreview(values[index]);
													return;
												}
												onCommit(values, {
													controlValue: values[index],
													elementId,
													parameterId: 'gains',
												});
											}}
											{...gestures}
									/>
								</div>
								<span>{frequency >= 1_000 ? `${frequency / 1_000}k` : frequency}</span>
							</div>
						);
					})}
				</div>
				<div className="audio-editor-panel-actions audio-editor-graphic-eq__actions">
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit(descriptor.frequencies.map(() => 0))}>{copy.reset}</Button>
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit((value || descriptor.default).map((gain) => -gain))}>{copy.invert}</Button>
				</div>
			</fieldset>
		);
	}
	const range = audioEffectParamRange(effectType, name) || audioEffectParamRangeFromDescriptor(descriptor);
	return (
		<ParameterNumber
			label={`${label}${descriptor.unit ? ` (${descriptor.unit})` : ''}`}
			value={value}
			range={range}
			step={descriptor.step}
			presentation={audacityParameterPresentation(effectType, name)}
			copy={copy}
			disabled={disabled}
			hook={name}
			durationUnit={durationUnit(effectType, name, descriptor.unit)}
			sampleRate={sampleRate}
			onCommit={(next) => onCommit(next, { controlValue: next })}
			{...gestureFor(name)}
		/>
	);
}
