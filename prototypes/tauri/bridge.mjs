/* SPDX-License-Identifier: AGPL-3.0-only */

export const PROTOTYPE_READ_CHUNK_BYTES = 1024 * 1024;
// The prototype uses JSON for writes only. This is a throughput limitation,
// kept bounded until a native binary upload transport is qualified.
export const PROTOTYPE_WRITE_CHUNK_BYTES = 128 * 1024;
const READ_PREFIX = 'prototype-read:';
const READ_PROFILES = new Set(['materialized-v1', 'selected-range-v1', 'scape-range-v1']);

/**
 * @typedef {(command: string, arguments_?: Record<string, unknown>) => Promise<unknown>} Invoke
 * @typedef {(event: string, listener: (event: {payload: unknown}) => void) => Promise<() => void>} Listen
 * @typedef {{id: string, name: string, size: number, mimeType: string, readProfile: string, url: string, lastModified: number}} ReadDescriptor
 */

/**
 * Adapt only the existing desktop file and close contracts. Codec, plug-in,
 * AI, project-library and native-audio methods are intentionally absent.
 * @param {{invoke: Invoke, fetch: typeof globalThis.fetch, listen?: Listen}} options
 */
export function createTauriPrototypeBridge(options) {
	if (typeof options.invoke !== 'function' || typeof options.fetch !== 'function') {
		throw new TypeError('The prototype requires native invoke and ordinary fetch.');
	}
	/** @type {Map<string, ReadDescriptor>} */
	const reads = new Map();
	/** @type {Set<string>} */
	const targets = new Set();
	/** @type {Set<Promise<void>>} */
	const subscriptions = new Set();
	/** @type {Set<() => void>} */
	const unsubscribers = new Set();
	let disposed = false;
	/** @type {Invoke} */
	const invoke = async (command, arguments_) => {
		if (disposed) throw new Error('The prototype bridge is disposed.');
		try { return await options.invoke(command, arguments_); }
		catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
	};

	/** @param {string} event @param {(payload: Record<string, unknown>) => void} listener */
	function subscribe(event, listener) {
		if (typeof listener !== 'function') throw new TypeError('An event listener is required.');
		if (!options.listen) return () => {};
		let active = true;
		let stop = () => {};
		const unsubscribe = () => {
			if (!active) return;
			active = false;
			stop();
			unsubscribers.delete(unsubscribe);
		};
		unsubscribers.add(unsubscribe);
		const registration = options.listen(event, ({ payload }) => {
			if (!active) return;
			const value = record(payload);
			if (event === 'prototype-close-requested') listener({ requestId: identifier(value.requestId) });
			else listener({ fullscreen: value.fullscreen === true, maximized: value.maximized === true });
		}).then(unlisten => {
			stop = unlisten;
			if (!active) stop();
		});
		subscriptions.add(registration);
		// signalReady awaits registration failures. Subscribe itself must return a
		// synchronous cleanup function for the existing React lifecycle.
		void registration.catch(() => undefined);
		return unsubscribe;
	}

	const api = Object.freeze({
		version: 1,
		getEnvironment: () => invoke('prototype_environment'),
		/** @param {{purpose?: string, multiple?: boolean}} request */
		async chooseFiles(request = {}) {
			const result = await invoke('prototype_choose_files', { request: {
				purpose: boundedText(request.purpose ?? 'audio', 24), multiple: request.multiple === true,
			} });
			if (!Array.isArray(result) || result.length > 256) throw new TypeError('Invalid native read descriptors.');
			try {
				if (disposed) throw new Error('The prototype bridge is disposed.');
				const descriptors = result.map(readDescriptor);
				for (const descriptor of descriptors) reads.set(descriptor.id, descriptor);
				return Object.freeze(descriptors);
			} catch (error) {
				const ids = result.flatMap(value => {
					try { return [identifier(record(value).id)]; }
					catch { return []; }
				});
				// Disposal may have occurred while the native dialog was open. Cleanup
				// bypasses the disposed adapter guard and preserves the original error.
				await Promise.allSettled(ids.map(id => options.invoke('prototype_release_read', { id })));
				throw error;
			}
		},
		/** @param {string} id */
		async releaseRead(id) {
			identifier(id);
			reads.delete(id);
			return invoke('prototype_release_read', { id });
		},
		/** @param {{purpose?: string, suggestedName?: string}} request */
		async chooseSaveTarget(request = {}) {
			const result = await invoke('prototype_choose_save_target', { request: {
				purpose: boundedText(request.purpose ?? 'audio', 24),
				suggestedName: boundedText(request.suggestedName ?? 'Untitled', 220),
			} });
			if (result === null) {
				if (disposed) throw new Error('The prototype bridge is disposed.');
				return null;
			}
			let id;
			try {
				const value = record(result);
				id = identifier(value.id);
				if (disposed) throw new Error('The prototype bridge is disposed.');
				const target = Object.freeze({ id, name: boundedText(value.name, 255) });
				targets.add(id);
				return target;
			} catch (error) {
				if (id !== undefined) await Promise.allSettled([options.invoke('prototype_release_target', { id })]);
				throw error;
			}
		},
		/** @param {{targetId: string, size?: number, maximumSize?: number, finalPrefixByteLength?: number}} request */
		async beginWrite(request) {
			const declaration = writeDeclaration(request);
			const result = record(await invoke('prototype_begin_write', { request: declaration }));
			const session = Object.freeze({ writeId: identifier(result.writeId),
				chunkSize: Math.min(PROTOTYPE_WRITE_CHUNK_BYTES, positiveInteger(result.chunkSize)),
			});
			targets.delete(declaration.targetId);
			return session;
		},
		/** @param {{writeId: string, offset: number, bytes: Uint8Array | ArrayBuffer}} request */
		async writeChunk(request) {
			const bytes = binary(request.bytes);
			if (bytes.byteLength > PROTOTYPE_WRITE_CHUNK_BYTES) throw new RangeError('Prototype write chunk exceeds 128 KiB.');
			const result = record(await invoke('prototype_write_chunk', { request: {
				writeId: identifier(request.writeId), offset: integer(request.offset), bytes: Array.from(bytes),
			} }));
			return Object.freeze({ nextOffset: integer(result.nextOffset) });
		},
		/** @param {{writeId: string, bytes: Uint8Array | ArrayBuffer}} request */
		async patchFinalPrefix(request) {
			const bytes = binary(request.bytes);
			if (bytes.byteLength !== 32) throw new RangeError('A final prefix must contain exactly 32 bytes.');
			const result = record(await invoke('prototype_patch_final_prefix', { request: {
				writeId: identifier(request.writeId), bytes: Array.from(bytes),
			} }));
			return Object.freeze({ byteLength: integer(result.byteLength) });
		},
		/** @param {string} id */
		async finishWrite(id) {
			const result = record(await invoke('prototype_finish_write', { id: identifier(id) }));
			return Object.freeze({ byteLength: integer(result.byteLength) });
		},
		/** @param {string} id */
		abortWrite: id => invoke('prototype_abort_write', { id: identifier(id) }),
		async signalReady() {
			await Promise.all(subscriptions);
			return invoke('prototype_signal_ready');
		},
		/** @param {(request: Record<string, unknown>) => void} listener */
		onCloseRequested: listener => subscribe('prototype-close-requested', listener),
		/** @param {(state: Record<string, unknown>) => void} listener */
		onWindowStateChanged: listener => subscribe('prototype-window-state', listener),
		/** @param {{requestId: string, allow: boolean}} request */
		respondToClose: request => invoke('prototype_respond_to_close', { request: {
			requestId: identifier(request.requestId), allow: request.allow === true,
		} }),
		/** @param {string} action */
		runWindowAction(action) {
			if (!['minimize', 'toggle-maximize', 'toggle-fullscreen', 'quit'].includes(action)) throw new TypeError('Unsupported prototype window action.');
			return invoke('prototype_window_action', { action });
		},
	});

	/** @type {typeof globalThis.fetch} */
	const fetch = async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		if (!url.startsWith(READ_PREFIX)) return options.fetch(input, init);
		if (disposed) throw new Error('The prototype bridge is disposed.');
		const id = identifier(url.slice(READ_PREFIX.length));
		const descriptor = reads.get(id);
		if (!descriptor) throw new Error('Unknown or released native read capability.');
		const request = new Request(input, init);
		request.signal.throwIfAborted();
		const headers = new Headers({ 'Content-Type': descriptor.mimeType, 'Accept-Ranges': 'bytes' });
		if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
		const requestedRange = request.headers.get('Range');
		const range = byteRange(requestedRange, descriptor.size);
		if (!range) {
			headers.set('Content-Range', `bytes */${descriptor.size}`);
			return new Response(null, { status: 416, headers });
		}
		headers.set('Content-Length', String(range.length));
		if (requestedRange) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${descriptor.size}`);
		const status = requestedRange ? 206 : 200;
		if (request.method === 'HEAD' || range.length === 0) return new Response(null, { status, headers });
		const body = nativeReadStream({ invoke, id, ...range, signal: request.signal,
			isValid: () => !disposed && reads.get(id) === descriptor,
		});
		return new Response(body, { status, headers });
	};

	return Object.freeze({ bridge: Object.freeze({ v1: api }), fetch,
		async dispose() {
			if (disposed) return;
			for (const unsubscribe of unsubscribers) unsubscribe();
			await Promise.allSettled(subscriptions);
			const ids = [...reads.keys()];
			const targetIds = [...targets];
			reads.clear();
			targets.clear();
			disposed = true;
			await Promise.allSettled([
				...ids.map(id => options.invoke('prototype_release_read', { id })),
				...targetIds.map(id => options.invoke('prototype_release_target', { id })),
			]);
		},
	});
}

/** @param {{invoke: Invoke, id: string, offset: number, length: number, signal: AbortSignal, isValid: () => boolean}} options */
function nativeReadStream(options) {
	let offset = options.offset;
	const end = offset + options.length;
	let terminal = false;
	let removeAbort = () => {};
	const finish = () => { terminal = true; removeAbort(); };
	return new ReadableStream({
		start(controller) {
			const abort = () => { if (!terminal) { finish(); controller.error(options.signal.reason); } };
			options.signal.addEventListener('abort', abort, { once: true });
			removeAbort = () => options.signal.removeEventListener('abort', abort);
			if (options.signal.aborted) abort();
		},
		async pull(controller) {
			if (terminal) return;
			try {
				if (!options.isValid()) throw new Error('The native read capability was released.');
				const length = Math.min(PROTOTYPE_READ_CHUNK_BYTES, end - offset);
				const value = await options.invoke('prototype_read_range', { id: options.id, offset, length });
				if (terminal) return;
				if (!options.isValid()) throw new Error('The native read capability was released.');
				const bytes = binary(value);
				if (bytes.byteLength !== length) throw new Error('The native read returned an inexact byte length.');
				offset += length;
				controller.enqueue(bytes);
				if (offset === end) { finish(); controller.close(); }
			} catch (error) {
				if (!terminal) { finish(); controller.error(error); }
			}
		},
		cancel() { finish(); },
	}, { highWaterMark: 0 });
}

/** @param {string | null} range @param {number} size */
function byteRange(range, size) {
	if (range === null) return { offset: 0, length: size };
	const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
	if (!match || (!match[1] && !match[2]) || size === 0) return null;
	const first = match[1] ? Number(match[1]) : null;
	const last = match[2] ? Number(match[2]) : null;
	if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
	if (first === null) return last > 0 ? { offset: Math.max(0, size - last), length: Math.min(size, last) } : null;
	if (first >= size || (last !== null && last < first)) return null;
	return { offset: first, length: Math.min(last ?? size - 1, size - 1) - first + 1 };
}

/** @param {unknown} value @returns {ReadDescriptor} */
function readDescriptor(value) {
	const descriptor = record(value);
	const id = identifier(descriptor.id);
	const readProfile = boundedText(descriptor.readProfile, 32);
	if (!READ_PROFILES.has(readProfile)) throw new TypeError('Unsupported native read descriptor profile.');
	return Object.freeze({ id, name: boundedText(descriptor.name, 255), size: integer(descriptor.size),
		mimeType: boundedText(descriptor.mimeType, 255), readProfile, url: `${READ_PREFIX}${id}`,
		lastModified: descriptor.lastModified === undefined ? 0 : integer(descriptor.lastModified),
	});
}

/** @param {unknown} value */
function writeDeclaration(value) {
	const request = record(value);
	const targetId = identifier(request.targetId);
	const exact = request.size !== undefined;
	if (exact === (request.maximumSize !== undefined)) throw new TypeError('Provide one exact size or maximum size.');
	const result = exact ? { targetId, size: integer(request.size) } : { targetId, maximumSize: integer(request.maximumSize) };
	if (request.finalPrefixByteLength === undefined) return result;
	if (!exact || request.finalPrefixByteLength !== 32 || result.size < 32) throw new RangeError('A 32-byte final prefix requires an exact-size save.');
	return { ...result, finalPrefixByteLength: 32 };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid native descriptor or response.');
	return value;
}
/** @param {unknown} value */
function identifier(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new TypeError('Invalid native identifier.');
	return value;
}
/** @param {unknown} value @param {number} maximum */
function boundedText(value, maximum) {
	if (typeof value !== 'string' || !value || value.length > maximum || /[\0\r\n]/u.test(value)) throw new TypeError('Invalid native text.');
	return value;
}
/** @param {unknown} value */
function integer(value) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid native nonnegative integer.');
	return value;
}
/** @param {unknown} value */
function positiveInteger(value) {
	const result = integer(value);
	if (result === 0) throw new RangeError('A positive native integer is required.');
	return result;
}
/** @param {unknown} value */
function binary(value) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer) return value;
	throw new TypeError('The native transport must return binary bytes, not JSON arrays.');
}

/**
 * @param {{fetch: typeof globalThis.fetch, __TAURI__?: {core?: {invoke: Invoke}, event?: {listen: Listen}}, __TAURI_INTERNALS__?: {invoke: Invoke}}} scope
 */
export function installTauriPrototypeBridge(scope = globalThis) {
	const invoke = scope.__TAURI__?.core?.invoke ?? scope.__TAURI_INTERNALS__?.invoke;
	if (!invoke) return null;
	if (Object.hasOwn(scope, 'scapeDesktop')) throw new Error('A desktop bridge is already installed.');
	const originalFetch = scope.fetch;
	const runtime = createTauriPrototypeBridge({ invoke, fetch: originalFetch.bind(scope), listen: scope.__TAURI__?.event?.listen });
	Object.defineProperty(scope, 'scapeDesktop', { value: runtime.bridge, configurable: true });
	scope.fetch = runtime.fetch;
	return Object.freeze({ ...runtime, async dispose() {
		await runtime.dispose();
		if (scope.fetch === runtime.fetch) scope.fetch = originalFetch;
		if (Object.getOwnPropertyDescriptor(scope, 'scapeDesktop')?.value === runtime.bridge) Reflect.deleteProperty(scope, 'scapeDesktop');
	} });
}

// Safe to import from Node tests and ordinary browsers; only the injected Tauri
// initialization script installs this adapter before the application starts.
installTauriPrototypeBridge();
