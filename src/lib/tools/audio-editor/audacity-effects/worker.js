/* Audacity-derived DSP worker. SPDX-License-Identifier: GPL-3.0-only */

import { applyAudacityEffectAsync, captureAudacityNoiseProfile } from './index.js';

globalThis.onmessage = async ({ data }) => {
	try {
		const channels = (data.channels || []).map(asFloat32Array);
		if (data.operation === 'capture-noise-profile') {
			const profile = captureAudacityNoiseProfile(channels, data.sampleRate, data.params || {});
			globalThis.postMessage({ type: 'noise-profile', profile }, transferableBuffers(profile));
			return;
		}
		const context = normalizeContext(data.context || {});
		const output = await applyAudacityEffectAsync(data.effectType, channels, data.sampleRate, data.params || {}, context);
		globalThis.postMessage({ type: 'result', channels: output }, output.map((channel) => channel.buffer));
	} catch (error) {
		globalThis.postMessage({
			type: 'error',
			name: error instanceof Error ? error.name : 'Error',
			code: typeof error?.code === 'string' ? error.code : null,
			message: error instanceof Error ? error.message : String(error),
		});
	}
};

function normalizeContext(context) {
	const output = { ...context };
	for (const key of ['controlChannels', 'beforeChannels', 'afterChannels']) {
		if (Array.isArray(output[key])) output[key] = output[key].map(asFloat32Array);
	}
	return output;
}

function asFloat32Array(value) {
	return value instanceof Float32Array ? value : new Float32Array(value || 0);
}

function transferableBuffers(value, found = new Set()) {
	if (!value || typeof value !== 'object') return [...found];
	if (ArrayBuffer.isView(value)) found.add(value.buffer);
	else if (value instanceof ArrayBuffer) found.add(value);
	else for (const child of Object.values(value)) transferableBuffers(child, found);
	return [...found];
}
