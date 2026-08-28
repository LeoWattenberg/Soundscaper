// @ts-check

import { processParametricEqChannelsWasm } from './destructive.js';
import { PARAMETRIC_EQ_WORKER_OPERATION } from './protocol.js';

globalThis.onmessage = handleWorkerMessage;

/** @param {MessageEvent<unknown>} event */
function handleWorkerMessage({ data }) { void handleMessage(data); }

/** @param {unknown} data */
async function handleMessage(data) {
	const request = isRecord(data) ? data : {};
	try {
		if (request.operation !== PARAMETRIC_EQ_WORKER_OPERATION && request.operation !== 'render') {
			throw new RangeError(`Unsupported parametric EQ worker operation: ${String(request.operation)}`);
		}
		const channels = (Array.isArray(request.channels) ? request.channels : []).map(asFloat32Array);
		const options = isRecord(request.options) ? request.options : {};
		const output = await processParametricEqChannelsWasm(
			channels,
			request.sampleRate,
			request.packet ?? request.params ?? {},
			{ ...options, wasmModule: request.wasmModule },
		);
		postWorkerMessage(
			{ type: 'result', requestId: request.requestId ?? null, channels: output },
			output.map((channel) => channel.buffer),
		);
	} catch (error) {
		postWorkerMessage({
			type: 'error',
			requestId: request.requestId ?? null,
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/** @param {unknown} value */
function asFloat32Array(value) {
	if (value instanceof Float32Array) return value;
	if (isNumericArrayView(value)) return Float32Array.from(value);
	if (Array.isArray(value)) return Float32Array.from(value);
	throw new TypeError('Parametric EQ worker channels must be numeric typed arrays.');
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
