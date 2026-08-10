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
import {
	abortFfmpegOutputSink,
	assertFfmpegOutputReady,
	cleanupFfmpegOutputRuntime,
	streamFfmpegOutputFile,
} from './ffmpeg-output-stream.ts';
import {
	encodeFfmpegVideoBytes,
	encodeFfmpegVideoToSink,
} from './ffmpeg-video-output.ts';
import { readBoundedFfmpegOutputFile } from './browser-export-output.ts';
import { getVideoExportFormat } from './video-export.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import {
	buildFfmpegVideoTimingProbeArgs,
	parseFfmpegVideoTimingLogs,
} from './ffmpeg-video-timing-probe.ts';
import {
	isFfmpegSourceCharacteristicsLog,
	parseFfmpegVideoSourceCharacteristics,
} from './ffmpeg-video-source-characteristics.ts';
import { conformFfmpegVideoToCfr } from './ffmpeg-cfr-ingest.ts';

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
	const configuredCoreBaseURL = options.coreBaseURL || import.meta.env?.PUBLIC_FFMPEG_CORE_BASE_URL || null;
	const fallbackCoreBaseURL = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10';

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

	async function resolveCoreBaseURL() {
		if (configuredCoreBaseURL) return String(configuredCoreBaseURL).replace(/\/$/, '');
		try {
			if (options.resolveCoreBaseURL) {
				return String(await options.resolveCoreBaseURL(fallbackCoreBaseURL)).replace(/\/$/, '');
			}
			const { createBrowserFfmpegRuntimeManager } = await import('../offline/browser-ffmpeg-runtime.ts');
			return await createBrowserFfmpegRuntimeManager().resolveCoreBaseUrl(fallbackCoreBaseURL);
		} catch {
			return fallbackCoreBaseURL;
		}
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
				const coreBaseURL = await resolveCoreBaseURL();
				assertGeneration(loadGeneration);
				await instance.load({
					coreURL: `${coreBaseURL}/ffmpeg-core.js`,
					wasmURL: `${coreBaseURL}/ffmpeg-core.wasm`,
				});
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
				const data = await readBoundedFfmpegOutputFile(instance, output, {
					label: 'Audio export', maximumBytes: settings.maximumOutputBytes, signal,
				});
				return {
					bytes: data,
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
				? safeFfmpegFileName(file.name, `editor-${stamp}.wav`)
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
				const data = await readBoundedFfmpegOutputFile(instance, output, {
					label: 'Audio export', maximumBytes: settings.maximumOutputBytes, signal,
				});
				return {
					bytes: data,
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

	async function encodeFileToSink(file, format, sink, settings = {}) {
		let streamOwnsFailure = false;
		const signal = settings.signal;
		try {
			const normalizedFormat = canonicalMediaExportFormat(format);
			const descriptor = getMediaExportFormat(normalizedFormat);
			if (descriptor.backend !== 'ffmpeg' && descriptor.backend !== 'custom-ffmpeg') {
				throw new Error(`${descriptor.label} uses a native encoder.`);
			}
			assertMediaExportAvailable(normalizedFormat, settings.capabilities || capabilities);
			const normalized = normalizeMediaExportSettings(normalizedFormat, { ...settings, capabilities: settings.capabilities || capabilities });
			if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
			assertFfmpegOutputReady(settings);
			const result = await run(async (instance) => {
				const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
				const mountPoint = `/editor-encode-${stamp}`;
				const inputName = typeof File !== 'undefined' && file instanceof File
					? file.name.replace(/[\\/]/g, '-').replaceAll('\u0000', '-')
					: `editor-${stamp}.wav`;
				const output = `editor-${stamp}.${normalized.extension}`;
				const onAbort = () => terminateRuntime();
				const cleanupSteps = [];
				let operationError;
				signal?.addEventListener('abort', onAbort, { once: true });
				try {
					assertFfmpegOutputReady(settings);
					await instance.createDir(mountPoint);
					cleanupSteps.push(() => instance.deleteDir(mountPoint));
					const mountOptions = typeof File !== 'undefined' && file instanceof File
						? { files: [file] }
						: { blobs: [{ name: inputName, data: file }] };
					await instance.mount(module.FFFSType.WORKERFS, mountOptions, mountPoint);
					cleanupSteps.unshift(() => instance.unmount(mountPoint));
					assertFfmpegOutputReady(settings);
					cleanupSteps.unshift(() => instance.deleteFile(output));
					const code = await instance.exec(encoderArgs(`${mountPoint}/${inputName}`, output, normalizedFormat, {
						...normalized,
						applyDither: settings.applyDither === true,
					}), -1, { signal });
					assertFfmpegOutputReady(settings);
					if (code !== 0) throw new FfmpegEncodingError(normalizedFormat, code);
					streamOwnsFailure = true;
					const streamed = await streamFfmpegOutputFile(instance, output, sink, {
						signal,
						assertCurrent: settings.assertCurrent,
						maximumChunkBytes: settings.maximumOutputChunkBytes,
					});
					streamOwnsFailure = false;
					return { ...streamed, extension: `.${normalized.extension}`, mimeType: normalized.mimeType };
				} catch (error) {
					operationError = error;
					throw error;
				} finally {
					signal?.removeEventListener('abort', onAbort);
					if (!terminatedInstances.has(instance)) {
						await cleanupFfmpegOutputRuntime(cleanupSteps, terminateRuntime, operationError);
					}
				}
			});
			assertFfmpegOutputReady(settings);
			return result;
		} catch (error) {
			if (streamOwnsFailure) throw error;
			const primary = signal?.aborted ? signal.reason ?? abortError() : error;
			throw await abortFfmpegOutputSink(sink, primary);
		}
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

	async function probeVideoTiming(file, settings = {}) {
		if (!(file instanceof Blob)) throw new TypeError('Expected a video Blob for timing probe.');
		const signal = settings.signal;
		if (signal?.aborted) throw signal.reason ?? abortError();
		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-probe-${stamp}`;
			let input = `editor-probe-${stamp}`;
			let mounted = false;
			const logs = [];
			const handleLog = ({ message = '' }) => {
				if (typeof message !== 'string') return;
				// The banner states the characteristics no filter reports, and it
				// arrives in the run the timing probe already pays for.
				if (message.includes('showinfo') || message.includes('config in time_base:')
					|| isFfmpegSourceCharacteristicsLog(message)) {
					logs.push(message);
				}
			};
			const onAbort = () => terminateRuntime();
			instance.on('log', handleLog);
			signal?.addEventListener('abort', onAbort, { once: true });
			try {
				if (typeof File !== 'undefined' && file instanceof File && module?.FFFSType) {
					const inputName = safeFfmpegFileName(file.name, `video-${stamp}`);
					await instance.createDir(mountPoint);
					await instance.mount(module.FFFSType.WORKERFS, {
						blobs: [{ name: inputName, data: file }],
					}, mountPoint);
					input = `${mountPoint}/${inputName}`;
					mounted = true;
				} else {
					await instance.writeFile(input, new Uint8Array(await file.arrayBuffer()), { signal });
				}
				const code = await instance.exec(buildFfmpegVideoTimingProbeArgs(input), -1, { signal });
				if (code !== 0) throw new Error(`FFmpeg timing probe exited with code ${code}.`);
				const timing = parseFfmpegVideoTimingLogs(logs);
				return {
					...timing,
					characteristics: parseFfmpegVideoSourceCharacteristics(logs, { rate: timing.nominalRate }),
				};
			} finally {
				signal?.removeEventListener('abort', onAbort);
				try { instance.off('log', handleLog); } catch {}
				if (mounted) {
					await instance.unmount(mountPoint).catch(() => undefined);
					await instance.deleteDir(mountPoint).catch(() => undefined);
				} else await instance.deleteFile(input).catch(() => undefined);
			}
		});
	}

	function conformVideoToCfr(file, settings = {}) {
		return conformFfmpegVideoToCfr({
			file, rate: settings.rate, signal: settings.signal, run,
			workerFsType: () => module?.FFFSType?.WORKERFS,
			terminateRuntime,
		});
	}

	async function encodeVideo(videoBlobsBySourceId, audioMix, plan, settings = {}) {
		return encodeFfmpegVideoBytes({
			videoBlobsBySourceId, audioMix, plan, settings,
			run,
			workerFsType: () => module.FFFSType.WORKERFS,
			terminateRuntime,
			isRuntimeTerminated: (instance) => terminatedInstances.has(instance),
			createEncodingError: (format, code) => new FfmpegVideoEncodingError(format, code),
		});
	}

	async function encodeVideoToSink(videoBlobsBySourceId, audioMix, plan, sink, settings = {}) {
		return encodeFfmpegVideoToSink({
			videoBlobsBySourceId, audioMix, plan, sink, settings,
			run,
			workerFsType: () => module.FFFSType.WORKERFS,
			terminateRuntime,
			isRuntimeTerminated: (instance) => terminatedInstances.has(instance),
			createEncodingError: (format, code) => new FfmpegVideoEncodingError(format, code),
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

	return {
		load, encode, encodeFile, encodeFileToSink, encodeVideo, encodeVideoToSink,
		decode, probeVideoTiming, conformVideoToCfr, dispose, capabilities: () => capabilities,
	};
}

function normalizeIdleTimeout(value) {
	if (value === false || value === null) return null;
	if (value === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new TypeError('FFmpeg idleTimeoutMs must be a non-negative finite number, false, or null.');
	}
	return value;
}

function safeFfmpegFileName(value, fallback) {
	const normalized = String(value || '').replaceAll('\0', '-').replace(/[\\/]/gu, '-');
	return normalized || fallback;
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
