import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Knob } from '@soundscaper/design-system/Knob';
import { audioEffectParamRange } from '../../effects.js';
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
import {
	audacityCurvePolyline,
	audacityParameterPresentation,
	audacityParameterVisible,
	audioEffectParamRangeFromDescriptor,
	effectParameterLabel,
	isAudacityDefinition,
	safeEffectLabel,
} from './effect-helpers.ts';

export default function EffectParameterEditor({
	effect,
	copy,
	disabled,
	tracks,
	targetTrackId,
	sampleRate = AUDIO_EDITOR_SAMPLE_RATE,
	captureNoiseProfile,
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
	onChange,
}) {
	const [error, setError] = useState('');
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
	const updateParam = (name, value) => update({ params: { [name]: value } });

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
					/>
					{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
				</div>
			);
		}
		const parameterNames = Object.entries(effect.params || {}).filter(([, value]) => typeof value === 'number').map(([name]) => name);
		const nativeDefinition = { params: Object.fromEntries(parameterNames.map((name) => [name, {}])) };
		const renderNativeParameter = (name) => {
			return (
				<ParameterNumber
					label={effectParameterLabel(name, copy)}
					value={effect.params?.[name]}
					range={audioEffectParamRange(effect.type, name)}
					copy={copy}
					disabled={disabled}
					hook={name}
					onCommit={(next) => updateParam(name, next)}
					onGestureBegin={onRackEffectGestureBegin
						? () => invoke(onRackEffectGestureBegin)
						: null}
					onGesturePreview={onRackEffectPreview
						? (next) => invoke(() => onRackEffectPreview({
							...effect.params,
							[name]: next,
						}))
						: null}
					onGestureCommit={onRackEffectCommit
						? (next) => invoke(() => onRackEffectCommit({
							...effect.params,
							[name]: next,
						}))
						: null}
					onGestureCancel={onRackEffectCancel
						? () => invoke(onRackEffectCancel)
						: null}
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
				onCommit={(value) => updateParam(name, value)}
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
							<Button disabled={disabled} onClick={captureNoiseProfile}>{noiseProfileLabel}</Button>
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

function AudacityParameter({ name, effectType, descriptor, value, effectParams, copy, disabled, onCommit }) {
	const label = audacityEffectParameterLabel(effectType, name, copy);
	if (descriptor.kind === 'boolean') {
		return (
			<div data-effect-param={name}>
				<DesignCheckbox label={label} checked={Boolean(value)} disabled={disabled} onChange={onCommit} />
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
				onChange={onCommit}
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
											onCommit(values);
										}}
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
			onCommit={onCommit}
		/>
	);
}

function ParameterNumber({
	label,
	value,
	range,
	step,
	presentation = 'knob',
	copy,
	disabled,
	hook,
	onCommit,
	onGestureBegin,
	onGesturePreview,
	onGestureCommit,
	onGestureCancel,
}) {
	const [gestureActive, setGestureActive] = useState(false);
	const [gestureValue, setGestureValue] = useState(null);
	const gestureActiveRef = useRef(false);
	const gestureValueRef = useRef(null);
	const gestureCallbacksRef = useRef({});
	gestureCallbacksRef.current = {
		begin: onGestureBegin,
		preview: onGesturePreview,
		commit: onGestureCommit,
		cancel: onGestureCancel,
	};
	const knobRange = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) ? range : null;
	const knobStep = Number.isFinite(step) && step > 0
		? step
		: 0.01;
	const gestureEnabled = Boolean(onGestureBegin && onGesturePreview && onGestureCommit);
	useEffect(() => {
		if (!gestureActive) return undefined;
		const finish = (event) => {
			if (!gestureActiveRef.current) return;
			gestureActiveRef.current = false;
			const next = gestureValueRef.current;
			if (event?.type === 'blur' && typeof globalThis.MouseEvent === 'function') {
				document.dispatchEvent(new globalThis.MouseEvent('mouseup', { bubbles: true }));
			}
			setGestureActive(false);
			setGestureValue(null);
			gestureCallbacksRef.current.commit?.(next);
		};
		document.addEventListener('mouseup', finish);
		globalThis.addEventListener?.('blur', finish);
		return () => {
			document.removeEventListener('mouseup', finish);
			globalThis.removeEventListener?.('blur', finish);
		};
	}, [gestureActive]);
	useEffect(() => () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		gestureCallbacksRef.current.cancel?.();
	}, []);
	const beginKnobGesture = (event) => {
		if (
			disabled
			|| !gestureEnabled
			|| event.button !== 0
			|| !event.target.closest?.('.knob')
		) return;
		const current = Number(value) || 0;
		gestureActiveRef.current = true;
		gestureValueRef.current = current;
		setGestureValue(current);
		setGestureActive(true);
		gestureCallbacksRef.current.begin?.();
	};
	const previewKnobValue = (next) => {
		if (!gestureActiveRef.current || !gestureEnabled) {
			onCommit(next);
			return;
		}
		gestureValueRef.current = next;
		setGestureValue(next);
		gestureCallbacksRef.current.preview?.(next);
	};
	const commit = (raw) => {
		const next = Number(raw);
		if (!Number.isFinite(next) || (range && (next < range[0] || next > range[1]))) {
			throw new RangeError(copy.parameterRangeError
				.replace('{label}', label)
				.replace('{minimum}', String(range?.[0] ?? '−∞'))
				.replace('{maximum}', String(range?.[1] ?? '∞')));
		}
		onCommit(next);
	};
	const commitSlider = (next) => {
		const snapped = knobStep > 0
			? Math.round((next - knobRange[0]) / knobStep) * knobStep + knobRange[0]
			: next;
		onCommit(Number(snapped.toFixed(8)));
	};
	return (
		<div
			className={`audio-editor-effect-number audio-editor-effect-number--${presentation}`}
			data-effect-param={hook}
			role="group"
			aria-label={label}
			onMouseDownCapture={beginKnobGesture}
		>
			<span>{label}</span>
			{knobRange && presentation === 'knob' && <Knob
				value={gestureValue ?? (Number(value) || 0)}
				min={knobRange[0]}
				max={knobRange[1]}
				step={knobStep}
				label={label}
				mode={knobRange[0] < 0 && knobRange[1] > 0 ? 'bipolar' : 'unipolar'}
				disabled={disabled}
				onChange={previewKnobValue}
			/>}
			{knobRange && presentation === 'slider' && <SteppedSlider
				value={Number(value) || 0}
				min={knobRange[0]}
				max={knobRange[1]}
				step={knobStep}
				ariaLabel={label}
				disabled={disabled}
				onChange={commitSlider}
			/>}
			<CommitField
				label={label}
				name={hook}
				value={String(value ?? '')}
				type="number"
				disabled={disabled}
				hookName="effect-number-input"
				visuallyHiddenLabel
				onCommit={(_name, raw) => commit(raw)}
			/>
		</div>
	);
}
