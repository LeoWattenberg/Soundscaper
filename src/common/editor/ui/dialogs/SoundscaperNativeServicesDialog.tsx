/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one surface behind every milestone-5A native menu entry.
 *
 * It is opened from a menu and nowhere else — the editor gains no permanent
 * chrome from the native tier — and it is the only place a user can grant a
 * format, admit a folder, watch a scan, read what the scan found, or clear a
 * quarantined digest. Everything it draws came from the preload bridge, so it
 * names status and never mechanism.
 */

import React, { useEffect, useMemo, useSyncExternalStore, type KeyboardEvent } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	type NativeAudioInventory,
	type NativeAudioSessionOpenRequestV1,
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';
import {
	resolveSoundscaperNativeServicesCopy,
	type SoundscaperNativeServicesCopy,
} from '../soundscaper-native-services-copy.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from '../soundscaper-native-services-dialog-model.ts';
import {
	createSoundscaperNativeServicesDialogRuntime,
	type SoundscaperNativeServicesDialogRuntime,
} from '../soundscaper-native-services-dialog-runtime.ts';
import {
	SOUNDSCAPER_NATIVE_SERVICE_SURFACES,
	type SoundscaperNativeServiceSurface,
} from '../soundscaper-native-services-menu.ts';
import {
	SoundscaperNativeEffectManagePanel,
	SoundscaperNativeEffectScanPanel,
} from './SoundscaperNativeEffectPanels.tsx';

export interface SoundscaperNativeServicesDialogProps {
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly initialSurface: SoundscaperNativeServiceSurface;
	readonly initialState?: SoundscaperNativeServicesDialogState;
	readonly runtime?: SoundscaperNativeServicesDialogRuntime;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly onClose: () => void;
}

export default function SoundscaperNativeServicesDialog({
	bridge,
	initialSurface,
	initialState = EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	runtime: workspaceRuntime,
	copy: hostCopy,
	onClose,
}: SoundscaperNativeServicesDialogProps) {
	const copy = useMemo(() => resolveSoundscaperNativeServicesCopy(hostCopy), [hostCopy]);
	const [surface, setSurface] = React.useState<SoundscaperNativeServiceSurface>(initialSurface);
	const localRuntime = useMemo(
		() => createSoundscaperNativeServicesDialogRuntime(bridge, initialState),
		[bridge, initialState],
	);
	const runtime = workspaceRuntime ?? localRuntime;
	const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
	const perform = useMemo(() => (action: SoundscaperNativeServicesDialogAction): void => {
		void runtime.perform(action);
	}, [runtime]);
	useEffect(() => { perform({ type: 'refresh' }); }, [perform]);

	const busy = state.pending !== null || Object.values(state.scans).some((scan) => scan.running);
	const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
		const next = adjacentSurface(surface, event.key);
		if (next === null) return;
		event.preventDefault();
		setSurface(next);
	};

	return <AudioEditorDialogShell
		title={copy.nativeServices}
		onClose={onClose}
		width={760}
		initialFocus={`[data-native-service-tab="${surface}"]`}
		dataAttributes={{ 'data-soundscaper-native-services-dialog': 'true' }}
	>
		<div className="audio-editor-soundscaper-native-services">
			<div role="tablist" aria-label={copy.nativeServiceSurfaces}>
				{SOUNDSCAPER_NATIVE_SERVICE_SURFACES.map((candidate) => <button
					key={candidate}
					id={tabId(candidate)}
					type="button"
					role="tab"
					aria-selected={surface === candidate}
					aria-controls={panelId(candidate)}
					tabIndex={surface === candidate ? 0 : -1}
					data-native-service-tab={candidate}
					onClick={() => setSurface(candidate)}
					onKeyDown={handleTabKey}
				>{surfaceLabel(copy, candidate)}</button>)}
			</div>
			<p role="status" aria-live="polite" aria-busy={busy ? 'true' : undefined}>
				{state.error || (busy ? copy.working : state.completed === null ? '' : copy.operationComplete)}
			</p>
			<section
				id={panelId(surface)}
				role="tabpanel"
				aria-labelledby={tabId(surface)}
				tabIndex={0}
			>
				<p>
					<button
						type="button"
						disabled={state.pending !== null}
						data-native-service-refresh="true"
						onClick={() => perform({ type: 'refresh' })}
					>{copy.refresh}</button>
				</p>
				{surface === 'native-audio-device' && <AudioDevicePanel
					copy={copy}
					state={state}
					disabled={state.pending !== null}
					perform={perform}
				/>}
				{surface === 'native-audio-preferences' && <NativeAudioPanel
					copy={copy}
					state={state}
					disabled={state.pending !== null}
					perform={perform}
				/>}
				{surface === 'native-effect-scan' && <SoundscaperNativeEffectScanPanel
					copy={copy}
					state={state}
					disabled={state.pending !== null}
					perform={perform}
				/>}
				{surface === 'native-effect-manage' && <SoundscaperNativeEffectManagePanel
					copy={copy}
					state={state}
					disabled={state.pending !== null}
					perform={perform}
				/>}
			</section>
		</div>
	</AudioEditorDialogShell>;
}

function AudioDevicePanel({ copy, state, disabled, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	state: SoundscaperNativeServicesDialogState;
	disabled: boolean;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	const backends = state.audio?.backends ?? [];
	const devices = state.devices;
	const routes = devices?.status === 'described' ? groupAudioRoutes(devices.inventory) : [];
	const savedUnavailable = devices?.status === 'described'
		&& savedRouteUnavailable(state.audio?.routePreference ?? null, devices.inventory, routes);
	return <div className="audio-editor-soundscaper-native-devices">
		<h3>{copy.audioBackends}</h3>
		{backends.length === 0
			? <p>{copy.audioBackendUnavailable}</p>
			: <ul>
				{backends.map((backend) => <li key={backend} data-native-audio-backend={backend}>
					<span>{backend}</span>
					<button
						type="button"
						disabled={disabled || state.audio?.enabled !== true}
						data-native-audio-describe={backend}
						onClick={() => perform({ type: 'describe-devices', backend })}
					>{copy.listDevices}</button>
				</li>)}
			</ul>}
		{devices?.status === 'failed' && <p>{devices.message}</p>}
			{devices?.status === 'described' && (routes.length === 0
				? <p>{copy.noDevices}</p>
				: <ul aria-label={copy.audioDevices}>
					{routes.map((route) => <AudioRouteControl
						key={route.handle}
						copy={copy}
						backend={devices.inventory.backend}
						route={route}
						preference={state.audio?.routePreference ?? null}
						availableBackends={backends}
						disabled={disabled || state.audioSession !== null}
						perform={perform}
					/>) }
				</ul>)}
			{savedUnavailable && <p role="status">{copy.savedAudioRouteUnavailable}</p>}
		{state.audioSession !== null && <AudioSessionControls
			copy={copy}
			disabled={disabled}
			state={state}
			perform={perform}
		/>}
	</div>;
}

function AudioSessionControls({ copy, disabled, state, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	disabled: boolean;
	state: SoundscaperNativeServicesDialogState;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	const session = state.audioSession;
	if (session === null) return null;
	return <section data-native-audio-session={session.sessionId}>
		<h3>{`${session.backend} — ${session.state}`}</h3>
		<button type="button" disabled={disabled || session.state !== 'open'}
			data-native-audio-bind="true"
			onClick={() => perform({ type: 'bind-audio-session', sessionId: session.sessionId })}
		>{copy.bindAudioSession}</button>
		<button type="button" disabled={disabled} data-native-audio-status="true"
			onClick={() => perform({ type: 'audio-session-status', sessionId: session.sessionId })}
		>{copy.refreshAudioSession}</button>
		<button type="button" disabled={disabled || !session.calibrationAvailable} data-native-audio-calibrate="true"
			onClick={() => perform({ type: 'calibrate-audio-session', sessionId: session.sessionId })}
		>{copy.calibrateAudioSession}</button>
		<button type="button" disabled={disabled} data-native-audio-close="true"
			onClick={() => perform({ type: 'close-audio-session', sessionId: session.sessionId })}
		>{copy.closeAudioSession}</button>
		<p>{`${session.format.direction}, ${session.format.mode}, ${session.format.sampleRate} Hz, ${session.format.periodFrames} frames, ${session.format.channelCount} channels`}</p>
		<p>{`${session.framesTransferred} frames transferred; ${session.lostFrames} frames lost`}</p>
		{session.calibrationUnavailableReason !== null
			&& <p>{calibrationUnavailableText(copy, session.calibrationUnavailableReason)}</p>}
		{session.fallback?.active === true
			&& <p>{`${copy.webCoreFallbackActive} ${session.fallback.reason.replaceAll('-', ' ')}`}</p>}
		{session.attempts.length > 0 && <ol aria-label={copy.audioOpenAttempts}>
			{session.attempts.map((attempt, index) => <li key={`${attempt.backend}:${String(index)}`}>
				{`${attempt.backend}: ${attempt.status} — ${attempt.detail}`}
			</li>)}
		</ol>}
		{session.calibrationFrames !== null && <p>{`${session.calibrationFrames} frames`}</p>}
	</section>;
}

interface AudioRoute {
	readonly handle: string;
	readonly label: string;
	readonly directions: readonly NativeAudioSessionOpenRequestV1['direction'][];
	readonly maximumChannels: number;
}

function AudioRouteControl({ copy, backend, route, preference, availableBackends, disabled, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	backend: string;
	route: AudioRoute;
	preference: NativeAudioSessionOpenRequestV1 | null;
	availableBackends: readonly string[];
	disabled: boolean;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	const saved = routePreferenceForRoute(preference, backend, route, availableBackends);
	const modes: readonly NativeAudioSessionOpenRequestV1['mode'][] = backend === 'asio'
		? ['exclusive'] : backend === 'wasapi' ? ['shared', 'exclusive'] : ['shared'];
	const [direction, setDirection] = React.useState<NativeAudioSessionOpenRequestV1['direction']>(
		saved?.direction ?? route.directions[0],
	);
	const [mode, setMode] = React.useState<NativeAudioSessionOpenRequestV1['mode']>(
		backend === 'asio' ? 'exclusive' : saved?.mode ?? modes[0],
	);
	const [sampleRate, setSampleRate] = React.useState(saved?.sampleRate ?? 48_000);
	const [periodFrames, setPeriodFrames] = React.useState(saved?.periodFrames ?? 1_024);
	const [channelCount, setChannelCount] = React.useState(
		Math.min(saved?.channelCount ?? 2, route.maximumChannels),
	);
	const rates = numericChoices([44_100, 48_000, 88_200, 96_000, 192_000], sampleRate);
	const periods = numericChoices([64, 128, 256, 512, 1_024, 2_048], periodFrames);
	const open = (): void => {
		if (!isStreamingBackend(backend)) return;
		const candidates = saved?.candidates ?? [{ backend, deviceHandle: route.handle }];
		perform({ type: 'open-audio-session', request: createNativeAudioRouteOpenRequest({
			candidates, direction, mode, sampleRate, periodFrames, channelCount,
		}) });
	};
	return <li data-native-audio-route={route.handle}>
		<strong>{route.label}</strong>
		<label>{copy.audioRouteDirection} <select value={direction} disabled={disabled}
			data-native-audio-direction={route.handle}
			onChange={(event) => setDirection(event.currentTarget.value as typeof direction)}>
			{route.directions.map((value) => <option key={value} value={value}>{value}</option>)}
		</select></label>
		<label>{copy.audioRouteMode} <select value={mode} data-native-audio-mode={route.handle}
			disabled={disabled || backend === 'asio'}
			onChange={(event) => setMode(event.currentTarget.value as typeof mode)}>
			{modes.map((value) => <option key={value} value={value}>{value}</option>)}
		</select></label>
		<label>{copy.audioRouteSampleRate} <select value={sampleRate} disabled={disabled}
			data-native-audio-sample-rate={route.handle}
			onChange={(event) => setSampleRate(Number(event.currentTarget.value))}>
			{rates.map((value) => <option key={value} value={value}>{value}</option>)}
		</select></label>
		<label>{copy.audioRoutePeriod} <select value={periodFrames} disabled={disabled}
			data-native-audio-period-frames={route.handle}
			onChange={(event) => setPeriodFrames(Number(event.currentTarget.value))}>
			{periods.map((value) => <option key={value} value={value}>{value}</option>)}
		</select></label>
		<label>{copy.audioRouteChannels} <input type="number" min={1} max={route.maximumChannels} value={channelCount}
			disabled={disabled} data-native-audio-channel-count={route.handle}
			onChange={(event) => setChannelCount(Math.max(1,
				Math.min(route.maximumChannels, Number(event.currentTarget.value))))} /></label>
		<button type="button" disabled={disabled || !isStreamingBackend(backend)}
			data-native-audio-open={route.handle} onClick={open}>{copy.openAudioSession}</button>
	</li>;
}

function groupAudioRoutes(inventory: NativeAudioInventory): readonly AudioRoute[] {
	const grouped = new Map<string, { label: string; input: boolean; output: boolean; channels: number }>();
	for (const device of inventory.devices) {
		const route = grouped.get(device.handle) ?? {
			label: device.label, input: false, output: false, channels: 32,
		};
		route.input ||= device.direction === 'input' || device.direction === 'duplex';
		route.output ||= device.direction === 'output' || device.direction === 'duplex';
		if (device.channelCount !== undefined) route.channels = Math.min(route.channels, device.channelCount, 32);
		grouped.set(device.handle, route);
	}
	return Object.freeze([...grouped].map(([handle, route]) => Object.freeze({
		handle, label: route.label,
		directions: Object.freeze(route.input && route.output
			? ['duplex', 'input', 'output'] as const : route.input ? ['input'] as const : ['output'] as const),
		maximumChannels: Math.max(1, route.channels),
	})));
}

function routePreferenceForRoute(preference: NativeAudioSessionOpenRequestV1 | null, backend: string,
	route: AudioRoute, availableBackends: readonly string[]): NativeAudioSessionOpenRequestV1 | null {
	if (preference === null || !route.directions.includes(preference.direction)
		|| preference.channelCount > route.maximumChannels) return null;
	const index = preference.candidates.findIndex(
		(candidate) => candidate.backend === backend && candidate.deviceHandle === route.handle,
	);
	if (index < 0 || preference.candidates.slice(0, index).some(
		(candidate) => availableBackends.includes(candidate.backend),
	)) return null;
	return preference;
}

function savedRouteUnavailable(preference: NativeAudioSessionOpenRequestV1 | null,
	inventory: NativeAudioInventory, routes: readonly AudioRoute[]): boolean {
	if (preference === null || preference.candidates[0]?.backend !== inventory.backend) return false;
	const route = routes.find((candidate) => candidate.handle === preference.candidates[0].deviceHandle);
	return route === undefined || !route.directions.includes(preference.direction)
		|| preference.channelCount > route.maximumChannels;
}

function numericChoices(values: readonly number[], selected: number): readonly number[] {
	return [...new Set([...values, selected])].sort((left, right) => left - right);
}

type NativeAudioStreamingUiBackend = Exclude<
	NativeAudioSessionOpenRequestV1['candidates'][number]['backend'], 'jack'
>;

function isStreamingBackend(value: string): value is NativeAudioStreamingUiBackend {
	return ['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa'].includes(value);
}

/** Build the exact request issued by a changed route form; no defaults are substituted here. */
export function createNativeAudioRouteOpenRequest(
	value: NativeAudioSessionOpenRequestV1,
): NativeAudioSessionOpenRequestV1 {
	if (value.candidates.length < 1 || value.candidates.length > 4
		|| value.candidates.some((candidate) => !isStreamingBackend(candidate.backend)
			|| !candidate.deviceHandle || /[\0/\\]/u.test(candidate.deviceHandle))
		|| !['input', 'output', 'duplex'].includes(value.direction)
		|| !['shared', 'exclusive'].includes(value.mode)
		|| value.candidates.some((candidate) => candidate.backend === 'asio') && value.mode !== 'exclusive') {
		throw new TypeError('Invalid native audio route selection.');
	}
	for (const [entry, minimum, maximum] of [
		[value.sampleRate, 8_000, 768_000], [value.periodFrames, 1, 16_384], [value.channelCount, 1, 32],
	] as const) if (!Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
		throw new RangeError('A native audio route value is outside its admitted bounds.');
	}
	return Object.freeze({
		candidates: Object.freeze(value.candidates.map((candidate) => Object.freeze({ ...candidate }))),
		direction: value.direction, mode: value.mode, sampleRate: value.sampleRate,
		periodFrames: value.periodFrames, channelCount: value.channelCount,
	});
}

function calibrationUnavailableText(copy: SoundscaperNativeServicesCopy,
	reason: 'duplex-required' | 'bind-required' | 'device-lost' | 'renderer-busy'): string {
	if (reason === 'device-lost') return copy.calibrationUnavailableAfterLoss;
	if (reason === 'renderer-busy') return copy.calibrationRequiresIdleRenderer;
	return copy.calibrationRequiresBoundDuplex;
}

function NativeAudioPanel({ copy, state, disabled, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	state: SoundscaperNativeServicesDialogState;
	disabled: boolean;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	const audio = state.audio;
	const enabled = audio?.enabled === true;
	return <div className="audio-editor-soundscaper-native-audio">
		<p>{enabled ? copy.tierEnabled : copy.tierDisabled}</p>
		<button
			type="button"
			disabled={disabled || audio === null}
			data-native-audio-set-enabled={String(!enabled)}
			onClick={() => perform({ type: 'set-audio-enabled', enabled: !enabled })}
		>{enabled ? copy.disableNativeAudio : copy.enableNativeAudio}</button>
		{audio?.quarantined === true && <p>{copy.audioHelperQuarantined}</p>}
		{audio !== null && audio.payload.status !== 'available'
			&& <p>{audio.payload.detail || copy.audioBackendUnavailable}</p>}
		{state.plugins !== null && !state.plugins.enabled && <p>{copy.discoveryDisabled}</p>}
	</div>;
}

function adjacentSurface(
	surface: SoundscaperNativeServiceSurface,
	key: string,
): SoundscaperNativeServiceSurface | null {
	const surfaces = SOUNDSCAPER_NATIVE_SERVICE_SURFACES;
	const index = surfaces.indexOf(surface);
	if (key === 'ArrowRight') return surfaces[(index + 1) % surfaces.length];
	if (key === 'ArrowLeft') return surfaces[(index - 1 + surfaces.length) % surfaces.length];
	if (key === 'Home') return surfaces[0];
	if (key === 'End') return surfaces[surfaces.length - 1];
	return null;
}

function surfaceLabel(
	copy: SoundscaperNativeServicesCopy,
	surface: SoundscaperNativeServiceSurface,
): string {
	if (surface === 'native-audio-device') return copy.tabAudioDevice;
	if (surface === 'native-audio-preferences') return copy.tabAudioPreferences;
	if (surface === 'native-effect-scan') return copy.tabEffectScan;
	return copy.tabEffectManage;
}

function tabId(surface: SoundscaperNativeServiceSurface): string {
	return `soundscaper-native-service-tab-${surface}`;
}

function panelId(surface: SoundscaperNativeServiceSurface): string {
	return `soundscaper-native-service-panel-${surface}`;
}
