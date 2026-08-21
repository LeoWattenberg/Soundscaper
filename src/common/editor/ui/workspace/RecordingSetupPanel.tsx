/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { Button } from '@dilsonspickles/components';

import type {
	CaptureDestination,
	CapturePhase,
	CaptureSourceRole,
} from '../../framescaper-capture-domain.ts';
import {
	FRAMESCAPER_CAPTURE_PANEL_ID,
	captureMetricText,
	capturePhaseIsSourceLocked,
	workspacePanelAvailable,
	type FramescaperCaptureUiSnapshot,
} from '../framescaper-capture-ui-model.ts';
import { FramescaperCaptureSources } from './FramescaperCaptureSources.tsx';

interface CaptureActions {
	requestPreview?(roles: readonly CaptureSourceRole[]): unknown;
	listDisplaySources?(): unknown;
	selectDisplaySource?(sourceToken: string): unknown;
	selectDevice?(role: 'camera' | 'microphone', deviceId: string): unknown;
	configureSource?(sourceId: string, settings: Readonly<Record<string, number>>): unknown;
	release?(): unknown;
	configure?(changes: Readonly<Record<string, unknown>>): unknown;
	setSetupDefaults?(defaults: Readonly<{ destination: CaptureDestination; countdownMs: number }>): unknown;
	arm?(options: Readonly<{ destination: CaptureDestination; countdownMs: number }>): unknown;
	start?(): unknown;
	pause?(): unknown;
	resume?(): unknown;
	stop?(): unknown;
	recover?(): unknown;
	importAsIs?(): unknown;
	discard?(): unknown;
	resetFailure?(): unknown;
}

interface RecordingSetupPanelProps {
	readonly controller: Readonly<{ actions: Readonly<{ capture?: CaptureActions }> }>;
	readonly snapshot: Readonly<{
		readonly productId?: string;
		readonly project?: unknown;
		readonly readOnly?: boolean;
		readonly capture?: FramescaperCaptureUiSnapshot;
	}>;
	readonly blocked?: boolean;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly locale: string;
	run(action: () => unknown): unknown;
}

const SELECTABLE_SOURCE_ROLES = Object.freeze([
	'camera', 'microphone', 'display',
] as const satisfies readonly CaptureSourceRole[]);

const DESTINATIONS = Object.freeze([
	'project-bin', 'timeline', 'both',
] as const satisfies readonly CaptureDestination[]);

const COUNTDOWNS_MS = Object.freeze([0, 3_000, 5_000, 10_000]);

export default function RecordingSetupPanel({
	controller,
	snapshot,
	copy,
	locale,
	run,
	blocked,
}: RecordingSetupPanelProps) {
	const productId = snapshot.productId ?? 'framescaper';
	const capture = snapshot.capture;
	const actions = controller.actions.capture;
	const [selectedRoles, setSelectedRoles] = useState<readonly CaptureSourceRole[]>(() => (
		capture?.requestedRoles.length ? capture.requestedRoles : defaultSourceRoles(capture)
	));
	const [destination, setDestination] = useState<CaptureDestination>(
		capture?.destination ?? capture?.setupDefaults?.destination ?? 'both',
	);
	const [countdownMs, setCountdownMs] = useState(
		capture?.countdownMs ?? capture?.setupDefaults?.countdownMs ?? 3_000,
	);

	useEffect(() => {
		if (capture?.requestedRoles.length) setSelectedRoles(capture.requestedRoles);
	}, [capture?.requestedRoles]);
	const supportedRoleKey = capture?.availability.status === 'available'
		? capture.availability.sourceRoles.join(':')
		: '';
	useEffect(() => {
		if (!supportedRoleKey) return;
		const supportedRoles = SELECTABLE_SOURCE_ROLES.filter((role) => (
			supportedRoleKey.split(':').includes(role)
		));
		setSelectedRoles((current) => {
			const supported = current.filter((role) => supportedRoles.includes(
				role as typeof SELECTABLE_SOURCE_ROLES[number],
			));
			if (supported.length === current.length) return current;
			const fallback = supportedRoles.filter((role) => ['camera', 'microphone'].includes(role));
			return Object.freeze(supported.length ? supported : (fallback.length ? fallback : supportedRoles));
		});
	}, [supportedRoleKey]);
	useEffect(() => {
		const next = capture?.destination ?? capture?.setupDefaults?.destination;
		if (next) setDestination(next);
	}, [capture?.destination, capture?.setupDefaults?.destination]);
	useEffect(() => {
		const next = capture?.countdownMs ?? capture?.setupDefaults?.countdownMs;
		if (next !== undefined) setCountdownMs(next);
	}, [capture?.countdownMs, capture?.setupDefaults?.countdownMs]);

	if (!workspacePanelAvailable(productId, FRAMESCAPER_CAPTURE_PANEL_ID)) return null;
	const phase = capture?.phase ?? 'inactive';
	const availability = capture?.availability ?? { status: 'checking' };
	const sourceLocked = capturePhaseIsSourceLocked(phase) || phase === 'permission-pending';
	const invoke = (operation: (() => unknown) | undefined): void => {
		if (operation) void run(operation);
	};
	const toggleRole = (role: CaptureSourceRole, enabled: boolean): void => {
		if (sourceLocked) return;
		setSelectedRoles((current) => enabled
			? Object.freeze([...new Set([...current, role])])
			: Object.freeze(current.filter((candidate) => candidate !== role)));
	};
	const statusText = captureStatusText(capture, copy);
	const recordingBlocked = Boolean(blocked || snapshot.readOnly || !snapshot.project);
	const recoveryBlocked = Boolean(blocked);
	const updateSetupDefaults = (next: Readonly<{
		destination: CaptureDestination;
		countdownMs: number;
	}>): void => {
		setDestination(next.destination);
		setCountdownMs(next.countdownMs);
		invoke(() => actions?.setSetupDefaults?.(next));
	};

	return <section
		className="kw-framescaper-capture"
		data-framescaper-recording-setup
		data-capture-phase={phase}
		aria-labelledby="framescaper-capture-setup-title"
	>
		<h3 id="framescaper-capture-setup-title" className="kw-audio-editor-sr-only">
			{copy.panelRecordingSetup}
		</h3>
		<div className="kw-framescaper-capture__status" role="status" aria-live="polite">
			<strong>{statusText}</strong>
			{availability.status === 'unavailable' && availability.detail
				? <span>{availability.detail}</span>
				: null}
			{capture?.failure?.message ? <span>{capture.failure.message}</span> : null}
		</div>

		{availability.status === 'available' && capture && <>
			<FramescaperCaptureSources
				capture={capture} selectedRoles={selectedRoles} sourceLocked={sourceLocked}
				copy={copy} locale={locale}
				canListDisplaySources={Boolean(actions?.listDisplaySources)}
				canSelectDevice={Boolean(actions?.selectDevice)}
				canConfigureSource={Boolean(actions?.configureSource)}
				onToggleRole={toggleRole}
				onListDisplaySources={() => invoke(actions?.listDisplaySources)}
				onSelectDisplaySource={(sourceToken) => invoke(() => actions?.selectDisplaySource?.(sourceToken))}
				onSelectDevice={(role, deviceId) => invoke(() => actions?.selectDevice?.(role, deviceId))}
				onConfigureSource={(sourceId, settings) => invoke(() => actions?.configureSource?.(sourceId, settings))}
			/>

			{['previewing', 'armed'].includes(phase) && <CaptureSetupOptions
				copy={copy}
				destination={destination}
				countdownMs={countdownMs}
				monitoring={Boolean(capture?.monitoring)}
				inputGain={capture?.inputGain ?? 1}
				disabled={phase === 'armed'}
				onDestination={(value) => updateSetupDefaults({ destination: value, countdownMs })}
				onCountdown={(value) => updateSetupDefaults({ destination, countdownMs: value })}
				onMonitoring={(monitoring) => invoke(() => actions?.configure?.({ monitoring }))}
				onInputGain={(inputGain) => invoke(() => actions?.configure?.({ inputGain }))}
			/>}

		</>}

		{(availability.status === 'available' || ['recovery', 'failed'].includes(phase))
			&& <CapturePanelActions
				phase={phase}
				copy={copy}
				actions={actions}
				selectedRoles={selectedRoles}
				destination={destination}
				countdownMs={countdownMs}
					capture={capture}
					recordingBlocked={recordingBlocked}
					recoveryBlocked={recoveryBlocked}
				invoke={invoke}
			/>}

		{capture && ['recording', 'paused', 'finalizing', 'recovery'].includes(phase)
			&& <CaptureSessionStatus capture={capture} copy={copy} locale={locale} />}
	</section>;
}

function CaptureSetupOptions({
	copy,
	destination,
	countdownMs,
	monitoring,
	inputGain,
	disabled,
	onDestination,
	onCountdown,
	onMonitoring,
	onInputGain,
}: Readonly<{
	copy: Readonly<Record<string, string | undefined>>;
	destination: CaptureDestination;
	countdownMs: number;
	monitoring: boolean;
	inputGain: number;
	disabled: boolean;
	onDestination(value: CaptureDestination): void;
	onCountdown(value: number): void;
	onMonitoring(value: boolean): void;
	onInputGain(value: number): void;
}>) {
	return <div className="kw-framescaper-capture__setup-options">
		<fieldset>
			<legend>{copy.captureDestination}</legend>
			{DESTINATIONS.map((value) => <label key={value}>
				<input type="radio" name="framescaper-capture-destination" value={value}
					checked={destination === value} disabled={disabled}
					onChange={() => onDestination(value)} />
				<span>{destinationLabel(copy, value)}</span>
			</label>)}
		</fieldset>
		<label className="kw-framescaper-capture__select">
			<span>{copy.captureCountdown}</span>
			<select value={countdownMs} disabled={disabled}
				onChange={(event) => onCountdown(Number(event.currentTarget.value))}>
				{COUNTDOWNS_MS.map((value) => <option key={value} value={value}>
					{value === 0
						? copy.captureCountdownNone
						: copy.captureCountdownSeconds?.replace('{count}', String(value / 1_000))}
				</option>)}
			</select>
		</label>
		<label className="kw-framescaper-capture__check">
			<input type="checkbox" checked={monitoring} disabled={disabled}
				onChange={(event) => onMonitoring(event.currentTarget.checked)} />
			<span>{copy.captureMonitoring}</span>
		</label>
		<label className="kw-framescaper-capture__gain">
			<span>{copy.captureInputGain}</span>
			<input type="range" min="0" max="2" step="0.05" value={inputGain} disabled={disabled}
				onChange={(event) => onInputGain(Number(event.currentTarget.value))} />
			<output>{inputGain.toFixed(2)}×</output>
		</label>
	</div>;
}

function CapturePanelActions({
	phase,
	copy,
	actions,
	selectedRoles,
	destination,
	countdownMs,
	capture,
	recordingBlocked,
	recoveryBlocked,
	invoke,
}: Readonly<{
	phase: CapturePhase;
	copy: Readonly<Record<string, string | undefined>>;
	actions: CaptureActions | undefined;
	selectedRoles: readonly CaptureSourceRole[];
	destination: CaptureDestination;
	countdownMs: number;
	capture: FramescaperCaptureUiSnapshot | undefined;
	recordingBlocked: boolean;
	recoveryBlocked: boolean;
	invoke(operation: (() => unknown) | undefined): void;
}>) {
	const previewNeedsUpdate = phase === 'previewing'
		&& !sameSourceRoles(selectedRoles, capture?.requestedRoles ?? []);
	const displaySelectionRequired = selectedRoles.includes('display')
		&& capture?.displaySelectionMode === 'source-list'
		&& !capture.selectedDisplaySourceToken
		&& (phase === 'inactive' || previewNeedsUpdate);
	return <div className="kw-framescaper-capture__actions">
		{phase === 'inactive' && <Button variant="primary" disabled={!selectedRoles.length || displaySelectionRequired || !actions?.requestPreview}
			onClick={() => invoke(() => actions?.requestPreview?.(selectedRoles))}>{copy.capturePreviewSources}</Button>}
		{phase === 'permission-pending' && <Button variant="primary" disabled>{copy.capturePreviewSources}</Button>}
		{phase === 'previewing' && <>
			{previewNeedsUpdate && <Button variant="primary"
				disabled={!selectedRoles.length || displaySelectionRequired || !actions?.requestPreview}
				onClick={() => invoke(() => actions?.requestPreview?.(selectedRoles))}>{copy.captureUpdatePreview}</Button>}
			<Button variant="primary" disabled={recordingBlocked || previewNeedsUpdate || !actions?.arm}
				onClick={() => invoke(() => actions?.arm?.({ destination, countdownMs }))}>{copy.captureArm}</Button>
			<Button variant="secondary" disabled={!actions?.release}
				onClick={() => invoke(actions?.release)}>{copy.captureReleaseSources}</Button>
		</>}
		{phase === 'armed' && <>
			<Button variant="primary" disabled={recordingBlocked || !actions?.start}
				onClick={() => invoke(actions?.start)}>{copy.captureStart}</Button>
			<Button variant="secondary" disabled={!actions?.release}
				onClick={() => invoke(actions?.release)}>{copy.captureReleaseSources}</Button>
		</>}
		{phase === 'countdown' && <Button variant="secondary" disabled={!actions?.stop}
			onClick={() => invoke(actions?.stop)}>{copy.captureStopImport}</Button>}
		{phase === 'recording' && <>
			<Button variant="secondary" disabled={!actions?.pause}
				onClick={() => invoke(actions?.pause)}>{copy.capturePause}</Button>
			<Button variant="primary" disabled={!actions?.stop}
				onClick={() => invoke(actions?.stop)}>{copy.captureStopImport}</Button>
		</>}
		{phase === 'paused' && <>
			<Button variant="secondary" disabled={!actions?.resume}
				onClick={() => invoke(actions?.resume)}>{copy.captureResume}</Button>
			<Button variant="primary" disabled={!actions?.stop}
				onClick={() => invoke(actions?.stop)}>{copy.captureStopImport}</Button>
		</>}
		{phase === 'recovery' && <>
			<Button variant="primary" disabled={recoveryBlocked || !actions?.recover}
				onClick={() => invoke(actions?.recover)}>{copy.captureRecover}</Button>
			<Button variant="secondary" disabled={recoveryBlocked || !actions?.importAsIs}
				onClick={() => invoke(actions?.importAsIs)}>{copy.captureImportAsIs}</Button>
			<Button variant="secondary" disabled={!actions?.discard}
				onClick={() => invoke(actions?.discard)}>{copy.captureDelete}</Button>
		</>}
		{phase === 'failed' && <Button variant="secondary" disabled={!actions?.resetFailure}
			onClick={() => invoke(actions?.resetFailure)}>{copy.captureResetFailure}</Button>}
	</div>;
}

function CaptureSessionStatus({
	capture,
	copy,
	locale,
}: Readonly<{
	capture: FramescaperCaptureUiSnapshot;
	copy: Readonly<Record<string, string | undefined>>;
	locale: string;
}>) {
	const elapsed = Math.max(0, Math.floor((capture.elapsedTimeMs ?? 0) / 1_000));
	const elapsedText = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
	const percentage = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 3 });
	const milliseconds = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
	return <section className="kw-framescaper-capture__session" aria-labelledby="framescaper-capture-metrics-title">
		<h4 id="framescaper-capture-metrics-title">{copy.captureMetrics}</h4>
		<dl><div><dt>{copy.captureElapsed}</dt><dd>{elapsedText}</dd></div></dl>
		{Boolean(capture.metrics?.length) && <table>
			<thead><tr><th>{copy.captureSources}</th><th>{copy.captureDropped}</th><th>{copy.captureDrift}</th></tr></thead>
			<tbody>{capture.metrics?.map((metric) => {
				const dropped = captureMetricText(metric.droppedRatio, (value) => percentage.format(value), String(copy.captureConfidenceUnavailable));
				const drift = captureMetricText(metric.currentDriftUs, (value) => `${milliseconds.format(value / 1_000)} ms`, String(copy.captureConfidenceUnavailable));
				return <tr key={metric.streamId}>
					<th>{sourceRoleLabel(copy, metric.role)}</th>
					<td>{dropped.value} <small>{confidenceLabel(copy, dropped.confidence)}</small></td>
					<td>{drift.value} <small>{confidenceLabel(copy, drift.confidence)}</small></td>
				</tr>;
			})}</tbody>
		</table>}
	</section>;
}

function captureStatusText(
	capture: FramescaperCaptureUiSnapshot | undefined,
	copy: Readonly<Record<string, string | undefined>>,
): string | undefined {
	if (!capture || capture.availability.status === 'checking') return copy.captureRuntimeChecking;
	if (capture.availability.status === 'unavailable') return copy.captureRuntimeUnavailable;
	const labels: Record<CapturePhase, string | undefined> = {
		inactive: copy.captureStatusInactive,
		'permission-pending': copy.captureStatusPermissionPending,
		previewing: copy.captureStatusPreviewing,
		armed: copy.captureStatusArmed,
		countdown: copy.captureStatusCountdown,
		recording: copy.captureStatusRecording,
		paused: copy.captureStatusPaused,
		finalizing: copy.captureStatusFinalizing,
		recovery: copy.captureStatusRecovery,
		failed: copy.captureStatusFailed,
	};
	return labels[capture.phase];
}

function sourceRoleLabel(
	copy: Readonly<Record<string, string | undefined>>,
	role: CaptureSourceRole,
): string | undefined {
	return {
		camera: copy.captureCamera,
		microphone: copy.captureMicrophone,
		display: copy.captureDisplay,
		'system-audio': copy.captureSystemAudio,
	}[role];
}

function destinationLabel(
	copy: Readonly<Record<string, string | undefined>>,
	destination: CaptureDestination,
): string | undefined {
	return {
		'project-bin': copy.captureDestinationProjectBin,
		timeline: copy.captureDestinationTimeline,
		both: copy.captureDestinationBoth,
	}[destination];
}

function confidenceLabel(
	copy: Readonly<Record<string, string | undefined>>,
	confidence: 'exact' | 'estimated' | 'unavailable',
): string | undefined {
	return {
		exact: copy.captureConfidenceExact,
		estimated: copy.captureConfidenceEstimated,
		unavailable: copy.captureConfidenceUnavailable,
	}[confidence];
}

function defaultSourceRoles(
	capture: FramescaperCaptureUiSnapshot | undefined,
): readonly CaptureSourceRole[] {
	if (capture?.availability.status !== 'available') return Object.freeze(['camera', 'microphone']);
	const preferred = ['camera', 'microphone'] as const;
	const selected = preferred.filter((role) => capture.availability.status === 'available'
		&& capture.availability.sourceRoles.includes(role));
	if (selected.length) return Object.freeze(selected);
	return Object.freeze(capture.availability.sourceRoles.filter((role) => role !== 'system-audio'));
}

function sameSourceRoles(
	left: readonly CaptureSourceRole[],
	right: readonly CaptureSourceRole[],
): boolean {
	return left.length === right.length && left.every((role) => right.includes(role));
}
