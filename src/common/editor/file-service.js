import {
	createDesktopPreparedSave,
	createFileSystemPreparedSave,
} from './file-save-stream.ts';
import {
	DESKTOP_READ_HARD_LIMIT_BYTES,
	materializeDesktopReadBlob,
} from './desktop-read-materialization.ts';
import {
	assertDesktopMaterializedReadProfile,
	assertDesktopScapeReadProfile,
	desktopScapeReadMaximum,
	isDesktopReadProfile,
} from './desktop-read-profile.ts';
import { createDesktopScapeArchiveByteSource } from './desktop-scape-archive-byte-source.ts';
import { createDesktopHelperVideoTimingProbe } from './desktop-helper-video-timing-probe.ts';
import { createDesktopLinkedOriginalAccess } from './desktop-linked-original-port.ts';
import { registerDesktopReadCapability } from './desktop-read-capability-registry.ts';
import { createDesktopLinkedVideoOriginalAccess } from './storage/desktop-linked-video-original-port.ts';

const DEFAULT_WRITE_CHUNK_BYTES = 1024 * 1024;
const NEVER_ABORTED_READ_SIGNAL = new AbortController().signal;

export function resolveAudioEditorDesktopBridge(scope = globalThis) {
	const bridge = scope?.window?.scapeDesktop?.v1 || scope?.scapeDesktop?.v1
		|| scope?.window?.soundscaperDesktop?.v1 || scope?.soundscaperDesktop?.v1
		|| scope?.window?.framescaperDesktop?.v1 || scope?.framescaperDesktop?.v1;
	return bridge && typeof bridge === 'object' ? bridge : null;
}

export function createAudioEditorFileService(options = {}) {
	const scope = options.scope || globalThis;
	const bridge = options.bridge === undefined ? resolveAudioEditorDesktopBridge(scope) : options.bridge;
	const document = options.document === undefined ? scope.document : options.document;
	const urlApi = options.urlApi || scope.URL;
	const fetchFile = options.fetch || scope.fetch?.bind(scope);
	const setTimer = options.setTimeout || scope.setTimeout?.bind(scope);
	const isDesktop = Boolean(bridge);
	const readMaximumBytes = desktopReadMaximum(options.readMaximumBytes);
	const scapeReadMaximumBytes = desktopScapeReadMaximum(options.scapeReadMaximumBytes);
	const linkedVideoOriginals = createDesktopLinkedVideoOriginalAccess({
		bridge, fetch: fetchFile, openReadDescriptor,
	});
	const linkedOriginals = createDesktopLinkedOriginalAccess({
		bridge,
		fetch: fetchFile,
		videoPort: linkedVideoOriginals.port,
		openReadDescriptor,
	});
	const linkedVideoOriginalPort = createLinkedVideoOriginalPortCompatibility(
		linkedVideoOriginals.port,
		linkedOriginals.port,
	);

	return Object.freeze({
		kind: isDesktop ? 'desktop' : 'browser',
		isDesktop,
		bridge,
		helperTimingProbe: createDesktopHelperVideoTimingProbe({ bridge }),
		linkedVideoOriginalsAvailable: linkedVideoOriginals.available,
		linkedVideoOriginalPort,
		chooseLinkedVideoOriginal: linkedVideoOriginals.choose,
		releaseLinkedVideoOriginal: linkedVideoOriginals.release,
		linkedOriginalsAvailable: linkedOriginals.available,
		linkedAudioOriginalsAvailable: linkedOriginals.audioAvailable,
		linkedOriginalPort: linkedOriginals.port,
		chooseLinkedAudioOriginal: linkedOriginals.chooseAudio,
		releaseLinkedAudioOriginal: linkedOriginals.releaseAudio,
		getEnvironment: () => bridge?.getEnvironment?.() ?? null,
		chooseFiles,
		openReadDescriptor,
		withScapeReadDescriptor,
		withReadDescriptors,
		releaseRead,
		chooseSaveTarget,
		prepareSave,
		writeFile,
		saveFile,
		createDownload,
		signalReady: () => bridge?.signalReady?.(),
		respondToClose: (request) => bridge?.respondToClose?.(request),
		setLocale: (locale) => bridge?.setLocale?.(locale),
		getExternalFfmpegStatus: () => bridge?.getExternalFfmpegStatus?.() ?? null,
		chooseExternalFfmpeg: () => bridge?.chooseExternalFfmpeg?.() ?? null,
		clearExternalFfmpeg: () => bridge?.clearExternalFfmpeg?.() ?? null,
		rescanExternalFfmpeg: () => bridge?.rescanExternalFfmpeg?.() ?? null,
		installExternalFfmpeg: () => bridge?.installExternalFfmpeg?.() ?? null,
		getDesktopAudioCodecCapabilities: (request) => bridge?.getDesktopAudioCodecCapabilities?.(request) ?? null,
		getDesktopVideoExportCapabilities: () => bridge?.getDesktopVideoExportCapabilities?.() ?? null,
		runDesktopAudioCodecOperation: (request) => bridge?.runDesktopAudioCodecOperation?.(request) ?? null,
		cancelDesktopAudioCodecOperation: (requestId) => bridge?.cancelDesktopAudioCodecOperation?.(requestId) ?? null,
		runWindowAction: (action) => bridge?.runWindowAction?.(action),
		readNativeTierControls: () => bridge?.readNativeTierControls?.(),
		applyNativeTierControl: (request) => bridge?.applyNativeTierControl?.(request),
		checkForUpdates: () => bridge?.checkForUpdates?.(),
		openExternal: (destination) => bridge?.openExternal?.(destination),
		editText: (command) => bridge?.editText?.(command),
		onOpenProject: (listener) => subscribeBridgeEvent(bridge, 'onOpenProject', listener),
		onMenuCommand: (listener) => subscribeBridgeEvent(bridge, 'onMenuCommand', listener),
		onCloseRequested: (listener) => subscribeBridgeEvent(bridge, 'onCloseRequested', listener),
		onWindowStateChanged: (listener) => subscribeBridgeEvent(bridge, 'onWindowStateChanged', listener),
	});

	async function chooseFiles(request = {}) {
		if (!bridge?.chooseFiles) return [];
		const descriptors = await bridge.chooseFiles({
			purpose: normalizePurpose(request.purpose, ['project', 'audio', 'video', 'media', 'labels', 'lut']),
			...(request.multiple ? { multiple: true } : {}),
		});
		return Array.isArray(descriptors) ? descriptors.filter(isReadDescriptor) : [];
	}

	async function openReadDescriptor(descriptor, request = {}) {
		const FileConstructor = scope.File || globalThis.File;
		if (typeof FileConstructor === 'function' && descriptor instanceof FileConstructor) {
			throwIfAborted(request.signal);
			return descriptor;
		}
		return withReadCleanup(uniqueReadIds([descriptor]), releaseRead, async () => {
			if (!isReadDescriptor(descriptor)) throw new TypeError('A valid desktop read descriptor is required.');
			assertDesktopMaterializedReadProfile(descriptor);
			const blob = await materializeReadDescriptor(descriptor, request.signal);
			return createNamedFile(blob, descriptor, scope);
		});
	}

	async function withReadDescriptors(descriptors, request = {}, consume) {
		if (!Array.isArray(descriptors)) throw new TypeError('Desktop read descriptors must be an array.');
		if (typeof consume !== 'function') throw new TypeError('A desktop read consumer is required.');
		const readIds = uniqueReadIds(descriptors);
		return withReadCleanup(readIds, releaseRead, async () => {
			let aggregateBytes = 0;
			for (const descriptor of descriptors) {
				if (!isReadDescriptor(descriptor)) throw new TypeError('A valid desktop read descriptor is required.');
				assertDesktopMaterializedReadProfile(descriptor);
				if (descriptor.size > readMaximumBytes - aggregateBytes) {
					throw new RangeError('The desktop read aggregate exceeds its admitted maximum.');
				}
				aggregateBytes += descriptor.size;
			}
			throwIfAborted(request.signal);
			const files = [];
			for (const descriptor of descriptors) {
				const blob = await materializeReadDescriptor(descriptor, request.signal);
				files.push(createNamedFile(blob, descriptor, scope));
			}
			return consume(Object.freeze(files));
		});
	}

	async function withScapeReadDescriptor(descriptor, request = {}, consume) {
		const readIds = uniqueReadIds([descriptor]);
		return withReadCleanup(readIds, releaseRead, async () => {
			if (!isReadDescriptor(descriptor)) throw new TypeError('A valid desktop read descriptor is required.');
			assertDesktopScapeReadProfile(descriptor, scapeReadMaximumBytes);
			if (typeof consume !== 'function') throw new TypeError('A desktop Scape read consumer is required.');
			if (typeof fetchFile !== 'function') throw new Error('Desktop Scape range reads are unavailable.');
			if (typeof bridge?.releaseRead !== 'function') {
				throw new Error('Desktop Scape capability release is unavailable.');
			}
			throwIfAborted(request.signal);
			const source = createDesktopScapeArchiveByteSource(descriptor, { fetch: fetchFile });
			return consume(source);
		});
	}

	async function materializeReadDescriptor(descriptor, signal) {
		if (typeof fetchFile !== 'function') throw new Error('Desktop file reads are unavailable.');
		return materializeDesktopReadBlob(descriptor, {
			fetch: fetchFile,
			signal: signal ?? NEVER_ABORTED_READ_SIGNAL,
			maximumBytes: readMaximumBytes,
		});
	}

	async function releaseRead(id) {
		if (id == null || !bridge?.releaseRead) return;
		await bridge.releaseRead(String(id));
	}

	async function chooseSaveTarget(request = {}) {
		const purpose = normalizePurpose(request.purpose, ['project', 'aup4', 'audio-pcm-mix', 'audio', 'video', 'media', 'labels', 'preset', 'macro', 'report', 'interchange']);
		const suggestedName = sanitizeSuggestedName(request.suggestedName || request.fileName);
		if (bridge?.chooseSaveTarget) {
			return bridge.chooseSaveTarget({
				purpose,
				suggestedName,
				...(request.mimeType ? { mimeType: String(request.mimeType) } : {}),
			});
		}
		if (request.useFileSystemAccess && typeof scope.showSaveFilePicker === 'function') {
			return scope.showSaveFilePicker({
				suggestedName,
				...(Array.isArray(request.types) ? { types: request.types } : {}),
				excludeAcceptAllOption: false,
			});
		}
		return Object.freeze({ browserDownload: true, name: suggestedName });
	}

	async function writeFile(target, input, request = {}) {
		throwIfAborted(request.signal);
		const blob = toBlob(input, request.mimeType);
		const fileName = sanitizeSuggestedName(request.suggestedName || request.fileName || target?.name);
		if (!target) return { cancelled: true, fileName, size: blob.size };
		if (bridge) return writeDesktopFile(target, blob, fileName, request.signal);
		if (typeof target.createWritable === 'function') return writeFileSystemHandle(target, blob, fileName, request.signal);
		return triggerBrowserDownload(blob, fileName, request.signal);
	}

	async function prepareSave(request = {}) {
		throwIfAborted(request.signal);
		const fileName = sanitizeSuggestedName(request.suggestedName || request.fileName);
		let target = request.target;
		if (target === undefined) {
			try {
				target = await chooseSaveTarget({ ...request, suggestedName: fileName });
				throwIfAborted(request.signal);
			} catch (error) {
				throwIfAborted(request.signal);
				if (error?.name === 'AbortError') return Object.freeze({ mode: 'cancelled', cancelled: true, fileName });
				throw error;
			}
		}
		if (!target) return Object.freeze({ mode: 'cancelled', cancelled: true, fileName });
		if (bridge) return createDesktopPreparedSave({ bridge, target, fileName, signal: request.signal });
		if (typeof target.createWritable === 'function') {
			return createFileSystemPreparedSave({ target, fileName, signal: request.signal });
		}
		return Object.freeze({ mode: 'blob', target, fileName });
	}

	async function saveFile(request = {}) {
		throwIfAborted(request.signal);
		const blob = toBlob(request.blob ?? request.bytes ?? request.text ?? '', request.mimeType);
		let target = request.target;
		if (target === undefined) {
			try {
				target = await chooseSaveTarget(request);
				throwIfAborted(request.signal);
			} catch (error) {
				throwIfAborted(request.signal);
				if (error?.name === 'AbortError') return { cancelled: true, fileName: request.suggestedName, size: blob.size };
				throw error;
			}
		}
		return writeFile(target, blob, request);
	}

	async function createDownload(request = {}) {
		const blob = toBlob(request.blob ?? request.bytes ?? request.text ?? '', request.mimeType);
		const fileName = sanitizeSuggestedName(request.suggestedName || request.fileName);
		if (bridge) return saveFile({ ...request, blob, suggestedName: fileName });
		if (!urlApi?.createObjectURL) return { method: 'blob', blob, fileName, size: blob.size, url: null, cleanup: async () => {} };
		const url = urlApi.createObjectURL(blob);
		let revoked = false;
		return {
			method: 'object-url',
			blob,
			fileName,
			size: blob.size,
			url,
			cleanup: async () => {
				if (revoked) return;
				revoked = true;
				urlApi.revokeObjectURL?.(url);
			},
		};
	}

	async function writeDesktopFile(target, blob, fileName, signal) {
		throwIfAborted(signal);
		if (!target?.id || !bridge.beginWrite || !bridge.writeChunk || !bridge.finishWrite) {
			throw new Error('Desktop file writing is unavailable.');
		}
		const session = await bridge.beginWrite({ targetId: target.id, size: blob.size });
		if (!session?.writeId) throw new Error('The desktop save session could not be started.');
		const chunkSize = Math.max(1, Math.min(DEFAULT_WRITE_CHUNK_BYTES, Number(session.chunkSize) || DEFAULT_WRITE_CHUNK_BYTES));
		let offset = 0;
		try {
			throwIfAborted(signal);
			while (offset < blob.size) {
				throwIfAborted(signal);
				const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
				throwIfAborted(signal);
				const result = await bridge.writeChunk({ writeId: session.writeId, offset, bytes });
				throwIfAborted(signal);
				const expectedOffset = offset + bytes.byteLength;
				if (Number(result?.nextOffset) !== expectedOffset) throw new Error('The desktop save stream lost synchronization.');
				offset = expectedOffset;
			}
			throwIfAborted(signal);
			const result = await bridge.finishWrite(session.writeId);
			if (Number(result?.byteLength) !== blob.size) throw new Error('The desktop save completed with an unexpected size.');
			return { method: 'desktop', fileName: target.name || fileName, size: blob.size };
		} catch (error) {
			await Promise.resolve(bridge.abortWrite?.(session.writeId)).catch(() => undefined);
			throw error;
		}
	}

	async function writeFileSystemHandle(handle, blob, fileName, signal) {
		throwIfAborted(signal);
		const writable = await handle.createWritable();
		try {
			throwIfAborted(signal);
			await writable.write(blob);
			throwIfAborted(signal);
			await writable.close();
		} catch (error) {
			await writable.abort?.().catch(() => undefined);
			throw error;
		}
		return { method: 'file-system-access', fileName, size: blob.size };
	}

	function triggerBrowserDownload(blob, fileName, signal) {
		throwIfAborted(signal);
		if (!document?.createElement || !urlApi?.createObjectURL) return { method: 'blob', blob, fileName, size: blob.size };
		const url = urlApi.createObjectURL(blob);
		try {
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = fileName;
			anchor.hidden = true;
			document.body?.append(anchor);
			throwIfAborted(signal);
			anchor.click();
			anchor.remove?.();
		} finally {
			if (typeof setTimer === 'function') setTimer(() => urlApi.revokeObjectURL?.(url), 30_000);
			else urlApi.revokeObjectURL?.(url);
		}
		return { method: 'download', fileName, size: blob.size };
	}
}

function createLinkedVideoOriginalPortCompatibility(videoPort, linkedOriginalPort) {
	if (!videoPort || !linkedOriginalPort) return videoPort;
	return Object.freeze({
		load: (...args) => videoPort.load(...args),
		...(typeof videoPort.leasePlayback === 'function'
			? { leasePlayback: (...args) => videoPort.leasePlayback(...args) }
			: {}),
		reconcile: (references) => linkedOriginalPort.reconcile(
			legacyLinkedVideoReferences(references).map((reference) => ({ kind: 'video', ...reference })),
		),
		release: (reference) => linkedOriginalPort.release({
			kind: 'video', ...legacyLinkedVideoReferences([reference])[0],
		}),
	});
}

function legacyLinkedVideoReferences(value) {
	if (!Array.isArray(value) || value.length > 128) {
		throw new RangeError('Linked-video reference count exceeds its limit.');
	}
	const identifiers = new Set();
	return Object.freeze(value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError('A linked-video locator reference is required.');
		}
		const fields = ['locatorId', 'locatorRevision'];
		const keys = Reflect.ownKeys(item);
		if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
			throw new TypeError('A linked-video locator reference contains an unsupported field.');
		}
		const reference = {};
		for (const field of fields) {
			const descriptor = Object.getOwnPropertyDescriptor(item, field);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
				|| typeof descriptor.value !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.value)) {
				throw new TypeError(`Linked-video ${field} is invalid.`);
			}
			reference[field] = descriptor.value;
		}
		if (identifiers.has(reference.locatorId)) {
			throw new Error('Linked-video references contain a duplicate locator.');
		}
		identifiers.add(reference.locatorId);
		return Object.freeze(reference);
	}));
}

function subscribeBridgeEvent(bridge, method, listener) {
	if (typeof listener !== 'function' || typeof bridge?.[method] !== 'function') return () => {};
	const unsubscribe = bridge[method](listener);
	return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

function isReadDescriptor(value) {
	return Boolean(value && typeof value === 'object'
		&& value.id != null
		&& isDesktopReadProfile(value.readProfile)
		&& typeof value.url === 'string' && value.url
		&& Number.isSafeInteger(value.size) && value.size >= 0);
}

function desktopReadMaximum(value) {
	if (value === undefined) return DESKTOP_READ_HARD_LIMIT_BYTES;
	const maximum = value;
	if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > DESKTOP_READ_HARD_LIMIT_BYTES) {
		throw new RangeError('The desktop read maximum must not exceed its hard limit.');
	}
	return maximum;
}

function uniqueReadIds(descriptors) {
	return [...new Set(descriptors
		.map((descriptor) => descriptor?.id)
		.filter((id) => id != null)
		.map(String))];
}

async function withReadCleanup(readIds, release, operation) {
	let value;
	let primaryError;
	let operationFailed = false;
	try {
		value = await operation();
	} catch (error) {
		operationFailed = true;
		primaryError = error;
	}
	const cleanupResults = await Promise.allSettled(readIds.map((id) => release(id)));
	const cleanupErrors = cleanupResults
		.filter((result) => result.status === 'rejected')
		.map((result) => result.reason);
	if (operationFailed) {
		if (cleanupErrors.length) {
			throw new AggregateError(
				[primaryError, ...cleanupErrors],
				'The desktop read failed and its capability cleanup was incomplete.',
				{ cause: primaryError },
			);
		}
		throw primaryError;
	}
	if (cleanupErrors.length) {
		throw new AggregateError(cleanupErrors, 'Desktop read capability cleanup was incomplete.');
	}
	return value;
}

function createNamedFile(blob, descriptor, scope) {
	const FileConstructor = scope.File || globalThis.File;
	const options = {
		type: descriptor.mimeType || blob.type || 'application/octet-stream',
		lastModified: Number(descriptor.lastModified) || Date.now(),
	};
	if (typeof FileConstructor === 'function') {
		const file = new FileConstructor([blob], descriptor.name || 'desktop-file', options);
		registerDesktopReadCapability(file, descriptor.id);
		return file;
	}
	Object.defineProperties(blob, {
		name: { value: descriptor.name || 'desktop-file', configurable: true },
		lastModified: { value: options.lastModified, configurable: true },
	});
	registerDesktopReadCapability(blob, descriptor.id);
	return blob;
}

function toBlob(input, mimeType) {
	if (input instanceof Blob) return input;
	return new Blob([input], { type: mimeType || 'application/octet-stream' });
}

function sanitizeSuggestedName(value) {
	return String(value || 'soundscaper-export')
		.trim()
		.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
		.replace(/[. ]+$/g, '')
		|| 'soundscaper-export';
}

function normalizePurpose(value, allowed) {
	const purpose = String(value || '').trim().toLowerCase();
	if (!allowed.includes(purpose)) throw new RangeError(`Unsupported file purpose: ${purpose || 'empty'}.`);
	return purpose;
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The file operation was cancelled.', 'AbortError');
}
