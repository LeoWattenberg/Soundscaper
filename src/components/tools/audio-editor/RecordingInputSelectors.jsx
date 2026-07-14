import React from 'react';

const DISPLAY_SOURCE_KEY = 'display';
const DEVICE_SOURCE_PREFIX = 'device:';

export default function RecordingInputSelectors({
	controller,
	recordingInputs,
	track,
	copy,
	run,
	disabled = false,
	surface = 'track',
}) {
	if (!track || track.type === 'label') return null;
	const inputs = recordingInputs || {};
	const devices = Array.isArray(inputs.devices) ? inputs.devices : [];
	const routes = inputs.routes || {};
	const route = routes[track.id] || null;
	const sourceKey = routeSourceKey(route);
	const channelCount = track.channelCount === 1 ? 1 : 2;
	const sourceOptions = buildSourceOptions({ devices, route, routes, track, copy });
	const availableChannels = sourceChannelCount(sourceKey, devices, route, channelCount);
	const channelOptions = sourceKey
		? buildChannelOptions({ sourceKey, availableChannels, channelCount, routes, trackId: track.id, route })
		: [];
	const health = inputs.health?.[track.id] || routeHealth(route, devices, inputs.sources);
	const healthLabel = recordingInputHealthLabel(copy, health);
	const controlsDisabled = disabled || typeof controller.actions.recording.setTrackInput !== 'function';
	const setRoute = (nextRoute) => run(() => controller.actions.recording.setTrackInput(track.id, nextRoute));
	const handleSourceChange = (event) => {
		const nextSourceKey = event.currentTarget.value;
		if (!nextSourceKey) {
			setRoute(null);
			return;
		}
		const nextAvailableChannels = sourceChannelCount(nextSourceKey, devices, null, channelCount);
		const nextChannels = buildChannelOptions({
			sourceKey: nextSourceKey,
			availableChannels: nextAvailableChannels,
			channelCount,
			routes,
			trackId: track.id,
			route: null,
		});
		const firstChannel = nextChannels.find((option) => !option.disabled)?.channelStart ?? 0;
		if (nextSourceKey === DISPLAY_SOURCE_KEY) {
			setRoute({
				kind: 'display',
				label: copy.recordingDesktopAudio,
				channelStart: firstChannel,
				channelCount,
			});
			return;
		}
		const deviceId = nextSourceKey.slice(DEVICE_SOURCE_PREFIX.length);
		const device = devices.find((candidate) => candidate.deviceId === deviceId);
		setRoute({
			kind: 'device',
			deviceId,
			deviceLabel: device?.label || '',
			channelStart: firstChannel,
			channelCount,
		});
	};
	const handleChannelChange = (event) => {
		const channelStart = Number(event.currentTarget.value);
		if (!route || !Number.isSafeInteger(channelStart)) return;
		setRoute({ ...route, channelStart, channelCount });
	};
	const stopTrackSelection = (event) => event.stopPropagation();

	return (
		<div
			className={`kw-recording-input-selectors kw-recording-input-selectors--${surface}`}
			data-recording-input-selectors
			data-recording-input-track={track.id}
			data-recording-input-health={health || 'unassigned'}
			onClick={stopTrackSelection}
			onDoubleClick={stopTrackSelection}
		>
			<label>
				<span className="kw-audio-editor-sr-only">{copy.recordingInputSource}: {track.name}</span>
				<select
					aria-label={`${copy.recordingInputSource}: ${track.name}`}
					disabled={controlsDisabled}
					value={sourceKey}
					onChange={handleSourceChange}
				>
					{sourceOptions.map((option) => (
						<option key={option.value || 'unassigned'} value={option.value} disabled={option.disabled}>{option.label}</option>
					))}
				</select>
			</label>
			<label>
				<span className="kw-audio-editor-sr-only">{copy.recordingInputChannel}: {track.name}</span>
				<select
					aria-label={`${copy.recordingInputChannel}: ${track.name}`}
					disabled={controlsDisabled || !route || !channelOptions.length}
					value={route?.channelStart ?? ''}
					onChange={handleChannelChange}
				>
					{!route && <option value="">{copy.recordingInputChannel}</option>}
					{route && !channelOptions.length && <option value={route.channelStart ?? 0}>{copy.recordingNoChannels}</option>}
					{channelOptions.map((option) => (
						<option key={option.channelStart} value={option.channelStart} disabled={option.disabled}>
							{channelOptionLabel(copy, option.channelStart, channelCount)}
						</option>
					))}
				</select>
			</label>
			<span
				className="kw-recording-input-selectors__health"
				role="status"
				aria-label={`${copy.recordingInputStatus}: ${healthLabel}`}
				title={healthLabel}
			/>
		</div>
	);
}

function buildSourceOptions({ devices, route, routes, track, copy }) {
	const options = [{ value: '', label: copy.recordingInputUnassigned, disabled: false }];
	const currentSourceKey = routeSourceKey(route);
	const displaySupported = typeof navigator === 'undefined'
		|| typeof navigator.mediaDevices?.getDisplayMedia === 'function';
	const displayChannels = buildChannelOptions({
		sourceKey: DISPLAY_SOURCE_KEY,
		availableChannels: 2,
		channelCount: track.channelCount === 1 ? 1 : 2,
		routes,
		trackId: track.id,
		route: currentSourceKey === DISPLAY_SOURCE_KEY ? route : null,
	});
	devices.forEach((device, index) => {
		const key = `${DEVICE_SOURCE_PREFIX}${device.deviceId}`;
		const unavailable = ['unavailable', 'disconnected', 'ended'].includes(device.status);
		const channels = buildChannelOptions({
			sourceKey: key,
			availableChannels: Math.max(track.channelCount === 1 ? 1 : 2, Number(device.channelCount) || 0),
			channelCount: track.channelCount === 1 ? 1 : 2,
			routes,
			trackId: track.id,
			route: currentSourceKey === key ? route : null,
		});
		options.push({
			value: key,
			label: deviceOptionLabel(copy, device, index),
			disabled: (unavailable && currentSourceKey !== key) || !channels.some((option) => !option.disabled),
		});
	});
	if (route?.kind === 'device' && !devices.some((device) => device.deviceId === route.deviceId)) {
		options.push({
			value: currentSourceKey,
			label: `${route.deviceLabel || copy.recordingInputUnknownDevice} (${copy.recordingInputUnavailable})`,
			disabled: false,
		});
	}
	options.push({
		value: DISPLAY_SOURCE_KEY,
		label: copy.recordingDesktopAudio,
		disabled: !displaySupported || !displayChannels.some((option) => !option.disabled),
	});
	return options;
}

function buildChannelOptions({ sourceKey, availableChannels, channelCount, routes, trackId, route }) {
	const occupied = new Set();
	for (const [candidateTrackId, candidateRoute] of Object.entries(routes || {})) {
		if (candidateTrackId === trackId || routeSourceKey(candidateRoute) !== sourceKey) continue;
		const start = Number(candidateRoute.channelStart) || 0;
		const count = candidateRoute.channelCount === 1 ? 1 : 2;
		for (let channel = start; channel < start + count; channel += 1) occupied.add(channel);
	}
	const maximum = Math.max(channelCount, Number(availableChannels) || 0, (Number(route?.channelStart) || 0) + channelCount);
	const options = [];
	for (let channelStart = 0; channelStart + channelCount <= maximum; channelStart += channelCount) {
		if (channelCount === 2 && channelStart % 2 !== 0) continue;
		const conflicting = Array.from({ length: channelCount }, (_, index) => occupied.has(channelStart + index)).some(Boolean);
		options.push({ channelStart, disabled: conflicting });
	}
	return options;
}

function sourceChannelCount(sourceKey, devices, route, minimum) {
	if (sourceKey === DISPLAY_SOURCE_KEY) return Math.max(2, minimum);
	if (!sourceKey.startsWith(DEVICE_SOURCE_PREFIX)) return minimum;
	const deviceId = sourceKey.slice(DEVICE_SOURCE_PREFIX.length);
	const device = devices.find((candidate) => candidate.deviceId === deviceId);
	return Math.max(minimum, Number(device?.channelCount) || 0, (Number(route?.channelStart) || 0) + minimum);
}

function routeSourceKey(route) {
	if (!route) return '';
	if (route.kind === 'display') return DISPLAY_SOURCE_KEY;
	if (route.kind === 'device' && route.deviceId) return `${DEVICE_SOURCE_PREFIX}${route.deviceId}`;
	return '';
}

function routeHealth(route, devices, sources = []) {
	if (!route) return 'unassigned';
	const sourceKey = routeSourceKey(route);
	const source = (sources || []).find((candidate) => candidate.key === sourceKey || candidate.sourceKey === sourceKey);
	if (source?.status || source?.state) return source.status || source.state;
	if (route.kind === 'device') {
		const device = devices.find((candidate) => candidate.deviceId === route.deviceId);
		if (!device) return 'unavailable';
		return device.status || 'available';
	}
	return 'available';
}

function recordingInputHealthLabel(copy, health) {
	return {
		available: copy.recordingInputAvailable,
		open: copy.recordingInputOpen,
		opening: copy.recordingInputOpening,
		recording: copy.recordingInputRecording,
		skipped: copy.recordingInputSkipped,
		unavailable: copy.recordingInputUnavailable,
		disconnected: copy.recordingInputDisconnected,
		ended: copy.recordingInputDisconnected,
		unassigned: copy.recordingInputUnassigned,
	}[health] || health || copy.recordingInputUnassigned;
}

function channelOptionLabel(copy, channelStart, channelCount) {
	if (channelCount === 1) return copy.recordingMonoChannel.replace('{channel}', String(channelStart + 1));
	return copy.recordingStereoChannels
		.replace('{left}', String(channelStart + 1))
		.replace('{right}', String(channelStart + 2));
}

function deviceOptionLabel(copy, device, index) {
	const name = device.label || copy.recordingInputUnnamedDevice.replace('{number}', String(index + 1));
	if (!['unavailable', 'disconnected', 'ended'].includes(device.status)) return name;
	return `${name} (${copy.recordingInputUnavailable})`;
}
