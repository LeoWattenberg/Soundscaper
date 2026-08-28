// @ts-check
/* Repository-owned browser spectral edit worker. SPDX-License-Identifier: AGPL-3.0-only */

import { applySpectralGain } from './spectral-edit.js';
import { initializePffft } from './pffft.js';

globalThis.onmessage = handleWorkerMessage;

/** @param {MessageEvent<unknown>} event */
function handleWorkerMessage({ data }) { void handleMessage(data); }

/** @param {unknown} data */
async function handleMessage(data) {
	try {
		await initializePffft();
		const request = isRecord(data) ? data : {};
		const channels = (Array.isArray(request.channels) ? request.channels : []).map(asFloat32Array);
		const options = isRecord(request.options) ? request.options : {};
		const output = applySpectralGain(channels, options);
		postWorkerMessage({ type: 'result', channels: output }, output.map((channel) => channel.buffer));
	} catch (error) {
		postWorkerMessage({
			type: 'error',
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/** @param {unknown} value */
function asFloat32Array(value) {
	if (value instanceof Float32Array) return value;
	if (value instanceof ArrayBuffer) return new Float32Array(value);
	if (isNumericArrayView(value)) return Float32Array.from(value);
	if (Array.isArray(value)) return Float32Array.from(value);
	throw new TypeError('Spectral edit worker channels must be numeric typed arrays.');
}

/**
 * @param {unknown} value
 * @returns {value is ArrayBufferView & ArrayLike<number>}
 */
function isNumericArrayView(value) {
	return ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value;
}

/**
 * @param {unknown} message
 * @param {Transferable[]} [transfer]
 */
function postWorkerMessage(message, transfer = []) {
	globalThis.postMessage(message, { transfer });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
