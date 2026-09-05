import { useEffect, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { Separator } from '@soundscaper/design-system/Separator';
import { TextInput } from '@soundscaper/design-system/TextInput';

import { summarizeMorseCode } from '../../morse-code.ts';
import {
	GeneratorKnob,
	GeneratorNumberField,
	GeneratorRadioGroup,
	GeneratorSelect,
} from './GeneratorDialogFields.jsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import EditorHelpTooltip from '../EditorHelpTooltip.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';

// Real hand-sent Morse runs from a beginner's five words per minute to about
// sixty; the generator itself accepts more for scripted use.
const MORSE_SPEED_RANGE = Object.freeze({ minimum: 5, maximum: 60 });

export default function GeneratorDialog({ type, controller, copy, locale, run, onClose }) {
	const [params, setParams] = useState(() => generatorDefaults(type));
	useEffect(() => setParams(generatorDefaults(type)), [type]);
	const update = (name, value) => setParams((current) => ({ ...current, [name]: value }));
	const labels = generatorLayoutLabels(copy);
	const waveformOptions = generatorWaveformOptions(copy);
	const dtmfTiming = generatorDtmfTiming(params);
	// A half-typed message must not break the preview, so the summary reports
	// what cannot be sent instead of throwing the way the encoder does.
	const morse = type === 'morse' ? summarizeMorseCode(params.text, params.wordsPerMinute) : null;
	const unsendable = Boolean(morse && (morse.empty || morse.unsupported.length));
	// The generate button sits in the shared footer, outside the form, so both
	// it and an Enter press inside a field run this one handler.
	const generate = () => {
		if (unsendable) return;
		const options = type === 'dtmf'
			? { ...params, durationSeconds: dtmfTiming.totalSeconds, toneSeconds: dtmfTiming.toneSeconds, silenceSeconds: dtmfTiming.silenceSeconds }
			: params;
		void runAwaitedAudioEditorOperation(
			run,
			() => controller.actions.generators.generate(type, options),
		).then(onClose).catch(() => undefined);
	};
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
			footer={<DialogFooter
				className="audio-editor-dialog-footer"
				rightContent={<>
					<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
					<Button variant="primary" disabled={unsendable} onClick={generate}>{copy.generate}</Button>
				</>}
			/>}
		>
				<form className="kw-audio-editor-generator" onSubmit={(event) => {
					event.preventDefault();
					generate();
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

						{type === 'morse' && (
							<div className="kw-audio-editor-generator__stack" data-generator-layout="morse">
								<div className="audio-editor-helped-field">
									<label className="kw-audio-editor-dialog__field" data-generator-field="text">
										<span>{copy.generatorMorseMessage}</span>
										<TextInput value={params.text} onChange={(value) => update('text', value)} />
									</label>
									<EditorHelpTooltip
										subject={copy.generatorMorseMessage}
										description={labels.morseExplanation}
										helpLabel={copy.helpMenu}
										hook="generator-morse-message"
									/>
								</div>
								<div role="group" aria-label={labels.morseKeying}>
									<PreferencePanel title={labels.morseKeying} className="kw-audio-editor-generator__card">
										<div className="kw-audio-editor-generator__ratio-control">
											<GeneratorKnob
												value={params.wordsPerMinute}
												label={copy.generatorMorseSpeed}
												minimum={MORSE_SPEED_RANGE.minimum}
												maximum={MORSE_SPEED_RANGE.maximum}
												onChange={(value) => update('wordsPerMinute', value)}
											/>
											<GeneratorNumberField
												name="wordsPerMinute"
												label={copy.generatorMorseSpeed}
												value={params.wordsPerMinute}
												min={MORSE_SPEED_RANGE.minimum}
												max={MORSE_SPEED_RANGE.maximum}
												step={1}
												onChange={(value) => update('wordsPerMinute', value)}
											/>
										</div>
										<Separator />
										<dl className="kw-audio-editor-generator__timing-summary">
											<div>
												<dt>{labels.morseEncoding}</dt>
												<dd className="kw-audio-editor-generator__morse-code">{morse.code || '\u2014'}</dd>
											</div>
											<div><dt>{labels.morseDotDuration}</dt><dd>{formatGeneratorSeconds(morse.dotSeconds, locale)}</dd></div>
											{morse.unsupported.length > 0 && (
												<div><dt>{labels.morseUnsupported}</dt><dd>{morse.unsupported.join(' ')}</dd></div>
											)}
										</dl>
									</PreferencePanel>
								</div>
								<div className="kw-audio-editor-generator__pair">
									{numberField('frequency', copy.generatorFrequency, { min: 0.01, max: 96_000, step: 1 })}
									{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
								</div>
								<label className="kw-audio-editor-dialog__field" data-generator-field="durationSeconds">
									<span>{copy.generatorDuration}</span>
									<AudioEditorTimeCodeInput
										label={copy.generatorDuration}
										value={morse.durationSeconds}
										disabled
									/>
								</label>
							</div>
						)}

						{type === 'dtmf' && (
							<div className="kw-audio-editor-generator__dtmf" data-generator-layout="dtmf">
								<div role="group" aria-label={generatorLabel(type, copy)}>
									<PreferencePanel className="kw-audio-editor-generator__card kw-audio-editor-generator__dtmf-fields">
										<div className="audio-editor-helped-field">
											<label className="kw-audio-editor-dialog__field" data-generator-field="sequence">
												<span>{copy.generatorSequence}</span>
												<TextInput value={params.sequence} onChange={updateDtmfSequence} />
											</label>
											<EditorHelpTooltip
												subject={copy.generatorSequence}
												description={labels.dtmfExplanation}
												helpLabel={copy.helpMenu}
												hook="generator-sequence"
											/>
										</div>
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
											<div><dt>{copy.generatorToneDuration}</dt><dd>{formatGeneratorSeconds(dtmfTiming.toneSeconds, locale)}</dd></div>
											<div><dt>{copy.generatorSilenceDuration}</dt><dd>{formatGeneratorSeconds(dtmfTiming.silenceSeconds, locale)}</dd></div>
										</dl>
									</PreferencePanel>
								</div>
							</div>
						)}
					</div>
				</form>
		</AudioEditorDialogShell>
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

export function generatorDtmfDurations(totalSeconds, dutyPercent, symbolCount) {
	const total = Number(totalSeconds);
	const duty = Math.max(1, Math.min(100, Number(dutyPercent))) / 100;
	const gaps = Math.max(0, symbolCount - 1);
	const denominator = symbolCount + gaps * (1 - duty) / duty;
	const toneSeconds = total / denominator;
	// A single symbol has no gap to fill, so the whole total is tone and the
	// duty cycle has nothing to divide; deriving a gap anyway reports a length
	// that is never rendered and grows without bound as the duty cycle falls.
	const silenceSeconds = duty === 1 || gaps === 0 ? 0 : toneSeconds * (1 - duty) / duty;
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

// The unit belongs to the locale, not to the markup: a hand-written " s" reads
// as English in every language the catalog is translated into.
function formatGeneratorSeconds(value, locale) {
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: 3,
		style: 'unit',
		unit: 'second',
		unitDisplay: 'short',
	}).format(value);
}

function generatorLayoutLabels(copy) {
	return {
		frequencySweep: copy.generatorFrequencySweep,
		amplitudeSweep: copy.generatorAmplitudeSweep,
		toneSilenceRatio: copy.generatorToneSilenceRatio,
		dutyCycle: copy.generatorDutyCycle,
		dtmfExplanation: copy.generatorDtmfExplanation,
		morseKeying: copy.generatorMorseKeying,
		morseEncoding: copy.generatorMorseEncoding,
		morseDotDuration: copy.generatorMorseDotDuration,
		morseUnsupported: copy.generatorMorseUnsupported,
		morseExplanation: copy.generatorMorseExplanation,
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
	// Morse takes its length from the message and the sending speed, so the
	// shared duration default would only describe a clip it never produces.
	if (type === 'morse') return { amplitude: 0.8, frequency: 700, text: 'SOS', wordsPerMinute: 20 };
	return { durationSeconds: 30 };
}

function generatorLabel(type, copy) {
	return {
		silence: copy.silenceGenerator,
		tone: copy.toneGenerator,
		chirp: copy.chirpGenerator,
		noise: copy.noiseGenerator,
		dtmf: copy.dtmfGenerator,
		morse: copy.morseGenerator,
	}[type] || copy.generateMenu;
}
