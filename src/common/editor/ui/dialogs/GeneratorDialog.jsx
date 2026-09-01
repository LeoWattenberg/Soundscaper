import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Dropdown } from '@soundscaper/design-system/Dropdown';
import { Knob } from '@soundscaper/design-system/Knob';
import { LabeledRadio } from '@soundscaper/design-system/LabeledRadio';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { Separator } from '@soundscaper/design-system/Separator';
import { TextInput } from '@soundscaper/design-system/TextInput';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';

export default function GeneratorDialog({ type, controller, copy, locale, run, onClose }) {
	const [params, setParams] = useState(() => generatorDefaults(type));
	useEffect(() => setParams(generatorDefaults(type)), [type]);
	const update = (name, value) => setParams((current) => ({ ...current, [name]: value }));
	const labels = generatorLayoutLabels(copy);
	const waveformOptions = generatorWaveformOptions(copy);
	const dtmfTiming = generatorDtmfTiming(params);
	const numberField = (name, label, options = {}) => (
		<GeneratorNumberField
			name={name}
			label={label}
			ariaLabel={options.ariaLabel}
			value={params[name]}
			min={options.min}
			max={options.max}
			step={options.step ?? 0.01}
			onChange={(value) => update(name, value)}
		/>
	);
	const timeField = (name, label, options = {}) => <label
		className="kw-audio-editor-dialog__field"
		data-generator-field={name}
	>
		<span>{label}</span>
		<AudioEditorTimeCodeInput
			label={label}
			value={params[name]}
			minimum={options.min}
			maximum={options.max}
			onChange={(value) => update(name, value)}
		/>
	</label>;
	const updateDtmfTiming = ({ totalSeconds, dutyPercent }) => {
		setParams((current) => {
			const currentTiming = generatorDtmfTiming(current);
			const next = generatorDtmfDurations(
				totalSeconds ?? currentTiming.totalSeconds,
				dutyPercent ?? currentTiming.dutyPercent,
				currentTiming.symbolCount,
			);
			return {
				...current,
				durationSeconds: next.totalSeconds,
				toneSeconds: next.toneSeconds,
				silenceSeconds: next.silenceSeconds,
			};
		});
	};
	const updateDtmfSequence = (sequence) => {
		setParams((current) => {
			const currentTiming = generatorDtmfTiming(current);
			const next = generatorDtmfDurations(
				currentTiming.totalSeconds,
				currentTiming.dutyPercent,
				generatorDtmfSymbolCount(sequence),
			);
			return {
				...current,
				sequence,
				durationSeconds: next.totalSeconds,
				toneSeconds: next.toneSeconds,
				silenceSeconds: next.silenceSeconds,
			};
		});
	};
	const title = generatorLabel(type, copy);
	return (
		<AudioEditorDialogShell
			title={title}
			headerOs={null}
			onClose={onClose}
			width={680}
			className="kw-audio-editor-dialog--generator"
			overlayClassName="kw-audio-editor-dialog-layer"
			overlayDataAttributes={{ 'data-open': 'true' }}
			dataAttributes={{ 'data-generator-type': type }}
			closeOnOutside={false}
			wrapBody={false}
		>
				<form className="kw-audio-editor-generator" onSubmit={(event) => {
					event.preventDefault();
					const options = type === 'dtmf'
						? { ...params, durationSeconds: dtmfTiming.totalSeconds, toneSeconds: dtmfTiming.toneSeconds, silenceSeconds: dtmfTiming.silenceSeconds }
						: params;
					void runAwaitedAudioEditorOperation(
						run,
						() => controller.actions.generators.generate(type, options),
					).then(onClose).catch(() => undefined);
				}}>
					<div className="kw-audio-editor-generator__content">
						{type === 'tone' && (
							<div className="kw-audio-editor-generator__standard-grid" data-generator-layout="tone">
								<GeneratorSelect label={copy.generatorWaveform} value={params.waveform} onChange={(value) => update('waveform', value)} options={waveformOptions} />
								{numberField('frequency', copy.generatorFrequency, { min: 0.01, max: 96_000, step: 1 })}
								{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
								{timeField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400 })}
							</div>
						)}

						{type === 'chirp' && (
							<div className="kw-audio-editor-generator__chirp" data-generator-layout="chirp">
								<GeneratorSelect
									label={copy.generatorWaveform}
									value={params.waveform}
									onChange={(value) => update('waveform', value)}
									options={waveformOptions}
								/>
								<div role="group" aria-label={labels.frequencySweep}>
									<PreferencePanel title={labels.frequencySweep} className="kw-audio-editor-generator__card">
										<GeneratorRadioGroup
											label={copy.generatorInterpolation}
											value={params.interpolation}
											onChange={(value) => update('interpolation', value)}
											options={[
												['linear', copy.linear],
												['logarithmic', copy.logarithmic],
											]}
										/>
										<Separator />
										<div className="kw-audio-editor-generator__pair">
											{numberField('startFrequency', copy.generatorStartFrequency, { min: 0.01, max: 96_000, step: 1 })}
											{numberField('endFrequency', copy.generatorEndFrequency, { min: 0.01, max: 96_000, step: 1 })}
										</div>
									</PreferencePanel>
								</div>
								<div role="group" aria-label={labels.amplitudeSweep}>
									<PreferencePanel title={labels.amplitudeSweep} className="kw-audio-editor-generator__card">
										<div className="kw-audio-editor-generator__pair">
											{numberField('startAmplitude', copy.generatorStartAmplitude, { min: 0, max: 1, step: 0.01 })}
											{numberField('endAmplitude', copy.generatorEndAmplitude, { min: 0, max: 1, step: 0.01 })}
										</div>
									</PreferencePanel>
								</div>
								{timeField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400 })}
							</div>
						)}

						{type === 'noise' && (
							<div className="kw-audio-editor-generator__standard-grid" data-generator-layout="noise">
								<GeneratorSelect label={copy.generatorNoiseColor} value={params.color} onChange={(value) => update('color', value)} options={[
									['white', copy.generatorWhite], ['pink', copy.generatorPink], ['brown', copy.generatorBrown],
								]} />
								{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
								{timeField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400 })}
							</div>
						)}

						{type === 'silence' && (
							<div className="kw-audio-editor-generator__standard-grid kw-audio-editor-generator__standard-grid--single" data-generator-layout="silence">
								{timeField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400 })}
							</div>
						)}

						{type === 'dtmf' && (
							<div className="kw-audio-editor-generator__dtmf" data-generator-layout="dtmf">
								<div role="group" aria-label={generatorLabel(type, copy)}>
									<PreferencePanel className="kw-audio-editor-generator__card kw-audio-editor-generator__dtmf-fields">
										<label className="kw-audio-editor-dialog__field" data-generator-field="sequence">
											<span>{copy.generatorSequence}</span>
											<TextInput value={params.sequence} onChange={updateDtmfSequence} />
										</label>
										<p className="kw-audio-editor-generator__explanation">{labels.dtmfExplanation}</p>
										{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
										<label className="kw-audio-editor-dialog__field" data-generator-field="durationSeconds">
											<span>{copy.generatorDuration}</span>
											<AudioEditorTimeCodeInput
												label={copy.generatorDuration}
												value={dtmfTiming.totalSeconds}
												minimum={0.001}
												maximum={86_400}
												onChange={(value) => updateDtmfTiming({ totalSeconds: value })}
											/>
										</label>
									</PreferencePanel>
								</div>
								<div role="group" aria-label={labels.toneSilenceRatio}>
									<PreferencePanel title={labels.toneSilenceRatio} className="kw-audio-editor-generator__card kw-audio-editor-generator__ratio-card">
										<div className="kw-audio-editor-generator__ratio-control">
											<GeneratorKnob
												value={dtmfTiming.dutyPercent}
												label={labels.dutyCycle}
												onChange={(value) => updateDtmfTiming({ dutyPercent: value })}
											/>
											<GeneratorNumberField
												name="dutyPercent"
												label={labels.dutyCycle}
												value={dtmfTiming.dutyPercent}
												min={1}
												max={100}
												step={1}
												onChange={(value) => updateDtmfTiming({ dutyPercent: value })}
											/>
										</div>
										<Separator />
										<dl className="kw-audio-editor-generator__timing-summary">
											<div><dt>{labels.dutyCycle}</dt><dd>{formatGeneratorNumber(dtmfTiming.dutyPercent, locale)}%</dd></div>
											<div><dt>{copy.generatorToneDuration}</dt><dd>{formatGeneratorNumber(dtmfTiming.toneSeconds, locale)} s</dd></div>
											<div><dt>{copy.generatorSilenceDuration}</dt><dd>{formatGeneratorNumber(dtmfTiming.silenceSeconds, locale)} s</dd></div>
										</dl>
									</PreferencePanel>
								</div>
							</div>
						)}
					</div>
					<div className="kw-audio-editor-dialog__actions">
						<Button type="button" variant="secondary" onClick={onClose}>{copy.cancel}</Button>
						<Button type="submit">{copy.generate}</Button>
					</div>
				</form>
		</AudioEditorDialogShell>
	);
}

function GeneratorNumberField({ name, label, ariaLabel = label, value, min, max, step, onChange }) {
	const inputRef = useRef(null);
	const valueRef = useRef(value);
	const [draft, setDraft] = useState(() => String(value));
	valueRef.current = value;
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return undefined;
		input.setAttribute('aria-label', ariaLabel);
		const handleBlur = () => {
			setDraft((current) => current.trim() && Number.isFinite(Number(current)) ? current : String(valueRef.current));
		};
		input.addEventListener('blur', handleBlur);
		return () => input.removeEventListener('blur', handleBlur);
	}, [ariaLabel]);
	useEffect(() => {
		if (document.activeElement !== inputRef.current) setDraft(String(value));
	}, [value]);
	return (
		<label className="kw-audio-editor-dialog__field" data-generator-field={name}>
			<span>{label}</span>
			<NumberStepper
				ref={inputRef}
				value={draft}
				min={min}
				max={max}
				step={step}
				width="100%"
				onChange={(next) => {
					setDraft(next);
					if (next.trim() && Number.isFinite(Number(next))) onChange(Number(next));
				}}
			/>
		</label>
	);
}

function GeneratorSelect({ label, value, disabled = false, onChange, options }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-dialog__field" data-generator-field={label} role="group" aria-label={label}>
			<span>{label}</span>
			<Dropdown
				disabled={disabled}
				value={value}
				onChange={onChange}
				options={options.map(([id, text]) => ({ value: id, label: text }))}
				width="100%"
			/>
		</div>
	);
}

function GeneratorRadioGroup({ label, value, onChange, options }) {
	const groupRef = useRef(null);
	useEffect(() => {
		const radios = [...(groupRef.current?.querySelectorAll('[role="radio"]') || [])];
		radios.forEach((radio, index) => {
			radio.setAttribute('aria-label', options[index][1]);
			radio.setAttribute('tabindex', options[index][0] === value ? '0' : '-1');
		});
	}, [options, value]);
	const selectAndFocus = (nextValue) => {
		onChange(nextValue);
		queueMicrotask(() => groupRef.current?.querySelector(`[data-generator-radio-value="${nextValue}"] [role="radio"]`)?.focus());
	};
	return (
		<div
			ref={groupRef}
			className="kw-audio-editor-generator__radio-group"
			role="radiogroup"
			aria-label={label}
			onKeyDown={(event) => {
				if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
				event.preventDefault();
				const currentIndex = Math.max(0, options.findIndex(([id]) => id === value));
				const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
				const nextIndex = (currentIndex + direction + options.length) % options.length;
				selectAndFocus(options[nextIndex][0]);
			}}
		>
			{options.map(([id, text]) => (
				<div
					key={id}
					className="kw-audio-editor-generator__radio-option"
					data-generator-radio-value={id}
					onClick={(event) => {
						if (!event.target.closest('[role="radio"]')) selectAndFocus(id);
					}}
				>
					<LabeledRadio label={text} name="generator-interpolation" value={id} checked={value === id} tabIndex={value === id ? 0 : -1} onChange={() => onChange(id)} />
				</div>
			))}
		</div>
	);
}

function GeneratorKnob({ value, label, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const knob = wrapperRef.current?.querySelector('.knob');
		if (!knob) return undefined;
		knob.setAttribute('type', 'button');
		const handleKeyDown = (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			if (event.key === 'Home') onChange(1);
			else if (event.key === 'End') onChange(100);
			else onChange(Math.max(1, Math.min(100, value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))));
		};
		knob.addEventListener('keydown', handleKeyDown);
		return () => knob.removeEventListener('keydown', handleKeyDown);
	}, [onChange, value]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-generator__knob">
			<Knob value={value} min={1} max={100} step={1} label={label} mode="unipolar" onChange={onChange} />
		</div>
	);
}

function generatorDtmfTiming(params) {
	const symbolCount = generatorDtmfSymbolCount(params.sequence);
	const toneSeconds = Number(params.toneSeconds) || 0;
	const silenceSeconds = Number(params.silenceSeconds) || 0;
	const dutyPercent = toneSeconds + silenceSeconds > 0
		? toneSeconds / (toneSeconds + silenceSeconds) * 100
		: 100;
	const totalSeconds = Number(params.durationSeconds) > 0 ? Number(params.durationSeconds) : 30;
	const durations = generatorDtmfDurations(totalSeconds, dutyPercent, symbolCount);
	return {
		symbolCount,
		...durations,
		dutyPercent: roundGeneratorNumber(dutyPercent),
	};
}

function generatorDtmfSymbolCount(sequence) {
	const normalized = String(sequence ?? '').toUpperCase().replace(/[\s,-]+/g, '');
	return Math.max(1, normalized.length);
}

function generatorDtmfDurations(totalSeconds, dutyPercent, symbolCount) {
	const total = Number(totalSeconds);
	const duty = Math.max(1, Math.min(100, Number(dutyPercent))) / 100;
	const gaps = Math.max(0, symbolCount - 1);
	const denominator = symbolCount + gaps * (1 - duty) / duty;
	const toneSeconds = total / denominator;
	const silenceSeconds = duty === 1 ? 0 : toneSeconds * (1 - duty) / duty;
	return {
		totalSeconds: roundGeneratorNumber(total),
		toneSeconds: roundGeneratorNumber(toneSeconds),
		silenceSeconds: roundGeneratorNumber(silenceSeconds),
	};
}

function roundGeneratorNumber(value) {
	return Number(Number(value).toFixed(6));
}

function formatGeneratorNumber(value, locale) {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

function generatorLayoutLabels(copy) {
	return {
		frequencySweep: copy.generatorFrequencySweep,
		amplitudeSweep: copy.generatorAmplitudeSweep,
		toneSilenceRatio: copy.generatorToneSilenceRatio,
		dutyCycle: copy.generatorDutyCycle,
		dtmfExplanation: copy.generatorDtmfExplanation,
	};
}

function generatorWaveformOptions(copy) {
	return [['sine', copy.generatorSine], ['square', copy.generatorSquare], ['sawtooth', copy.generatorSawtooth]];
}

function generatorDefaults(type) {
	const common = { durationSeconds: 30 };
	if (type === 'tone') return { ...common, amplitude: 0.8, frequency: 440, waveform: 'sine' };
	if (type === 'chirp') return { ...common, startAmplitude: 0.8, endAmplitude: 0.8, startFrequency: 440, endFrequency: 1320, interpolation: 'logarithmic', waveform: 'sine' };
	if (type === 'noise') return { ...common, amplitude: 0.8, color: 'white' };
	if (type === 'dtmf') {
		const durations = generatorDtmfDurations(30, 2 / 3 * 100, 3);
		return { ...common, amplitude: 0.8, sequence: '123', toneSeconds: durations.toneSeconds, silenceSeconds: durations.silenceSeconds };
	}
	return { durationSeconds: 30 };
}

function generatorLabel(type, copy) {
	return { silence: copy.silenceGenerator, tone: copy.toneGenerator, chirp: copy.chirpGenerator, noise: copy.noiseGenerator, dtmf: copy.dtmfGenerator }[type] || copy.generateMenu;
}
