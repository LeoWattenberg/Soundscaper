import {
	createDesktopPreparedSave,
} from './file-save-stream.ts';
import {
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
import { createBrowserFileSaveService, sanitizeSuggestedSaveName as sanitizeSuggestedName } from './browser-file-save-service.ts';
import { createDesktopLinkedVideoOriginalAccess } from './storage/desktop-linked-video-original-port.ts';
import { bindSoundscaperPersistentDeliverySave } from './soundscaper-persistent-delivery-save-target.ts';
import { createDesktopExternalMediaFiles } from './desktop-external-media-files.ts';
import { registerDesktopOriginalFile, withDesktopOriginalReadCleanup } from './desktop-original-file-port.ts';
const DEFAULT_WRITE_CHUNK_BYTES = 1024 * 1024;
const NEVER_ABORTED_READ_SIGNAL = new AbortController().signal;
const FRAMESCAPER_DESKTOP_BRIDGE_ENABLED = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'framescaper';
export function resolveAudioEditorDesktopBridge(scope = globalThis) {
	const bridge = scope?.window?.scapeDesktop?.v1 || scope?.scapeDesktop?.v1
		|| scope?.window?.soundscaperDesktop?.v1 || scope?.soundscaperDesktop?.v1
		|| (FRAMESCAPER_DESKTOP_BRIDGE_ENABLED
			? scope?.window?.framescaperDesktop?.v1 || scope?.framescaperDesktop?.v1
			: null);
	return bridge && typeof bridge === 'object' ? bridge : null;
}
export function createAudioEditorFileService(options = {}) {
	const scope = options.scope || globalThis;
	const bridge = options.bridge === undefined ? resolveAudioEditorDesktopBridge(scope) : options.bridge;
	const browserFiles = createBrowserFileSaveService({ scope, document: options.document, urlApi: options.urlApi, setTimeout: options.setTimeout });
	const fetchFile = options.fetch || scope.fetch?.bind(scope);
	const isDesktop = Boolean(bridge);
	const externalMediaFiles = createDesktopExternalMediaFiles(bridge, fetchFile);
	const registerOriginal = (file, descriptor) => registerDesktopOriginalFile(file, descriptor.originalFile, (id) => bridge?.releaseOriginalFile?.(id));
	const nativeTierControlsAvailable = typeof bridge?.readNativeTierControls === 'function'
		&& typeof bridge?.applyNativeTierControl === 'function';
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
		originalOverwriteAvailable: typeof bridge?.prepareOriginalOverwrite === 'function',
		prepareOriginalOverwrite: async (id) => { const target = await bridge?.prepareOriginalOverwrite?.(id); return target ? Object.freeze({ ...target, originalOverwrite: true }) : null; },
		releaseOriginalFile: (id) => bridge?.releaseOriginalFile?.(id),
		externalMediaResolver: externalMediaFiles.resolve, captureExternalMediaFile: (file) => externalMediaFiles.capture(file),
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
		...((typeof __SCAPE_DESKTOP_RENDERER__ === 'undefined' || __SCAPE_DESKTOP_RENDERER__) ? {
			readMcpStatus: () => bridge?.readMcpStatus?.() ?? null,
			startMcp: () => bridge?.startMcp?.() ?? null,
			stopMcp: () => bridge?.stopMcp?.() ?? null,
			onMcpRequest: (listener) => subscribeBridgeEvent(bridge, 'onMcpRequest', listener),
			respondMcpRequest: (response) => bridge?.respondMcpRequest?.(response),
		} : {}),
		chooseFiles,
		openReadDescriptor,
		withScapeReadDescriptor,
		withReadDescriptors,
		releaseRead,
		resolveSesxMedia: (request) => bridge?.resolveSesxMedia?.(request) ?? Promise.resolve({ status: 'missing' }),
		chooseSesxMediaFolder: (request) => bridge?.chooseSesxMediaFolder?.(request) ?? Promise.resolve({ status: 'cancelled' }),
		releaseSesxSession: (sessionReadId) => bridge?.releaseSesxSession?.(sessionReadId) ?? Promise.resolve(false),
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
		runDesktopAudioCodecStreamCommand: (request) => bridge?.runDesktopAudioCodecStreamCommand?.(request) ?? null,
		runDesktopAudioCodecOperation: (request) => bridge?.runDesktopAudioCodecOperation?.(request) ?? null,
		cancelDesktopAudioCodecOperation: (requestId) => bridge?.cancelDesktopAudioCodecOperation?.(requestId) ?? null,
		beginDesktopVideoCodecOperation: (request) => bridge?.beginDesktopVideoCodecOperation?.(request) ?? null,
		writeDesktopVideoCodecInput: (request) => bridge?.writeDesktopVideoCodecInput?.(request) ?? null,
		closeDesktopVideoCodecInput: (request) => bridge?.closeDesktopVideoCodecInput?.(request) ?? null,
		executeDesktopVideoCodecOperation: (request) => bridge?.executeDesktopVideoCodecOperation?.(request) ?? null,
		statDesktopVideoCodecOutput: (request) => bridge?.statDesktopVideoCodecOutput?.(request) ?? null,
		readDesktopVideoCodecOutput: (request) => bridge?.readDesktopVideoCodecOutput?.(request) ?? null,
		deleteDesktopVideoCodecOperation: (request) => bridge?.deleteDesktopVideoCodecOperation?.(request) ?? null,
		cancelDesktopVideoCodecOperation: (operationId) => bridge?.cancelDesktopVideoCodecOperation?.(operationId) ?? null,
		runWindowAction: (action) => bridge?.runWindowAction?.(action),
		readNativeTierControls: nativeTierControlsAvailable ? () => bridge.readNativeTierControls() : undefined,
		applyNativeTierControl: nativeTierControlsAvailable ? (request) => bridge.applyNativeTierControl(request) : undefined,
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
		return withDesktopOriginalReadCleanup([descriptor], bridge?.releaseOriginalFile?.bind(bridge), () => withReadCleanup(uniqueReadIds([descriptor]), releaseRead, async () => {
			if (!isReadDescriptor(descriptor)) throw new TypeError('A valid desktop read descriptor is required.');
			assertDesktopMaterializedReadProfile(descriptor);
			const blob = await materializeReadDescriptor(descriptor, request.signal);
			const file = createNamedFile(blob, descriptor, scope); registerOriginal(file, descriptor); await externalMediaFiles.capture(file, descriptor.id); return file;
		}), false);
	}
	async function withReadDescriptors(descriptors, request = {}, consume) {
		if (!Array.isArray(descriptors)) throw new TypeError('Desktop read descriptors must be an array.');
		if (typeof consume !== 'function') throw new TypeError('A desktop read consumer is required.');
		const readIds = uniqueReadIds(descriptors);
		return withDesktopOriginalReadCleanup(descriptors, bridge?.releaseOriginalFile?.bind(bridge), () => withReadCleanup(readIds, releaseRead, async () => {
			let aggregateBytes = 0;
			for (const descriptor of descriptors) {
				if (!isReadDescriptor(descriptor)) throw new TypeError('A valid desktop read descriptor is required.');
				if (descriptor.readProfile === 'linked-audio-range-v1' || descriptor.readProfile === 'selected-range-v1') continue;
				assertDesktopMaterializedReadProfile(descriptor);
				if (descriptor.size > readMaximumBytes - aggregateBytes) {
					throw new RangeError('The desktop read aggregate exceeds its admitted maximum.');
				}
				aggregateBytes += descriptor.size;
			}
			throwIfAborted(request.signal);
			const audioRanges = descriptors.some((descriptor) => descriptor.readProfile === 'linked-audio-range-v1')
				? await import('./desktop-audio-range-blob.ts') : null;
			const selectedRanges = descriptors.some((descriptor) => descriptor.readProfile === 'selected-range-v1')
				? await import('./desktop-selected-range-blob.ts') : null;
			const files = [];
			for (const descriptor of descriptors) {
				if (descriptor.readProfile === 'linked-audio-range-v1') {
					files.push(audioRanges.createDesktopAudioRangeBlob(descriptor, { fetch: fetchFile, signal: request.signal }));
				} else if (descriptor.readProfile === 'selected-range-v1') {
					files.push(selectedRanges.createDesktopSelectedRangeBlob(descriptor, { fetch: fetchFile, signal: request.signal }));
				} else {
					const blob = await materializeReadDescriptor(descriptor, request.signal);
					files.push(createNamedFile(blob, descriptor, scope));
				}
			}
			try { for (const [index, file] of files.entries()) { registerOriginal(file, descriptors[index]); await externalMediaFiles.capture(file, descriptors[index].id); } return await consume(Object.freeze(files)); }
			finally { for (const file of files) { audioRanges?.retireDesktopAudioRangeBlob(file); selectedRanges?.retireDesktopSelectedRangeBlob(file); } }
		}));
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
			registerDesktopReadCapability(source, descriptor.id);
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
		if (!bridge) return browserFiles.chooseSaveTarget(request);
		const purpose = normalizePurpose(request.purpose, ['project', 'project-copy', 'aup3', 'aup4', 'audio-pcm-mix', 'audio', 'video', 'media', 'labels', 'preset', 'macro', 'report', 'attribution-csv', 'interchange']);
		const suggestedName = sanitizeSuggestedName(request.suggestedName || request.fileName);
		if (bridge.chooseSaveTarget) {
			return bridge.chooseSaveTarget({ purpose, suggestedName,
				...(request.mimeType ? { mimeType: String(request.mimeType) } : {}),
			});
		}
		return browserFiles.chooseSaveTarget(request);
	}

	async function writeFile(target, input, request = {}) {
		if (!bridge) return browserFiles.writeFile(target, input, request);
		throwIfAborted(request.signal);
		const blob = toBlob(input, request.mimeType);
		const fileName = sanitizeSuggestedName(target?.originalOverwrite ? target.name : request.suggestedName || request.fileName || target?.name);
		if (!target) return { cancelled: true, fileName, size: blob.size };
		return writeDesktopFile(target, blob, fileName, request.signal, request.onProgress);
	}

	async function prepareSave(request = {}) {
		if (!bridge) return browserFiles.prepareSave(request);
		throwIfAborted(request.signal);
		const fileName = sanitizeSuggestedName(request.target?.originalOverwrite ? request.target.name : request.suggestedName || request.fileName);
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
		const persistent = bindSoundscaperPersistentDeliverySave(target, fileName);
		return createDesktopPreparedSave({ ...(persistent ?? { bridge, target }), fileName, signal: request.signal });
	}

	async function saveFile(request = {}) {
		if (!bridge) return browserFiles.saveFile(request);
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
		if (bridge) {
			const blob = toBlob(request.blob ?? request.bytes ?? request.text ?? '', request.mimeType);
			const fileName = sanitizeSuggestedName(request.suggestedName || request.fileName);
			return saveFile({ ...request, blob, suggestedName: fileName });
		}
		return browserFiles.createDownload(request);
	}

	async function writeDesktopFile(target, blob, fileName, signal, onProgress) {
		throwIfAborted(signal);
		const persistent = bindSoundscaperPersistentDeliverySave(target, fileName);
		const saveBridge = persistent?.bridge ?? bridge;
		const saveTarget = persistent?.target ?? target;
		if (!saveTarget?.id || !saveBridge.beginWrite || !saveBridge.writeChunk || !saveBridge.finishWrite) {
			throw new Error('Desktop file writing is unavailable.');
		}
		const session = await saveBridge.beginWrite({ targetId: saveTarget.id, size: blob.size });
		if (!session?.writeId) throw new Error('The desktop save session could not be started.');
		const chunkSize = Math.max(1, Math.min(DEFAULT_WRITE_CHUNK_BYTES, Number(session.chunkSize) || DEFAULT_WRITE_CHUNK_BYTES));
		let offset = 0;
		try {
			onProgress?.(0);
			throwIfAborted(signal);
			while (offset < blob.size) {
				throwIfAborted(signal);
				const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
				throwIfAborted(signal);
				const result = await saveBridge.writeChunk({ writeId: session.writeId, offset, bytes });
				throwIfAborted(signal);
				const expectedOffset = offset + bytes.byteLength;
				if (Number(result?.nextOffset) !== expectedOffset) throw new Error('The desktop save stream lost synchronization.');
				offset = expectedOffset;
				onProgress?.(Math.min(0.999, offset / blob.size));
			}
			throwIfAborted(signal);
			const result = await saveBridge.finishWrite(session.writeId);
			if (Number(result?.byteLength) !== blob.size) throw new Error('The desktop save completed with an unexpected size.');
			onProgress?.(1);
			return { method: 'desktop', fileName: saveTarget.name || fileName, size: blob.size };
		} catch (error) {
			await Promise.resolve(saveBridge.abortWrite?.(session.writeId)).catch(() => undefined);
			throw error;
		}
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
	// Main approves large materialization before granting this exact descriptor.
	if (value === undefined) return Number.MAX_SAFE_INTEGER;
	const maximum = value;
	if (!Number.isSafeInteger(maximum) || maximum < 0) {
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
	const descriptorTimestamp = Number(descriptor.lastModified);
	const options = {
		type: descriptor.mimeType || blob.type || 'application/octet-stream',
		lastModified: Number.isSafeInteger(descriptorTimestamp) && descriptorTimestamp >= 0
			? descriptorTimestamp
			: Date.now(),
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
