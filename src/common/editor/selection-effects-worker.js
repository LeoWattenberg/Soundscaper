import { captureAudacityNoiseProfile } from './audacity-effects/index.js';
import { applyAudioSelectionEffectAsync } from './selection-effects.js';
import {
	asFloat32Array,
	normalizeSelectionEffectWorkerContext,
} from './selection-effects-worker-context.ts';
import { initializePffft } from './pffft.js';

globalThis.onmessage = async ({ data }) => {
	try {
		const channels = (data.channels || []).map(asFloat32Array);
		if (data.operation === 'capture-noise-profile') {
			await initializePffft();
			const profile = captureAudacityNoiseProfile(channels, data.sampleRate, data.params || {});
			globalThis.postMessage({ type: 'noise-profile', profile }, transferableBuffers(profile));
			return;
		}
		const context = normalizeSelectionEffectWorkerContext(data.context);
		context.onProgress = (progress) => globalThis.postMessage({ type: 'progress', ratio: progress });
		if (data.wasmModule instanceof WebAssembly.Module) context.wasmModule = data.wasmModule;
		const output = await applyAudioSelectionEffectAsync(
			data.effectType,
			channels,
			data.sampleRate,
			data.params || {},
			context,
		);
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

function transferableBuffers(value, found = new Set()) {
	if (!value || typeof value !== 'object') return [...found];
	if (ArrayBuffer.isView(value)) found.add(value.buffer);
	else if (value instanceof ArrayBuffer) found.add(value);
	else for (const child of Object.values(value)) transferableBuffers(child, found);
	return [...found];
}
