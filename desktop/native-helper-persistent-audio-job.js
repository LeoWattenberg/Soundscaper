/* SPDX-License-Identifier: AGPL-3.0-only */

/** Persistent helper-side native audio session over the admitted MessagePort. */

const PROTOCOL_VERSION = 1;
const DIRECTION = Object.freeze({ input: 0, output: 1, duplex: 2 });
const REFUSAL = Object.freeze({
	'backend-unavailable': 'backend-absent',
	'server-unavailable': 'server-absent',
	'device-unavailable': 'device-unavailable',
	'format-refused': 'format-refused',
	'mode-refused': 'mode-refused',
	'invalid-request': 'invalid-request',
});

export function createNativePersistentAudioJobRunner({ loadAddon, addonPath, addonSha256 }) {
	if (typeof loadAddon !== 'function') throw new TypeError('A native addon loader is required.');
	let addon = null;
	return ({ grant, ports }) => {
		if (!grant.persistentPort || ports.length !== 1) {
			throw new TypeError('A persistent audio job requires its one admitted MessagePort.');
		}
		const port = ports[0];
		let session = null;
		let configured = null;
		let settled = false;
		let resolveCompletion;
		const completion = new Promise((resolve) => { resolveCompletion = resolve; });
		const finish = (reason) => {
			if (settled) return;
			settled = true;
			if (session !== null) {
				try { addon?.closeAudioDevice?.(session); } catch { /* already gone */ }
				session = null;
			}
			try { port.close(); } catch { /* peer already closed */ }
			resolveCompletion(Object.freeze({
				backend: grant.backend,
				deviceHandle: grant.deviceHandle,
				persistent: true,
				reason,
			}));
		};
		const receive = async (message) => {
			if (settled) return;
			if (message?.protocolVersion !== PROTOCOL_VERSION || typeof message.kind !== 'string') {
				post(port, { protocolVersion: PROTOCOL_VERSION, kind: 'fault', code: 'malformed-message' });
				finish('malformed-message');
				return;
			}
			if (message.kind === 'configure') {
				if (configured !== null) return finish('duplicate-configure');
				try {
					configured = normalizeConfiguration(message);
					addon ??= await loadAddon({ addonPath, addonSha256 });
					const opened = addon.openAudioDevice({
						candidates: [{ backend: grant.backend, deviceHandle: grant.deviceHandle }],
						direction: DIRECTION[grant.direction],
						exclusive: grant.mode === 'exclusive' ? 1 : 0,
						sampleRate: configured.sampleRate,
						periodFrames: configured.periodFrames,
						channelCount: configured.channelCount,
					});
					if (opened?.status !== 'ok') {
						post(port, {
							protocolVersion: PROTOCOL_VERSION,
							kind: 'configured',
							status: 'refused',
							code: REFUSAL[opened?.status] ?? 'open-failed',
							detail: boundedText(opened?.detail),
						});
						finish('open-refused');
						return;
					}
					session = opened.session;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'configured',
						status: 'opened',
						backend: opened.grantedBackend,
						format: {
							direction: grant.direction,
							mode: opened.grantedExclusive ? 'exclusive' : 'shared',
							sampleRate: opened.grantedSampleRate,
							periodFrames: opened.grantedPeriodFrames,
							channelCount: opened.grantedChannelCount,
						},
					});
				} catch (error) {
					post(port, { protocolVersion: PROTOCOL_VERSION, kind: 'fault', code: 'open-failed', detail: boundedText(error) });
					finish('open-failed');
				}
				return;
			}
			if (message.kind === 'close') return finish(boundedReason(message.reason));
			if (session === null || configured === null) return finish('message-before-configure');
			if (message.kind === 'audio' && grant.direction !== 'input') {
				const block = normalizeAudioBlock(message, configured);
				const transferred = addon.writeAudioDevice(session, block.frameCount, block.channels);
				post(port, {
					protocolVersion: PROTOCOL_VERSION,
					kind: 'return',
					generation: block.generation,
					packetId: block.packetId,
					sequence: block.sequence,
					channels: block.channels,
					framesTransferred: transferred.framesTransferred ?? 0,
					status: transferred.status,
				}, block.channels.map(({ buffer }) => buffer));
				if (transferred.status !== 'ok' || transferred.framesTransferred !== block.frameCount) {
					finish(transferred.status === 'device-unavailable' ? 'device-loss' : 'transfer-failed');
				}
				return;
			}
			if (message.kind === 'capture-credit' && grant.direction !== 'output') {
				const block = normalizeCaptureCredit(message, configured);
				const transferred = addon.readAudioDevice(session, block.frameCount, block.channels);
				post(port, {
					protocolVersion: PROTOCOL_VERSION,
					kind: 'audio',
					generation: block.generation,
					packetId: block.packetId,
					sequence: block.sequence,
					startFrame: block.startFrame,
					frameCount: block.frameCount,
					channels: block.channels,
					framesTransferred: transferred.framesTransferred ?? 0,
					status: transferred.status,
				}, block.channels.map(({ buffer }) => buffer));
				if (transferred.status !== 'ok' || transferred.framesTransferred !== block.frameCount) {
					finish(transferred.status === 'device-unavailable' ? 'device-loss' : 'transfer-failed');
				}
			}
		};
		listen(port, (value) => { void receive(value); });
		port.start?.();
		return Object.freeze({ completion, cancel: async () => finish('cancelled') });
	};
}

function normalizeConfiguration(value) {
	return Object.freeze({
		sampleRate: integer(value.sampleRate, 8_000, 768_000, 'sample rate'),
		periodFrames: integer(value.periodFrames, 1, 16_384, 'period frames'),
		channelCount: integer(value.channelCount, 1, 32, 'channel count'),
	});
}

function normalizeAudioBlock(value, configuration) {
	const frameCount = integer(value.frameCount, 1, configuration.periodFrames, 'frame count');
	return Object.freeze({
		generation: integer(value.generation, 1, Number.MAX_SAFE_INTEGER, 'generation'),
		packetId: integer(value.packetId, 0, 31, 'packet id'),
		sequence: integer(value.sequence, 0, Number.MAX_SAFE_INTEGER, 'sequence'),
		startFrame: integer(value.startFrame, 0, Number.MAX_SAFE_INTEGER, 'start frame'),
		frameCount,
		channels: channels(value.channels, configuration.channelCount, frameCount),
	});
}

function normalizeCaptureCredit(value, configuration) {
	return normalizeAudioBlock({ ...value, kind: 'audio' }, configuration);
}

function channels(value, count, frames) {
	if (!Array.isArray(value) || value.length !== count) throw new TypeError('An audio block has the wrong channel count.');
	const seen = new Set();
	for (const plane of value) {
		if (!(plane instanceof Float32Array) || plane.length !== frames || seen.has(plane.buffer)) {
			throw new TypeError('An audio block must carry distinct exact planar Float32Array buffers.');
		}
		seen.add(plane.buffer);
	}
	return value;
}

function integer(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`The persistent audio ${label} is outside its bounds.`);
	}
	return value;
}

function listen(port, listener) {
	if (typeof port.on === 'function') port.on('message', (event) => listener(event?.data ?? event));
	else port.onmessage = (event) => listener(event?.data);
}

function post(port, message, transfer = []) {
	port.postMessage(message, transfer);
}

function boundedText(value) {
	const text = value instanceof Error ? value.message : String(value ?? 'The native audio backend refused the request.');
	return text.slice(0, 2_048);
}

function boundedReason(value) {
	return typeof value === 'string' && /^[a-z][a-z-]{0,63}$/u.test(value) ? value : 'peer-closed';
}
