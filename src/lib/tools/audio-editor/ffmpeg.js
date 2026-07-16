import {
	assertMediaExportAvailable,
	buildMediaFfmpegDecoderArgs,
	buildMediaFfmpegEncoderArgs,
	canonicalMediaExportFormat,
	createMediaExportCapabilities,
	getMediaExportFormat,
	normalizeMediaDecodeSampleRate,
	normalizeMediaExportSettings,
} from './media-export.js';

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export class FfmpegCoreUnavailableError extends Error {
	constructor(cause) {
		super('The browser FFmpeg core could not be loaded; compressed media export is unavailable.', { cause });
		this.name = 'FfmpegCoreUnavailableError';
		this.code = 'FFMPEG_CORE_UNAVAILABLE';
	}
}

export class FfmpegEncodingError extends Error {
	constructor(format, exitCode) {
		const descriptor = getMediaExportFormat(format);
		super(`${descriptor.label} encoding failed because FFmpeg codec ${descriptor.codec} is unavailable or rejected the export settings (exit code ${exitCode}).`);
		this.name = 'FfmpegEncodingError';
		this.code = 'FFMPEG_ENCODING_FAILED';
		this.format = descriptor.id;
		this.codec = descriptor.codec;
		this.exitCode = exitCode;
	}
}

/**
 * Lazy, single-thread FFmpeg runtime used only for editor decode and encoding.
 * The versioned core is served from R2 in production so the 32 MiB WASM file
 * does not exceed Cloudflare Pages' 25 MiB per-asset limit. The worker is
 * released after 30 seconds idle by default; set idleTimeoutMs to false or
 * null to retain it until explicit disposal.
 */
export function createEditorFfmpeg(options = {}) {
	let ffmpeg = null;
	let module = null;
	let loading = null;
	let queue = Promise.resolve();
	let pendingOperations = 0;
	let idleTeardown = null;
	const idleTimeoutMs = normalizeIdleTimeout(options.idleTimeoutMs);
	const setTimeoutFn = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
	const clearTimeoutFn = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis);
	const capabilities = options.capabilities?.formats
		? options.capabilities
		: createMediaExportCapabilities(options.capabilities || {});
	const coreBaseURL = String(
		options.coreBaseURL
		|| import.meta.env?.PUBLIC_FFMPEG_CORE_BASE_URL
		|| 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10',
	).replace(/\/$/, '');
	const coreURL = `${coreBaseURL}/ffmpeg-core.js`;
	const wasmURL = `${coreBaseURL}/ffmpeg-core.wasm`;

	const handleProgress = ({ progress = 0, time = 0 }) => {
		options.onProgress?.(Math.max(0, Math.min(1, progress)), time);
	};

	function cancelIdleTeardown() {
		const scheduled = idleTeardown;
		idleTeardown = null;
		if (scheduled && typeof clearTimeoutFn === 'function') clearTimeoutFn(scheduled.handle);
	}

	function terminateRuntime() {
		if (ffmpeg) {
			ffmpeg.off('progress', handleProgress);
			ffmpeg.terminate();
		}
		ffmpeg = null;
		loading = null;
	}

	function scheduleIdleTeardown() {
		if (idleTimeoutMs === null || typeof setTimeoutFn !== 'function' || pendingOperations !== 0 || !ffmpeg) return;
		cancelIdleTeardown();
		const target = ffmpeg;
		const scheduled = { handle: null };
		idleTeardown = scheduled;
		scheduled.handle = setTimeoutFn(() => {
			if (idleTeardown !== scheduled) return;
			idleTeardown = null;
			if (pendingOperations !== 0 || ffmpeg !== target) return;
			terminateRuntime();
			queue = Promise.resolve();
		}, idleTimeoutMs);
		scheduled.handle?.unref?.();
	}

	async function load() {
		cancelIdleTeardown();
		if (ffmpeg?.loaded) {
			scheduleIdleTeardown();
			return ffmpeg;
		}
		if (loading) {
			const instance = await loading;
			scheduleIdleTeardown();
			return instance;
		}

		loading = import('@ffmpeg/ffmpeg').then(async (loadedModule) => {
			module = loadedModule;
			const instance = new loadedModule.FFmpeg();
			instance.on('progress', handleProgress);
			options.onLoading?.();
			await instance.load({ coreURL, wasmURL });
			ffmpeg = instance;
			options.onReady?.();
			return instance;
		}).catch((error) => {
			loading = null;
			throw error instanceof FfmpegCoreUnavailableError ? error : new FfmpegCoreUnavailableError(error);
		});

		const instance = await loading;
		scheduleIdleTeardown();
		return instance;
	}

	function run(task) {
		cancelIdleTeardown();
		pendingOperations += 1;
		const execute = async () => task(await load());
		const result = queue.then(execute, execute);
		queue = result.catch(() => undefined);
		return result.finally(() => {
			pendingOperations -= 1;
			if (pendingOperations === 0) scheduleIdleTeardown();
		});
	}

	async function encode(wav, format, settings = {}) {
		const normalizedFormat = canonicalMediaExportFormat(format);
		const descriptor = getMediaExportFormat(normalizedFormat);
		if (descriptor.backend !== 'ffmpeg' && descriptor.backend !== 'custom-ffmpeg') {
			throw new Error(`${descriptor.label} uses a native encoder.`);
		}
		assertMediaExportAvailable(normalizedFormat, settings.capabilities || capabilities);
		const normalized = normalizeMediaExportSettings(normalizedFormat, { ...settings, capabilities: settings.capabilities || capabilities });
		const signal = settings.signal;
		if (signal?.aborted) throw abortError();

		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const input = `editor-${stamp}.wav`;
			const output = `editor-${stamp}.${normalized.extension}`;
			const onAbort = () => dispose();
			signal?.addEventListener('abort', onAbort, { once: true });

			try {
				await instance.writeFile(input, toUint8Array(wav), { signal });
				const code = await instance.exec(encoderArgs(input, output, normalizedFormat, {
					...normalized,
					applyDither: settings.applyDither === true,
				}), -1, { signal });
				if (code !== 0) throw new FfmpegEncodingError(normalizedFormat, code);
				const data = await instance.readFile(output, undefined, { signal });
				return {
					bytes: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)),
					extension: `.${normalized.extension}`,
					mimeType: normalized.mimeType,
				};
			} finally {
				signal?.removeEventListener('abort', onAbort);
				await instance.deleteFile(input).catch(() => undefined);
				await instance.deleteFile(output).catch(() => undefined);
			}
		});
	}

	async function encodeFile(file, format, settings = {}) {
		const normalizedFormat = canonicalMediaExportFormat(format);
		const descriptor = getMediaExportFormat(normalizedFormat);
		if (descriptor.backend !== 'ffmpeg' && descriptor.backend !== 'custom-ffmpeg') {
			throw new Error(`${descriptor.label} uses a native encoder.`);
		}
		assertMediaExportAvailable(normalizedFormat, settings.capabilities || capabilities);
		const normalized = normalizeMediaExportSettings(normalizedFormat, { ...settings, capabilities: settings.capabilities || capabilities });
		if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
		const signal = settings.signal;
		if (signal?.aborted) throw abortError();
		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-encode-${stamp}`;
			const inputName = typeof File !== 'undefined' && file instanceof File
				? file.name.replace(/[\\/\u0000]/g, '-')
				: `editor-${stamp}.wav`;
			const output = `editor-${stamp}.${normalized.extension}`;
			const onAbort = () => dispose();
			signal?.addEventListener('abort', onAbort, { once: true });
			await instance.createDir(mountPoint);
			try {
				const mountOptions = typeof File !== 'undefined' && file instanceof File
					? { files: [file] }
					: { blobs: [{ name: inputName, data: file }] };
				await instance.mount(module.FFFSType.WORKERFS, mountOptions, mountPoint);
				const code = await instance.exec(encoderArgs(`${mountPoint}/${inputName}`, output, normalizedFormat, {
					...normalized,
					applyDither: settings.applyDither === true,
				}), -1, { signal });
				if (code !== 0) throw new FfmpegEncodingError(normalizedFormat, code);
				const data = await instance.readFile(output, undefined, { signal });
				return {
					bytes: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)),
					extension: `.${normalized.extension}`,
					mimeType: normalized.mimeType,
				};
			} finally {
				signal?.removeEventListener('abort', onAbort);
				await instance.deleteFile(output).catch(() => undefined);
				await instance.unmount(mountPoint).catch(() => undefined);
				await instance.deleteDir(mountPoint).catch(() => undefined);
			}
		});
	}

	async function decode(file, settings = {}) {
		const signal = settings.signal;
		const sampleRate = normalizeMediaDecodeSampleRate(settings.sampleRate);
		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-input-${stamp}`;
			const output = `editor-decoded-${stamp}.f32`;
			let input = `editor-input-${stamp}`;
			let mounted = false;

			try {
				if (typeof File !== 'undefined' && file instanceof File && module?.FFFSType) {
					await instance.createDir(mountPoint);
					await instance.mount(module.FFFSType.WORKERFS, { files: [file] }, mountPoint);
					input = `${mountPoint}/${file.name}`;
					mounted = true;
				} else {
					await instance.writeFile(input, new Uint8Array(await file.arrayBuffer()), { signal });
				}

				const code = await instance.exec(
					buildMediaFfmpegDecoderArgs(input, output, { sampleRate, channelCount: 2 }),
					-1,
					{ signal },
				);
				if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
				const raw = await instance.readFile(output, undefined, { signal });
				if (!(raw instanceof Uint8Array)) throw new Error('FFmpeg returned invalid PCM data');
				return deinterleaveStereo(raw, sampleRate);
			} finally {
				await instance.deleteFile(output).catch(() => undefined);
				if (mounted) {
					await instance.unmount(mountPoint).catch(() => undefined);
					await instance.deleteDir(mountPoint).catch(() => undefined);
				} else {
					await instance.deleteFile(input).catch(() => undefined);
				}
			}
		});
	}

	function dispose() {
		cancelIdleTeardown();
		terminateRuntime();
		queue = Promise.resolve();
	}

	return { load, encode, encodeFile, decode, dispose, capabilities: () => capabilities };
}

function normalizeIdleTimeout(value) {
	if (value === false || value === null) return null;
	if (value === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new TypeError('FFmpeg idleTimeoutMs must be a non-negative finite number, false, or null.');
	}
	return value;
}

export function encoderArgs(input, output, format, settings = {}) {
	return buildMediaFfmpegEncoderArgs(input, output, format, settings);
}

function toUint8Array(value) {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw new TypeError('Expected WAV bytes');
}

function deinterleaveStereo(bytes, sampleRate) {
	const frames = Math.floor(bytes.byteLength / 8);
	const view = new DataView(bytes.buffer, bytes.byteOffset, frames * 8);
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	for (let frame = 0; frame < frames; frame += 1) {
		left[frame] = view.getFloat32(frame * 8, true);
		right[frame] = view.getFloat32(frame * 8 + 4, true);
	}
	return { sampleRate, channels: [left, right], frameCount: frames };
}

function abortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
