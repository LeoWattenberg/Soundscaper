/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingRoutingDeviceRow,
	RecordingRoutingProject,
	RecordingRoutingRefreshOptions,
	RecordingRoutingServiceRuntime,
} from './recording-routing-service-types.d.ts';
import { setRecordingTrackRoute } from '../recording-routing.js';

export type {
	PersistedRecordingRouting,
	RecordingPreferencePatch,
	RecordingRoutingCapturePool,
	RecordingRoutingDeviceRow,
	RecordingRoutingMediaDevice,
	RecordingRoutingMediaDevices,
	RecordingRoutingNativeInventory,
	RecordingRoutingProject,
	RecordingRoutingRefreshOptions,
	RecordingRoutingServiceRuntime,
	RecordingRoutingState,
	RecordingRoutingTrack,
} from './recording-routing-service-types.d.ts';

export function createRecordingRoutingService<
	Project extends RecordingRoutingProject = RecordingRoutingProject,
	Stream = unknown,
>(runtime: RecordingRoutingServiceRuntime<Project, Stream>) {
	const {
		AUDIO_DEVICE_PREFERENCES_SETTING_KEY, RECORDING_CHANNEL_COUNT_MAXIMUM, RECORDING_DEFAULT_DEVICE_ID, RECORDING_DISPLAY_SOURCE_KEY,
		assignPreferredInputToTrack, engine, mediaDevices, microphoneMeterDeviceId,
		getMicrophoneMeterSession, invalidateMicrophoneMeter, normalizePreferredInputDeviceId, normalizePreferredOutputDeviceId,
		normalizeRecordingRouting, persistSetting, productSettingKey, getProject,
		projectSampleRate, publishDocumentSnapshot, recordingCapturePool, recordingRouteSourceKey,
		recordingRoutingSettingKey, setRecordingSourceOffset, setRecordingTrackInput, state,
		stopMicrophoneMetering, store, updatePreferences,
	} = runtime;
	let outputDeviceSelectionGeneration = 0;
	async function loadRecordingRouting(currentProject: Project | null = getProject()) {
		if (!currentProject) {
			state.recordingRouting = normalizeRecordingRouting();
			state.recordingDevices = [];
			state.recordingRouteHealth = {};
			return state.recordingRouting;
		}
		let saved: unknown = null;
		try {
			saved = await store.loadSetting(recordingRoutingSettingKey(currentProject.id), null);
		} catch {
			// Local routing is optional and must never prevent a project from opening.
		}
		const storedRouting = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
		state.recordingRouting = normalizeRecordingRouting(storedRouting, currentProject.tracks);
		state.recordingRouteHealth = Object.fromEntries(Object.keys(state.recordingRouting.routes)
			.map((trackId) => [trackId, 'unavailable']));
		updateRecordingDeviceRows();
		syncRecordingPoolSnapshot();
		return state.recordingRouting;
	}

	function persistRecordingRouting() {
		const project = getProject();
		if (!project) return Promise.resolve(state.recordingRouting);
		return persistSetting(recordingRoutingSettingKey(project.id), state.recordingRouting, { policy: 'required' })
			.then(() => state.recordingRouting);
	}

	async function requestInputAccess() {
		if (!mediaDevices?.getUserMedia) throw new Error('Hardware audio recording is not supported in this browser.');
		const sampleRate = projectSampleRate();
		const opened: string[] = [];
		const failures: unknown[] = [];
		try {
			await recordingCapturePool.acquireHardware(RECORDING_DEFAULT_DEVICE_ID, { channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM, sampleRate });
			opened.push(RECORDING_DEFAULT_DEVICE_ID);
		} catch (error) {
			failures.push(error);
		}
		await refreshRecordingInputs({ probe: false });
		const deviceIds = state.recordingDevices
			.map((device) => device.deviceId)
			.filter((deviceId) => deviceId && deviceId !== RECORDING_DEFAULT_DEVICE_ID);
		const results = await Promise.allSettled(deviceIds.map((deviceId) => (
			recordingCapturePool.acquireHardware(deviceId, { channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM, sampleRate })
		)));
		for (let index = 0; index < results.length; index += 1) {
			const result = results[index];
			if (result?.status === 'fulfilled') opened.push(deviceIds[index]);
			else if (result) failures.push(result.reason);
		}
		state.audioInputAccess = opened.length > 0;
		syncRecordingPoolSnapshot();
		await refreshRecordingInputs({ probe: false });
		if (!state.recorder) releaseUnretainedRecordingInputs();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		if (!opened.length && failures[0]) throw failures[0];
		return state.recordingDevices;
	}

	async function refreshRecordingInputs({ probe = true }: Pick<RecordingRoutingRefreshOptions, 'probe'> = {}) {
		return refreshAudioDevices({ probe });
	}

	async function refreshAudioDevices({
		probe = true,
		publish = true,
		nativeInventory = null,
	}: RecordingRoutingRefreshOptions = {}) {
		const webInputs: RecordingRoutingDeviceRow[] = [];
		const webOutputs: RecordingRoutingDeviceRow[] = [];
		if (mediaDevices?.enumerateDevices) {
			const devices = await mediaDevices.enumerateDevices();
			for (const device of devices || []) {
				if (!device?.deviceId) continue;
				const row = {
					deviceId: String(device.deviceId),
					label: String(device.label || ''),
					groupId: String(device.groupId || ''),
				};
				if (device.kind === 'audioinput') webInputs.push(row);
				else if (device.kind === 'audiooutput' && row.deviceId !== 'default') webOutputs.push(row);
			}
		}
		const discoveredInputs = uniqueDeviceRows([...webInputs, ...(nativeInventory?.inputs || [])]);
		const discoveredOutputs = uniqueDeviceRows([...webOutputs, ...(nativeInventory?.outputs || [])]);
		state.recordingEnumeratedDeviceIds = new Set(discoveredInputs.map((device) => device.deviceId));
		if (discoveredInputs.some((device) => device.label)) state.audioInputAccess = true;
		updateRecordingDeviceRows(discoveredInputs);
		state.audioInputDevices = Object.freeze(state.recordingDevices.map((device, index) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || `Audio input ${index + 1}`,
			channelCount: device.channelCount,
			status: device.status,
		})));
		state.audioOutputDevices = Object.freeze(discoveredOutputs.map((device, index) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || `Audio output ${index + 1}`,
			groupId: device.groupId || '',
			isDefault: device.isDefault === true,
		})));
		if (probe) {
			await Promise.allSettled(webInputs.map((device) => recordingCapturePool.acquireHardware(device.deviceId, {
				channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM,
				sampleRate: projectSampleRate(),
			})));
			syncRecordingPoolSnapshot();
			if (!state.recorder) releaseUnretainedRecordingInputs();
			syncRecordingPoolSnapshot();
			updateRecordingDeviceRows(discoveredInputs);
			state.audioInputDevices = Object.freeze(state.recordingDevices.map((device) => Object.freeze({
				deviceId: device.deviceId,
				label: device.label,
				channelCount: device.channelCount,
				status: device.status,
			})));
		}
		await reconcilePreferredOutputDevice();
		if (publish) publishDocumentSnapshot();
		return state.recordingDevices;
	}

	async function setPreferredInputDevice(deviceId: string) {
		const normalized = normalizePreferredInputDeviceId(deviceId);
		if (normalized !== RECORDING_DEFAULT_DEVICE_ID
			&& normalized !== RECORDING_DISPLAY_SOURCE_KEY
			&& !state.audioInputDevices.some((device) => device.deviceId === normalized)) {
			throw new Error('The selected audio input is unavailable.');
		}
		if (normalized === RECORDING_DISPLAY_SOURCE_KEY && !mediaDevices?.getDisplayMedia) {
			throw new Error('Display audio capture is not supported in this browser.');
		}
		await keepSelectedRecordingInputsOpen();
		const selectedTrackId = state.selectedTrackId;
		const selectedRoute = selectedTrackId ? state.recordingRouting.routes[selectedTrackId] : null;
		const previousSourceKey = state.preferredInputDeviceId === RECORDING_DISPLAY_SOURCE_KEY
			? RECORDING_DISPLAY_SOURCE_KEY : `device:${state.preferredInputDeviceId}`;
		const selectedTrack = getProject()?.tracks.find((track) => track.id === selectedTrackId);
		const previousRouting = state.recordingRouting;
		if (!state.recorder && !state.recordingStarting && !state.timedRecordingPreparing && !state.timedRecording
			&& selectedTrack && selectedRoute?.channelStart === 0
			&& recordingRouteSourceKey(selectedRoute) === previousSourceKey) {
			// Selecting the default must also move the matching active route. Keep
			// display acquisition on the separate chooser action (or Record).
			state.recordingRouting = setRecordingTrackRoute(state.recordingRouting, selectedTrack, {
				...(normalized === RECORDING_DISPLAY_SOURCE_KEY
					? { kind: 'display' }
					: { kind: 'device', deviceId: normalized,
						deviceLabel: state.audioInputDevices.find((device) => device.deviceId === normalized)?.label || '' }),
				channelStart: 0,
				channelCount: state.preferredInputChannelCount,
			});
		}
		state.preferredInputDeviceId = normalized;
		await Promise.all([
			persistAudioDevicePreferences(),
			state.recordingRouting === previousRouting ? Promise.resolve() : persistRecordingRouting(),
		]);
		if (normalized !== RECORDING_DISPLAY_SOURCE_KEY) {
			await recordingCapturePool.acquireHardware(normalized, {
				channelCount: state.preferredInputChannelCount,
				sampleRate: projectSampleRate(),
			});
		}
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return normalized;
	}

	async function configureDisplayInput() {
		if (!mediaDevices?.getDisplayMedia) throw new Error('Display audio capture is not supported in this browser.');
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			throw new Error('The display source cannot be changed while recording is active.');
		}
		await keepSelectedRecordingInputsOpen();
		const hasDisplay = Boolean(recordingCapturePool.getDisplay?.());
		const stream = hasDisplay && typeof recordingCapturePool.replaceDisplay === 'function'
			? await recordingCapturePool.replaceDisplay()
			: await recordingCapturePool.acquireDisplay();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return stream;
	}

	function keepSelectedRecordingInputsOpen() {
		if (state.preferences.recording.retainInputs) return Promise.resolve(state.preferences);
		return updatePreferences({ recording: { retainInputs: true } });
	}

	async function setPreferredInputChannelCount(channelCount: number) {
		const normalized = Number(channelCount) === 2 ? 2 : 1;
		state.preferredInputChannelCount = normalized;
		const selectedTrackId = state.selectedTrackId;
		if (selectedTrackId && !state.recordingRouting.routes[selectedTrackId]) {
			assignPreferredInputToTrack(selectedTrackId);
		}
		const selectedRoute = selectedTrackId ? state.recordingRouting.routes[selectedTrackId] : null;
		if (selectedTrackId && selectedRoute
			&& (selectedRoute.kind === 'display'
				? state.preferredInputDeviceId === RECORDING_DISPLAY_SOURCE_KEY
				: selectedRoute.deviceId === state.preferredInputDeviceId)
			&& selectedRoute.channelStart === 0
			&& selectedRoute.channelCount !== normalized) {
			try {
				await setRecordingTrackInput(selectedTrackId, {
					...selectedRoute,
					channelCount: normalized,
				});
			} catch {
				// Keep the preference for new tracks when the selected route cannot use it.
			}
		}
		publishDocumentSnapshot();
		await persistAudioDevicePreferences();
		return normalized;
	}

	async function setAudioOutputDevice(deviceId: string) {
		const normalized = normalizePreferredOutputDeviceId(deviceId);
		if (normalized && !state.audioOutputDevices.some((device) => device.deviceId === normalized)) {
			throw new Error('The selected audio output is unavailable.');
		}
		const generation = ++outputDeviceSelectionGeneration;
		const previous = state.preferredOutputDeviceId;
		if (normalized.startsWith('native:')) {
			state.preferredOutputDeviceId = normalized;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'available';
			await persistAudioDevicePreferences();
			if (generation === outputDeviceSelectionGeneration) publishDocumentSnapshot();
			return normalized;
		}
		try {
			const result = await Promise.resolve(engine.setOutputDevice?.(normalized));
			if (generation !== outputDeviceSelectionGeneration) return normalized;
			state.preferredOutputDeviceId = normalized;
			state.activeOutputDeviceId = result?.activeDeviceId ?? normalized;
			state.audioOutputStatus = normalized ? 'active' : 'default';
			await persistAudioDevicePreferences();
			if (generation === outputDeviceSelectionGeneration) publishDocumentSnapshot();
			return normalized;
		} catch (error) {
			if (generation === outputDeviceSelectionGeneration) {
				const errorName = (error as Readonly<{ name?: string }> | null)?.name;
				state.preferredOutputDeviceId = previous;
				state.audioOutputStatus = errorName === 'NotSupportedError'
					? 'unsupported'
					: errorName === 'NotAllowedError' || errorName === 'SecurityError'
						? 'denied'
						: 'error';
				publishDocumentSnapshot();
			}
			throw error;
		}
	}

	async function reconcilePreferredOutputDevice() {
		const generation = outputDeviceSelectionGeneration;
		const preferred = state.preferredOutputDeviceId;
		if (!preferred) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			if (generation !== outputDeviceSelectionGeneration) return;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'default';
			return;
		}
		const available = state.audioOutputDevices.some((device) => device.deviceId === preferred);
		if (!available) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			if (generation !== outputDeviceSelectionGeneration) return;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'unavailable';
			return;
		}
		if (preferred.startsWith('native:')) {
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'available';
			return;
		}
		try {
			const result = await Promise.resolve(engine.setOutputDevice?.(preferred));
			if (generation !== outputDeviceSelectionGeneration) return;
			state.activeOutputDeviceId = result?.activeDeviceId ?? preferred;
			state.audioOutputStatus = 'active';
		} catch (error) {
			if (generation !== outputDeviceSelectionGeneration) return;
			const errorName = (error as Readonly<{ name?: string }> | null)?.name;
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			if (generation !== outputDeviceSelectionGeneration) return;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = errorName === 'NotSupportedError' ? 'unsupported' : 'denied';
		}
	}

	function persistAudioDevicePreferences() {
		return persistSetting(productSettingKey(AUDIO_DEVICE_PREFERENCES_SETTING_KEY), {
			inputDeviceId: state.preferredInputDeviceId,
			inputChannelCount: state.preferredInputChannelCount,
			outputDeviceId: state.preferredOutputDeviceId,
		});
	}

	function updateRecordingDeviceRows(discovered: readonly RecordingRoutingDeviceRow[] = state.recordingDevices) {
		const rows = new Map<string, RecordingRoutingDeviceRow>();
		for (const device of discovered || []) {
			if (!device?.deviceId) continue;
			rows.set(device.deviceId, { ...device });
		}
		for (const route of Object.values(state.recordingRouting.routes || {})) {
			if (route.kind !== 'device' || rows.has(route.deviceId)) continue;
			rows.set(route.deviceId, {
				deviceId: route.deviceId,
				label: route.deviceLabel || (route.deviceId === RECORDING_DEFAULT_DEVICE_ID ? 'Default audio input' : 'Missing audio input'),
			});
		}
		for (const source of state.recordingPoolSources) {
			if (source.kind !== 'device' || !source.deviceId) continue;
			const existing = rows.get(source.deviceId) || { deviceId: source.deviceId, label: '' };
			rows.set(source.deviceId, { ...existing, channelCount: source.channelCount });
		}
		state.recordingDevices = Object.freeze([...rows.values()].map((device) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || (device.deviceId === RECORDING_DEFAULT_DEVICE_ID ? 'Default audio input' : 'Audio input'),
			groupId: device.groupId || '',
			isDefault: device.isDefault === true,
			channels: Object.freeze([...(device.channels || [])]),
			channelCount: Math.max(0, Number(device.channelCount) || 0),
			status: state.recordingPoolSources.some((source) => source.key === `device:${device.deviceId}`)
				? 'open'
				: state.recordingEnumeratedDeviceIds.has(device.deviceId) || device.deviceId === RECORDING_DEFAULT_DEVICE_ID
					? 'available'
					: 'unavailable',
		})));
	}

	function uniqueDeviceRows<Device extends RecordingRoutingDeviceRow>(devices: readonly Device[]): Device[] {
		const rows = new Map<string, Device>();
		for (const device of devices) {
			if (device?.deviceId && !rows.has(device.deviceId)) rows.set(device.deviceId, device);
		}
		return [...rows.values()];
	}

	async function setRecordingSourceLatency(sourceKey: string, value: number) {
		state.recordingRouting = setRecordingSourceOffset(state.recordingRouting, sourceKey, value);
		publishDocumentSnapshot();
		await persistRecordingRouting();
		return state.recordingRouting.offsets[sourceKey];
	}

	async function setRetainInputs(enabled: boolean) {
		const retainInputs = Boolean(enabled);
		await updatePreferences({ recording: { retainInputs } });
		if (retainInputs) state.recordingReleaseAfterStop = false;
		else if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			state.recordingReleaseAfterStop = true;
		}
		else releaseUnretainedRecordingInputs();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return retainInputs;
	}

	function releaseInputs() {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recordingFinishing) return false;
		if (state.microphoneMetering) {
			state.microphoneMetering = false;
			invalidateMicrophoneMeter();
			stopMicrophoneMetering({ releaseInput: false });
			void persistSetting('microphone-metering', false);
		}
		const released = recordingCapturePool.releaseAll();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return released;
	}

	function releaseUnretainedRecordingInputs({ force = false }: Readonly<{ readonly force?: boolean }> = {}) {
		if (!force && state.preferences.recording.retainInputs) return false;
		if (!state.microphoneMetering) return recordingCapturePool.releaseAll();
		const meterDeviceId = getMicrophoneMeterSession()?.deviceId || microphoneMeterDeviceId();
		let released = false;
		for (const source of recordingCapturePool.getSnapshot?.() || []) {
			if (source.kind === 'display') {
				released = recordingCapturePool.releaseDisplay() || released;
			} else if (source.kind === 'device' && source.deviceId && source.deviceId !== meterDeviceId) {
				released = recordingCapturePool.releaseHardware(source.deviceId) || released;
			}
		}
		return released;
	}

	function syncRecordingPoolSnapshot() {
		state.recordingPoolSources = Object.freeze(recordingCapturePool.getSnapshot?.() || []);
		if (!state.recorder) {
			const open = new Map(state.recordingPoolSources.map((source) => [source.key, source]));
			for (const [trackId, route] of Object.entries(state.recordingRouting.routes || {})) {
				const previous = state.recordingRouteHealth[trackId];
				const source = open.get(recordingRouteSourceKey(route));
				state.recordingRouteHealth[trackId] = source
					? route.kind === 'display' || route.channelStart + route.channelCount <= source.channelCount ? 'open' : 'skipped'
					: previous === 'disconnected' ? 'disconnected' : 'unavailable';
			}
		}
		updateRecordingDeviceRows();
	}
	return Object.freeze({
		loadRecordingRouting,
		persistRecordingRouting,
		requestInputAccess,
		refreshRecordingInputs,
		refreshAudioDevices,
		setPreferredInputDevice,
		configureDisplayInput,
		keepSelectedRecordingInputsOpen,
		setPreferredInputChannelCount,
		setAudioOutputDevice,
		reconcilePreferredOutputDevice,
		persistAudioDevicePreferences,
		updateRecordingDeviceRows,
		setRecordingSourceLatency,
		setRetainInputs,
		releaseInputs,
		releaseUnretainedRecordingInputs,
		syncRecordingPoolSnapshot,
	});
}
