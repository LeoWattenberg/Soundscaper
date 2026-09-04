/* SPDX-License-Identifier: AGPL-3.0-only */

// Hardware and display capture streams outlive the recording controllers that
// use them, so a pool owns them instead: it hands out live streams, replaces
// one that has ended, and stops a stream's tracks only when that source is
// replaced, released, or the pool itself is disposed. Split out of
// recording.js; no behaviour changes here.

import {
	DISPLAY_INPUT_KEY,
	DISPLAY_REPLACEMENT_KEY,
	exposedAudioChannelCount,
	hardwareInputKey,
	hasLiveTrack,
	normalizeDeviceId,
	normalizeRecordingChannelCount,
	requestDisplayInput,
	requestHardwareInput,
	stopStream,
} from './recording-inputs.js';

/**
 * Keep hardware/display streams alive across controller lifetimes. The pool
 * owns every stream returned by its acquire methods and stops those tracks only
 * when a source is replaced, released, or the pool is disposed.
 */
export function createRecordingCapturePool(options = {}) {
	const requestHardware = options.requestHardwareInput || requestHardwareInput;
	const requestDisplay = options.requestDisplayInput || requestDisplayInput;
	const onChange = typeof options.onChange === 'function' ? options.onChange : null;
	const entries = new Map();
	const pending = new Map();
	const generations = new Map();
	let disposed = false;

	return {
		get size() { return entries.size; },
		get hasInputs() { return entries.size > 0; },
		acquireHardware,
		acquireDisplay,
		replaceDisplay,
		getHardware(deviceId) {
			return getLiveEntry(hardwareInputKey(deviceId), 'device')?.stream || null;
		},
		getDisplay() {
			return getLiveEntry(DISPLAY_INPUT_KEY, 'display')?.stream || null;
		},
		getSnapshot() {
			pruneEndedEntries();
			return [...entries.values()].map(snapshotEntry);
		},
		releaseHardware(deviceId) {
			return releaseEntry(hardwareInputKey(deviceId));
		},
		releaseDisplay() {
			return releaseEntry(DISPLAY_INPUT_KEY);
		},
		releaseAll,
		dispose() {
			disposed = true;
			return releaseAll();
		},
	};

	async function acquireHardware(deviceId, acquireOptions = {}) {
		if (disposed) throw new Error('The recording capture pool has been disposed.');
		const normalizedDeviceId = normalizeDeviceId(deviceId);
		const key = hardwareInputKey(normalizedDeviceId);
		const requestedChannels = normalizeRecordingChannelCount(acquireOptions.channelCount ?? 2);
		if (pending.has(key)) {
			await pending.get(key);
			return acquireHardware(normalizedDeviceId, acquireOptions);
		}
		const current = getLiveEntry(key, 'device');
		if (current && current.channelCount >= requestedChannels) return current.stream;
		const generation = generationFor(key);

		const acquisition = Promise.resolve().then(async () => {
			const stream = await requestHardware({ ...acquireOptions, deviceId: normalizedDeviceId, channelCount: requestedChannels });
			if (disposed || generation !== generationFor(key)) {
				stopStream(stream);
				throw new Error('The recording input was released while it was opening.');
			}
			if (!hasLiveTrack(stream, 'audio')) {
				stopStream(stream);
				throw new Error('The selected hardware input did not provide a live audio track.');
			}
			const channelCount = exposedAudioChannelCount(stream);
			const retained = getLiveEntry(key, 'device');
			if (retained && channelCount <= retained.channelCount && channelCount < requestedChannels) {
				stopStream(stream);
				return retained.stream;
			}
			setEntry(key, {
				key,
				kind: 'device',
				deviceId: normalizedDeviceId,
				stream,
				channelCount,
			});
			return stream;
		}).finally(() => pending.delete(key));
		pending.set(key, acquisition);
		return acquisition;
	}

	async function acquireDisplay(acquireOptions = {}) {
		if (disposed) throw new Error('The recording capture pool has been disposed.');
		if (pending.has(DISPLAY_INPUT_KEY)) return pending.get(DISPLAY_INPUT_KEY);
		const current = getLiveEntry(DISPLAY_INPUT_KEY, 'display');
		if (current) return current.stream;
		const generation = generationFor(DISPLAY_INPUT_KEY);

		const acquisition = Promise.resolve().then(async () => {
			const stream = await requestDisplay(acquireOptions);
			if (disposed || generation !== generationFor(DISPLAY_INPUT_KEY)) {
				stopStream(stream);
				throw new Error('The display input was released while it was opening.');
			}
			if (!hasLiveTrack(stream, 'audio')) {
				stopStream(stream);
				throw new Error('Display capture did not include a live audio track.');
			}
			if (!hasLiveTrack(stream, 'video')) {
				stopStream(stream);
				throw new Error('Display capture did not include its required live video track.');
			}
			setEntry(DISPLAY_INPUT_KEY, {
				key: DISPLAY_INPUT_KEY,
				kind: 'display',
				stream,
				channelCount: exposedAudioChannelCount(stream),
			});
			return stream;
		}).finally(() => pending.delete(DISPLAY_INPUT_KEY));
		pending.set(DISPLAY_INPUT_KEY, acquisition);
		return acquisition;
	}

	async function replaceDisplay(acquireOptions = {}) {
		if (disposed) throw new Error('The recording capture pool has been disposed.');
		if (pending.has(DISPLAY_REPLACEMENT_KEY)) return pending.get(DISPLAY_REPLACEMENT_KEY);
		if (pending.has(DISPLAY_INPUT_KEY)) await pending.get(DISPLAY_INPUT_KEY);
		const generation = generationFor(DISPLAY_INPUT_KEY);
		const replacement = Promise.resolve().then(async () => {
			const stream = await requestDisplay(acquireOptions);
			if (disposed || generation !== generationFor(DISPLAY_INPUT_KEY)) {
				stopStream(stream);
				throw new Error('The display input was released while it was opening.');
			}
			if (!hasLiveTrack(stream, 'audio')) {
				stopStream(stream);
				throw new Error('Display capture did not include a live audio track.');
			}
			if (!hasLiveTrack(stream, 'video')) {
				stopStream(stream);
				throw new Error('Display capture did not include its required live video track.');
			}
			setEntry(DISPLAY_INPUT_KEY, {
				key: DISPLAY_INPUT_KEY,
				kind: 'display',
				stream,
				channelCount: exposedAudioChannelCount(stream),
			});
			return stream;
		}).finally(() => pending.delete(DISPLAY_REPLACEMENT_KEY));
		pending.set(DISPLAY_REPLACEMENT_KEY, replacement);
		return replacement;
	}

	function getLiveEntry(key, kind) {
		const entry = entries.get(key);
		if (!entry) return null;
		const live = hasLiveTrack(entry.stream, 'audio') && (kind !== 'display' || hasLiveTrack(entry.stream, 'video'));
		if (live) return entry;
		removeEntry(key, entry, true);
		return null;
	}

	function setEntry(key, entry) {
		const previous = entries.get(key);
		entries.set(key, entry);
		for (const track of entry.stream.getTracks?.() || []) {
			track.addEventListener?.('ended', () => removeEntry(key, entry, true), { once: true });
		}
		if (previous && previous !== entry) stopStream(previous.stream);
		emitChange();
	}

	function releaseEntry(key) {
		const wasPending = pending.has(key);
		invalidate(key);
		const entry = entries.get(key);
		if (!entry) return wasPending;
		removeEntry(key, entry, true);
		return true;
	}

	function removeEntry(key, expected, stopTracks) {
		if (entries.get(key) !== expected) return false;
		entries.delete(key);
		if (stopTracks) stopStream(expected.stream);
		emitChange();
		return true;
	}

	function releaseAll() {
		const keys = new Set([...entries.keys(), ...pending.keys()]);
		const released = keys.size;
		for (const key of keys) invalidate(key);
		for (const entry of entries.values()) stopStream(entry.stream);
		entries.clear();
		if (released) emitChange();
		return released;
	}

	function pruneEndedEntries() {
		for (const [key, entry] of entries) {
			getLiveEntry(key, entry.kind);
		}
	}

	function emitChange() {
		onChange?.([...entries.values()].map(snapshotEntry));
	}

	function generationFor(key) {
		return generations.get(key) || 0;
	}

	function invalidate(key) {
		generations.set(key, generationFor(key) + 1);
	}
}


function snapshotEntry(entry) {
	return Object.freeze({
		key: entry.key,
		kind: entry.kind,
		...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
		channelCount: entry.channelCount,
		state: 'open',
	});
}

