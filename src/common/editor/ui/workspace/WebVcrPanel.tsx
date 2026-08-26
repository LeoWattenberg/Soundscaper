/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import '../audio-editor-design-system/30-framescaper-web-vcr.css';

import {
	type WebVcrAspect,
	type WebVcrResolution,
	type WebVcrUiActions,
	type WebVcrUiSnapshot,
	webVcrCapabilityAvailable,
	webVcrPhaseLocksControls,
} from '../web-vcr-ui-model.ts';
import WebVcrPreview from './WebVcrPreview.tsx';

interface CaptureRecoveryActions {
	importAsIs?(): unknown;
	discard?(): unknown;
}

interface WebVcrPanelController {
	readonly actions: Readonly<{
		readonly webVcr?: WebVcrUiActions;
		readonly capture?: CaptureRecoveryActions;
	}>;
}

interface WebVcrPanelSnapshot {
	readonly productId?: string;
	readonly project?: unknown;
	readonly readOnly?: boolean;
	readonly webVcr?: WebVcrUiSnapshot;
	readonly capture?: Readonly<{ readonly phase?: string }>;
}

interface WebVcrPanelProps {
	readonly controller: WebVcrPanelController;
	readonly snapshot: WebVcrPanelSnapshot;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly blocked?: boolean;
	run(action: () => unknown): unknown;
}

const ASPECTS = Object.freeze(['free', '16:9', '9:16', '1:1'] as const satisfies readonly WebVcrAspect[]);

export default function WebVcrPanel({ controller, snapshot, copy, blocked, run }: WebVcrPanelProps) {
	const webVcr = snapshot.webVcr;
	const actions = controller.actions.webVcr;
	const navigationUrl = webVcr?.navigation.url ?? 'https://';
	const navigationGeneration = webVcr?.navigation.generation;
	const addressRef = useRef<HTMLInputElement>(null);
	const [address, setAddress] = useState(() => navigationUrl);
	const [confirmClear, setConfirmClear] = useState(false);
	useEffect(() => {
		setAddress(navigationUrl);
	}, [navigationGeneration, navigationUrl]);
	if (!webVcr || !webVcrCapabilityAvailable(webVcr)) return null;

	const controlsLocked = webVcrPhaseLocksControls(webVcr.phase);
	const recordingBlocked = Boolean(blocked || snapshot.readOnly || !snapshot.project);
	const recoveryBlocked = Boolean(blocked);
	const invoke = (operation: (() => unknown) | undefined): void => {
		if (operation) void run(operation);
	};
	const navigate = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const next = address.trim();
		if (!next || controlsLocked) return;
		invoke(() => actions?.navigate?.(next));
	};
	const record = (): void => invoke(actions?.record);
	const stop = (): void => invoke(actions?.stopAndImport);
	const canRecord = webVcr.phase === 'ready' && !webVcr.navigation.loading && Boolean(actions?.record) && !recordingBlocked;
	const canStop = ['preparing', 'recording'].includes(webVcr.phase) && Boolean(actions?.stopAndImport);
	const recovery = webVcr.phase === 'recovery' || snapshot.capture?.phase === 'recovery';

	return <section
		className="kw-web-vcr"
		data-framescaper-web-vcr
		data-web-vcr-phase={webVcr.phase}
		aria-labelledby="web-vcr-panel-title"
	>
		<h3 id="web-vcr-panel-title" className="kw-audio-editor-sr-only">{copy.webVcrTitle}</h3>
		<div className="kw-web-vcr__status" role="status" aria-live="polite">
			<span>{phaseText(copy, webVcr.phase)}</span>
			{webVcr.navigation.loading && <span>{copy.loading}</span>}
		</div>
		{webVcr.error && <p className="kw-web-vcr__error" role="alert">{webVcr.error}</p>}

		<form className="kw-web-vcr__browser-bar" onSubmit={navigate}>
			<button type="button" aria-label={copy.webVcrBack}
				disabled={controlsLocked || !webVcr.navigation.canGoBack || !actions?.back}
				onClick={() => invoke(actions?.back)}>←</button>
			<button type="button" aria-label={copy.webVcrForward}
				disabled={controlsLocked || !webVcr.navigation.canGoForward || !actions?.forward}
				onClick={() => invoke(actions?.forward)}>→</button>
			<button type="button" aria-label={copy.webVcrReload}
				disabled={controlsLocked || !actions?.reload}
				onClick={() => invoke(actions?.reload)}>↻</button>
			<label className="kw-web-vcr__address">
				<span className="kw-audio-editor-sr-only">{copy.webVcrAddress}</span>
					<input ref={addressRef} type="url" inputMode="url" required pattern="https://.*"
					aria-label={copy.webVcrAddress} value={address} disabled={controlsLocked}
					onChange={(event) => setAddress(event.currentTarget.value)} />
			</label>
			<button type="submit" disabled={controlsLocked || !actions?.navigate}>{copy.webVcrGo}</button>
		</form>

		<WebVcrPreview
			copy={copy}
			snapshot={webVcr}
			disabled={controlsLocked}
			onCrop={(crop) => invoke(() => actions?.setCrop?.(crop))}
				onPointerInput={(input) => invoke(() => actions?.sendPointerInput?.(input))}
				onKeyInput={(input) => invoke(() => actions?.sendKeyInput?.(input))}
				onReleaseFocus={() => addressRef.current?.focus()}
			/>

		<div className="kw-web-vcr__settings">
			<label>
				<span>{copy.webVcrResolution}</span>
				<select aria-label={copy.webVcrResolution} value={webVcr.resolution}
					disabled={controlsLocked || !actions?.setResolution}
					onChange={(event) => invoke(() => actions?.setResolution?.(
						event.currentTarget.value as WebVcrResolution,
					))}>
					{webVcr.availableResolutions.map((resolution) => <option key={resolution} value={resolution}>
						{resolution === '4k' ? '4K' : resolution}
					</option>)}
				</select>
			</label>
			<label className="kw-web-vcr__check">
				<input type="checkbox" checked={webVcr.autoCrop}
					disabled={controlsLocked || !actions?.setAutoCrop}
					onChange={(event) => invoke(() => actions?.setAutoCrop?.(event.currentTarget.checked))} />
				<span>{copy.webVcrAutoCrop}</span>
			</label>
			<label>
				<span>{copy.webVcrAspect}</span>
				<select aria-label={copy.webVcrAspect} value={webVcr.aspect}
					disabled={controlsLocked || webVcr.autoCrop || !actions?.setAspect}
					onChange={(event) => invoke(() => actions?.setAspect?.(
						event.currentTarget.value as WebVcrAspect,
					))}>
					{ASPECTS.map((aspect) => <option key={aspect} value={aspect}>
						{aspect === 'free' ? copy.webVcrAspectFree : aspect}
					</option>)}
				</select>
			</label>
			<label className="kw-web-vcr__check">
				<input type="checkbox" checked={webVcr.monitorMuted} disabled={!actions?.setMonitorMuted}
					onChange={(event) => invoke(() => actions?.setMonitorMuted?.(event.currentTarget.checked))} />
				<span>{copy.webVcrMuteMonitor}</span>
			</label>
			<label className="kw-web-vcr__check">
				<input type="checkbox" checked={webVcr.autoStop}
					disabled={controlsLocked || !actions?.setAutoStop}
					onChange={(event) => invoke(() => actions?.setAutoStop?.(event.currentTarget.checked))} />
				<span>{copy.webVcrAutoStop}</span>
			</label>
		</div>

		<CaptureDimensions copy={copy} snapshot={webVcr} />

		<div className="kw-web-vcr__actions">
			{!canStop && <button type="button" className="kw-web-vcr__primary"
				disabled={!canRecord} onClick={record}>{copy.webVcrRecord}</button>}
			{canStop && <button type="button" className="kw-web-vcr__primary"
				onClick={stop}>{copy.captureStopImport}</button>}
			{recovery && <>
					<button type="button" disabled={recoveryBlocked || !controller.actions.capture?.importAsIs}
					onClick={() => invoke(controller.actions.capture?.importAsIs)}>{copy.captureImportAsIs}</button>
				<button type="button" disabled={!controller.actions.capture?.discard}
					onClick={() => invoke(controller.actions.capture?.discard)}>{copy.captureDelete}</button>
			</>}
			{!confirmClear
				? <button type="button" disabled={webVcr.phase !== 'ready' || !actions?.clearBrowserData}
					onClick={() => setConfirmClear(true)}>{copy.webVcrClearData}</button>
				: <span className="kw-web-vcr__clear-confirm" role="group" aria-label={copy.webVcrClearData}>
					<span role="alert">{copy.webVcrClearDataWarning}</span>
					<button type="button" onClick={() => setConfirmClear(false)}>{copy.webVcrCancelClearData}</button>
					<button type="button" onClick={() => {
						setConfirmClear(false);
						invoke(actions?.clearBrowserData);
					}}>{copy.webVcrClearDataConfirm}</button>
				</span>}
		</div>
	</section>;
}

function CaptureDimensions({ copy, snapshot }: Readonly<{
	copy: Readonly<Record<string, string | undefined>>;
	snapshot: WebVcrUiSnapshot;
}>) {
	return <div className="kw-web-vcr__dimensions">
		<dl>
			<Dimension label={copy.webVcrSurface} value={snapshot.surface} unavailable={copy.webVcrDimensionsUnavailable} />
			<Dimension label={copy.webVcrOutput} value={snapshot.output} unavailable={copy.webVcrDimensionsUnavailable} />
			<Dimension label={copy.webVcrSource} value={snapshot.intrinsic} unavailable={copy.webVcrDimensionsUnavailable} />
		</dl>
		{snapshot.lowerResolutionWarning && <p role="status">{copy.webVcrLowerResolutionWarning}</p>}
	</div>;
}

function Dimension({ label, value, unavailable }: Readonly<{
	label: string | undefined;
	value: Readonly<{ width: number; height: number }> | null;
	unavailable: string | undefined;
}>) {
	return <div><dt>{label}</dt><dd>{value ? `${value.width} × ${value.height}` : unavailable}</dd></div>;
}

function phaseText(copy: Readonly<Record<string, string | undefined>>, phase: WebVcrUiSnapshot['phase']) {
	const key = `webVcrStatus${phase[0]?.toUpperCase()}${phase.slice(1)}`;
	return copy[key] ?? phase;
}
