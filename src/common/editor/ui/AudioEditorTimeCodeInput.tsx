/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import {
	TimeCode,
	type TimeCodeFormat,
} from '@soundscaper/design-system/TimeCode';

export type AudioEditorTimeUnit = 'seconds' | 'milliseconds' | 'samples' | 'frames';

interface AudioEditorTimeCodeInputProps {
	readonly label: string;
	readonly value: number;
	readonly onChange?: (value: number) => void;
	readonly onCommit?: (value: number) => unknown;
	readonly unit?: AudioEditorTimeUnit;
	readonly rate?: number;
	readonly format?: TimeCodeFormat;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly disabled?: boolean;
	readonly name?: string;
	readonly required?: boolean;
	readonly className?: string;
	readonly showFormatSelector?: boolean;
	readonly onFormatChange?: (format: TimeCodeFormat) => void;
	readonly valueText?: string;
	readonly describedBy?: string;
}

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_FRAME_RATE = 24;

export default function AudioEditorTimeCodeInput({
	label,
	value,
	onChange,
	onCommit,
	unit = 'seconds',
	rate = unit === 'frames' ? DEFAULT_FRAME_RATE : DEFAULT_SAMPLE_RATE,
	format = unit === 'samples' ? 'samples'
		: unit === 'frames' ? 'hh:mm:ss+frames' : 'hh:mm:ss+milliseconds',
	minimum = 0,
	maximum = Number.POSITIVE_INFINITY,
	disabled = false,
	name,
	required = false,
	className = '',
	showFormatSelector = false,
	onFormatChange,
	valueText,
	describedBy,
}: AudioEditorTimeCodeInputProps) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const normalizedRate = editorTimeRate(unit, rate);
	const normalizedValue = clampAudioEditorTimeValue(draft, minimum, maximum);
	const signed = minimum < 0;
	return <span
		className={`audio-editor-timecode-input${className ? ` ${className}` : ''}`}
		data-timecode-input={unit}
		onBlur={(event) => {
			if (event.currentTarget.contains(event.relatedTarget)) return;
			if (!onCommit || normalizedValue === value) return;
			try {
				const outcome = onCommit(normalizedValue);
				if (outcome && typeof (outcome as PromiseLike<unknown>).then === 'function') {
					void Promise.resolve(outcome).then((accepted) => {
						if (accepted === false) setDraft(value);
					}, () => setDraft(value));
				} else if (outcome === false) setDraft(value);
			} catch {
				setDraft(value);
			}
		}}
	>
		{signed ? <button type="button" className="audio-editor-timecode-input__sign"
			aria-label={`${label}: sign`} disabled={disabled || normalizedValue === 0}
			onClick={() => {
				const nextValue = clampAudioEditorTimeValue(-normalizedValue, minimum, maximum);
				setDraft(nextValue);
				onChange?.(nextValue);
			}}> {normalizedValue < 0 ? '−' : '+'} </button> : null}
		<TimeCode
			ariaLabel={label}
			formatAriaLabel={`${label}: format`}
			ariaValueText={valueText}
			ariaDescribedBy={describedBy}
			value={timeCodeSecondsFromEditorValue(Math.abs(normalizedValue), unit, normalizedRate)}
			format={format}
			formatDomain="time"
			sampleRate={unit === 'samples' ? normalizedRate : DEFAULT_SAMPLE_RATE}
			frameRate={unit === 'frames' ? normalizedRate : DEFAULT_FRAME_RATE}
			showFormatSelector={showFormatSelector}
			disabled={disabled}
			variant="dark"
			onFormatChange={onFormatChange}
			onChange={(seconds) => {
				const magnitude = timeCodeSecondsToEditorValue(seconds, unit, normalizedRate);
				const nextValue = clampAudioEditorTimeValue(
					normalizedValue < 0 ? -magnitude : magnitude, minimum, maximum,
				);
				setDraft(nextValue);
				onChange?.(nextValue);
			}}
		/>
		{name ? <input type="hidden" name={name} value={normalizedValue} disabled={disabled}
			required={required} onChange={(event) => {
				const nextValue = Number(event.currentTarget.value);
				if (!Number.isFinite(nextValue)) return;
				const bounded = clampAudioEditorTimeValue(nextValue, minimum, maximum);
				setDraft(bounded);
				onChange?.(bounded);
			}} /> : null}
	</span>;
}

export function timeCodeSecondsFromEditorValue(
	value: number,
	unit: AudioEditorTimeUnit,
	rate: number,
): number {
	finiteTimeValue(value);
	if (unit === 'seconds') return value;
	if (unit === 'milliseconds') return value / 1_000;
	return value / editorTimeRate(unit, rate);
}

export function timeCodeSecondsToEditorValue(
	seconds: number,
	unit: AudioEditorTimeUnit,
	rate: number,
): number {
	finiteTimeValue(seconds);
	if (unit === 'seconds') return seconds;
	if (unit === 'milliseconds') return seconds * 1_000;
	return Math.round(seconds * editorTimeRate(unit, rate));
}

export function clampAudioEditorTimeValue(value: number, minimum: number, maximum: number): number {
	finiteTimeValue(value);
	if (minimum > maximum) throw new RangeError('A timecode input minimum cannot exceed its maximum.');
	return Math.max(minimum, Math.min(maximum, value));
}

export function audioEditorProjectSampleRate(value: unknown): number {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_SAMPLE_RATE;
	const sampleRate = (value as Readonly<Record<string, unknown>>).sampleRate;
	return Number.isSafeInteger(sampleRate) && Number(sampleRate) > 0 ? Number(sampleRate) : DEFAULT_SAMPLE_RATE;
}

export function audioEditorProjectFrameRate(value: unknown): number {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_FRAME_RATE;
	const project = value as Readonly<Record<string, unknown>>;
	const sequences = Array.isArray(project.sequences) ? project.sequences : [];
	const selected = sequences.find((sequence) => isRecord(sequence)
		&& sequence.id === project.primarySequenceId) ?? sequences[0];
	if (!isRecord(selected) || !isRecord(selected.rate)) return DEFAULT_FRAME_RATE;
	const num = Number(selected.rate.num);
	const den = Number(selected.rate.den);
	return Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0
		? num / den : DEFAULT_FRAME_RATE;
}

function editorTimeRate(unit: AudioEditorTimeUnit, rate: number): number {
	if (unit === 'seconds' || unit === 'milliseconds') return 1;
	if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('A timecode input requires a positive finite rate.');
	return rate;
}

function finiteTimeValue(value: number): void {
	if (!Number.isFinite(value)) throw new RangeError('A timecode input value must be finite.');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
