/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** One persistent native plug-in instance controlled only by its admitted port. */

const PROTOCOL_VERSION = 1;
const MAXIMUM_STATE_BYTES = 16 * 1_024 * 1_024;

export function createNativePersistentPluginJobRunner({
	loadAddon,
	addonPath,
	addonSha256,
	hashFile,
}) {
	if (typeof loadAddon !== 'function' || typeof hashFile !== 'function') {
		throw new TypeError('Persistent plug-in hosting requires addon and digest seams.');
	}
	let addon = null;
	return ({ grant, ports, resourcePolicy }) => {
		if (!grant.persistentPort || ports.length !== 1) {
			throw new TypeError('A persistent plug-in job requires its one admitted MessagePort.');
		}
		const port = ports[0];
		let instance = null;
		let configuration = null;
		let settled = false;
		let accepting = true;
		let generation = 1;
		let receiveTail = Promise.resolve();
		let resolveCompletion;
		const completion = new Promise((resolve) => { resolveCompletion = resolve; });
		const finish = async (reason) => {
			if (settled) return;
			accepting = false;
			generation += 1;
			settled = true;
			if (instance !== null) {
				try { await addon?.closePluginInstance?.(instance); } catch { /* already stopped */ }
				instance = null;
			}
			try { port.close(); } catch { /* peer already closed */ }
			resolveCompletion(Object.freeze({
				format: grant.format,
				binarySha256: grant.binarySha256,
				persistent: true,
				reason,
			}));
		};
		const current = (observedGeneration) => accepting && !settled && observedGeneration === generation;
		const receive = async (message, observedGeneration) => {
			if (!current(observedGeneration)) return;
			if (!message || message.protocolVersion !== PROTOCOL_VERSION || typeof message.kind !== 'string') {
				post(port, { protocolVersion: PROTOCOL_VERSION, kind: 'fault', code: 'malformed-answer' });
				return finish('malformed-answer');
			}
			try {
				if (message.kind === 'configure') {
					if (configuration !== null) return finish('duplicate-configure');
					configuration = Object.freeze({
						sampleRate: integer(message.sampleRate, 8_000, 768_000, 'sample rate'),
						maximumFrames: integer(message.maximumFrames, 1, 65_536, 'block ceiling'),
						stateAuthenticationKey: authenticationKey(message.stateAuthenticationKey),
					});
					const digest = await hashFile(grant.binaryPath);
					if (!current(observedGeneration)) return;
					if (digest.sha256 !== grant.binarySha256 || digest.byteLength !== grant.binaryBytes) {
						throw fault('identity-changed', 'The plug-in binary changed after it was granted.');
					}
					addon ??= await loadAddon({ addonPath, addonSha256 });
					if (!current(observedGeneration)) return;
					instance = await addon.openPluginInstance(
						grant.binaryPath,
						configuration.sampleRate,
						configuration.maximumFrames,
						grant.format,
						grant.stableId,
						{ identity: grant.identity, byteLength: grant.binaryBytes,
							sha256: grant.binarySha256, resourcePolicy },
					);
					if (!current(observedGeneration)) return;
					const reportedLatencyFrames = await addon.pluginLatencyFrames(instance);
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'configured',
						status: 'opened',
						format: grant.format,
						reportedLatencyFrames,
					});
					return;
				}
				if (message.kind === 'close') return finish(reason(message.reason));
				if (instance === null || configuration === null) return finish('message-before-configure');
				if (message.kind === 'process') {
					const frameCount = integer(message.frameCount, 1, configuration.maximumFrames, 'frame count');
					const input = planes(message.input, frameCount, true);
					const output = planes(message.output, frameCount, false);
					await addon.processPluginBlock(instance, frameCount, input.length === 0 ? null : input, output);
					if (!current(observedGeneration)) return;
					const reportedLatencyFrames = await addon.pluginLatencyFrames(instance);
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'processed',
						requestId: requestId(message.requestId),
						frameCount,
						input,
						output,
						reportedLatencyFrames,
					}, [...input, ...output].map(({ buffer }) => buffer));
					return;
				}
				if (message.kind === 'save-state') {
					const bytes = new Uint8Array(await addon.savePluginState(instance));
					if (!current(observedGeneration)) return;
					if (bytes.byteLength > MAXIMUM_STATE_BYTES) throw fault('oversize-state', 'Plug-in state exceeds 16 MiB.');
					const requestIdValue = requestId(message.requestId);
					const sha256 = createHash('sha256').update(bytes).digest('hex');
					const mac = createHmac('sha256', configuration.stateAuthenticationKey)
						.update(`${grant.persistentPort.streamId}\0${grant.binarySha256}\0${requestIdValue}\0${String(bytes.byteLength)}\0${sha256}`)
						.digest('hex');
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'state',
						requestId: requestIdValue,
						bytes,
						authentication: Object.freeze({ requestId: requestIdValue, byteLength: bytes.byteLength, sha256, mac }),
					}, [bytes.buffer]);
					return;
				}
				if (message.kind === 'load-state') {
					const bytes = ordinaryBytes(message.bytes);
					const restored = await addon.loadPluginState(instance, bytes);
					if (!current(observedGeneration)) return;
					if (restored !== true) throw fault('state-rejected', 'The plug-in rejected its state.');
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'state-loaded',
						requestId: requestId(message.requestId),
					});
					return;
				}
				if (message.kind === 'latency') {
					const reportedLatencyFrames = await addon.pluginLatencyFrames(instance);
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'latency',
						requestId: requestId(message.requestId),
						reportedLatencyFrames,
					});
					return;
				}
				if (message.kind === 'capabilities') {
					if (typeof addon.pluginCapabilities !== 'function') {
						throw fault('unsupported', 'This plug-in host exposes no generated controls.');
					}
					const capabilities = pluginCapabilities(await addon.pluginCapabilities(instance));
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'capabilities',
						requestId: requestId(message.requestId),
						...capabilities,
					});
					return;
				}
				if (message.kind === 'parameters') {
					if (typeof addon.describePluginParameters !== 'function') {
						throw fault('unsupported', 'This plug-in host exposes no generated controls.');
					}
					const parameters = pluginParameters(await addon.describePluginParameters(instance));
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'parameters',
						requestId: requestId(message.requestId),
						parameters,
					});
					return;
				}
				if (message.kind === 'parameter-get' || message.kind === 'parameter-set') {
					const index = integer(message.index, 0, 4_095, 'parameter index');
					const method = message.kind === 'parameter-get' ? 'readPluginParameter' : 'writePluginParameter';
					if (typeof addon[method] !== 'function') {
						throw fault('unsupported', 'This plug-in host exposes no generated controls.');
					}
					const value = normalizedParameterValue(message.kind === 'parameter-get'
						? await addon[method](instance, index)
						: await addon[method](instance, index, normalizedParameterValue(message.value)));
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'parameter-value',
						requestId: requestId(message.requestId),
						index,
						value,
					});
					return;
				}
				if (message.kind === 'open-vendor-ui' || message.kind === 'close-vendor-ui') {
					const method = message.kind === 'open-vendor-ui' ? 'openPluginVendorWindow' : 'closePluginVendorWindow';
					if (typeof addon[method] !== 'function') throw fault('vendor-ui-unavailable', 'This host has no vendor UI adapter.');
					const capability = vendorWindowCapability(
						message.windowHandleId, grant, configuration.stateAuthenticationKey,
					);
					const outcome = await addon[method](instance, capability);
					if (!current(observedGeneration)) return;
					post(port, {
						protocolVersion: PROTOCOL_VERSION,
						kind: 'vendor-ui',
						requestId: requestId(message.requestId),
						status: outcome === false ? 'refused' : (message.kind === 'open-vendor-ui' ? 'opened' : 'closed'),
					});
					return;
				}
				throw fault('malformed-answer', 'The plug-in RPC kind is unknown.');
			} catch (error) {
				if (!current(observedGeneration)) return;
				post(port, {
					protocolVersion: PROTOCOL_VERSION,
					kind: 'fault',
					code: error?.code ?? 'crash',
					detail: text(error),
				});
				await finish(error?.code ?? 'crash');
			}
		};
		listen(port, (value) => {
			const observedGeneration = generation;
			receiveTail = receiveTail.then(() => receive(value, observedGeneration));
		});
		port.start?.();
		return Object.freeze({
			completion,
			cancel: async () => {
				if (settled) return;
				accepting = false;
				generation += 1;
				await receiveTail;
				await finish('user-cancelled');
			},
		});
	};
}

function planes(value, frames, optional) {
	if (optional && (value === null || (Array.isArray(value) && value.length === 0))) return [];
	if (!Array.isArray(value) || value.length < 1 || value.length > 4_096) throw new TypeError('Plug-in planes are malformed.');
	const seen = new Set();
	for (const plane of value) {
		if (!(plane instanceof Float32Array) || plane.length !== frames || seen.has(plane.buffer)) {
			throw new TypeError('Plug-in planes must be distinct exact Float32Array buffers.');
		}
		seen.add(plane.buffer);
	}
	return value;
}

function ordinaryBytes(value) {
	if (!(value instanceof Uint8Array) || value.byteLength > MAXIMUM_STATE_BYTES
		|| (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer)) {
		throw fault('oversize-state', 'Plug-in state must be at most 16 MiB of ordinary bytes.');
	}
	return value;
}

function pluginCapabilities(value) {
	if (!value || typeof value !== 'object') throw new TypeError('Plug-in capabilities are malformed.');
	return Object.freeze({
		parameterCount: integer(value.parameterCount, 0, 4_096, 'parameter count'),
		hasVendorUi: boolean(value.hasVendorUi, 'vendor UI capability'),
	});
}

function pluginParameters(value) {
	if (!Array.isArray(value) || value.length > 4_096) throw new TypeError('Plug-in parameters are malformed.');
	const found = value.map((parameter, index) => pluginParameter(parameter, index));
	if (new Set(found.map(({ id }) => id)).size !== found.length) {
		throw new TypeError('Plug-in parameter IDs must be unique.');
	}
	return Object.freeze(found);
}

function pluginParameter(value, index) {
	if (!value || typeof value !== 'object' || value.index !== index) {
		throw new TypeError('A plug-in parameter is malformed.');
	}
	const minimumValue = normalizedParameterValue(value.minimumValue);
	const defaultValue = normalizedParameterValue(value.defaultValue);
	const maximumValue = normalizedParameterValue(value.maximumValue);
	if (minimumValue > defaultValue || defaultValue > maximumValue) {
		throw new RangeError('A plug-in parameter range is malformed.');
	}
	return Object.freeze({
		index,
		id: parameterText(value.id, false),
		name: parameterText(value.name, false),
		label: parameterText(value.label, true),
		defaultValue,
		minimumValue,
		maximumValue,
		flags: integer(value.flags, 0, 15, 'parameter flags'),
	});
}

function normalizedParameterValue(value) {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError('A normalized plug-in parameter value is required.');
	}
	return value;
}

function parameterText(value, allowEmpty) {
	if (typeof value !== 'string' || (!allowEmpty && value.length < 1)
		|| Buffer.byteLength(value, 'utf8') > 512 || value.includes('\0')) {
		throw new TypeError('Plug-in parameter text is malformed.');
	}
	return value;
}

function boolean(value, label) {
	if (typeof value !== 'boolean') throw new TypeError(`Invalid plug-in ${label}.`);
	return value;
}

function integer(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid plug-in ${label}.`);
	return value;
}

function requestId(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('A bounded plug-in RPC id is required.');
	}
	return value;
}

function authenticationKey(value) {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new TypeError('A state authentication key is required.');
	return Buffer.from(value, 'hex');
}

function vendorWindowCapability(value, grant, authentication) {
	if (typeof value !== 'string') throw fault('vendor-ui-unavailable', 'The vendor-window capability is invalid.');
	const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,62})\.([a-f\d]{64})$/u.exec(value);
	if (match === null) throw fault('vendor-ui-unavailable', 'The vendor-window capability is invalid.');
	const expected = createHmac('sha256', authentication)
		.update(`${grant.persistentPort.streamId}\0${grant.binarySha256}\0vendor-window\0${match[1]}`)
		.digest();
	if (!timingSafeEqual(expected, Buffer.from(match[2], 'hex'))) {
		throw fault('vendor-ui-unavailable', 'The vendor-window capability was not minted by main.');
	}
	return value;
}

function reason(value) {
	return typeof value === 'string' && /^[a-z][a-z-]{0,63}$/u.test(value) ? value : 'user-cancelled';
}

function fault(code, message) {
	return Object.assign(new Error(message), { code });
}

function text(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 2_048);
}

function listen(port, listener) {
	if (typeof port.on === 'function') port.on('message', (event) => listener(event?.data ?? event));
	else port.onmessage = (event) => listener(event?.data);
}

function post(port, message, transfer = []) {
	port.postMessage(message, transfer);
}
