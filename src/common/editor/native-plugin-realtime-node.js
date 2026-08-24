/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_PLUGIN_CONTROL,
	NATIVE_PLUGIN_PIPELINE_BLOCKS,
	NATIVE_PLUGIN_WORKLET_NAME,
} from './native-plugin-realtime-worklet.js';
import { nativePluginOfflineInstanceIds } from './engine/native-plugin-offline-admission.ts';

const loaded = new WeakSet();
const loading = new WeakMap();
const nodes = new WeakMap();
const contextMaps = new Set();
const offers = new Map();
const latencies = new Map();
const reportedLatencies = new Map();
const listeners = new Set();
const activeNodes = new Map();
const activeContexts = new Map();
const pendingRpc = new Map();
const latencyPublicationTimers = new Map();
const attached = new Set();
const attachmentWaiters = new Map();
const runtimeFormats = new Map();
const runtimeTopologies = new Map();
const offlineAliases = new WeakMap();
const offlineProviders = new Set();
let rpcSequence = 0;

export function registerNativePluginOfflineRuntimeProvider(provider) {
	if (typeof provider !== 'function') throw new TypeError('A native plug-in offline runtime provider is required.');
	offlineProviders.add(provider);
	return () => offlineProviders.delete(provider);
}

export function nativePluginOfflineRuntimeProviderAvailable() { return offlineProviders.size > 0; }

/** Acquire fresh helper instances for a realtime PCM export/freeze graph. */
export async function prepareNativePluginOfflineRuntimes(context, project, options = {}) {
	const instanceIds = nativePluginOfflineInstanceIds(project, options);
	if (!instanceIds.length) return emptyOfflineRuntimes();
	const provider = [...offlineProviders].at(-1);
	if (!provider) throw new Error('No native plug-in offline runtime provider is registered.');
	const states = new Map((Array.isArray(project?.nativePluginStates) ? project.nativePluginStates : [])
		.map((state) => [state?.instanceId, state]));
	const acquired = [];
	const aliases = new Map();
	let disposed = false;
	try {
		for (const instanceId of instanceIds) {
			const state = states.get(instanceId);
			if (!state?.stateBody) throw new Error(`Native plug-in ${instanceId} has no authenticated state body.`);
			const runtime = await provider(Object.freeze({
				instanceId, state, sampleRate: context.sampleRate,
			}));
			if (!runtime || typeof runtime.runtimeInstanceId !== 'string'
				|| !(runtime.stateBytes instanceof Uint8Array) || typeof runtime.dispose !== 'function') {
				throw new Error('The native plug-in offline runtime provider returned a malformed session.');
			}
			aliases.set(instanceId, runtime.runtimeInstanceId);
			acquired.push(runtime);
		}
		offlineAliases.set(context, aliases);
	} catch (error) {
		await Promise.allSettled(acquired.map((runtime) => runtime.dispose()));
		throw error;
	}
	return Object.freeze({
		async activate() {
			for (const runtime of acquired) {
				await waitForNativePluginRuntime(runtime.runtimeInstanceId);
				await loadNativePluginRuntimeState(runtime.runtimeInstanceId, Uint8Array.from(runtime.stateBytes));
			}
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			offlineAliases.delete(context);
			await Promise.allSettled(acquired.map(async (runtime) => {
				try { await runtime.dispose(); }
				finally { releaseNativePluginRuntime(runtime.runtimeInstanceId); }
			}));
		},
	});
}

export function isNativePluginEffect(effect) {
	return String(effect?.type || effect?.kind || '').toLowerCase() === 'native-plugin'
		&& typeof effect?.params?.instanceId === 'string';
}

export function nativePluginRuntimeLatencyFrames(instanceId, fallback = 0) {
	return latencies.get(instanceId) ?? fallback;
}

export function nativePluginReportedLatencyFrames(instanceId, fallback = 0) {
	return reportedLatencies.get(instanceId) ?? fallback;
}

export function publishNativePluginRuntimeLatency(instanceId, latencyFrames) {
	if (!Number.isSafeInteger(latencyFrames) || latencyFrames < 0 || latencyFrames > 1_048_576) {
		throw new RangeError('The published native plug-in latency is invalid.');
	}
	latencies.set(instanceId, latencyFrames);
}

export function scheduleNativePluginRuntimeLatency(instanceId, latencyFrames, delayMs = 0) {
	const previous = latencyPublicationTimers.get(instanceId);
	if (previous) clearTimeout(previous);
	if (!(delayMs > 0)) return publishNativePluginRuntimeLatency(instanceId, latencyFrames);
	const timer = setTimeout(() => {
		if (latencyPublicationTimers.get(instanceId) !== timer) return;
		latencyPublicationTimers.delete(instanceId);
		publishNativePluginRuntimeLatency(instanceId, latencyFrames);
	}, delayMs);
	latencyPublicationTimers.set(instanceId, timer);
}

export function isNativePluginRealtimeWorkletLoaded(context) { return loaded.has(context); }

export function subscribeNativePluginRuntime(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function registerNativePluginRuntimeIdentity(instanceId, format, topology = { inputChannels: 2, outputChannels: 2 }) {
	if (typeof instanceId !== 'string' || !['vst3', 'clap', 'au', 'lv2'].includes(format)) {
		throw new TypeError('A native plug-in runtime identity is invalid.');
	}
	const admitted = pluginTopology(topology);
	runtimeFormats.set(instanceId, format);
	runtimeTopologies.set(instanceId, admitted);
}

export function availableNativePluginRuntimeFormats() {
	return new Set(runtimeFormats.values());
}

export function nativePluginRuntimeAvailable(instanceId, format) {
	return attached.has(instanceId) && runtimeFormats.get(instanceId) === format;
}

export function waitForNativePluginRuntime(instanceId, timeoutMs = 10_000) {
	if (attached.has(instanceId)) return Promise.resolve(true);
	let waiter = attachmentWaiters.get(instanceId);
	if (!waiter) {
		let resolve;
		let reject;
		const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
		const timer = setTimeout(() => {
			if (attachmentWaiters.get(instanceId) !== waiter) return;
			attachmentWaiters.delete(instanceId);
			reject(new Error('The native plug-in processor did not attach in time.'));
		}, timeoutMs);
		waiter = { promise, resolve, reject, timer };
		attachmentWaiters.set(instanceId, waiter);
	}
	return waiter.promise;
}

export async function ensureNativePluginRealtimeWorklet(context) {
	if (loaded.has(context)) return;
	let pending = loading.get(context);
	if (!pending) {
		pending = Promise.resolve(workletUrl()).then((url) => context.audioWorklet.addModule(String(url)));
		loading.set(context, pending);
	}
	try { await pending; loaded.add(context); }
	finally { if (loading.get(context) === pending) loading.delete(context); }
}

export function createNativePluginEffectNode(context, effect, channelCount = 2, outputChannelCount = channelCount) {
	const authoredInstanceId = effect.params.instanceId;
	const instanceId = offlineAliases.get(context)?.get(authoredInstanceId) ?? authoredInstanceId;
	const topology = runtimeTopologies.get(instanceId)
		?? pluginTopology({ inputChannels: channelCount, outputChannels: outputChannelCount });
	let byInstance = nodes.get(context);
	if (!byInstance) { byInstance = new Map(); nodes.set(context, byInstance); contextMaps.add(byInstance); }
	let node = byInstance.get(instanceId);
	if (!node) {
		const Constructor = globalThis.AudioWorkletNode;
		if (typeof Constructor !== 'function') throw new Error('AudioWorkletNode is unavailable for the native plug-in.');
		node = new Constructor(context, NATIVE_PLUGIN_WORKLET_NAME, {
			numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [topology.outputChannels],
			channelCount: topology.inputChannels, channelCountMode: 'explicit', channelInterpretation: 'discrete',
			processorOptions: {
				instanceId, inputChannelCount: topology.inputChannels,
				outputChannelCount: topology.outputChannels,
				queueCapacity: 4, bypassed: effect.bypassed === true,
			},
		});
		node.port.onmessage = ({ data = {} } = {}) => receiveControl(instanceId, data);
		node.port.start?.();
		byInstance.set(instanceId, node);
		activeNodes.set(instanceId, node);
		activeContexts.set(instanceId, context);
		const offer = offers.get(instanceId);
		if (offer) attach(node, offer, instanceId);
	}
	node.port.postMessage({ type: NATIVE_PLUGIN_CONTROL.bypass, bypassed: effect.bypassed === true });
	return node;
}

export function acceptNativePluginPortOffer(offer, ports = []) {
	const port = ports.length === 1 ? ports[0] : null;
	const instanceId = offer?.instanceId;
	if (!port || typeof port.postMessage !== 'function' || typeof instanceId !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(instanceId)
		|| offer?.purpose !== 'plugin-rpc' || offer?.transport !== 'message-port'
		|| offer?.portContractVersion !== 1 || !Number.isSafeInteger(offer?.generation)) {
		for (const candidate of ports) close(candidate);
		return false;
	}
	const previous = offers.get(instanceId);
	if (previous) close(previous.port);
	const admitted = { port, generation: offer.generation };
	offers.set(instanceId, admitted);
	const reported = Math.max(0, Number(offer.reportedLatencyFrames) || 0)
		+ NATIVE_PLUGIN_PIPELINE_BLOCKS * 128;
	reportedLatencies.set(instanceId, reported);
	const node = activeNodes.get(instanceId);
	if (node) attach(node, admitted, instanceId);
	notify(instanceId, reported, node ? 'active' : 'pending');
	return true;
}

/** Attaches a pending offer when the authored graph creates its one processor. */
export function attachNativePluginOfferToNode(context, instanceId) {
	const node = nodes.get(context)?.get(instanceId);
	const offer = offers.get(instanceId);
	if (!node || !offer) return false;
	attach(node, offer, instanceId);
	return true;
}

/** @param {string} instanceId @param {boolean} bypassed @param {number | null} [contextTime] */
export function setNativePluginBypassed(instanceId, bypassed, contextTime = null) {
	forEachNode(instanceId, (node) => {
		const context = activeContexts.get(instanceId);
		const atContextFrame = Number.isFinite(contextTime) && context
			? Math.ceil(Number(contextTime) * context.sampleRate / 128) * 128
			: null;
		node.port.postMessage({
			type: NATIVE_PLUGIN_CONTROL.bypass, bypassed,
			...(atContextFrame === null ? {} : { atContextFrame }),
		});
	});
	notify(instanceId, bypassed ? 0 : null, bypassed ? 'bypass' : 'active');
}

/** Vendor state remains on the helper/worklet RPC path; callers never author it. */
export function saveNativePluginRuntimeState(instanceId) {
	return stateRequest(instanceId, NATIVE_PLUGIN_CONTROL.saveState).then((answer) => Object.freeze({
		bytes: answer.bytes, authentication: answer.authentication,
	}));
}

export function loadNativePluginRuntimeState(instanceId, bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > 16 * 1_024 * 1_024) {
		return Promise.reject(new TypeError('Native plug-in state must be at most 16 MiB.'));
	}
	return stateRequest(instanceId, NATIVE_PLUGIN_CONTROL.loadState, bytes).then(() => true);
}

export function openNativePluginRuntimeVendorUi(instanceId, windowHandleId) {
	return vendorUiRequest(instanceId, NATIVE_PLUGIN_CONTROL.openVendorUi, windowHandleId);
}

export function closeNativePluginRuntimeVendorUi(instanceId, windowHandleId) {
	return vendorUiRequest(instanceId, NATIVE_PLUGIN_CONTROL.closeVendorUi, windowHandleId);
}

export function releaseNativePluginRuntime(instanceId) {
	const offer = offers.get(instanceId);
	if (offer) close(offer.port);
	offers.delete(instanceId);
	latencies.delete(instanceId);
	reportedLatencies.delete(instanceId);
	attached.delete(instanceId);
	runtimeFormats.delete(instanceId);
	runtimeTopologies.delete(instanceId);
	activeNodes.delete(instanceId);
	activeContexts.delete(instanceId);
	const timer = latencyPublicationTimers.get(instanceId);
	if (timer) clearTimeout(timer);
	latencyPublicationTimers.delete(instanceId);
	rejectPending(instanceId, new Error('The native plug-in runtime closed.'));
	rejectAttachment(instanceId, new Error('The native plug-in runtime closed.'));
	forEachNode(instanceId, (node, byInstance) => {
		node.port.postMessage({ type: NATIVE_PLUGIN_CONTROL.revoke });
		node.port.onmessage = null;
		try { node.disconnect(); } catch { /* already disconnected */ }
		byInstance.delete(instanceId);
	});
	notify(instanceId, 0, 'closed');
}

function attach(node, offer, instanceId) {
	offers.delete(instanceId);
	node.port.postMessage({ type: NATIVE_PLUGIN_CONTROL.attach, generation: offer.generation }, [offer.port]);
}

function receiveControl(instanceId, message) {
	if (message.type === NATIVE_PLUGIN_CONTROL.attached) {
		attached.add(instanceId);
		const waiter = attachmentWaiters.get(instanceId);
		if (waiter) {
			attachmentWaiters.delete(instanceId);
			clearTimeout(waiter.timer);
			waiter.resolve(true);
		}
	} else if (message.type === NATIVE_PLUGIN_CONTROL.state || message.type === NATIVE_PLUGIN_CONTROL.stateLoaded
		|| message.type === NATIVE_PLUGIN_CONTROL.vendorUi) {
		const key = `${instanceId}\0${String(message.requestId || '')}`;
		const pending = pendingRpc.get(key);
		if (!pending) return;
		pendingRpc.delete(key);
		clearTimeout(pending.timer);
		if (message.type === NATIVE_PLUGIN_CONTROL.state
			&& (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength > 16 * 1_024 * 1_024)) {
			pending.reject(new Error('The native plug-in returned malformed state.'));
		} else pending.resolve(message);
	} else if (message.type === NATIVE_PLUGIN_CONTROL.latency && Number.isSafeInteger(message.latencyFrames)) {
		reportedLatencies.set(instanceId, message.latencyFrames);
		notify(instanceId, message.latencyFrames, 'active');
	} else if (message.type === NATIVE_PLUGIN_CONTROL.fault) {
		attached.delete(instanceId);
		const error = new Error(`The native plug-in host failed: ${String(message.reason || 'fault')}.`);
		rejectPending(instanceId, error);
		rejectAttachment(instanceId, error);
		notify(instanceId, 0, 'host-lost');
	}
}


function vendorUiRequest(instanceId, type, windowHandleId) {
	if (typeof windowHandleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(windowHandleId)) {
		return Promise.reject(new TypeError('The native plug-in vendor window ID is invalid.'));
	}
	return stateRequest(instanceId, type, undefined, { windowHandleId }).then((answer) => {
		if (answer.status === 'refused') throw new Error('The plug-in refused its vendor window.');
		return answer.status;
	});
}


async function stateRequest(instanceId, type, bytes, fields = {}) {
	await waitForNativePluginRuntime(instanceId);
	const node = activeNodes.get(instanceId);
	if (!node?.port?.postMessage) return Promise.reject(new Error('The native plug-in processor is unavailable.'));
	const requestId = `s${String(++rpcSequence)}`;
	const key = `${instanceId}\0${requestId}`;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRpc.delete(key);
			reject(new Error('The native plug-in state request timed out.'));
		}, 10_000);
		pendingRpc.set(key, { resolve, reject, timer });
		try {
			const message = { type, requestId, ...fields, ...(bytes ? { bytes } : {}) };
			node.port.postMessage(message, bytes ? [bytes.buffer] : []);
		} catch (error) {
			clearTimeout(timer);
			pendingRpc.delete(key);
			reject(error);
		}
	});
}

function rejectAttachment(instanceId, error) {
	const waiter = attachmentWaiters.get(instanceId);
	if (!waiter) return;
	attachmentWaiters.delete(instanceId);
	clearTimeout(waiter.timer);
	waiter.reject(error);
}

function rejectPending(instanceId, error) {
	for (const [key, pending] of pendingRpc) {
		if (!key.startsWith(`${instanceId}\0`)) continue;
		pendingRpc.delete(key);
		clearTimeout(pending.timer);
		pending.reject(error);
	}
}

function notify(instanceId, latencyFrames, state) {
	for (const listener of listeners) listener(Object.freeze({ instanceId, latencyFrames, state }));
}

// WeakMap is intentionally non-enumerable. Context-local attachment happens in
// createNativePluginEffectNode; release walks the strong per-context maps below.
function forEachNode(instanceId, action) {
	for (const byInstance of contextMaps) {
		const node = byInstance.get(instanceId);
		if (node) action(node, byInstance);
	}
}
function close(port) { try { port.close(); } catch { /* already transferred */ } }
function pluginTopology(value) {
	const inputChannels = value?.inputChannels;
	const outputChannels = value?.outputChannels;
	if (!Number.isSafeInteger(inputChannels) || inputChannels < 1 || inputChannels > 32
		|| !Number.isSafeInteger(outputChannels) || outputChannels < 1 || outputChannels > 32) {
		throw new TypeError('A native plug-in requires one bounded main-bus topology.');
	}
	return Object.freeze({ inputChannels, outputChannels });
}
async function workletUrl() {
	if (import.meta.env?.DEV || import.meta.env?.PROD) return (await import('./native-plugin-realtime-worklet.js?worker&url')).default;
	return new URL('./native-plugin-realtime-worklet.js', import.meta.url);
}

function emptyOfflineRuntimes() {
	return Object.freeze({ activate: async () => undefined, dispose: async () => undefined });
}
