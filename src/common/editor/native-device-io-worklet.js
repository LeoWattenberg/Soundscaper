/* SPDX-License-Identifier: AGPL-3.0-only */

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() { this.port = { postMessage() {}, onmessage: null, start() {} }; }
};
const CALIBRATION_SIGNATURE = Object.freeze([0.5, -0.5, 0.25, -0.25, -0.5, 0.5, -0.25, 0.25]);
const CALIBRATION_QUIET_PEAK = 0.05;
const CALIBRATION_CORRELATION = 0.9;

export const NATIVE_DEVICE_IO_WORKLET_NAME = 'soundscaper-native-device-io-v1';
export const NATIVE_DEVICE_IO_CONTROL = Object.freeze({
	attach: 'native-device-attach', revoke: 'native-device-revoke', attached: 'native-device-attached',
	closed: 'native-device-closed', fault: 'native-device-fault',
	calibrate: 'native-device-calibrate', cancelCalibration: 'native-device-calibration-cancel',
	calibrationResult: 'native-device-calibration-result', calibrationFailed: 'native-device-calibration-failed',
	transfer: 'native-device-transfer',
});

/** Fixed-pool Web Audio <-> native device bridge; main never observes an audio block. */
export class NativeDeviceIoProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const value = options.processorOptions || {};
		this.direction = requiredDirection(value.direction);
		this.channelCount = requiredInteger(value.channelCount, 1, 32, 'channel count');
		this.periodFrames = requiredInteger(value.periodFrames, 1, 16_384, 'period frames');
		this.queueCapacity = requiredInteger(value.queueCapacity, 2, 8, 'queue capacity');
		this.generation = 0;
		this.portPeer = null;
		this.outputFree = [];
		this.outputBusy = new Set();
		this.captureBusy = new Set();
		this.captureQueue = [];
		this.outputPacket = null;
		this.outputOffset = 0;
		this.capturePacket = null;
		this.captureOffset = 0;
		this.outputSequence = 0;
		this.captureSequence = 0;
		this.captureReceived = 0;
		this.outputFrame = 0;
		this.captureFrame = 0;
		this.calibration = null;
		this.pendingTransferredFrames = 0;
		this.pendingLostFrames = 0;
		this.pendingTransferEvents = 0;
		for (let id = 0; id < this.queueCapacity; id += 1) {
			if (this.direction !== 'input') this.outputFree.push(packet(id, this.channelCount, this.periodFrames));
		}
		this.port.onmessage = (event) => this.#control(event?.data || {}, event?.ports || []);
		this.port.start?.();
	}

	process(inputs, outputs) {
		if (this.direction !== 'input') this.#write(inputs[0] || []);
		if (this.direction !== 'output') this.#read(outputs[0] || []);
		else for (const channel of outputs[0] || []) channel.fill(0);
		return true;
	}

	#control(message, ports) {
		if (message.type === NATIVE_DEVICE_IO_CONTROL.calibrate) return this.#beginCalibration(message);
		if (message.type === NATIVE_DEVICE_IO_CONTROL.cancelCalibration) return this.#cancelCalibration(message);
		if (message.type === NATIVE_DEVICE_IO_CONTROL.revoke) return this.#close('cancelled');
		if (message.type !== NATIVE_DEVICE_IO_CONTROL.attach) return;
		const peer = ports.length === 1 ? ports[0] : null;
		const generation = integer(message.generation, 1, Number.MAX_SAFE_INTEGER, 0);
		if (!peer || typeof peer.postMessage !== 'function' || generation <= this.generation) {
			try { peer?.close(); } catch { /* invalid offer */ }
			return this.#post({ type: NATIVE_DEVICE_IO_CONTROL.fault, reason: 'invalid-attach' });
		}
		this.#close('replaced');
		this.generation = generation;
		this.portPeer = peer;
		peer.onmessage = (event) => this.#message(event?.data);
		peer.onmessageerror = () => this.#close('malformed-message');
		peer.start?.();
		if (this.direction !== 'output') {
			for (let id = 0; id < this.queueCapacity; id += 1) this.#issueCapture(packet(id, this.channelCount, this.periodFrames));
		}
		this.#post({ type: NATIVE_DEVICE_IO_CONTROL.attached, generation });
	}

	#write(input) {
		if (!this.portPeer) return;
		const frames = input[0]?.length || 0;
		let read = 0;
		while (read < frames) {
			if (!this.outputPacket) {
				this.outputPacket = this.outputFree.shift() || null;
				this.outputOffset = 0;
				if (!this.outputPacket) return this.#close('output-overrun');
			}
			const count = Math.min(frames - read, this.periodFrames - this.outputOffset);
			const targetOffset = this.outputOffset;
			copyPlanes(input, read, this.outputPacket.channels, this.outputOffset, count);
			if (this.calibration?.armed && !this.calibration.injected && count > 0) {
				if (this.calibration.signatureOffset === 0) {
					this.calibration.impulseFrame = this.outputFrame + targetOffset;
				}
				for (let frame = 0; frame < count
					&& this.calibration.signatureOffset < CALIBRATION_SIGNATURE.length; frame += 1) {
					this.outputPacket.channels[0][targetOffset + frame]
						= CALIBRATION_SIGNATURE[this.calibration.signatureOffset++];
				}
				this.calibration.injected = this.calibration.signatureOffset === CALIBRATION_SIGNATURE.length;
			}
			read += count;
			this.outputOffset += count;
			if (this.outputOffset !== this.periodFrames) continue;
			const block = this.outputPacket;
			this.outputPacket = null;
			this.outputBusy.add(block.id);
			this.#send({
				protocolVersion: 1, kind: 'audio', generation: this.generation, packetId: block.id,
				sequence: this.outputSequence, startFrame: this.outputFrame,
				frameCount: this.periodFrames, channels: block.channels,
			}, transfer(block.channels));
			this.outputSequence += 1;
			this.outputFrame += this.periodFrames;
		}
	}

	#read(output) {
		for (const channel of output) channel.fill(0);
		let written = 0;
		const frames = output[0]?.length || 0;
		while (written < frames) {
			if (!this.capturePacket) {
				this.capturePacket = this.captureQueue.shift() || null;
				this.captureOffset = 0;
				if (!this.capturePacket) {
					this.#recordTransfer(0, frames - written);
					return;
				}
			}
			const count = Math.min(frames - written, this.periodFrames - this.captureOffset);
			copyPlanes(this.capturePacket.channels, this.captureOffset, output, written, count);
			written += count;
			this.captureOffset += count;
			if (this.captureOffset !== this.periodFrames) continue;
			const block = this.capturePacket;
			this.capturePacket = null;
			this.#issueCapture(block);
		}
	}

	#message(message) {
		if (message?.protocolVersion !== 1 || message.generation !== this.generation) return this.#close('malformed-message');
		if (message.kind === 'return' && this.direction !== 'input') {
			const block = this.#adopt(message, this.outputBusy);
			if (block) this.outputFree.push(block);
			return;
		}
		if (message.kind === 'audio' && this.direction !== 'output') {
			const block = this.#adopt(message, this.captureBusy);
			if (!block || message.sequence !== this.captureReceived) return this.#close('malformed-message');
			this.captureReceived += 1;
			this.#scanCalibration(message);
			this.captureQueue.push(block);
			return;
		}
		if (message.kind === 'fault') return this.#close('peer-fault');
		this.#close('malformed-message');
	}

	#adopt(message, ledger) {
		const transferred = Number.isSafeInteger(message.framesTransferred)
			&& message.framesTransferred >= 0 && message.framesTransferred <= this.periodFrames
			? message.framesTransferred : 0;
		this.#recordTransfer(transferred, Math.max(0, this.periodFrames - transferred));
		if (message.status !== 'ok' || message.framesTransferred !== this.periodFrames) {
			this.#close(message.status === 'device-unavailable' ? 'device-loss'
				: message.status !== 'ok' ? 'device-fault' : 'short-transfer');
			return null;
		}
		const id = integer(message.packetId, 0, this.queueCapacity - 1, -1);
		if (!ledger.delete(id) || !planes(message.channels, this.channelCount, this.periodFrames)) {
			this.#close('pool-violation');
			return null;
		}
		return { id, channels: message.channels };
	}

	#issueCapture(block) {
		if (!this.portPeer) return;
		this.captureBusy.add(block.id);
		this.#send({
			protocolVersion: 1, kind: 'capture-credit', generation: this.generation,
			packetId: block.id, sequence: this.captureSequence, startFrame: this.captureFrame,
			frameCount: this.periodFrames, channels: block.channels,
		}, transfer(block.channels));
		this.captureSequence += 1;
		this.captureFrame += this.periodFrames;
	}

	#send(message, buffers = []) {
		try { this.portPeer?.postMessage(message, buffers); } catch { this.#close('peer-loss'); }
	}

	#close(reason) {
		const peer = this.portPeer;
		this.portPeer = null;
		if (!peer) return;
		this.#failCalibration(reason === 'cancelled' ? 'cancelled' : 'device-loss');
		try { peer.postMessage({ protocolVersion: 1, kind: 'close', reason }); } catch { /* lost */ }
		try { peer.close(); } catch { /* lost */ }
		this.#flushTransfer();
		this.#post({ type: NATIVE_DEVICE_IO_CONTROL.closed, generation: this.generation, reason });
	}

	#post(message) { try { this.port.postMessage(message); } catch { /* renderer left */ } }

	#beginCalibration(message) {
		const requestId = controlInteger(message, 'requestId', 1, Number.MAX_SAFE_INTEGER);
		const maxFrames = controlInteger(message, 'maxFrames', 1, 1_048_576);
		if (!exactKeys(message, ['type', 'requestId', 'maxFrames']) || requestId === null || maxFrames === null) {
			return this.#postCalibrationFailure(requestId ?? 1, 'invalid-request');
		}
		if (this.direction !== 'duplex') return this.#postCalibrationFailure(requestId, 'duplex-required');
		if (!this.portPeer) return this.#postCalibrationFailure(requestId, 'not-bound');
		if (this.calibration) return this.#postCalibrationFailure(requestId, 'busy');
		this.calibration = {
			requestId, maxFrames, armed: false, quietFrames: 0, injected: false,
			impulseFrame: 0, signatureOffset: 0, scannedFrames: 0,
			windows: Array.from({ length: this.channelCount }, () => []),
		};
	}

	#cancelCalibration(message) {
		const requestId = controlInteger(message, 'requestId', 1, Number.MAX_SAFE_INTEGER);
		if (!exactKeys(message, ['type', 'requestId']) || requestId === null
			|| this.calibration?.requestId !== requestId) return;
		this.#failCalibration('cancelled');
	}

	#scanCalibration(message) {
		const calibration = this.calibration;
		if (!calibration) return;
		if (!calibration.armed) {
			if (message.channels.some((channel) => channel.some(
				(sample) => Math.abs(sample) > CALIBRATION_QUIET_PEAK,
			))) return this.#failCalibration('input-not-quiet');
			calibration.quietFrames += this.periodFrames;
			if (calibration.quietFrames >= this.periodFrames) calibration.armed = true;
			return;
		}
		if (!calibration.injected) return;
		const startFrame = Number.isSafeInteger(message.startFrame) ? message.startFrame : 0;
		for (let frame = 0; frame < this.periodFrames; frame += 1) {
			const absolute = startFrame + frame;
			if (absolute < calibration.impulseFrame) continue;
			let matched = false;
			for (let channel = 0; channel < message.channels.length; channel += 1) {
				const window = calibration.windows[channel];
				window.push(message.channels[channel][frame]);
				if (window.length > CALIBRATION_SIGNATURE.length) window.shift();
				matched ||= window.length === CALIBRATION_SIGNATURE.length
					&& signatureCorrelation(window) >= CALIBRATION_CORRELATION;
			}
			if (matched) {
				const calibrationFrames = absolute - CALIBRATION_SIGNATURE.length + 1
					- calibration.impulseFrame;
				const requestId = calibration.requestId;
				this.calibration = null;
				this.#post({ type: NATIVE_DEVICE_IO_CONTROL.calibrationResult, requestId, calibrationFrames });
				return;
			}
			calibration.scannedFrames += 1;
			if (calibration.scannedFrames >= calibration.maxFrames) return this.#failCalibration('timeout');
		}
	}

	#failCalibration(reason) {
		if (!this.calibration) return;
		const { requestId } = this.calibration;
		this.calibration = null;
		this.#postCalibrationFailure(requestId, reason);
	}

	#postCalibrationFailure(requestId, reason) {
		this.#post({ type: NATIVE_DEVICE_IO_CONTROL.calibrationFailed, requestId, reason });
	}

	#recordTransfer(framesTransferred, lostFrames) {
		this.pendingTransferredFrames += framesTransferred;
		this.pendingLostFrames += lostFrames;
		this.pendingTransferEvents += 1;
		if (this.pendingTransferEvents >= 32) this.#flushTransfer();
	}

	#flushTransfer() {
		if (!this.pendingTransferredFrames && !this.pendingLostFrames) return;
		this.#post({
			type: NATIVE_DEVICE_IO_CONTROL.transfer,
			framesTransferred: this.pendingTransferredFrames,
			lostFrames: this.pendingLostFrames,
		});
		this.pendingTransferredFrames = 0;
		this.pendingLostFrames = 0;
		this.pendingTransferEvents = 0;
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(NATIVE_DEVICE_IO_WORKLET_NAME, NativeDeviceIoProcessor);
}

function packet(id, channelCount, frames) {
	return { id, channels: Array.from({ length: channelCount }, () => new Float32Array(frames)) };
}

function copyPlanes(source, sourceOffset, target, targetOffset, frames) {
	const sourceLast = Math.max(0, source.length - 1);
	for (let channel = 0; channel < target.length; channel += 1) {
		const from = source[Math.min(channel, sourceLast)];
		const to = target[channel];
		for (let frame = 0; frame < frames; frame += 1) to[targetOffset + frame] = from?.[sourceOffset + frame] || 0;
	}
}

function planes(value, channelCount, frames) {
	return Array.isArray(value) && value.length === channelCount
		&& value.every((plane) => plane instanceof Float32Array && plane.length === frames)
		&& new Set(value.map((plane) => plane.buffer)).size === value.length;
}

function transfer(value) { return value.map((plane) => plane.buffer); }
function integer(value, minimum, maximum, fallback) {
	return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
function requiredDirection(value) {
	if (!['input', 'output', 'duplex'].includes(value)) throw new TypeError('Invalid native device direction.');
	return value;
}
function requiredInteger(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Invalid native device ${label}.`);
	}
	return value;
}
function controlInteger(value, key, minimum, maximum) {
	return value && Number.isSafeInteger(value[key]) && value[key] >= minimum && value[key] <= maximum
		? value[key] : null;
}
function exactKeys(value, keys) {
	return value && typeof value === 'object' && !Array.isArray(value)
		&& Reflect.ownKeys(value).length === keys.length
		&& Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}
function signatureCorrelation(window) {
	let dot = 0;
	let energy = 0;
	let signatureEnergy = 0;
	for (let index = 0; index < CALIBRATION_SIGNATURE.length; index += 1) {
		dot += window[index] * CALIBRATION_SIGNATURE[index];
		energy += window[index] * window[index];
		signatureEnergy += CALIBRATION_SIGNATURE[index] * CALIBRATION_SIGNATURE[index];
	}
	return energy < 1e-6 ? 0 : Math.abs(dot) / Math.sqrt(energy * signatureEnergy);
}
