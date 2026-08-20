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

import React, { useEffect, useMemo, useReducer, type KeyboardEvent } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	soundscaperNativeServicesStoreFor,
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';
import {
	resolveSoundscaperNativeServicesCopy,
	type SoundscaperNativeServicesCopy,
} from '../soundscaper-native-services-copy.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	reduceSoundscaperNativeServicesDialog,
	runSoundscaperNativeServicesAction,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from '../soundscaper-native-services-dialog-model.ts';
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
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly onClose: () => void;
}

export default function SoundscaperNativeServicesDialog({
	bridge,
	initialSurface,
	initialState = EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	copy: hostCopy,
	onClose,
}: SoundscaperNativeServicesDialogProps) {
	const copy = useMemo(() => resolveSoundscaperNativeServicesCopy(hostCopy), [hostCopy]);
	const [surface, setSurface] = React.useState<SoundscaperNativeServiceSurface>(initialSurface);
	const [state, dispatch] = useReducer(reduceSoundscaperNativeServicesDialog, initialState);

	const perform = useMemo(() => (action: SoundscaperNativeServicesDialogAction): void => {
		dispatch({ type: 'begin', action });
		void runSoundscaperNativeServicesAction(bridge, action).then((event) => {
			dispatch(event);
			if (event.type === 'settled' && action.type !== 'refresh' && action.type !== 'describe-devices') {
				void soundscaperNativeServicesStoreFor(bridge).refresh().catch(() => null);
			}
		});
	}, [bridge]);
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
		{devices?.status === 'described' && (devices.inventory.devices.length === 0
			? <p>{copy.noDevices}</p>
			: <ul aria-label={copy.audioDevices}>
				{devices.inventory.devices.map((device) => <li key={device.handle}>
					{`${device.label} (${device.direction})`}
				</li>)}
			</ul>)}
	</div>;
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
