/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useState } from 'react';

import {
	assertConvertedPositionsOrderedV21,
	convertAutomationLaneControlPositionV21,
	convertAutomationLanePositionV21,
} from '../../automation-lane-timebase-v21.ts';

import {
	SOUNDSCAPER_AUTOMATION_MODES,
	type SoundscaperAutomationMode,
} from '../soundscaper-production-application-menu.ts';
import type { SoundscaperProductionCopy } from '../soundscaper-production-copy.ts';
import type { createSoundscaperProductionDialogModel } from '../soundscaper-production-dialog-model.ts';

export interface SoundscaperAutomationEditorProps {
	readonly copy: SoundscaperProductionCopy;
	readonly model: ReturnType<typeof createSoundscaperProductionDialogModel>;
	readonly disabled: boolean;
	readonly mode: SoundscaperAutomationMode;
	readonly laneDraft: string;
	readonly automationValue: number;
	readonly gestureActive: boolean;
	readonly onLane: (value: string | null) => void;
	readonly onLaneDraft: (value: string) => void;
	readonly onAutomationValue: (value: number) => void;
	readonly onMode: (value: SoundscaperAutomationMode) => void;
	readonly onApply: () => void;
	readonly onReset: () => void;
	readonly onGestureBegin: () => void;
	readonly onGesturePreview: () => void;
	readonly onGestureRelease: () => void;
	readonly onGestureCancel: () => void;
}

export default function SoundscaperAutomationEditor({
	copy, model, disabled, mode, laneDraft, automationValue, gestureActive,
	onLane, onLaneDraft, onAutomationValue, onMode, onApply, onReset,
	onGestureBegin, onGesturePreview, onGestureRelease, onGestureCancel,
}: Readonly<SoundscaperAutomationEditorProps>) {
	const [structuredStatus, setStructuredStatus] = useState('');
	const draft = laneDocument(laneDraft);
	const parameter = model.selectedLaneParameter;
	useEffect(() => { setStructuredStatus(''); }, [model.selectedLaneId]);
	const updateDraft = (mutation: (lane: LaneDocument) => void): void => {
		if (!draft) {
			setStructuredStatus(copy.automationStructuredInvalid);
			return;
		}
		try {
			const next = structuredClone(draft);
			mutation(next);
			onLaneDraft(JSON.stringify(next, null, '\t'));
			setStructuredStatus(copy.automationStructuredUpdated);
		} catch (error) {
			setStructuredStatus(error instanceof Error ? error.message : String(error));
		}
	};
	const valueInRange = Number.isFinite(automationValue) && parameter !== null
		&& automationValue >= parameter.minimum && automationValue <= parameter.maximum;
	return <fieldset disabled={disabled}>
		<legend>{copy.laneEditor}</legend>
		<p>{copy.selectedTrack}: {model.automationTarget ?? model.selectedTrack?.name ?? '—'}</p>
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.selectedLane}</span>
			<select disabled={gestureActive} value={model.selectedLaneId ?? ''} onChange={(event) => {
				onLane(event.currentTarget.value || null);
			}}>
				{model.lanes.length === 0 && <option value="">{copy.noLanes}</option>}
				{model.lanes.map((lane) => <option key={lane.id} value={lane.id}>
					{lane.address || lane.id} · {lane.timebase} · {String(lane.pointCount)}
				</option>)}
			</select>
		</label>
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.automationMode}</span>
			<select disabled={gestureActive} value={mode} onChange={(event) => onMode(event.currentTarget.value as SoundscaperAutomationMode)}>
				{SOUNDSCAPER_AUTOMATION_MODES.map((candidate) => <option key={candidate} value={candidate}>
					{automationModeLabel(copy, candidate)}
				</option>)}
			</select>
		</label>
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.liveAutomationValue}</span>
			<input type="number" min={parameter?.minimum} max={parameter?.maximum}
				step={parameter?.step ?? 'any'} value={automationValue}
				onChange={(event) => onAutomationValue(Number(event.currentTarget.value))} />
		</label>
		<div className="kw-audio-editor-dialog__actions" data-automation-gesture-active={String(gestureActive)}>
			<button type="button" disabled={gestureActive || mode === 'read' || !model.selectedLaneId
				|| !valueInRange} onClick={onGestureBegin}>{copy.beginAutomationGesture}</button>
			<button type="button" disabled={!gestureActive || !valueInRange}
				onClick={onGesturePreview}>{copy.previewAutomationGesture}</button>
			<button type="button" disabled={!gestureActive || !valueInRange}
				onClick={onGestureRelease}>{copy.releaseAutomationGesture}</button>
			<button type="button" disabled={!gestureActive} onClick={onGestureCancel}>{copy.cancelAutomationGesture}</button>
		</div>
		{parameter && <dl data-automation-parameter-descriptor>
			<dt>{copy.automationParameter}</dt><dd>{parameter.label}</dd>
			<dt>{copy.automationUnit}</dt><dd>{parameter.unit}</dd>
			<dt>{copy.automationRange}</dt><dd>{parameter.minimum} – {parameter.maximum}</dd>
			<dt>{copy.automationStep}</dt><dd>{parameter.step ?? '—'}</dd>
			<dt>{copy.automationTaper}</dt><dd>{parameter.taper}</dd>
		</dl>}
		<div data-automation-structured-editor aria-disabled={!draft || !parameter}>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.automationTimebase}</span>
				<select disabled={!draft || !parameter || gestureActive} value={draft?.timebase ?? ''}
					onChange={(event) => updateDraft((lane) => changeTimebase(
						lane, event.currentTarget.value, model.laneTimebase,
					))}>
					<option value="absolute-samples">{copy.automationSamples}</option>
					<option value="musical-beats">{copy.automationBeats}</option>
				</select>
			</label>
			{draft?.points.map((point, index) => <div key={point.id} role="group"
				aria-label={`${copy.selectedLane} ${String(index + 1)}`} data-automation-point={point.id}>
				{draft.timebase === 'absolute-samples' ? <NumericField
					label={indexed(copy.automationPointPosition, index)} value={Number(point.position)}
					minimum={0} step={1} disabled={!parameter || gestureActive}
					onValue={(value) => updateDraft((lane) => {
						if (!nonNegativeInteger(value)) throw new RangeError(copy.automationPositionRefused);
						lane.points[index]!.position = value;
					})}
				/> : <>
					<NumericField label={indexed(copy.automationPointNumerator, index)}
						value={rationalPosition(point.position).num} minimum={0} step={1}
						disabled={!parameter || gestureActive} onValue={(value) => updateDraft((lane) => {
							if (!nonNegativeInteger(value)) throw new RangeError(copy.automationPositionRefused);
							const current = rationalPosition(lane.points[index]!.position);
							lane.points[index]!.position = canonicalRational(value, current.den);
						})} />
					<NumericField label={indexed(copy.automationPointDenominator, index)}
						value={rationalPosition(point.position).den} minimum={1} step={1}
						disabled={!parameter || gestureActive} onValue={(value) => updateDraft((lane) => {
							if (!positiveInteger(value)) throw new RangeError(copy.automationPositionRefused);
							const current = rationalPosition(lane.points[index]!.position);
							lane.points[index]!.position = canonicalRational(current.num, value);
						})} />
				</>}
				<NumericField label={`${indexed(copy.automationPointValue, index)} — ${parameter?.label ?? ''}`}
					value={point.value} minimum={parameter?.minimum} maximum={parameter?.maximum}
					step={parameter?.step ?? 'any'} disabled={!parameter || gestureActive}
					onValue={(value) => updateDraft((lane) => {
						if (!parameter || !Number.isFinite(value)
							|| value < parameter.minimum || value > parameter.maximum) {
							throw new RangeError(copy.automationValueRefused);
						}
						lane.points[index]!.value = value;
					})} />
			</div>)}
			{draft?.segments.map((segment, index) => <label key={`${String(index)}:${segment.kind}`}
				className="kw-audio-editor-dialog__field">
				<span>{indexed(copy.automationSegmentCurve, index)}</span>
				<select disabled={!parameter || gestureActive} value={segment.kind}
					onChange={(event) => updateDraft((lane) => {
						lane.segments[index] = simpleSegment(event.currentTarget.value, parameter?.taper === 'discrete');
					})}>
					<option value="hold">{copy.automationCurveHold}</option>
					{parameter?.taper !== 'discrete' && <>
						<option value="linear">{copy.automationCurveLinear}</option>
						<option value="eased">{copy.automationCurveEased}</option>
						<option value="bezier" disabled>{copy.automationCurveBezier}</option>
					</>}
				</select>
			</label>)}
		</div>
		{structuredStatus && <p role={structuredStatus === copy.automationStructuredUpdated ? 'status' : 'alert'}
			aria-live="polite">{structuredStatus}</p>}
		<details>
			<summary>{copy.automationAdvanced}</summary>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.laneDocument}</span>
				<textarea rows={14} spellCheck={false} value={laneDraft}
					onChange={(event) => onLaneDraft(event.currentTarget.value)} />
			</label>
		</details>
		<div className="kw-audio-editor-dialog__actions">
			<button type="button" disabled={gestureActive || !laneDraft.trim()} onClick={onApply}>{copy.applyLane}</button>
			<button type="button" disabled={gestureActive || !model.selectedLaneId} onClick={onReset}>{copy.resetLane}</button>
		</div>
	</fieldset>;
}

interface LanePointDocument {
	id: string;
	position: number | { num: number; den: number };
	value: number;
}

interface LaneDocument {
	id: string;
	address: Readonly<Record<string, unknown>>;
	timebase: 'absolute-samples' | 'musical-beats';
	points: LanePointDocument[];
	segments: Array<Readonly<Record<string, unknown>> & { kind: string }>;
}

function laneDocument(value: string): LaneDocument | null {
	try {
		const lane = JSON.parse(value) as LaneDocument;
		if (!lane || typeof lane !== 'object' || !Array.isArray(lane.points) || !Array.isArray(lane.segments)
			|| (lane.timebase !== 'absolute-samples' && lane.timebase !== 'musical-beats')
			|| lane.points.length === 0 || lane.segments.length !== lane.points.length - 1
			|| lane.points.some((point) => !point || typeof point !== 'object'
				|| typeof point.id !== 'string' || !point.id || !Number.isFinite(point.value)
				|| (lane.timebase === 'absolute-samples'
					? !nonNegativeInteger(point.position)
					: !isRationalPosition(point.position)))
			|| lane.segments.some((segment) => !segment || typeof segment !== 'object'
				|| !['hold', 'linear', 'eased', 'bezier'].includes(segment.kind))) return null;
		return lane;
	} catch {
		return null;
	}
}

function isRationalPosition(value: unknown): boolean {
	try {
		rationalPosition(value);
		return true;
	} catch {
		return false;
	}
}

function changeTimebase(
	lane: LaneDocument,
	value: string,
	context: Readonly<{ sampleRate: unknown; tempoMap: unknown }>,
): void {
	if (value !== 'absolute-samples' && value !== 'musical-beats') {
		throw new RangeError('The automation timebase is unsupported.');
	}
	if (lane.timebase === value) return;
	const from = lane.timebase === 'musical-beats' ? 'musical-beats' : 'absolute-samples';
	// A sample frame and a beat are different coordinates, so the switch projects
	// through the tempo map. Copying the number across would re-time every point.
	const position = (candidate: unknown): number | { num: number; den: number } => (
		convertAutomationLanePositionV21(candidate, from, value, {
			sampleRate: Number(context.sampleRate),
			...(context.tempoMap === undefined ? {} : { tempoMap: context.tempoMap as never }),
		}) as number | { num: number; den: number }
	);
	for (const point of lane.points) point.position = position(point.position);
	assertConvertedPositionsOrderedV21(
		lane.points.map(({ position: converted }) => converted as never),
	);
	for (const segment of lane.segments) {
		if (segment.kind !== 'bezier') continue;
		for (const controlName of ['control1', 'control2']) {
			const control = segment[controlName];
			if (!control || typeof control !== 'object' || Array.isArray(control)) {
				throw new RangeError('A Bézier segment requires canonical controls.');
			}
			// A curve control is a rational in either timebase, unlike a point, so it
			// converts through its own rule; the point rule wrote a bare number the
			// document only refused later, at Apply.
			(control as { position: unknown }).position = convertAutomationLaneControlPositionV21(
				(control as { position: unknown }).position,
				from,
				value,
				{
					sampleRate: Number(context.sampleRate),
					...(context.tempoMap === undefined ? {} : { tempoMap: context.tempoMap as never }),
				},
			);
		}
	}
	lane.timebase = value;
}

function NumericField({
	label, value, minimum, maximum, step, disabled, onValue,
}: Readonly<{
	label: string;
	value: number;
	minimum?: number;
	maximum?: number;
	step: number | 'any';
	disabled: boolean;
	onValue(value: number): void;
}>) {
	return <label className="kw-audio-editor-dialog__field">
		<span>{label}</span>
		<input type="number" value={value} min={minimum} max={maximum} step={step} disabled={disabled}
			onChange={(event) => onValue(event.currentTarget.valueAsNumber)} />
	</label>;
}

function simpleSegment(value: string, discrete: boolean): Readonly<{ kind: string }> {
	if (value === 'hold') return { kind: value };
	if (!discrete && (value === 'linear' || value === 'eased')) return { kind: value };
	throw new RangeError('This automation curve kind requires advanced canonical JSON.');
}

function rationalPosition(value: unknown): { num: number; den: number } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new RangeError('A musical point requires a canonical rational position.');
	}
	const position = value as Readonly<Record<string, unknown>>;
	if (!nonNegativeInteger(position.num) || !positiveInteger(position.den)) {
		throw new RangeError('A musical point requires a canonical rational position.');
	}
	return { num: Number(position.num), den: Number(position.den) };
}

function canonicalRational(num: number, den: number): { num: number; den: number } {
	let left = num;
	let right = den;
	while (right !== 0) [left, right] = [right, left % right];
	const divisor = Math.abs(left) || 1;
	return { num: num / divisor, den: den / divisor };
}

function nonNegativeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0);
}

function positiveInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function indexed(value: string, index: number): string {
	return value.replace('{index}', String(index + 1));
}

function automationModeLabel(copy: SoundscaperProductionCopy, mode: SoundscaperAutomationMode): string {
	return {
		read: copy.automationRead,
		trim: copy.automationTrim,
		touch: copy.automationTouch,
		latch: copy.automationLatch,
		write: copy.automationWrite,
	}[mode];
}
