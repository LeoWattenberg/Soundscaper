/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_PLUGIN_CONTROL,
	NATIVE_PLUGIN_WORKLET_NAME,
} from './native-plugin-realtime-contract.ts';
export {
	NATIVE_PLUGIN_CONTROL,
	NATIVE_PLUGIN_PIPELINE_BLOCKS,
	NATIVE_PLUGIN_WORKLET_NAME,
} from './native-plugin-realtime-contract.ts';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() { this.port = { postMessage() {}, onmessage: null, start() {} }; }
};

/** Fixed-pool, direct MessagePort processor. Live playback may dry bypass; renders fail closed. */
export class NativePluginRealtimeProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const value = options.processorOptions || {};
		this.instanceId = String(value.instanceId || 'unbound');
		this.inputChannelCount = integer(value.inputChannelCount, 1, 32,
			integer(value.channelCount, 1, 32, 2));
		this.outputChannelCount = integer(value.outputChannelCount, 1, 32,
			integer(value.channelCount, 1, 32, 2));
		this.queueCapacity = integer(value.queueCapacity, 2, 8, 4);
		this.generation = 0;
		this.sequence = 0;
		this.peer = null;
		this.bypassed = value.bypassed === true;
		this.strictRender = value.strictRender === true;
		this.renderFailed = false;
		this.renderFailureReason = null;
		this.pendingBypass = null;
		this.free = [];
		this.busy = new Map();
		this.timeline = new Map();
		this.dry = [];
		this.controlRequests = new Map();
		this.frameCount = 0;
		for (let id = 0; id < this.queueCapacity; id += 1) this.free.push({ id, input: null, output: null });
		this.port.onmessage = (event) => this.#control(event?.data || {}, event?.ports || []);
		this.port.start?.();
	}

	process(inputs, outputs) {
		const input = inputs[0] || [];
		const output = outputs[0] || [];
		const frames = output[0]?.length || input[0]?.length || 0;
		if (!frames) return true;
		if (this.renderFailed) {
			for (const channel of output) channel.fill(0);
			return true;
		}
		if (input.length !== this.inputChannelCount || output.length !== this.outputChannelCount) {
			if (this.strictRender) this.#failRender('topology-mismatch');
			else this.#close('topology-mismatch');
			if (this.strictRender) for (const channel of output) channel.fill(0);
			else copy(input, output, frames);
			return true;
		}
		const contextFrame = Number(globalThis.currentFrame);
		if (this.pendingBypass && (!Number.isSafeInteger(contextFrame)
			|| contextFrame >= this.pendingBypass.atContextFrame)) {
			this.bypassed = this.pendingBypass.bypassed;
			this.pendingBypass = null;
			if (this.bypassed) this.#discardTimeline();
		}
		if (this.bypassed) {
			copy(input, output, frames);
			return true;
		}
		if (this.strictRender && !this.peer) {
			this.#failRender('host-unavailable');
			for (const channel of output) channel.fill(0);
			return true;
		}
		if (this.frameCount !== frames || this.dry.length !== this.queueCapacity + 1) {
			this.frameCount = frames;
			this.dry = Array.from({ length: this.queueCapacity + 1 }, () => planes(this.outputChannelCount, frames));
			this.timeline.clear();
		}
		const sequence = this.sequence;
		this.sequence += 1;
		const due = this.timeline.get(sequence - this.queueCapacity) || null;
		if (due?.processed) {
			copy(due.processed.output, output, frames);
			this.free.push(due.processed);
		} else if (due && this.strictRender) {
			this.#failRender('processing-deadline-miss');
			for (const channel of output) channel.fill(0);
			return true;
		} else if (due) copy(due.dry, output, frames);
		else for (const channel of output) channel.fill(0);
		if (due) this.timeline.delete(sequence - this.queueCapacity);
		const dry = this.dry[sequence % this.dry.length];
		copy(input, dry, frames);
		this.timeline.set(sequence, { dry, processed: null });
		if (!this.peer) return true;
		const slot = this.free.shift() || null;
		if (!slot) {
			if (this.strictRender) this.#failRender('processing-pool-exhausted');
			return true;
		}
		if (!slot.input || slot.input[0]?.length !== frames) {
			slot.input = planes(this.inputChannelCount, frames);
			slot.output = planes(this.outputChannelCount, frames);
		}
		copy(input, slot.input, frames);
		const requestId = `p${String(slot.id)}-${String(sequence)}`;
		this.busy.set(requestId, { slot, sequence });
		this.#send({
			protocolVersion: 1, kind: 'process', requestId, frameCount: frames,
			input: slot.input, output: slot.output,
		}, [...slot.input, ...slot.output].map(({ buffer }) => buffer));
		return true;
	}

	#control(message, ports) {
		if (message.type === NATIVE_PLUGIN_CONTROL.renderStatus) {
			const requestId = requestIdValue(message.requestId);
			if (requestId) this.#post({
				type: NATIVE_PLUGIN_CONTROL.renderStatusResult, requestId,
				failed: this.renderFailed, reason: this.renderFailureReason,
			});
			return;
		}
		if (message.type === NATIVE_PLUGIN_CONTROL.bypass) {
			if (Number.isSafeInteger(message.atContextFrame) && message.atContextFrame >= 0) {
				this.pendingBypass = {
					bypassed: message.bypassed === true, atContextFrame: message.atContextFrame,
				};
			} else {
				this.pendingBypass = null;
				this.bypassed = message.bypassed === true;
				if (this.bypassed) this.#discardTimeline();
			}
			return;
		}
		if (message.type === NATIVE_PLUGIN_CONTROL.revoke) return this.#close('revoked');
		if (message.type === NATIVE_PLUGIN_CONTROL.saveState) return this.#requestControl(message, 'save-state');
		if (message.type === NATIVE_PLUGIN_CONTROL.loadState) return this.#requestControl(message, 'load-state');
		if (message.type === NATIVE_PLUGIN_CONTROL.openVendorUi) return this.#requestControl(message, 'open-vendor-ui');
		if (message.type === NATIVE_PLUGIN_CONTROL.closeVendorUi) return this.#requestControl(message, 'close-vendor-ui');
		if (message.type === NATIVE_PLUGIN_CONTROL.capabilities) return this.#requestControl(message, 'capabilities');
		if (message.type === NATIVE_PLUGIN_CONTROL.describeParameters) return this.#requestControl(message, 'parameters');
		if (message.type === NATIVE_PLUGIN_CONTROL.readParameter) return this.#requestControl(message, 'parameter-get');
		if (message.type === NATIVE_PLUGIN_CONTROL.writeParameter) return this.#requestControl(message, 'parameter-set');
		if (message.type !== NATIVE_PLUGIN_CONTROL.attach) return;
		const peer = ports.length === 1 ? ports[0] : null;
		if (!peer || typeof peer.postMessage !== 'function'
			|| !Number.isSafeInteger(message.generation) || message.generation <= this.generation) {
			try { peer?.close(); } catch { /* invalid offer */ }
			return this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason: 'invalid-attach' });
		}
		this.#close('replaced');
		this.peer = peer;
		this.generation = message.generation;
		peer.onmessage = (event) => this.#message(event?.data);
		peer.onmessageerror = () => this.#close('malformed-message');
		peer.start?.();
		this.#post({ type: NATIVE_PLUGIN_CONTROL.attached, generation: this.generation });
	}

	#message(message) {
		if (message?.protocolVersion !== 1) return this.#close('malformed-message');
		if (message.kind === 'fault') return this.#close(String(message.code || 'host-fault'));
		if (message.kind === 'state' || message.kind === 'state-loaded') {
			return this.#stateReply(message);
		}
		if (message.kind === 'vendor-ui') return this.#vendorUiReply(message);
		if (message.kind === 'capabilities' || message.kind === 'parameters'
			|| message.kind === 'parameter-value') return this.#parameterReply(message);
		if (message.kind === 'latency' && typeof message.requestId === 'string') {
			this.#post({
				type: NATIVE_PLUGIN_CONTROL.latency,
				latencyFrames: integer(message.reportedLatencyFrames, 0, 1_048_576, 0)
					+ this.queueCapacity * this.frameCount,
			});
			return;
		}
		if (message.kind !== 'processed' || typeof message.requestId !== 'string') return this.#close('malformed-message');
		const claim = this.busy.get(message.requestId);
		const slot = claim?.slot;
		if (!slot || message.frameCount !== this.frameCount
			|| !validPlanes(message.input, this.inputChannelCount, this.frameCount)
			|| !validPlanes(message.output, this.outputChannelCount, this.frameCount)) return this.#close('pool-violation');
		this.busy.delete(message.requestId);
		slot.input = message.input;
		slot.output = message.output;
		const record = this.timeline.get(claim.sequence);
		if (record) record.processed = slot;
		else this.free.push(slot);
		this.#post({
			type: NATIVE_PLUGIN_CONTROL.latency,
			latencyFrames: integer(message.reportedLatencyFrames, 0, 1_048_576, 0)
				+ this.queueCapacity * this.frameCount,
		});
	}

	#requestControl(message, kind) {
		const requestId = requestIdValue(message.requestId);
		if (!requestId || !this.peer || this.controlRequests.has(requestId)) {
			return this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason: 'control-rpc-unavailable', requestId });
		}
		const request = { protocolVersion: 1, kind, requestId };
		const transfer = [];
		if (kind === 'load-state') {
			if (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength > 16 * 1_024 * 1_024) {
				return this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason: 'invalid-state', requestId });
			}
			request.bytes = message.bytes;
			transfer.push(message.bytes.buffer);
		}
		if (kind === 'open-vendor-ui' || kind === 'close-vendor-ui') {
			const windowHandleId = requestIdValue(message.windowHandleId);
			if (!windowHandleId) {
				return this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason: 'invalid-vendor-window', requestId });
			}
			request.windowHandleId = windowHandleId;
		}
		if (kind === 'parameter-get' || kind === 'parameter-set') {
			if (!Number.isSafeInteger(message.index) || message.index < 0 || message.index > 4_095) {
				return this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason: 'invalid-parameter-index', requestId });
			}
			request.index = message.index;
			if (kind === 'parameter-set') {
				if (!normalizedParameterValue(message.value)) {
					return this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason: 'invalid-parameter-value', requestId });
				}
				request.value = message.value;
			}
		}
		this.controlRequests.set(requestId, Object.freeze({ kind, index: request.index ?? null }));
		this.#send(request, transfer);
	}

	#stateReply(message) {
		const requestId = requestIdValue(message.requestId);
		const kind = requestId ? this.controlRequests.get(requestId)?.kind : null;
		if (!kind || (kind === 'save-state') !== (message.kind === 'state')) return this.#close('state-rpc-mismatch');
		this.controlRequests.delete(requestId);
		if (message.kind === 'state') {
			if (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength > 16 * 1_024 * 1_024) {
				return this.#close('invalid-state');
			}
			if (!stateAuthentication(message.authentication, requestId, message.bytes.byteLength)) {
				return this.#close('invalid-state-authentication');
			}
			return this.#post({
				type: NATIVE_PLUGIN_CONTROL.state, requestId, bytes: message.bytes,
				authentication: message.authentication,
			}, [message.bytes.buffer]);
		}
		this.#post({ type: NATIVE_PLUGIN_CONTROL.stateLoaded, requestId });
	}

	#vendorUiReply(message) {
		const requestId = requestIdValue(message.requestId);
		const kind = requestId ? this.controlRequests.get(requestId)?.kind : null;
		if (!kind || !['open-vendor-ui', 'close-vendor-ui'].includes(kind)
			|| !['opened', 'closed', 'refused'].includes(message.status)) {
			return this.#close('vendor-ui-rpc-mismatch');
		}
		this.controlRequests.delete(requestId);
		this.#post({ type: NATIVE_PLUGIN_CONTROL.vendorUi, requestId, status: message.status });
	}

	#parameterReply(message) {
		const requestId = requestIdValue(message.requestId);
		const claim = requestId ? this.controlRequests.get(requestId) : null;
		if (!claim || (message.kind === 'capabilities' && claim.kind !== 'capabilities')
			|| (message.kind === 'parameters' && claim.kind !== 'parameters')
			|| (message.kind === 'parameter-value'
				&& !['parameter-get', 'parameter-set'].includes(claim.kind))) {
			return this.#close('parameter-rpc-mismatch');
		}
		this.controlRequests.delete(requestId);
		if (message.kind === 'capabilities') {
			if (!Number.isSafeInteger(message.parameterCount) || message.parameterCount < 0
				|| message.parameterCount > 4_096 || typeof message.hasVendorUi !== 'boolean') {
				return this.#close('invalid-plugin-capabilities');
			}
			return this.#post({
				type: NATIVE_PLUGIN_CONTROL.capabilitiesResult, requestId,
				parameterCount: message.parameterCount, hasVendorUi: message.hasVendorUi,
			});
		}
		if (message.kind === 'parameters') {
			const parameters = pluginParameters(message.parameters);
			if (!parameters) return this.#close('invalid-plugin-parameters');
			return this.#post({ type: NATIVE_PLUGIN_CONTROL.parameters, requestId, parameters });
		}
		if (message.index !== claim.index || !normalizedParameterValue(message.value)) {
			return this.#close('invalid-plugin-parameter-value');
		}
		this.#post({
			type: NATIVE_PLUGIN_CONTROL.parameterValue, requestId,
			index: message.index, value: message.value,
		});
	}

	#send(message, transfer = []) {
		try { this.peer?.postMessage(message, transfer); } catch {
			if (this.strictRender) this.#failRender('peer-loss');
			else this.#close('peer-loss');
		}
	}

	#failRender(reason) {
		if (this.renderFailed) return;
		this.renderFailed = true;
		this.renderFailureReason = reason;
		const hadPeer = !!this.peer;
		this.#close(reason);
		if (!hadPeer) this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason });
	}

	#close(reason) {
		const peer = this.peer;
		if (this.strictRender && (reason !== 'replaced' || peer)) {
			this.renderFailed = true;
			this.renderFailureReason ||= reason;
		}
		this.peer = null;
		this.#discardTimeline();
		this.busy.clear();
		this.free = Array.from({ length: this.queueCapacity }, (_, id) => ({ id, input: null, output: null }));
		this.controlRequests.clear();
		if (!peer) return;
		try { peer.postMessage({ protocolVersion: 1, kind: 'close', reason }); } catch { /* lost */ }
		try { peer.close(); } catch { /* lost */ }
		this.#post({ type: NATIVE_PLUGIN_CONTROL.fault, reason });
	}

	#discardTimeline() {
		for (const record of this.timeline.values()) if (record.processed) this.free.push(record.processed);
		this.timeline.clear();
	}

	#post(message, transfer = []) {
		try { this.port.postMessage({ ...message, instanceId: this.instanceId }, transfer); } catch { /* renderer left */ }
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(NATIVE_PLUGIN_WORKLET_NAME, NativePluginRealtimeProcessor);
}

function planes(count, frames) { return Array.from({ length: count }, () => new Float32Array(frames)); }
function validPlanes(value, count, frames) {
	return Array.isArray(value) && value.length === count
		&& value.every((plane) => plane instanceof Float32Array && plane.length === frames)
		&& new Set(value.map((plane) => plane.buffer)).size === count;
}
function copy(source, target, frames) {
	const last = Math.max(0, source.length - 1);
	for (let channel = 0; channel < target.length; channel += 1) {
		const from = source[Math.min(channel, last)];
		const to = target[channel];
		for (let frame = 0; frame < frames; frame += 1) to[frame] = from?.[frame] || 0;
	}
}
function integer(value, minimum, maximum, fallback) {
	return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
function requestIdValue(value) {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) ? value : null;
}
function stateAuthentication(value, requestId, byteLength) {
	return value && typeof value === 'object' && value.requestId === requestId && value.byteLength === byteLength
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256)
		&& typeof value.mac === 'string' && /^[a-f\d]{64}$/u.test(value.mac);
}
function normalizedParameterValue(value) {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}
function pluginParameters(value) {
	if (!Array.isArray(value) || value.length > 4_096) return null;
	const ids = new Set();
	for (let index = 0; index < value.length; index += 1) {
		const parameter = value[index];
		if (!parameter || parameter.index !== index || !parameterText(parameter.id, false)
			|| !parameterText(parameter.name, false) || !parameterText(parameter.label, true)
			|| !normalizedParameterValue(parameter.minimumValue)
			|| !normalizedParameterValue(parameter.defaultValue)
			|| !normalizedParameterValue(parameter.maximumValue)
			|| parameter.minimumValue > parameter.defaultValue
			|| parameter.defaultValue > parameter.maximumValue
			|| !Number.isSafeInteger(parameter.flags) || parameter.flags < 0 || parameter.flags > 15
			|| ids.has(parameter.id)) return null;
		ids.add(parameter.id);
	}
	return value;
}
function parameterText(value, allowEmpty) {
	return typeof value === 'string' && (allowEmpty || value.length > 0)
		&& value.length <= 512 && !value.includes('\0');
}
