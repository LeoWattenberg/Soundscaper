const DEFAULT_WRITE_CHUNK_BYTES = 1024 * 1024;

export function resolveAudioEditorDesktopBridge(scope = globalThis) {
	const bridge = scope?.window?.soundscaperDesktop?.v1 || scope?.soundscaperDesktop?.v1;
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

	return Object.freeze({
		kind: isDesktop ? 'desktop' : 'browser',
		isDesktop,
		bridge,
		getEnvironment: () => bridge?.getEnvironment?.() ?? null,
		chooseFiles,
		openReadDescriptor,
		releaseRead,
		chooseSaveTarget,
		writeFile,
		saveFile,
		createDownload,
		signalReady: () => bridge?.signalReady?.(),
		respondToClose: (request) => bridge?.respondToClose?.(request),
		setLocale: (locale) => bridge?.setLocale?.(locale),
		setFullscreen: (enabled) => bridge?.setFullscreen?.(Boolean(enabled)),
		checkForUpdates: () => bridge?.checkForUpdates?.(),
		openExternal: (destination) => bridge?.openExternal?.(destination),
		editText: (command) => bridge?.editText?.(command),
		onOpenProject: (listener) => subscribeBridgeEvent(bridge, 'onOpenProject', listener),
		onMenuCommand: (listener) => subscribeBridgeEvent(bridge, 'onMenuCommand', listener),
		onCloseRequested: (listener) => subscribeBridgeEvent(bridge, 'onCloseRequested', listener),
		onFullscreenChanged: (listener) => subscribeBridgeEvent(bridge, 'onFullscreenChanged', listener),
	});

	async function chooseFiles(request = {}) {
		if (!bridge?.chooseFiles) return [];
		const descriptors = await bridge.chooseFiles({
			purpose: normalizePurpose(request.purpose, ['project', 'audio', 'labels']),
			...(request.multiple ? { multiple: true } : {}),
		});
		return Array.isArray(descriptors) ? descriptors.filter(isReadDescriptor) : [];
	}

	async function openReadDescriptor(descriptor) {
		const FileConstructor = scope.File || globalThis.File;
		if (typeof FileConstructor === 'function' && descriptor instanceof FileConstructor) return descriptor;
		if (!isReadDescriptor(descriptor)) throw new TypeError('A valid desktop read descriptor is required.');
		if (typeof fetchFile !== 'function') throw new Error('Desktop file reads are unavailable.');
		try {
			const response = await fetchFile(descriptor.url, { credentials: 'omit', cache: 'no-store' });
			if (!response?.ok) throw new Error(`Desktop file read failed with status ${response?.status || 'unknown'}.`);
			const blob = await response.blob();
			return createNamedFile(blob, descriptor, scope);
		} finally {
			await releaseRead(descriptor.id);
		}
	}

	async function releaseRead(id) {
		if (id == null || !bridge?.releaseRead) return;
		await bridge.releaseRead(String(id));
	}

	async function chooseSaveTarget(request = {}) {
		const purpose = normalizePurpose(request.purpose, ['project', 'audio', 'labels', 'preset', 'macro', 'report']);
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
		const blob = toBlob(input, request.mimeType);
		const fileName = sanitizeSuggestedName(request.suggestedName || request.fileName || target?.name);
		if (!target) return { cancelled: true, fileName, size: blob.size };
		if (bridge) return writeDesktopFile(target, blob, fileName);
		if (typeof target.createWritable === 'function') return writeFileSystemHandle(target, blob, fileName);
		return triggerBrowserDownload(blob, fileName);
	}

	async function saveFile(request = {}) {
		const blob = toBlob(request.blob ?? request.bytes ?? request.text ?? '', request.mimeType);
		let target = request.target;
		if (target === undefined) {
			try {
				target = await chooseSaveTarget(request);
			} catch (error) {
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

	async function writeDesktopFile(target, blob, fileName) {
		if (!target?.id || !bridge.beginWrite || !bridge.writeChunk || !bridge.finishWrite) {
			throw new Error('Desktop file writing is unavailable.');
		}
		const session = await bridge.beginWrite({ targetId: target.id, size: blob.size });
		if (!session?.writeId) throw new Error('The desktop save session could not be started.');
		const chunkSize = Math.max(1, Math.min(DEFAULT_WRITE_CHUNK_BYTES, Number(session.chunkSize) || DEFAULT_WRITE_CHUNK_BYTES));
		let offset = 0;
		try {
			while (offset < blob.size) {
				const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
				const result = await bridge.writeChunk({ writeId: session.writeId, offset, bytes });
				const expectedOffset = offset + bytes.byteLength;
				if (Number(result?.nextOffset) !== expectedOffset) throw new Error('The desktop save stream lost synchronization.');
				offset = expectedOffset;
			}
			const result = await bridge.finishWrite(session.writeId);
			if (Number(result?.byteLength) !== blob.size) throw new Error('The desktop save completed with an unexpected size.');
			return { method: 'desktop', fileName: target.name || fileName, size: blob.size };
		} catch (error) {
			await Promise.resolve(bridge.abortWrite?.(session.writeId)).catch(() => undefined);
			throw error;
		}
	}

	async function writeFileSystemHandle(handle, blob, fileName) {
		const writable = await handle.createWritable();
		try {
			await writable.write(blob);
			await writable.close();
		} catch (error) {
			await writable.abort?.().catch(() => undefined);
			throw error;
		}
		return { method: 'file-system-access', fileName, size: blob.size };
	}

	function triggerBrowserDownload(blob, fileName) {
		if (!document?.createElement || !urlApi?.createObjectURL) return { method: 'blob', blob, fileName, size: blob.size };
		const url = urlApi.createObjectURL(blob);
		try {
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = fileName;
			anchor.hidden = true;
			document.body?.append(anchor);
			anchor.click();
			anchor.remove?.();
		} finally {
			if (typeof setTimer === 'function') setTimer(() => urlApi.revokeObjectURL?.(url), 30_000);
			else urlApi.revokeObjectURL?.(url);
		}
		return { method: 'download', fileName, size: blob.size };
	}
}

function subscribeBridgeEvent(bridge, method, listener) {
	if (typeof listener !== 'function' || typeof bridge?.[method] !== 'function') return () => {};
	const unsubscribe = bridge[method](listener);
	return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

function isReadDescriptor(value) {
	return Boolean(value && typeof value === 'object' && value.id != null && typeof value.url === 'string' && value.url);
}

function createNamedFile(blob, descriptor, scope) {
	const FileConstructor = scope.File || globalThis.File;
	const options = {
		type: descriptor.mimeType || blob.type || 'application/octet-stream',
		lastModified: Number(descriptor.lastModified) || Date.now(),
	};
	if (typeof FileConstructor === 'function') return new FileConstructor([blob], descriptor.name || 'desktop-file', options);
	Object.defineProperties(blob, {
		name: { value: descriptor.name || 'desktop-file', configurable: true },
		lastModified: { value: options.lastModified, configurable: true },
	});
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
