/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef } from 'react';

import '../audio-editor-design-system/18-musical-timeline.css';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import { approximatePositiveRational } from '../../rational-approximation.ts';
import { addRationals } from '../../timeline-time.ts';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { AudacityToolbarFlyoutButton } from './AudioEditorMeterControls.jsx';

export function MusicalTimelineControls({ project, snapshot, controller, copy, run }) {
	const tempoMap = project?.tempoMap;
	const signatureMap = project?.signatureMap;
	const tempoEvents = tempoMap?.events || [];
	const signatureEvents = signatureMap?.events || [];
	const rootTempo = tempoEvents[0]?.bpm;
	const rootSignature = signatureEvents[0];
	const disabled = snapshot.readOnly || snapshot.recording;
	return <>
		<label className="kw-audio-editor__tempo-control" data-action-id="playback-bpm">
			<span>{copy.projectTempo}</span>
			<AuthoritativeNumberField
				min="1"
				max="1000"
				step="any"
				value={rationalNumber(rootTempo, project?.tempo?.bpm || 120)}
				disabled={disabled}
				accepts={(bpm) => bpm >= 1 && bpm <= 1_000 && Boolean(tempoEvents[0]?.id)}
				onCommit={(bpm) => run(() => controller.actions.project.updateTempoEvent(
					tempoEvents[0].id,
					{ bpm: approximatePositiveRational(bpm) },
				))}
			/>
		</label>
		<label className="kw-audio-editor__signature-control" data-action-id="playback-time-signature">
			<span>{copy.timeSignature}</span>
			<span className="kw-audio-editor__signature-fields">
				<AuthoritativeNumberField
					min="1"
					max="1000"
					ariaLabel={`${copy.timeSignature}: ${copy.numerator}`}
					value={rootSignature?.numerator || project?.tempo?.timeSignature?.numerator || 4}
					disabled={disabled}
					accepts={(numerator) => Number.isSafeInteger(numerator) && Boolean(rootSignature?.id)}
					onCommit={(numerator) => run(() => controller.actions.project.updateSignatureEvent(
						rootSignature.id,
						{ numerator },
					))}
				/>
				<span aria-hidden="true">/</span>
				<AuthoritativeNumberField
					min="1"
					max="4503599627370496"
					ariaLabel={`${copy.timeSignature}: ${copy.denominator}`}
					value={rootSignature?.denominator || project?.tempo?.timeSignature?.denominator || 4}
					disabled={disabled}
					accepts={(denominator) => Number.isSafeInteger(denominator) && Boolean(rootSignature?.id)}
					onCommit={(denominator) => run(() => controller.actions.project.updateSignatureEvent(
						rootSignature.id,
						{ denominator },
					))}
				/>
			</span>
		</label>
		<AudacityToolbarFlyoutButton
			icon={iconNameToChar('TEMPO_CHANGE')}
			ariaLabel={copy.musicalTimeline}
			flyoutClassName="kw-audio-editor__musical-map-flyout"
			overlayPortal
		>
			<div className="kw-audio-editor__musical-map-editor" data-musical-map-editor>
				<header>
					<strong>{copy.musicalTimeline}</strong>
					<label>
						<span>{copy.tempoMapMode}</span>
						<select
							value={tempoMap?.mode || 'musical'}
							disabled={disabled}
							onChange={(event) => run(() => controller.actions.project.setTempoMapMode(event.currentTarget.value))}
						>
							<option value="musical">{copy.tempoMusicalAnchor}</option>
							<option value="sampleLocked">{copy.sampleLockedAnchor}</option>
						</select>
					</label>
				</header>
				<section aria-labelledby="audio-editor-tempo-events-heading">
					<div className="kw-audio-editor__musical-map-heading">
						<h3 id="audio-editor-tempo-events-heading">{copy.tempoEvents}</h3>
						<button
							type="button"
							disabled={disabled || !tempoEvents.length}
							onClick={() => run(() => controller.actions.project.addTempoEvent(nextTempoEvent(project)))}
						>{copy.addTempoEvent}</button>
					</div>
					<div className="kw-audio-editor__musical-map-list">
						{tempoEvents.map((event, index) => <TempoEventForm
							key={event.id}
							event={event}
							index={index}
							mode={tempoMap.mode}
							sampleRate={project.sampleRate}
							disabled={disabled}
							controller={controller}
							copy={copy}
							run={run}
						/>)}
					</div>
				</section>
				<section aria-labelledby="audio-editor-signature-events-heading">
					<div className="kw-audio-editor__musical-map-heading">
						<h3 id="audio-editor-signature-events-heading">{copy.signatureEvents}</h3>
						<button
							type="button"
							disabled={disabled || !signatureEvents.length}
							onClick={() => run(() => controller.actions.project.addSignatureEvent(nextSignatureEvent(project)))}
						>{copy.addSignatureEvent}</button>
					</div>
					<div className="kw-audio-editor__musical-map-list">
						{signatureEvents.map((event, index) => <SignatureEventForm
							key={event.id}
							event={event}
							index={index}
							disabled={disabled}
							controller={controller}
							copy={copy}
							run={run}
						/>)}
					</div>
				</section>
			</div>
		</AudacityToolbarFlyoutButton>
	</>;
}

/**
 * A toolbar field is retyped keystroke by keystroke, so committing every change
 * event refused the empty string a Backspace leaves behind — React restored the
 * old digit, and "Backspace, 3" over 4 read 43 — besides turning every
 * intermediate digit into its own undo entry. The field therefore holds its own
 * draft and re-adopts the project's value only while it is idle; a usable draft
 * commits on blur or Enter, and Escape or an unusable one restores the project.
 */
function AuthoritativeNumberField({ value, accepts, onCommit, ariaLabel, min, max, step, disabled }) {
	const inputRef = useRef(null);
	useLayoutEffect(() => {
		const input = inputRef.current;
		if (input && input.ownerDocument?.activeElement !== input) input.value = String(value);
	}, [value]);
	const commitDraft = (input) => {
		const draft = Number(input.value);
		if (input.value.trim() === '' || !Number.isFinite(draft) || draft === value || !accepts(draft)) {
			input.value = String(value);
			return;
		}
		onCommit(draft);
	};
	return <input
		ref={inputRef}
		type="number"
		min={min}
		max={max}
		step={step}
		aria-label={ariaLabel}
		defaultValue={value}
		disabled={disabled}
		onBlur={(event) => commitDraft(event.currentTarget)}
		onKeyDown={(event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commitDraft(event.currentTarget);
			} else if (event.key === 'Escape') {
				event.currentTarget.value = String(value);
			}
		}}
	/>;
}

function TempoEventForm({ event, index, mode, sampleRate, disabled, controller, copy, run }) {
	const formRef = useAuthoritativeFormRevision(`${mode}:${JSON.stringify(event)}`);
	return <form
		ref={formRef}
		className="kw-audio-editor__musical-map-event"
		data-musical-event-id={event.id}
		aria-label={`${copy.tempoEvent} ${String(index + 1)}`}
		onSubmit={(submitEvent) => {
			submitEvent.preventDefault();
			const fields = new FormData(submitEvent.currentTarget);
			const changes = {
				bpm: exactRationalFields(fields, 'bpm'),
				...(index === 0 ? {} : mode === 'sampleLocked'
					? { samplePosition: integerField(fields, 'samplePosition') }
					: { beat: exactRationalFields(fields, 'beat') }),
			};
			run(() => controller.actions.project.updateTempoEvent(event.id, changes));
		}}
	>
		<span className="kw-audio-editor__musical-map-event-id">{event.id}</span>
		{mode === 'sampleLocked' ? <TimePositionField
			label={copy.samplePosition}
			name="samplePosition"
			value={event.samplePosition}
			sampleRate={sampleRate}
			disabled={disabled || index === 0}
			minimum={0}
		/> : <RationalFields
			label={copy.beatPosition}
			name="beat"
			value={event.beat}
			disabled={disabled || index === 0}
			numeratorLabel={copy.numerator}
			denominatorLabel={copy.denominator}
		/>}
		<RationalFields
			label={copy.tempoBpm}
			name="bpm"
			value={event.bpm}
			disabled={disabled}
			positive
			numeratorLabel={copy.numerator}
			denominatorLabel={copy.denominator}
		/>
		<div className="kw-audio-editor__musical-map-event-actions">
			<button type="submit" disabled={disabled}>{copy.save}</button>
			<button
				type="button"
				disabled={disabled || index === 0}
				onClick={(clickEvent) => removeEventWithFocus(
					clickEvent.currentTarget,
					() => run(() => controller.actions.project.removeTempoEvent(event.id)),
				)}
			>{copy.removeTempoEvent}</button>
		</div>
	</form>;
}

function SignatureEventForm({ event, index, disabled, controller, copy, run }) {
	const formRef = useAuthoritativeFormRevision(JSON.stringify(event));
	return <form
		ref={formRef}
		className="kw-audio-editor__musical-map-event"
		data-musical-event-id={event.id}
		aria-label={`${copy.signatureEvent} ${String(index + 1)}`}
		onSubmit={(submitEvent) => {
			submitEvent.preventDefault();
			const fields = new FormData(submitEvent.currentTarget);
			run(() => controller.actions.project.updateSignatureEvent(event.id, {
				...(index === 0 ? {} : { bar: integerField(fields, 'bar') }),
				numerator: integerField(fields, 'numerator'),
				denominator: integerField(fields, 'denominator'),
			}));
		}}
	>
		<span className="kw-audio-editor__musical-map-event-id">{event.id}</span>
		<NumberField label={copy.barPosition} name="bar" value={event.bar} disabled={disabled || index === 0} minimum={0} />
		<NumberField label={copy.numerator} name="numerator" value={event.numerator} disabled={disabled} minimum={1} />
		<NumberField label={copy.denominator} name="denominator" value={event.denominator} disabled={disabled} minimum={1} />
		<div className="kw-audio-editor__musical-map-event-actions">
			<button type="submit" disabled={disabled}>{copy.save}</button>
			<button
				type="button"
				disabled={disabled || index === 0}
				onClick={(clickEvent) => removeEventWithFocus(
					clickEvent.currentTarget,
					() => run(() => controller.actions.project.removeSignatureEvent(event.id)),
				)}
			>{copy.removeSignatureEvent}</button>
		</div>
	</form>;
}

function RationalFields({ label, name, value, disabled, positive = false, numeratorLabel, denominatorLabel }) {
	return <fieldset className="kw-audio-editor__musical-map-rational" disabled={disabled}>
		<legend>{label}</legend>
		<NumberField label={`${label} ${numeratorLabel}`} name={`${name}Num`} value={value?.num ?? 0} minimum={positive ? 1 : 0} />
		<span aria-hidden="true">/</span>
		<NumberField label={`${label} ${denominatorLabel}`} name={`${name}Den`} value={value?.den ?? 1} minimum={1} />
	</fieldset>;
}

function NumberField({ label, name, value, disabled = false, minimum }) {
	return <label>
		<span>{label}</span>
		<input type="number" name={name} defaultValue={value ?? minimum ?? 0} min={minimum} step="1" disabled={disabled} />
	</label>;
}

function TimePositionField({ label, name, value, sampleRate, disabled = false, minimum }) {
	return <label><span>{label}</span><AudioEditorTimeCodeInput label={label} name={name}
		value={value ?? minimum ?? 0} unit="samples" rate={sampleRate || 48_000}
		format="hh:mm:ss+milliseconds" minimum={minimum} disabled={disabled} /></label>;
}

function exactRationalFields(fields, prefix) {
	return { num: integerField(fields, `${prefix}Num`), den: integerField(fields, `${prefix}Den`) };
}

function integerField(fields, name) {
	const value = Number(fields.get(name));
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return value;
}

function nextTempoEvent(project) {
	const map = project.tempoMap;
	const last = map.events.at(-1);
	if (map.mode === 'sampleLocked') {
		return {
			samplePosition: safeAdd(last.samplePosition, project.sampleRate, 'tempo event sample position'),
			bpm: structuredClone(last.bpm),
		};
	}
	return { beat: addRationals(last.beat, 4), bpm: structuredClone(last.bpm) };
}

function nextSignatureEvent(project) {
	const last = project.signatureMap.events.at(-1);
	return {
		bar: safeAdd(last.bar, 1, 'signature event bar'),
		numerator: last.numerator,
		denominator: last.denominator,
	};
}

function rationalNumber(value, fallback) {
	const numerator = Number(value?.num);
	const denominator = Number(value?.den);
	return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
		? numerator / denominator
		: fallback;
}

function safeAdd(left, right, name) {
	const result = Number(left) + Number(right);
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function useAuthoritativeFormRevision(revision) {
	const formRef = useRef(null);
	useLayoutEffect(() => formRef.current?.reset(), [revision]);
	return formRef;
}

function removeEventWithFocus(button, remove) {
	const section = button.closest('section');
	const row = button.closest('[data-musical-event-id]');
	const rows = section ? [...section.querySelectorAll('[data-musical-event-id]')] : [];
	const index = rows.indexOf(row);
	const neighborId = rows[index + 1]?.dataset.musicalEventId || rows[index - 1]?.dataset.musicalEventId;
	remove();
	requestAnimationFrame(() => {
		const escapedId = globalThis.CSS?.escape ? globalThis.CSS.escape(neighborId || '') : neighborId;
		const nextRow = escapedId ? section?.querySelector(`[data-musical-event-id="${escapedId}"]`) : null;
		const focusTarget = nextRow?.querySelector('input, button')
			|| section?.querySelector('.kw-audio-editor__musical-map-heading button');
		focusTarget?.focus();
	});
}
