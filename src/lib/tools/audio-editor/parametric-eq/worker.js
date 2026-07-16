import { processParametricEqChannelsWasm } from './destructive.js';
import { PARAMETRIC_EQ_WORKER_OPERATION } from './protocol.js';

globalThis.onmessage = async ({ data }) => {
	const request = data || {};
	try {
		if (request.operation !== PARAMETRIC_EQ_WORKER_OPERATION && request.operation !== 'render') {
			throw new RangeError(`Unsupported parametric EQ worker operation: ${String(request.operation)}`);
		}
		const channels = (request.channels || []).map(asFloat32Array);
		const output = await processParametricEqChannelsWasm(
			channels,
			request.sampleRate,
			request.packet ?? request.params ?? {},
			{ ...(request.options || {}), wasmModule: request.wasmModule },
		);
		globalThis.postMessage(
			{ type: 'result', requestId: request.requestId ?? null, channels: output },
			output.map((channel) => channel.buffer),
		);
	} catch (error) {
		globalThis.postMessage({
			type: 'error',
			requestId: request.requestId ?? null,
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		});
	}
};

function asFloat32Array(value) {
	if (value instanceof Float32Array) return value;
	if (ArrayBuffer.isView(value) || Array.isArray(value)) return Float32Array.from(value);
	throw new TypeError('Parametric EQ worker channels must be numeric typed arrays.');
}
