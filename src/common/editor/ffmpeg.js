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
import { getVideoExportFormat } from './video-export.js';
import { buildVideoFfmpegArgs } from './video-ffmpeg.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export class FfmpegCoreUnavailableError extends Error {
	constructor(cause) {
		super('The browser FFmpeg core could not be loaded; compressed media export is unavailable.', { cause });
		this.name = 'FfmpegCoreUnavailableError';
		this.code = 'FFMPEG_CORE_UNAVAILABLE';
	}
}

export class FfmpegDisposedError extends Error {
	constructor() {
		super('The browser FFmpeg runtime has been disposed.');
		this.name = 'FfmpegDisposedError';
		this.code = 'FFMPEG_DISPOSED';
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

export class FfmpegVideoEncodingError extends Error {
	constructor(format, exitCode) {
		const descriptor = getVideoExportFormat(format);
		super(`${descriptor.label} encoding failed because FFmpeg codec ${descriptor.videoEncoder} is unavailable or rejected the video export plan (exit code ${exitCode}).`);
		this.name = 'FfmpegVideoEncodingError';
		this.code = 'FFMPEG_VIDEO_ENCODING_FAILED';
		this.format = descriptor.id;
		this.videoCodec = descriptor.videoCodec;
		this.videoEncoder = descriptor.videoEncoder;
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
	let loadingInstance = null;
	let queue = Promise.resolve();
	let pendingOperations = 0;
	let idleTeardown = null;
	let disposed = false;
	let generation = 0;
	const terminatedInstances = new WeakSet();
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

	function terminateInstance(instance) {
		if (!instance || terminatedInstances.has(instance)) return;
		terminatedInstances.add(instance);
		try { instance.off('progress', handleProgress); } catch {}
		try { instance.terminate(); } catch {}
	}

	function terminateRuntime() {
		const instance = ffmpeg;
		ffmpeg = null;
		loading = null;
		terminateInstance(instance);
	}

	function scheduleIdleTeardown() {
		if (disposed || idleTimeoutMs === null || typeof setTimeoutFn !== 'function' || pendingOperations !== 0 || !ffmpeg) return;
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
		assertActive();
		cancelIdleTeardown();
		if (ffmpeg?.loaded) {
			scheduleIdleTeardown();
			return ffmpeg;
		}
		if (loading) {
			const instance = await loading;
			assertActive();
			scheduleIdleTeardown();
			return instance;
		}

		const loadGeneration = generation;
		const loadPromise = (async () => {
			let instance = null;
			try {
				const loadedModule = await import('@ffmpeg/ffmpeg');
				assertGeneration(loadGeneration);
				module = loadedModule;
				instance = new loadedModule.FFmpeg();
				loadingInstance = instance;
				instance.on('progress', handleProgress);
				options.onLoading?.();
				assertGeneration(loadGeneration);
				await instance.load({ coreURL, wasmURL });
				assertGeneration(loadGeneration);
				ffmpeg = instance;
				loadingInstance = null;
				options.onReady?.();
				return instance;
			} catch (error) {
				if (loadingInstance === instance) loadingInstance = null;
				if (ffmpeg === instance) ffmpeg = null;
				terminateInstance(instance);
				if (error instanceof FfmpegDisposedError) throw error;
				throw error instanceof FfmpegCoreUnavailableError
					? error
					: new FfmpegCoreUnavailableError(error);
			}
		})();
		loading = loadPromise;
		try {
			const instance = await loadPromise;
			assertGeneration(loadGeneration);
			scheduleIdleTeardown();
			return instance;
		} finally {
			if (loading === loadPromise) loading = null;
		}
	}

	function run(task) {
		assertActive();
		cancelIdleTeardown();
		const operationGeneration = generation;
		pendingOperations += 1;
		const execute = async () => {
			assertGeneration(operationGeneration);
			const instance = await load();
			assertGeneration(operationGeneration);
			return task(instance);
		};
		const result = queue.then(execute, execute);
		queue = result.catch(() => undefined);
		return result.finally(() => {
			pendingOperations -= 1;
			if (!disposed && pendingOperations === 0) scheduleIdleTeardown();
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
			const onAbort = () => terminateRuntime();
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
			const onAbort = () => terminateRuntime();
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
		if (settings.sampleRate != null) normalizeMediaDecodeSampleRate(settings.sampleRate);
		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-input-${stamp}`;
			const output = `editor-decoded-${stamp}.wav`;
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
					buildMediaFfmpegDecoderArgs(input, output, {
						sampleRate: null,
						channelCount: null,
						outputFormat: 'wav',
					}),
					-1,
					{ signal },
				);
				if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
				const raw = await instance.readFile(output, undefined, { signal });
				if (!(raw instanceof Uint8Array)) throw new Error('FFmpeg returned invalid PCM data');
				return decodeFloatWave(raw, signal);
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

	async function encodeVideo(videoBlobsBySourceId, audioMix, plan, settings = {}) {
		const staged = prepareVideoBlobs(videoBlobsBySourceId, audioMix, plan);
		const signal = settings.signal;
		if (signal?.aborted) throw abortError();

		return run(async (instance) => {
			if (signal?.aborted) throw abortError();
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-video-${stamp}`;
			const output = `editor-video-${stamp}.${staged.descriptor.extension}`;
			const videoInputPaths = new Map();
			let audioInputPath = null;
			let mounted = false;
			const onAbort = () => terminateRuntime();
			signal?.addEventListener('abort', onAbort, { once: true });

			try {
				if (staged.blobs.length) {
					await instance.createDir(mountPoint);
					await instance.mount(module.FFFSType.WORKERFS, { blobs: staged.blobs }, mountPoint);
					mounted = true;
				}
				for (const input of staged.inputs) {
					const path = `${mountPoint}/${input.fileName}`;
					if (input.kind === 'video-source') videoInputPaths.set(input.sourceId, path);
					else audioInputPath = path;
				}
				const args = buildVideoFfmpegArgs(plan, { videoInputPaths, audioInputPath }, output, settings);
				const code = await instance.exec(args, -1, { signal });
				if (code !== 0) throw new FfmpegVideoEncodingError(staged.descriptor.id, code);
				const data = await instance.readFile(output, undefined, { signal });
				return {
					bytes: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)),
					extension: `.${staged.descriptor.extension}`,
					mimeType: staged.descriptor.mimeType,
				};
			} finally {
				signal?.removeEventListener('abort', onAbort);
				await instance.deleteFile(output).catch(() => undefined);
				if (mounted) {
					await instance.unmount(mountPoint).catch(() => undefined);
					await instance.deleteDir(mountPoint).catch(() => undefined);
				}
			}
		});
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		generation += 1;
		cancelIdleTeardown();
		const instances = new Set([ffmpeg, loadingInstance].filter(Boolean));
		ffmpeg = null;
		loadingInstance = null;
		loading = null;
		module = null;
		for (const instance of instances) terminateInstance(instance);
		queue = Promise.resolve();
	}

	function assertActive() {
		if (disposed) throw new FfmpegDisposedError();
	}

	function assertGeneration(expected) {
		if (disposed || generation !== expected) throw new FfmpegDisposedError();
	}

	return { load, encode, encodeFile, encodeVideo, decode, dispose, capabilities: () => capabilities };
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

function prepareVideoBlobs(videoBlobsBySourceId, audioMix, plan) {
	if (!plan || typeof plan !== 'object' || !Array.isArray(plan.inputs)) {
		throw new TypeError('Expected a video export plan.');
	}
	const descriptor = getVideoExportFormat(plan.format);
	const inputs = [...plan.inputs].sort((left, right) => left.inputIndex - right.inputIndex);
	const blobs = [];
	const stagedInputs = [];
	for (const input of inputs) {
		let blob;
		let fileName;
		if (input?.kind === 'video-source') {
			blob = mappedBlob(videoBlobsBySourceId, input.sourceId);
			if (!(blob instanceof Blob)) {
				throw new TypeError(`Expected a video Blob for source ${input.sourceId}.`);
			}
			fileName = `video-${String(input.inputIndex).padStart(3, '0')}.${videoBlobExtension(input.mimeType || blob.type)}`;
		} else if (input?.kind === 'staged-audio-mix') {
			if (!(audioMix instanceof Blob)) throw new TypeError('Expected a staged audio mix Blob.');
			blob = audioMix;
			fileName = `audio-${String(input.inputIndex).padStart(3, '0')}.wav`;
		} else {
			throw new TypeError(`Unsupported video export input kind: ${input?.kind}.`);
		}
		blobs.push({ name: fileName, data: blob });
		stagedInputs.push({ ...input, fileName });
	}
	return { descriptor, blobs, inputs: stagedInputs };
}

function mappedBlob(mapping, key) {
	if (mapping instanceof Map) return mapping.get(key);
	if (mapping && typeof mapping === 'object' && Object.prototype.hasOwnProperty.call(mapping, key)) {
		return mapping[key];
	}
	return undefined;
}

function videoBlobExtension(mimeType) {
	const normalized = String(mimeType || '').toLowerCase().split(';', 1)[0].trim();
	if (normalized === 'video/webm') return 'webm';
	if (normalized === 'video/quicktime') return 'mov';
	if (normalized === 'video/x-m4v') return 'm4v';
	return 'mp4';
}

function toUint8Array(value) {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw new TypeError('Expected WAV bytes');
}

async function decodeFloatWave(bytes, signal) {
	const blob = new Blob([bytes]);
	const descriptor = await inspectWavBlobPcm(blob, { signal });
	if (descriptor.encoding !== 'ieee-float' || descriptor.bitDepth !== 32) {
		throw new Error('FFmpeg returned an unexpected PCM format.');
	}
	const channels = Array.from(
		{ length: descriptor.channelCount },
		() => new Float32Array(descriptor.frameCount),
	);
	await streamWavBlobPcm(blob, {
		descriptor,
		signal,
		onChunk(packet, { frameOffset }) {
			for (let channel = 0; channel < channels.length; channel += 1) {
				channels[channel].set(packet[channel], frameOffset);
			}
		},
	});
	return {
		sampleRate: descriptor.sampleRate,
		channels,
		frameCount: descriptor.frameCount,
	};
}

function abortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
