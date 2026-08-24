/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_DEVICE_IO_CONTROL,
	NATIVE_DEVICE_IO_WORKLET_NAME,
} from './native-device-io-worklet.js';

const loaded = new WeakSet();
const loading = new WeakMap();

export async function ensureNativeDeviceIoWorklet(context) {
	if (loaded.has(context)) return;
	let pending = loading.get(context);
	if (!pending) {
		pending = Promise.resolve(workletUrl()).then((url) => context.audioWorklet.addModule(String(url)));
		loading.set(context, pending);
	}
	try { await pending; loaded.add(context); }
	finally { if (loading.get(context) === pending) loading.delete(context); }
}

export async function createNativeDeviceIoWorkletNode(context, options) {
	await ensureNativeDeviceIoWorklet(context);
	const Constructor = options.AudioWorkletNode || globalThis.AudioWorkletNode;
	if (typeof Constructor !== 'function') throw new Error('AudioWorkletNode is unavailable.');
	const direction = options.direction;
	const channelCount = options.channelCount;
	const node = new Constructor(context, NATIVE_DEVICE_IO_WORKLET_NAME, {
		numberOfInputs: direction === 'input' ? 0 : 1,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		processorOptions: {
			direction, channelCount, periodFrames: options.periodFrames, queueCapacity: options.queueCapacity,
		},
	});
	let generation = 0;
	let disposed = false;
	let calibrationSequence = 0;
	let calibration = null;
	node.port.onmessage = ({ data = {} } = {}) => {
		if (data.type === NATIVE_DEVICE_IO_CONTROL.transfer && transferReport(data)) {
			options.onTransfer?.(Object.freeze({
				framesTransferred: data.framesTransferred, lostFrames: data.lostFrames,
			}));
		} else if (data.type === NATIVE_DEVICE_IO_CONTROL.calibrationResult) settleCalibration(data);
		else if (data.type === NATIVE_DEVICE_IO_CONTROL.calibrationFailed) settleCalibration(data);
		else if (data.type === NATIVE_DEVICE_IO_CONTROL.closed) {
			failCalibration(new Error('The native audio device closed during calibration.'));
			options.onClose?.(data);
		} else if (data.type === NATIVE_DEVICE_IO_CONTROL.fault) {
			failCalibration(new Error('The native audio worklet faulted during calibration.'));
			options.onFault?.(data);
		}
	};
	node.port.start?.();
	return Object.freeze({
		node,
		attach(port, config) {
			if (disposed) throw new Error('The native device node is disposed.');
			if (!port || typeof port.postMessage !== 'function') throw new TypeError('A transferred native device port is required.');
			if (!Number.isSafeInteger(config.generation) || config.generation <= generation) throw new RangeError('The device generation must increase.');
			generation = config.generation;
			node.port.postMessage({ type: NATIVE_DEVICE_IO_CONTROL.attach, generation }, [port]);
			return generation;
		},
		revoke(reason = 'cancelled') {
			if (!generation) return 0;
			failCalibration(new Error('Native audio calibration was cancelled.'), true);
			const previous = generation;
			node.port.postMessage({ type: NATIVE_DEVICE_IO_CONTROL.revoke, generation, reason });
			generation = 0;
			return previous;
		},
		notifyPeerLoss() { return this.revoke('peer-loss'); },
		calibrate(config) {
			try {
				if (disposed) throw new Error('The native device node is disposed.');
				if (direction !== 'duplex') throw new Error('Latency calibration requires a duplex native route.');
				const maxFrames = boundedInteger(config?.maxFrames, 1, 1_048_576, 'calibration frame window');
				const timeoutMs = boundedInteger(config?.timeoutMs, 100, 5_000, 'calibration timeout');
				if (!generation) throw new Error('Latency calibration requires a bound native route.');
				if (calibration) throw new Error('Native audio calibration is already running.');
				const requestId = ++calibrationSequence;
				return new Promise((resolve, reject) => {
					const timer = globalThis.setTimeout(() => {
						if (calibration?.requestId !== requestId) return;
						failCalibration(new Error('Native audio calibration timed out.'), true);
					}, timeoutMs);
					calibration = { requestId, resolve, reject, timer };
					try {
						node.port.postMessage({ type: NATIVE_DEVICE_IO_CONTROL.calibrate, requestId, maxFrames });
					} catch (error) { failCalibration(asError(error)); }
				});
			} catch (error) { return Promise.reject(asError(error)); }
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			failCalibration(new Error('The native device node was disposed.'), true);
			if (generation) node.port.postMessage({ type: NATIVE_DEVICE_IO_CONTROL.revoke, generation, reason: 'cancelled' });
			generation = 0;
			node.port.onmessage = null;
			try { node.disconnect(); } catch { /* already disconnected */ }
		},
	});

	function settleCalibration(data) {
		if (!calibration || data?.requestId !== calibration.requestId) return;
		if (data.type === NATIVE_DEVICE_IO_CONTROL.calibrationResult
			&& exactKeys(data, ['type', 'requestId', 'calibrationFrames'])
			&& Number.isSafeInteger(data.calibrationFrames)
			&& data.calibrationFrames >= 0 && data.calibrationFrames <= 1_048_576) {
			const pending = calibration;
			calibration = null;
			globalThis.clearTimeout(pending.timer);
			pending.resolve(data.calibrationFrames);
			return;
		}
		const reason = exactKeys(data, ['type', 'requestId', 'reason'])
			&& typeof data.reason === 'string' && data.reason.length <= 64
			? data.reason : 'malformed-result';
		failCalibration(new Error(`Native audio calibration failed: ${reason}.`));
	}

	function failCalibration(error, notify = false) {
		if (!calibration) return;
		const pending = calibration;
		calibration = null;
		globalThis.clearTimeout(pending.timer);
		if (notify) {
			try { node.port.postMessage({
				type: NATIVE_DEVICE_IO_CONTROL.cancelCalibration, requestId: pending.requestId,
			}); } catch { /* the worklet is already gone */ }
		}
		pending.reject(error);
	}
}

async function workletUrl() {
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		return (await import('./native-device-io-worklet.js?worker&url')).default;
	}
	return new URL('./native-device-io-worklet.js', import.meta.url);
}

function boundedInteger(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`The native device ${label} is outside its bounds.`);
	}
	return value;
}

function transferReport(value) {
	return exactKeys(value, ['type', 'framesTransferred', 'lostFrames'])
		&& Number.isSafeInteger(value.framesTransferred) && value.framesTransferred >= 0
		&& Number.isSafeInteger(value.lostFrames) && value.lostFrames >= 0;
}

function exactKeys(value, keys) {
	return value && typeof value === 'object' && !Array.isArray(value)
		&& Reflect.ownKeys(value).length === keys.length
		&& Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function asError(value) { return value instanceof Error ? value : new Error(String(value)); }
