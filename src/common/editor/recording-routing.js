export const RECORDING_DISPLAY_SOURCE_KEY = 'display';
export const RECORDING_DEFAULT_DEVICE_ID = 'default';
export const RECORDING_ROUTING_SETTING_PREFIX = 'recording-input-routing-v1:';

export function recordingRoutingSettingKey(projectId) {
	if (typeof projectId !== 'string' || !projectId.trim()) throw new TypeError('A project ID is required for recording routes.');
	return `${RECORDING_ROUTING_SETTING_PREFIX}${projectId}`;
}

export function recordingRouteSourceKey(route) {
	const normalized = normalizeRecordingRoute(route);
	return normalized.kind === 'display' ? RECORDING_DISPLAY_SOURCE_KEY : `device:${normalized.deviceId}`;
}

export function normalizeRecordingRoute(route, track = null) {
	if (!route || typeof route !== 'object' || Array.isArray(route)) throw new TypeError('A recording route must be an object.');
	if (track != null && track.type === 'label') throw new TypeError('An audio track is required for recording input routing.');
	const channelCount = normalizeRouteChannelCount(route.channelCount ?? 1);
	if (route.kind === 'display') {
		return Object.freeze({
			kind: 'display',
			channelStart: 0,
			channelCount,
			label: String(route.label || 'Desktop / tab audio'),
		});
	}
	if (route.kind !== 'device') throw new RangeError(`Unsupported recording route kind: ${route.kind}.`);
	const deviceId = String(route.deviceId ?? '');
	if (!deviceId.trim()) throw new TypeError('A hardware recording route requires a device ID.');
	const channelStart = nonNegativeInteger(route.channelStart ?? 0, 'recording route channel');
	if (channelCount === 2 && channelStart % 2 !== 0) {
		throw new RangeError('Stereo recording routes must begin on an adjacent odd-numbered input pair.');
	}
	return Object.freeze({
		kind: 'device',
		deviceId,
		deviceLabel: String(route.deviceLabel || ''),
		channelStart,
		channelCount,
	});
}

export function normalizeRecordingRouting(value = {}, tracks = []) {
	const audioTracks = new Map((tracks || [])
		.filter((track) => track?.type !== 'label')
		.map((track) => [track.id, track]));
	const routes = {};
	for (const [trackId, route] of Object.entries(value?.routes || {})) {
		const track = audioTracks.get(trackId);
		if (!track) continue;
		try {
			const normalized = normalizeRecordingRoute(route, track);
			// Persisted local state can outlive tracks and older builds did not
			// necessarily enforce conflicts. Keep the first valid assignment instead
			// of allowing one stale duplicate to make the whole project unreadable.
			assertRecordingRouteConflicts({ ...routes, [trackId]: normalized });
			routes[trackId] = normalized;
		} catch {
			// Stale or malformed local routes must not make a project unreadable.
		}
	}
	const offsets = {};
	for (const [sourceKey, offset] of Object.entries(value?.offsets || {})) {
		if (!sourceKey) continue;
		offsets[sourceKey] = normalizeRecordingSourceOffset(offset);
	}
	return Object.freeze({ routes: Object.freeze(routes), offsets: Object.freeze(offsets) });
}

export function setRecordingTrackRoute(routing, track, route) {
	if (!track || track.type === 'label') throw new TypeError('An audio track is required for recording input routing.');
	if (typeof track.id !== 'string' || !track.id) throw new TypeError('A recording track ID is required.');
	const routes = { ...(routing?.routes || {}) };
	if (route == null) delete routes[track.id];
	else routes[track.id] = normalizeRecordingRoute(route, track);
	assertRecordingRouteConflicts(routes);
	return Object.freeze({
		routes: Object.freeze(routes),
		offsets: Object.freeze({ ...(routing?.offsets || {}) }),
	});
}

export function setRecordingSourceOffset(routing, sourceKey, offset) {
	if (typeof sourceKey !== 'string' || !sourceKey.trim()) throw new TypeError('A recording source key is required.');
	return Object.freeze({
		routes: Object.freeze({ ...(routing?.routes || {}) }),
		offsets: Object.freeze({ ...(routing?.offsets || {}), [sourceKey]: normalizeRecordingSourceOffset(offset) }),
	});
}

export function assertRecordingRouteConflicts(routes = {}) {
	const occupied = new Map();
	for (const [trackId, input] of Object.entries(routes)) {
		const route = normalizeRecordingRoute(input);
		const sourceKey = recordingRouteSourceKey(route);
		for (let channel = route.channelStart; channel < route.channelStart + route.channelCount; channel += 1) {
			const key = `${sourceKey}:${channel}`;
			if (occupied.has(key)) {
				throw new RangeError(`Recording input channel ${channel + 1} is already assigned to track ${occupied.get(key)}.`);
			}
			occupied.set(key, trackId);
		}
	}
	return true;
}

export function recordingChannelOptions(track, availableChannels, routes = {}) {
	const current = routes?.[track?.id] ? normalizeRecordingRoute(routes[track.id]) : null;
	const channelCount = current?.channelCount ?? 1;
	const maximum = nonNegativeInteger(availableChannels ?? 0, 'available recording channels');
	const occupied = new Set();
	for (const [trackId, input] of Object.entries(routes || {})) {
		if (trackId === track?.id) continue;
		const route = normalizeRecordingRoute(input);
		for (let channel = route.channelStart; channel < route.channelStart + route.channelCount; channel += 1) {
			occupied.add(`${recordingRouteSourceKey(route)}:${channel}`);
		}
	}
	const sourceKey = current ? recordingRouteSourceKey(current) : null;
	const options = [];
	for (let channelStart = 0; channelStart + channelCount <= maximum; channelStart += 1) {
		if (channelCount === 2 && channelStart % 2 !== 0) continue;
		const disabled = sourceKey ? Array.from({ length: channelCount }, (_, index) => (
			occupied.has(`${sourceKey}:${channelStart + index}`)
		)).some(Boolean) : false;
		options.push(Object.freeze({ channelStart, channelCount, disabled }));
	}
	return Object.freeze(options);
}

export function normalizeRecordingSourceOffset(value) {
	return Math.max(-500, Math.min(500, Number(value) || 0));
}

function normalizeRouteChannelCount(value) {
	const channelCount = Number(value);
	if (channelCount !== 1 && channelCount !== 2) throw new RangeError('Recording routes must contain one or two channels.');
	return channelCount;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative integer.`);
	return number;
}
