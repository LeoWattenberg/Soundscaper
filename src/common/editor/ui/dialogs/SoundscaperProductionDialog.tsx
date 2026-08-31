/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import type { SessionLoudnessHistorySnapshot } from '../../production-audio/loudness-history-session.ts';
import type { RestorationWorkflow } from '../../production-audio/restoration-workflow.ts';
import type { StripMeterSnapshot } from '../../production-audio/strip-meter-session.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	type SoundscaperAutomationMode,
	type SoundscaperProductionMenuCapabilities,
	type SoundscaperProductionSurface,
} from '../soundscaper-production-application-menu.ts';
import {
	createSoundscaperProductionDialogModel,
} from '../soundscaper-production-dialog-model.ts';
import {
	resolveSoundscaperProductionCopy,
	type SoundscaperProductionCopy,
} from '../soundscaper-production-copy.ts';
import { useSoundscaperProductionDialogOperation } from '../soundscaper-production-dialog-operation.ts';
import { createSoundscaperProductionDialogClose } from '../soundscaper-production-dialog-close.ts';
import type {
	MasteringSequenceCommandPayloads,
	MasteringSequenceCommandType,
} from '../../commands/mastering-sequence.ts';
import { createStableId } from '../../stable-id.js';
import SoundscaperAutomationEditor from './SoundscaperAutomationEditor.tsx';
import SoundscaperMasteringSequenceEditor from './SoundscaperMasteringSequenceEditor.tsx';
import SoundscaperRoutingEditor from './SoundscaperRoutingEditor.tsx';

const MAXIMUM_RENDERED_LOUDNESS_HISTORY_ENTRIES = 6_000;

/**
 * Mastering-sequence edits are the commands themselves rather than a dialog
 * vocabulary that has to be translated: the editor names the edit, and the
 * ordinary command path decides whether it is allowed and how it undoes.
 */
type MasteringSequenceCommandOperation = {
	readonly [Type in MasteringSequenceCommandType]: Readonly<
		{ readonly type: Type } & MasteringSequenceCommandPayloads[Type]
	>;
}[MasteringSequenceCommandType];

export type MasteringSequenceDialogOperation =
	| MasteringSequenceCommandOperation
	| Readonly<{
		readonly type: 'batch';
		readonly commands: readonly MasteringSequenceCommandOperation[];
	}>;

export type SoundscaperProductionDialogOperation =
	| Readonly<{
		readonly type: 'automation-lane/set';
		readonly laneId: string;
		readonly expected: Readonly<Record<string, unknown>> | null;
		readonly lane: Readonly<Record<string, unknown>> | null;
	}>
	| Readonly<{
		readonly type: 'automation-mode/set';
		readonly mode: SoundscaperAutomationMode;
		readonly laneId?: string | null;
	}>
	| Readonly<{
		readonly type: 'automation-gesture/begin';
		readonly laneId: string;
		readonly controlValue: number;
	}>
	| Readonly<{
		readonly type: 'automation-gesture/preview';
		readonly controlValue: number;
	}>
	| Readonly<{
		readonly type: 'automation-gesture/release';
		readonly controlValue: number;
	}>
	| Readonly<{ readonly type: 'automation-gesture/cancel' }>
	| Readonly<{
		readonly type: 'mixer-graph/set';
		readonly expected: Readonly<Record<string, unknown>>;
		readonly mixer: Readonly<Record<string, unknown>>;
	}>
	| Readonly<{
		readonly type: 'restoration/apply';
		readonly workflow: RestorationWorkflow;
	}>
	| Readonly<{ readonly type: 'restoration/capture-noise-profile' }>
	| Readonly<{ readonly type: 'production-meter/reset' }>
	| MasteringSequenceDialogOperation
	| Readonly<{
		readonly type: 'reviewed-effect/apply';
		readonly package: Readonly<{ readonly id: 'org.soundscaper.utility-gain'; readonly version: '1.0.0' }>;
		readonly params: Readonly<{ readonly gain: number }>;
	}>;

export interface SoundscaperProductionDialogProps {
	readonly productId: string;
	readonly capabilities: SoundscaperProductionMenuCapabilities;
	readonly snapshot: Readonly<{
		readonly project?: unknown;
		readonly selectedTrackId?: string | null;
		readonly selectedAutomationTarget?: unknown;
		readonly selectedLaneId?: string | null;
		readonly readOnly?: boolean;
		readonly editingBlocked?: boolean;
		readonly noiseProfileReady?: boolean;
		readonly productionMeters?: readonly StripMeterSnapshot[];
		readonly loudnessHistory?: SessionLoudnessHistorySnapshot;
	}>;
	readonly initialSurface: SoundscaperProductionSurface;
	readonly automationMode?: SoundscaperAutomationMode;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly actions: Readonly<{
		execute(operation: SoundscaperProductionDialogOperation): unknown;
	}>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function SoundscaperProductionDialog({
	productId,
	capabilities,
	snapshot,
	initialSurface,
	automationMode = 'read',
	copy: hostCopy,
	actions,
	run,
	onClose,
}: SoundscaperProductionDialogProps) {
	const copy = useMemo(() => resolveSoundscaperProductionCopy(hostCopy), [hostCopy]);
	const projectIdentity = soundscaperProductionDialogProjectIdentity(snapshot.project);
	const [surface, setSurface] = useState<SoundscaperProductionSurface>(initialSurface);
	const [laneId, setLaneId] = useState<string | null>(snapshot.selectedLaneId ?? null);
	const [mode, setMode] = useState<SoundscaperAutomationMode>(automationMode);
	const model = useMemo(() => createSoundscaperProductionDialogModel({
		productId,
		capabilities,
		project: snapshot.project,
		selectedTrackId: snapshot.selectedTrackId,
		selectedAutomationTarget: snapshot.selectedAutomationTarget,
		selectedLaneId: laneId,
		requestedSurface: surface,
		automationMode: mode,
		readOnly: snapshot.readOnly,
		editingBlocked: snapshot.editingBlocked,
	}), [capabilities, laneId, mode, productId, snapshot, surface]);
	const [laneDraft, setLaneDraft] = useState(model.selectedLaneText);
	const [mixerDraft, setMixerDraft] = useState(model.mixerGraphText);
	const [clickRemoval, setClickRemoval] = useState(true);
	const [noiseReduction, setNoiseReduction] = useState(true);
	const [filterCurveEq, setFilterCurveEq] = useState(true);
	const [utilityGain, setUtilityGain] = useState(1);
	const [automationValue, setAutomationValue] = useState(() => laneDocumentValue(model.selectedLaneText));
	const [automationGestureActive, setAutomationGestureActive] = useState(false);
	const {
		disabled, pending, status, error, clearFeedback, perform,
	} = useSoundscaperProductionDialogOperation({
		project: snapshot.project,
		blocked: model.operationsBlocked,
		success: copy.operationComplete,
		execute: (operation: SoundscaperProductionDialogOperation) => actions.execute(operation),
		run,
		onProjectChange: () => { setAutomationGestureActive(false); },
	});
	const noiseProfileReady = snapshot.noiseProfileReady === true;
	const enabledNoiseReduction = noiseProfileReady && noiseReduction;

	useEffect(() => {
		if (model.surface && model.surface !== surface) setSurface(model.surface);
	}, [model.surface, surface]);
	useEffect(() => { setMode(automationMode); }, [automationMode, projectIdentity]);
	useEffect(() => {
		if (model.selectedLaneId !== laneId) setLaneId(model.selectedLaneId);
		setLaneDraft(model.selectedLaneText);
	}, [laneId, model.selectedLaneId, model.selectedLaneText, projectIdentity]);
	useEffect(() => {
		if (!automationGestureActive) setAutomationValue(laneDocumentValue(model.selectedLaneText));
	}, [automationGestureActive, model.selectedLaneText, projectIdentity]);
	useEffect(() => { setMixerDraft(model.mixerGraphText); }, [model.mixerGraphText, projectIdentity]);

	const selectSurface = (next: SoundscaperProductionSurface): void => {
		setSurface(next);
		clearFeedback();
	};
	const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
		const index = model.surfaces.indexOf(surface);
		let nextIndex = index;
		if (event.key === 'ArrowRight') nextIndex = (index + 1) % model.surfaces.length;
		else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + model.surfaces.length) % model.surfaces.length;
		else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = model.surfaces.length - 1;
		else return;
		const next = model.surfaces[nextIndex];
		if (!next) return;
		event.preventDefault();
		selectSurface(next);
		requestAnimationFrame(() => {
			document.getElementById(tabId(next))?.focus({ preventScroll: true });
		});
	};
	const requestClose = createSoundscaperProductionDialogClose({
		pending, automationGestureActive, perform, setAutomationGestureActive, onClose,
	});

	return <AudioEditorDialogShell
		title={copy.productionAudio}
		onClose={requestClose}
		width={920}
		initialFocus={`[data-production-surface-tab="${model.surface}"]`}
		dataAttributes={{ 'data-soundscaper-production-dialog': 'true' }}
	>
		<div className="audio-editor-soundscaper-production">
			<div role="tablist" aria-label={copy.productionAudioWorkflows}>
				{model.surfaces.map((candidate) => <button
					key={candidate}
					id={tabId(candidate)}
					type="button"
					role="tab"
					aria-selected={surface === candidate}
					aria-controls={panelId(candidate)}
					tabIndex={surface === candidate ? 0 : -1}
					data-production-surface-tab={candidate}
					onClick={() => selectSurface(candidate)}
					onKeyDown={handleTabKey}
				>{surfaceLabel(copy, candidate)}</button>)}
			</div>
			{model.surface && <section
				id={panelId(model.surface)}
				role="tabpanel"
				aria-labelledby={tabId(model.surface)}
				tabIndex={0}
			>
				<BlockNotice reason={model.blockReason} copy={copy} />
				{model.surface === 'automation' && <SoundscaperAutomationEditor
					copy={copy}
					model={model}
					disabled={disabled}
					mode={mode}
					laneDraft={laneDraft}
					automationValue={automationValue}
					gestureActive={automationGestureActive}
					onLane={setLaneId}
					onLaneDraft={setLaneDraft}
					onAutomationValue={setAutomationValue}
					onMode={(next) => {
						// Applied only once the controller accepted it, as every other
						// gesture here does: the dialog rebuilds its model from this mode,
						// so adopting a refused one would drive the gesture controls
						// against a controller still in the previous mode.
						perform('automation-mode', () => ({
							type: 'automation-mode/set', mode: next, laneId: model.selectedLaneId,
						}), () => { setMode(next); });
					}}
					onApply={() => perform('automation-apply', () => laneSetOperation(model.selectedLaneText, laneDraft))}
					onReset={() => perform('automation-reset', () => laneResetOperation(model.selectedLaneText))}
					onGestureBegin={() => perform('automation-gesture-begin', () => ({
						type: 'automation-gesture/begin',
						laneId: requiredLaneId(model.selectedLaneId),
						controlValue: automationValue,
					}), () => { setAutomationGestureActive(true); })}
					onGesturePreview={() => perform('automation-gesture-preview', () => ({
						type: 'automation-gesture/preview', controlValue: automationValue,
					}))}
					onGestureRelease={() => perform('automation-gesture-release', () => ({
						type: 'automation-gesture/release', controlValue: automationValue,
					}), () => { setAutomationGestureActive(false); })}
					onGestureCancel={() => perform('automation-gesture-cancel', () => ({
						type: 'automation-gesture/cancel',
					}), () => { setAutomationGestureActive(false); })}
				/>}
				{model.surface === 'routing' && <SoundscaperRoutingEditor
					copy={copy}
					project={snapshot.project}
					draft={mixerDraft}
					disabled={disabled}
					onDraft={setMixerDraft}
					onApply={() => perform('mixer-apply', () => ({
						type: 'mixer-graph/set',
						expected: documentRecord(model.mixerGraphText, 'current mixer graph'),
						mixer: documentRecord(mixerDraft, 'mixer graph'),
					}))}
				/>}
				{model.surface === 'restoration' && <RestorationEditor
					copy={copy}
					disabled={disabled}
					noiseProfileReady={noiseProfileReady}
					values={{ clickRemoval, noiseReduction: enabledNoiseReduction, filterCurveEq }}
					onClickRemoval={setClickRemoval}
					onNoiseReduction={setNoiseReduction}
					onFilterCurveEq={setFilterCurveEq}
					onCaptureNoiseProfile={() => perform('restoration-noise-profile', () => ({
						type: 'restoration/capture-noise-profile',
					}))}
					onApply={() => perform('restoration-apply', () => createSoundscaperRestorationOperation({
						clickRemoval, noiseReduction, filterCurveEq,
					}, noiseProfileReady))}
				/>}
				{model.surface === 'metering' && <MeteringEditor
					copy={copy}
					disabled={disabled}
					meters={snapshot.productionMeters ?? Object.freeze([])}
					loudness={snapshot.loudnessHistory ?? null}
					onReset={() => perform('meter-reset', () => ({ type: 'production-meter/reset' }))}
				/>}
				{model.surface === 'mastering-sequences' && <SoundscaperMasteringSequenceEditor
					copy={copy}
					disabled={disabled}
					sequences={model.masteringSequences}
					regions={model.masteringRegions}
					primarySequenceId={model.masteringPrimarySequenceId}
					createId={() => createStableId('mastering-sequence')}
					onOperation={(operation) => perform('mastering-sequence', () => operation)}
				/>}
				{model.surface === 'reviewed-effects' && <ReviewedEffectsEditor
					copy={copy}
					disabled={disabled}
					gain={utilityGain}
					onGain={setUtilityGain}
					onApply={() => perform('reviewed-effect-apply', () => reviewedEffectOperation(utilityGain))}
				/>}
			</section>}
			<div role="status" aria-live="polite" aria-atomic="true">
				{error || (pending ? `${surfaceLabel(copy, model.surface)}…` : status)}
			</div>
			<div className="kw-audio-editor-dialog__actions">
				<button type="button" disabled={pending !== null} onClick={requestClose}>{copy.close}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}

function RestorationEditor({
	copy, disabled, noiseProfileReady, values, onClickRemoval, onNoiseReduction,
	onFilterCurveEq, onCaptureNoiseProfile, onApply,
}: Readonly<{
	copy: SoundscaperProductionCopy;
	disabled: boolean;
	noiseProfileReady: boolean;
	values: Readonly<{ clickRemoval: boolean; noiseReduction: boolean; filterCurveEq: boolean }>;
	onClickRemoval(value: boolean): void;
	onNoiseReduction(value: boolean): void;
	onFilterCurveEq(value: boolean): void;
	onCaptureNoiseProfile(): void;
	onApply(): void;
}>) {
	return <fieldset disabled={disabled}>
		<legend>{copy.restorationProcessors}</legend>
		<p aria-live="polite" data-restoration-noise-profile={noiseProfileReady ? 'ready' : 'unavailable'}>
			{noiseProfileReady ? copy.restorationNoiseProfileReady : copy.restorationNoiseProfileRequired}
		</p>
		<button type="button" onClick={onCaptureNoiseProfile}>
			{noiseProfileReady ? copy.recaptureNoiseProfile : copy.captureNoiseProfile}
		</button>
		<Check label={copy.clickRemoval} checked={values.clickRemoval} onChange={onClickRemoval} />
		<Check
			label={copy.noiseReduction}
			checked={values.noiseReduction}
			disabled={!noiseProfileReady}
			onChange={onNoiseReduction}
		/>
		<Check label={copy.filterCurveEq} checked={values.filterCurveEq} onChange={onFilterCurveEq} />
		<div className="kw-audio-editor-dialog__actions">
			<button type="button" disabled={!Object.values(values).some(Boolean)} onClick={onApply}>{copy.applyRestoration}</button>
		</div>
	</fieldset>;
}

function MeteringEditor({ copy, disabled, meters, loudness, onReset }: Readonly<{
	copy: SoundscaperProductionCopy;
	disabled: boolean;
	meters: readonly StripMeterSnapshot[];
	loudness: SessionLoudnessHistorySnapshot | null;
	onReset(): void;
}>) {
	const current = loudness?.current.loudness;
	const history = loudness?.history.slice(-MAXIMUM_RENDERED_LOUDNESS_HISTORY_ENTRIES) ?? [];
	return <fieldset disabled={disabled}>
		<legend>{copy.metersTab}</legend>
		<p>{copy.meteringDescription}</p>
		<div role="group" aria-label={copy.metersTab} data-production-meter-readings="session-only">
			<h3>{copy.stripMeters}</h3>
			{meters.length === 0 ? <p>{copy.noMeterData}</p> : <table aria-label={copy.stripMeters}>
				<thead><tr>
					<th scope="col">{copy.meterStrip}</th>
					<th scope="col">{copy.meterChannels}</th>
					<th scope="col">{copy.meterCorrelation}</th>
					<th scope="col">{copy.meterPhase}</th>
				</tr></thead>
				<tbody>{meters.map((meter) => <tr key={stripMeterKey(meter)}>
					<td>{stripMeterKey(meter)}</td>
					<td>{meter.channels.map(({ label, peak, rms }) => (
						`${label}: ${formatMeter(peak)} peak, ${formatMeter(rms)} RMS`
					)).join('; ')}</td>
					<td>{formatMeter(meter.correlation)}</td>
					<td>{meter.phaseDegrees === null ? '—' : `${formatMeter(meter.phaseDegrees)}°`}</td>
				</tr>)}</tbody>
			</table>}
			<h3>{copy.loudnessHistory}</h3>
			<dl>
				<dt>{copy.momentaryLufs}</dt><dd>{formatMeter(current?.momentaryLufs ?? null)}</dd>
				<dt>{copy.shortTermLufs}</dt><dd>{formatMeter(current?.shortTermLufs ?? null)}</dd>
				<dt>{copy.integratedLufs}</dt><dd>{formatMeter(current?.integratedLufs ?? null)}</dd>
			</dl>
			{history.length === 0 ? <p>{copy.noLoudnessHistory}</p> : <table aria-label={copy.loudnessHistory}>
				<thead><tr>
					<th scope="col">{copy.loudnessSequence}</th>
					<th scope="col">{copy.loudnessElapsed}</th>
					<th scope="col">{copy.momentaryLufs}</th>
					<th scope="col">{copy.shortTermLufs}</th>
					<th scope="col">{copy.integratedLufs}</th>
					<th scope="col">{copy.loudnessRange}</th>
					<th scope="col">{copy.loudnessTruePeak}</th>
				</tr></thead>
				<tbody>{history.map((entry, index) => <tr key={`${String(entry.sequence)}:${String(index)}`}>
					<td>{entry.sequence}</td>
					<td>{formatMeter(entry.measuredSeconds)}</td>
					<td>{formatMeter(entry.momentaryLufs)}</td>
					<td>{formatMeter(entry.shortTermLufs)}</td>
					<td>{formatMeter(entry.integratedLufs)}</td>
					<td>{formatMeter(entry.loudnessRangeLu)}</td>
					<td>{formatMeter(entry.truePeakDbtp)}</td>
				</tr>)}</tbody>
			</table>}
		</div>
		<button type="button" onClick={onReset}>{copy.resetMeters}</button>
	</fieldset>;
}

function ReviewedEffectsEditor({ copy, disabled, gain, onGain, onApply }: Readonly<{
	copy: SoundscaperProductionCopy;
	disabled: boolean;
	gain: number;
	onGain(value: number): void;
	onApply(): void;
}>) {
	return <fieldset disabled={disabled}>
		<legend>{copy.reviewedEffectsTab}</legend>
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.reviewedEffectPackage}</span>
			<select value="org.soundscaper.utility-gain" disabled>
				<option value="org.soundscaper.utility-gain">{copy.utilityGain}</option>
			</select>
		</label>
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.utilityGainAmount}</span>
			<input type="number" min={0} max={4} step="0.01" value={gain} onChange={(event) => onGain(Number(event.currentTarget.value))} />
		</label>
		<button type="button" disabled={!Number.isFinite(gain) || gain < 0 || gain > 4} onClick={onApply}>
			{copy.applyReviewedEffect}
		</button>
	</fieldset>;
}

function Check({ label, checked, disabled = false, onChange }: Readonly<{
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange(value: boolean): void;
}>) {
	return <label><input
		type="checkbox"
		checked={checked}
		disabled={disabled}
		onChange={(event) => onChange(event.currentTarget.checked)}
	/> {label}</label>;
}

function BlockNotice({ reason, copy }: Readonly<{
	reason: ReturnType<typeof createSoundscaperProductionDialogModel>['blockReason'];
	copy: SoundscaperProductionCopy;
}>) {
	const message = reason === 'read-only' ? copy.readOnly
		: reason === 'locked' ? copy.locked
			: reason === 'busy' ? copy.busy
				: reason === 'no-selection' ? copy.noSelection
					: reason === 'wrong-schema' || reason === 'unsupported' ? copy.unsupported : '';
	return message ? <p role="status">{message}</p> : null;
}

function laneSetOperation(expectedText: string, laneText: string): SoundscaperProductionDialogOperation {
	const lane = documentRecord(laneText, 'automation lane');
	const laneId = typeof lane.id === 'string' && lane.id.length > 0 ? lane.id : null;
	if (!laneId) throw new TypeError('The automation lane requires a non-empty ID.');
	const expected = expectedText ? documentRecord(expectedText, 'current automation lane') : null;
	return Object.freeze({ type: 'automation-lane/set', laneId, expected, lane });
}

function laneResetOperation(expectedText: string): SoundscaperProductionDialogOperation {
	const expected = documentRecord(expectedText, 'current automation lane');
	const laneId = typeof expected.id === 'string' && expected.id.length > 0 ? expected.id : null;
	if (!laneId) throw new TypeError('The automation lane requires a non-empty ID.');
	return Object.freeze({ type: 'automation-lane/set', laneId, expected, lane: null });
}

function reviewedEffectOperation(gain: number): SoundscaperProductionDialogOperation {
	if (!Number.isFinite(gain) || Object.is(gain, -0) || gain < 0 || gain > 4) {
		throw new RangeError('Utility Gain must be from 0 through 4.');
	}
	return Object.freeze({
		type: 'reviewed-effect/apply',
		package: Object.freeze({ id: 'org.soundscaper.utility-gain', version: '1.0.0' }),
		params: Object.freeze({ gain }),
	});
}

export function createSoundscaperRestorationOperation(value: Readonly<{
	clickRemoval: boolean;
	noiseReduction: boolean;
	filterCurveEq: boolean;
}>, noiseProfileReady: boolean): Extract<
	SoundscaperProductionDialogOperation,
	Readonly<{ readonly type: 'restoration/apply' }>
> {
	const stages: RestorationWorkflow['stages'] = Object.freeze([
		...(value.clickRemoval ? [Object.freeze({
			id: 'click-removal', tool: 'click-removal' as const, enabled: true, params: Object.freeze({}),
		})] : []),
		...(noiseProfileReady && value.noiseReduction ? [Object.freeze({
			id: 'noise-reduction', tool: 'noise-reduction' as const, enabled: true, params: Object.freeze({}),
		})] : []),
		...(value.filterCurveEq ? [Object.freeze({
			id: 'filter-curve-eq', tool: 'filter-curve-eq' as const, enabled: true, params: Object.freeze({}),
		})] : []),
	]);
	return Object.freeze({
		type: 'restoration/apply',
		workflow: Object.freeze({ target: 'selection', stages }),
	});
}

function stripMeterKey(meter: StripMeterSnapshot): string {
	return meter.strip.kind === 'master' ? 'Master' : `${meter.strip.kind}: ${meter.strip.id}`;
}

function formatMeter(value: number | null): string {
	return value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

function documentRecord(text: string, name: string): Readonly<Record<string, unknown>> {
	let value: unknown;
	try { value = JSON.parse(text) as unknown; } catch (error) {
		throw new SyntaxError(`${name} must be valid JSON.`, { cause: error });
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function laneDocumentValue(text: string): number {
	if (!text) return 0;
	try {
		const lane = JSON.parse(text) as unknown;
		if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return 0;
		const points = (lane as Readonly<Record<string, unknown>>).points;
		if (!Array.isArray(points) || points.length === 0) return 0;
		const point = points[0];
		if (!point || typeof point !== 'object' || Array.isArray(point)) return 0;
		const value = (point as Readonly<Record<string, unknown>>).value;
		return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) ? value : 0;
	} catch {
		return 0;
	}
}

function requiredLaneId(value: string | null): string {
	if (!value) throw new Error('Select an automation lane before beginning a gesture.');
	return value;
}

function surfaceLabel(
	copy: SoundscaperProductionCopy,
	surface: SoundscaperProductionSurface | null,
): string {
	if (surface === 'automation') return copy.automation;
	if (surface === 'routing') return copy.routing;
	if (surface === 'restoration') return copy.restorationTab;
	if (surface === 'metering') return copy.metersTab;
	if (surface === 'mastering-sequences') return copy.masteringSequencesTab;
	if (surface === 'reviewed-effects') return copy.reviewedEffectsTab;
	return copy.productionAudio;
}

function tabId(surface: SoundscaperProductionSurface): string {
	return `soundscaper-production-tab-${surface}`;
}

function panelId(surface: SoundscaperProductionSurface): string {
	return `soundscaper-production-panel-${surface}`;
}

function soundscaperProductionDialogProjectIdentity(project: unknown): unknown {
	if (project === null || typeof project !== 'object' || Array.isArray(project)) return null;
	const id = (project as Readonly<Record<string, unknown>>).id;
	return typeof id === 'string' ? id : project;
}
