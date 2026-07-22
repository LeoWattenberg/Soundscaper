import { EBU_R128_WORKLET_NAME } from './ebu-r128-worklet.js';

const loadedContexts = new WeakSet();
const pendingLoads = new WeakMap();

export async function createEbuR128MeterNode(context, options = {}) {
	if (!context?.audioWorklet?.addModule) {
		throw new Error('EBU R 128 metering requires AudioWorklet support.');
	}
	const NodeConstructor = globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode;
	const nodeFactory = options.nodeFactory || ((audioContext, name, settings) => {
		if (typeof NodeConstructor !== 'function') {
			throw new Error('EBU R 128 metering requires AudioWorkletNode support.');
		}
		return new NodeConstructor(audioContext, name, settings);
	});
	await ensureEbuR128Worklet(context);
	const channelCount = Math.max(1, Math.min(8, Math.floor(options.channelCount || 2)));
	const node = nodeFactory(context, EBU_R128_WORKLET_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		channelCount,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete',
		processorOptions: {
			sampleRate: context.sampleRate || 48_000,
			channelCount,
			channelWeights: options.channelWeights,
			passthrough: options.passthrough !== false,
			inputGain: options.inputGain ?? 1,
			running: options.running,
		},
	});
	let latestMeter = null;
	let disposed = false;
	node.port.onmessage = ({ data = {} }) => {
		if (disposed || (data.type !== 'meter' && data.type !== 'ready')) return;
		latestMeter = data.meter || null;
		options.onMeter?.(latestMeter);
	};
	node.port.start?.();
	return Object.freeze({
		node,
		get meter() { return latestMeter; },
		setRunning(running) {
			node.port.postMessage({ type: 'running', running: Boolean(running) });
		},
		setInputGain(value) {
			node.port.postMessage({ type: 'input-gain', value });
		},
		reset() {
			node.port.postMessage({ type: 'reset' });
		},
		requestSnapshot() {
			node.port.postMessage({ type: 'snapshot' });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			node.port.onmessage = null;
			try { node.disconnect(); } catch { /* Already disconnected. */ }
		},
	});
}

export async function ensureEbuR128Worklet(context) {
	if (loadedContexts.has(context)) return;
	let pending = pendingLoads.get(context);
	if (!pending) {
		pending = Promise.resolve()
			.then(ebuR128WorkletUrl)
			.then((url) => context.audioWorklet.addModule(url))
			.then(() => { loadedContexts.add(context); });
		pendingLoads.set(context, pending);
	}
	try {
		await pending;
	} finally {
		if (pendingLoads.get(context) === pending) pendingLoads.delete(context);
	}
}

async function ebuR128WorkletUrl() {
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		const module = await import('./ebu-r128-worklet.js?worker&url');
		return module.default;
	}
	return new URL('./ebu-r128-worklet.js', import.meta.url);
}
