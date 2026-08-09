/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useId } from 'react';

import type { SoundActivationPolicySnapshot } from '../controller/sound-activation-policy-service.ts';
import {
	SOUND_ACTIVATION_UI_RANGES,
	createSoundActivationUiModel,
	type SoundActivationUiCopy,
} from './sound-activation-ui-model.ts';

interface SoundActivationActions {
	setEnabled(value: boolean): unknown;
	setThresholdDb(value: number): unknown;
	setHysteresisDb(value: number): unknown;
	setHoldMilliseconds(value: number): unknown;
}

interface SoundActivationPreferencesCopy extends SoundActivationUiCopy {
	readonly soundActivatedRecording: string;
	readonly soundActivationDescription: string;
	readonly soundActivationSettings: string;
	readonly soundActivationThreshold: string;
	readonly soundActivationThresholdDescription: string;
	readonly soundActivationHysteresis: string;
	readonly soundActivationHysteresisDescription: string;
	readonly soundActivationHold: string;
	readonly soundActivationHoldDescription: string;
}

interface SoundActivationPreferencesProps {
	readonly productId: string;
	readonly locale: string;
	readonly readOnly: boolean;
	readonly soundActivation: SoundActivationPolicySnapshot;
	readonly copy: SoundActivationPreferencesCopy;
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly recording: Readonly<{ readonly soundActivation: SoundActivationActions }>;
		}>;
	}>;
	run(operation: () => unknown): unknown;
}

/** Soundscaper-only preferences over the controller-owned sound activation policy. */
export default function SoundActivationPreferences({
	productId,
	locale,
	readOnly,
	soundActivation,
	copy,
	controller,
	run,
}: SoundActivationPreferencesProps) {
	const titleId = useId();
	const descriptionId = useId();
	const statusId = useId();
	if (productId !== 'soundscaper') return null;
	const model = createSoundActivationUiModel(soundActivation, readOnly, locale, copy);
	const actions = controller.actions.recording.soundActivation;
	const describedBy = `${descriptionId} ${statusId}`;
	const update = (operation: () => unknown) => {
		if (!model.controlsDisabled) void run(operation);
	};
	return (
		<section
			className="kw-audio-editor-sound-activation"
			data-sound-activation-preferences
			data-sound-activation-enabled={model.preferences.enabled}
			data-sound-activation-threshold-db={model.preferences.thresholdDb}
			data-sound-activation-hysteresis-db={model.preferences.hysteresisDb}
			data-sound-activation-hold-milliseconds={model.preferences.holdMilliseconds}
			data-sound-activation-pending={model.preferenceUpdatePending}
			data-sound-activation-block-reason={model.blockReason || undefined}
			aria-labelledby={titleId}
		>
			<h3 id={titleId}>{copy.soundActivationSettings}</h3>
			<p id={descriptionId}>{copy.soundActivationDescription}</p>
			<label className="kw-audio-editor-sound-activation__switch">
				<input
					type="checkbox"
					role="switch"
					checked={model.preferences.enabled}
					disabled={model.controlsDisabled}
					aria-label={copy.soundActivatedRecording}
					aria-describedby={describedBy}
					onChange={(event) => update(() => actions.setEnabled(event.currentTarget.checked))}
				/>
				<span>{copy.soundActivatedRecording}</span>
			</label>
			<fieldset
				className="kw-audio-editor-sound-activation__controls"
				aria-label={copy.soundActivationSettings}
				aria-disabled={model.controlsDisabled}
			>
				<SoundActivationRange
					name="sound-activation-threshold"
					label={copy.soundActivationThreshold}
					description={copy.soundActivationThresholdDescription}
					value={model.preferences.thresholdDb}
					valueText={model.thresholdValueText}
					range={SOUND_ACTIVATION_UI_RANGES.thresholdDb}
					disabled={model.controlsDisabled}
					statusId={statusId}
					dataAttribute="threshold"
					onChange={(value) => update(() => actions.setThresholdDb(value))}
				/>
				<SoundActivationRange
					name="sound-activation-hysteresis"
					label={copy.soundActivationHysteresis}
					description={copy.soundActivationHysteresisDescription}
					value={model.preferences.hysteresisDb}
					valueText={model.hysteresisValueText}
					range={SOUND_ACTIVATION_UI_RANGES.hysteresisDb}
					disabled={model.controlsDisabled}
					statusId={statusId}
					dataAttribute="hysteresis"
					onChange={(value) => update(() => actions.setHysteresisDb(value))}
				/>
				<SoundActivationRange
					name="sound-activation-hold"
					label={copy.soundActivationHold}
					description={copy.soundActivationHoldDescription}
					value={model.preferences.holdMilliseconds}
					valueText={model.holdValueText}
					range={SOUND_ACTIVATION_UI_RANGES.holdMilliseconds}
					disabled={model.controlsDisabled}
					statusId={statusId}
					dataAttribute="hold"
					onChange={(value) => update(() => actions.setHoldMilliseconds(value))}
				/>
			</fieldset>
			<p
				id={statusId}
				className="kw-audio-editor-sound-activation__status"
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>{model.statusMessage}</p>
		</section>
	);
}

interface SoundActivationRangeProps {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly value: number;
	readonly valueText: string;
	readonly range: Readonly<{ minimum: number; maximum: number; step: number }>;
	readonly disabled: boolean;
	readonly statusId: string;
	readonly dataAttribute: 'threshold' | 'hysteresis' | 'hold';
	onChange(value: number): void;
}

function SoundActivationRange({
	name,
	label,
	description,
	value,
	valueText,
	range,
	disabled,
	statusId,
	dataAttribute,
	onChange,
}: SoundActivationRangeProps) {
	const descriptionId = useId();
	const data = { [`data-sound-activation-${dataAttribute}`]: true };
	return <label className="kw-audio-editor-sound-activation__control">
		<span><strong>{label}</strong><output htmlFor={name}>{valueText}</output></span>
		<input
			type="range"
			{...data}
			id={name}
			name={name}
			aria-label={label}
			aria-describedby={`${descriptionId} ${statusId}`}
			aria-valuetext={valueText}
			min={range.minimum}
			max={range.maximum}
			step={range.step}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
		/>
		<small id={descriptionId}>{description}</small>
	</label>;
}
