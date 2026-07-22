/* SPDX-License-Identifier: AGPL-3.0-only */

import { PCM_ENCODING_WAVPACK_F32_V1, exactArrayBuffer } from './pcm.js';
import { decodePcmWithWavPack, encodePcmAdaptively } from './operations.js';
import { loadWavPackWasm } from './runtime.js';

let runtimePromise;
let work = Promise.resolve();

self.addEventListener('message', (event) => {
	const message = event.data;
	if (!message || typeof message !== 'object' || typeof message.id !== 'string') return;
	work = work.then(() => processMessage(message)).catch(() => {});
});

async function processMessage(message) {
	try {
		if (message.type === 'encode') await encode(message);
		else if (message.type === 'decode') await decode(message);
	} catch (error) {
		self.postMessage({
			type: 'error',
			id: message.id,
			error: serializeError(error),
		});
	}
}

async function encode(message) {
	const raw = exactArrayBuffer(message.payload);
	const runtime = await getRuntime(message.wasmUrl);
	postCodecResult(message.id, encodePcmAdaptively(raw, {
		frames: message.frames,
		channelCount: message.channelCount,
		sampleRate: message.sampleRate,
		runtime,
	}));
}

async function decode(message) {
	if (message.encoding !== PCM_ENCODING_WAVPACK_F32_V1) {
		throw new TypeError('WavPack worker can only decode wavpack-f32-v1 payloads.');
	}
	const encoded = exactArrayBuffer(message.payload);
	const runtime = await getRuntime(message.wasmUrl);
	const raw = decodePcmWithWavPack(encoded, {
		frames: message.frames,
		channelCount: message.channelCount,
		sampleRate: message.sampleRate,
		pcmCrc32: message.pcmCrc32,
		runtime,
	});
	self.postMessage({
		type: 'result',
		id: message.id,
		result: { payload: raw },
	}, [raw]);
}

function postCodecResult(id, result) {
	self.postMessage({
		type: 'result',
		id,
		result,
	}, [result.payload]);
}

function getRuntime(wasmUrl) {
	if (!runtimePromise) runtimePromise = loadWavPackWasm(wasmUrl || undefined);
	return runtimePromise;
}

function serializeError(error) {
	return {
		name: typeof error?.name === 'string' ? error.name : 'Error',
		message: typeof error?.message === 'string' ? error.message : String(error),
		code: typeof error?.code === 'string' ? error.code : '',
		stack: typeof error?.stack === 'string' ? error.stack : '',
	};
}
