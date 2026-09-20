/* SPDX-License-Identifier: AGPL-3.0-only */

/** One persistent Vamp analyzer controlled only by its admitted MessagePort. */

const PROTOCOL_VERSION = 1;
const MAXIMUM_TEXT = 512;
const MAXIMUM_CHANNELS = 64;
const MAXIMUM_BLOCK_FRAMES = 1_048_576;
const MAXIMUM_CHUNK_FRAMES = 65_536;
const MAXIMUM_CHUNK_BYTES = 16 * 1_024 * 1_024;
const MAXIMUM_PARAMETERS = 256;
const MAXIMUM_SESSION_SECONDS = 12 * 60 * 60;

export function createNativePersistentVampAnalyzerJobRunner({
	loadAddon, addonPath, addonSha256, hashFile,
}) {
	if (typeof loadAddon !== 'function' || typeof hashFile !== 'function') {
		throw new TypeError('Persistent Vamp analysis requires peer and digest seams.');
	}
	let addon = null;
	return ({ grant, ports, resourcePolicy }) => {
		if (!grant?.persistentPort || grant.format !== 'vamp' || ports?.length !== 1) {
			throw new TypeError('A persistent Vamp analyzer job requires its one admitted MessagePort.');
		}
		const port = ports[0];
		let instance = null;
		let configuration = null;
		let nextFrame = 0;
		let accepting = true;
		let settled = false;
		let cancelled = false;
		let finished = false;
		let generation = 1;
		let receiveTail = Promise.resolve();
		let resolveCompletion;
		const completion = new Promise((resolve) => { resolveCompletion = resolve; });
		const current = (observed) => accepting && !settled && observed === generation;
		const finish = async (reason, cancel = false) => {
			if (settled) return;
			accepting = false;
			generation += 1;
			settled = true;
			if (instance !== null) {
				if (cancel && !cancelled && !finished) {
					try { await addon?.cancelAnalyzer?.(instance); } catch { /* child is already stopping */ }
					cancelled = true;
				}
				try { await addon?.closeAnalyzer?.(instance); } catch { /* child is already stopped */ }
				instance = null;
			}
			try { port.close(); } catch { /* peer already closed */ }
			resolveCompletion(Object.freeze({
				format: 'vamp', binarySha256: grant.binarySha256, persistent: true, reason,
			}));
		};
		const receive = async (message, observed) => {
			if (!current(observed)) return;
			if (!record(message) || message.protocolVersion !== PROTOCOL_VERSION || typeof message.kind !== 'string') {
				post(port, { protocolVersion: PROTOCOL_VERSION, kind: 'fault', code: 'malformed-message' });
				return finish('malformed-message', true);
			}
			try {
				if (message.kind === 'configure') {
					exactKeys(message, ['protocolVersion', 'kind', 'requestId', 'configuration']);
					if (configuration !== null) throw fault('duplicate-configure', 'The Vamp analyzer is already configured.');
					const requestIdValue = requestId(message.requestId);
					configuration = analyzerConfiguration(message.configuration);
					const digest = await hashFile(grant.binaryPath);
					if (!current(observed)) return;
					if (digest.sha256 !== grant.binarySha256 || digest.byteLength !== grant.binaryBytes
						|| digest.identity?.dev !== grant.identity.dev || digest.identity?.ino !== grant.identity.ino) {
						throw fault('identity-changed', 'The Vamp library changed after it was granted.');
					}
					addon ??= await loadAddon({ addonPath, addonSha256 });
					if (!current(observed)) return;
					instance = await addon.openExactAnalyzer(
						grant.binaryPath, grant.stableId, configuration.sampleRate,
						{ identity: grant.identity, byteLength: grant.binaryBytes,
							sha256: grant.binarySha256, resourcePolicy },
					);
					if (!current(observed)) return;
					const configured = await addon.configureAnalyzer(instance, configuration);
					if (!current(observed)) return;
					const outputs = analyzerOutputs(configured?.outputs);
					post(port, {
						protocolVersion: PROTOCOL_VERSION, kind: 'configured', requestId: requestIdValue,
						outputs,
					});
					return;
				}
				if (message.kind === 'close') {
					exactKeys(message, ['protocolVersion', 'kind', 'reason']);
					return finish(reason(message.reason), false);
				}
				if (instance === null || configuration === null) {
					throw fault('message-before-configure', 'The Vamp analyzer is not configured.');
				}
				if (message.kind === 'process') {
					exactKeys(message, ['protocolVersion', 'kind', 'requestId', 'chunk']);
					const requestIdValue = requestId(message.requestId);
					const chunk = pcmChunk(message.chunk, configuration, nextFrame);
					const features = await addon.processAnalyzerPcm(instance, chunk);
					if (!current(observed)) return;
					nextFrame += chunk.frameCount;
					post(port, {
						protocolVersion: PROTOCOL_VERSION, kind: 'features', requestId: requestIdValue, features,
					});
					return;
				}
				if (message.kind === 'finish') {
					exactKeys(message, ['protocolVersion', 'kind', 'requestId']);
					if (finished || cancelled || nextFrame !== configuration.frameCount) {
						throw fault('incomplete-stream', 'The Vamp analyzer cannot finish an incomplete stream.');
					}
					const requestIdValue = requestId(message.requestId);
					const features = await addon.finishAnalyzer(instance);
					if (!current(observed)) return;
					finished = true;
					post(port, {
						protocolVersion: PROTOCOL_VERSION, kind: 'finished', requestId: requestIdValue, features,
					});
					return;
				}
				if (message.kind === 'cancel') {
					exactKeys(message, ['protocolVersion', 'kind', 'requestId', 'reason']);
					const requestIdValue = requestId(message.requestId);
					if (!cancelled && !finished) await addon.cancelAnalyzer(instance);
					if (!current(observed)) return;
					cancelled = true;
					post(port, {
						protocolVersion: PROTOCOL_VERSION, kind: 'cancelled', requestId: requestIdValue,
					});
					return;
				}
				throw fault('malformed-message', 'The Vamp analyzer RPC kind is unknown.');
			} catch (error) {
				if (!current(observed)) return;
				post(port, {
					protocolVersion: PROTOCOL_VERSION, kind: 'fault',
					code: error?.code ?? 'analyzer-fault', detail: text(error),
				});
				await finish(error?.code ?? 'analyzer-fault', true);
			}
		};
		listen(port, (value) => {
			const observed = generation;
			receiveTail = receiveTail.then(() => receive(value, observed));
		});
		port.start?.();
		return Object.freeze({
			completion,
			cancel: async () => {
				if (settled) return;
				accepting = false;
				generation += 1;
				await receiveTail;
				await finish('user-cancelled', true);
			},
		});
	};
}

function analyzerConfiguration(value) {
	if (!record(value)) throw new TypeError('A Vamp analyzer configuration record is required.');
	exactKeys(value, ['sampleRate', 'channelCount', 'stepSize', 'blockSize', 'frameCount', 'parameters', 'program']);
	const sampleRate = integer(value.sampleRate, 8_000, 768_000, 'sample rate');
	const channelCount = integer(value.channelCount, 1, MAXIMUM_CHANNELS, 'channel count');
	const blockSize = integer(value.blockSize, 1, MAXIMUM_BLOCK_FRAMES, 'block size');
	const stepSize = integer(value.stepSize, 1, blockSize, 'step size');
	const frameCount = integer(value.frameCount, 0, sampleRate * MAXIMUM_SESSION_SECONDS, 'frame count');
	if (!record(value.parameters) || Object.keys(value.parameters).length > MAXIMUM_PARAMETERS) {
		throw new TypeError('Vamp analyzer parameters are malformed.');
	}
	const parameters = {};
	for (const [identifier, parameter] of Object.entries(value.parameters)) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,255}$/u.test(identifier) || !Number.isFinite(parameter)) {
			throw new TypeError('A Vamp analyzer parameter is malformed.');
		}
		parameters[identifier] = parameter;
	}
	const program = value.program === null ? null : boundedText(value.program, MAXIMUM_TEXT, 'program');
	return Object.freeze({ sampleRate, channelCount, stepSize, blockSize, frameCount,
		parameters: Object.freeze(parameters), program });
}

function pcmChunk(value, configuration, expectedStartFrame) {
	if (!record(value)) throw new TypeError('A Vamp PCM chunk record is required.');
	exactKeys(value, ['startFrame', 'frameCount', 'channels']);
	const startFrame = integer(value.startFrame, 0, configuration.frameCount, 'PCM start frame');
	if (startFrame !== expectedStartFrame) throw new RangeError('Vamp PCM must be contiguous.');
	const frameCount = integer(value.frameCount, 1, MAXIMUM_CHUNK_FRAMES, 'PCM frame count');
	if (!Array.isArray(value.channels) || value.channels.length !== configuration.channelCount
		|| frameCount * value.channels.length * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_CHUNK_BYTES
		|| startFrame + frameCount > configuration.frameCount) throw new RangeError('Vamp PCM topology is invalid.');
	const buffers = new Set();
	const channels = value.channels.map((channel) => {
		if (!(channel instanceof Float32Array) || channel.length !== frameCount
			|| buffers.has(channel.buffer)
			|| (typeof SharedArrayBuffer !== 'undefined' && channel.buffer instanceof SharedArrayBuffer)) {
			throw new TypeError('Vamp PCM requires distinct ordinary exact Float32Array planes.');
		}
		buffers.add(channel.buffer);
		for (const sample of channel) if (!Number.isFinite(sample)) throw new TypeError('Vamp PCM must be finite.');
		return channel;
	});
	return Object.freeze({ startFrame, frameCount, channels: Object.freeze(channels) });
}

function analyzerOutputs(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
		throw new RangeError('The Vamp peer returned an invalid output set.');
	}
	return Object.freeze(value);
}

function record(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype
		&& Object.values(Object.getOwnPropertyDescriptors(value)).every(({ get, set }) => !get && !set);
}

function exactKeys(value, expected) {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
		throw new TypeError('A Vamp analyzer RPC message has invalid keys.');
	}
}

function integer(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Invalid Vamp analyzer ${label}.`);
	}
	return value;
}

function boundedText(value, maximum, label) {
	if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`Invalid Vamp analyzer ${label}.`);
	}
	return value;
}

function requestId(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('A bounded Vamp analyzer RPC id is required.');
	}
	return value;
}

function reason(value) {
	return typeof value === 'string' && /^[a-z][a-z-]{0,63}$/u.test(value) ? value : 'user-cancelled';
}

function fault(code, message) { return Object.assign(new Error(message), { code }); }
function text(error) { return (error instanceof Error ? error.message : String(error)).slice(0, 2_048); }

function listen(port, listener) {
	if (typeof port.on === 'function') port.on('message', (event) => listener(event?.data ?? event));
	else port.onmessage = (event) => listener(event?.data);
}

function post(port, message) { port.postMessage(message); }
