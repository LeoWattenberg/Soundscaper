/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoRetimeHtmlVideoPresentationRequest,
	createVideoRetimeHtmlVideoSeekPort,
	type VideoRetimeHtmlVideoSeekPortOptions,
	type VideoRetimePreviewMediaPort,
} from '../video-retime-html-video-seek-port.ts';
import type {
	VideoKeyframeOfflineSourcePresentation,
	VideoKeyframeOfflineSourceResolver,
} from './video-keyframe-offline-rgba-source.ts';
import {
	admitVideoKeyframeOfflineHtmlVideoSourceAssets,
	bindVideoKeyframeOfflineHtmlVideoEntry,
	type VideoKeyframeOfflineHtmlVideoSourceAsset,
	type VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot,
} from './video-keyframe-offline-html-video-source-admission.ts';

export type { VideoKeyframeOfflineHtmlVideoSourceAsset } from './video-keyframe-offline-html-video-source-admission.ts';

interface OfflineHtmlVideoElement extends EventTarget {
	preload: string;
	muted: boolean;
	playsInline: boolean;
	autoplay: boolean;
	readonly style: Pick<
		CSSStyleDeclaration,
		'position' | 'left' | 'top' | 'width' | 'height' | 'pointerEvents'
	>;
	readonly paused: boolean;
	readonly readyState: number;
	readonly isConnected: boolean;
	readonly duration: number;
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly error: MediaError | null;
	src: string;
	currentSrc: string;
	srcObject: MediaProvider | null;
	currentTime: number;
	pause(): void;
	load(): void;
	removeAttribute(name: string): void;
	remove(): void;
}

interface OfflineHtmlVideoDocument {
	createElement(name: 'video'): OfflineHtmlVideoElement;
	append(video: OfflineHtmlVideoElement): void;
}

interface OfflineObjectUrlPort {
	createObjectURL(blob: Blob): string;
	revokeObjectURL(url: string): void;
}

export interface VideoKeyframeOfflineHtmlVideoSourceResolverOptions {
	readonly sources: readonly VideoKeyframeOfflineHtmlVideoSourceAsset[];
	readonly timeoutMs?: number;
	readonly document?: Pick<Document, 'body' | 'createElement'>;
	readonly url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
	readonly createSeekPort?: (
		video: OfflineHtmlVideoElement,
		options: VideoRetimeHtmlVideoSeekPortOptions,
	) => VideoRetimePreviewMediaPort;
}

export interface VideoKeyframeOfflineHtmlVideoSourceResolver {
	readonly resolveSource: VideoKeyframeOfflineSourceResolver;
	dispose(): void;
}

interface SourceLifecycle {
	readonly asset: VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot;
	readonly occurrenceKey: string;
	readonly video: OfflineHtmlVideoElement;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly objectUrl: string;
	readonly token: object;
	readonly lifetime: AbortController;
	readonly cleanup: MediaCleanup;
	port: VideoRetimePreviewMediaPort;
	presentation: VideoKeyframeOfflineSourcePresentation;
	retired: boolean;
}

interface MediaCleanup {
	readonly video: OfflineHtmlVideoElement;
	readonly objectUrl: string;
	paused: boolean;
	sourceCleared: boolean;
	reloaded: boolean;
	removed: boolean;
	revoked: boolean;
}

interface NormalizedOptions {
	readonly assets: ReadonlyMap<string, VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot>;
	readonly timeoutMs: number;
	readonly document: OfflineHtmlVideoDocument;
	readonly url: OfflineObjectUrlPort;
	readonly createSeekPort: NonNullable<VideoKeyframeOfflineHtmlVideoSourceResolverOptions['createSeekPort']>;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAXIMUM_TIMEOUT_MS = 30_000;

/** Own lazy, digest-bound paused HTMLVideoElement lifecycles for offline exact frames. */
export function createVideoKeyframeOfflineHtmlVideoSourceResolver(
	optionsValue: VideoKeyframeOfflineHtmlVideoSourceResolverOptions,
): VideoKeyframeOfflineHtmlVideoSourceResolver {
	const options = snapshotOptions(optionsValue);
	const lifecycles = new Map<string, SourceLifecycle>();
	const currentTokens = new Map<string, object>();
	const ownedLifecycles = new Set<SourceLifecycle>();
	const failedMediaCleanups = new Set<MediaCleanup>();
	const lifetime = new AbortController();
	let activeResolution = false;
	let disposed = false;

	const resolveSource: VideoKeyframeOfflineSourceResolver = async (entryValue, requestValue) => {
		if (disposed) throw new Error('The offline HTML video source resolver is closed.');
		if (activeResolution) throw new Error('The offline HTML video source resolver cannot overlap resolutions.');
		const request = sourceRequest(requestValue);
		throwIfAborted(request.signal);
		const binding = bindVideoKeyframeOfflineHtmlVideoEntry(entryValue, options.assets);
		const current = lifecycles.get(binding.occurrenceKey);
		if (current !== undefined) {
			assertLifecycleCurrent(current);
			return current.presentation;
		}
		activeResolution = true;
		const token = Object.freeze({});
		currentTokens.set(binding.occurrenceKey, token);
		const abortScope = createAbortScope([request.signal, lifetime.signal]);
		let candidate: SourceLifecycle | null = null;
		try {
			candidate = await createLifecycle(
				binding.asset, binding.occurrenceKey, token, abortScope.signal,
			);
			throwIfAborted(abortScope.signal);
			assertLifecycleCurrent(candidate);
			lifecycles.set(binding.occurrenceKey, candidate);
			ownedLifecycles.add(candidate);
			return candidate.presentation;
		} catch (error) {
			if (candidate !== null) {
				candidate.retired = true;
				candidate.lifetime.abort();
				const cleanupError = cleanupLifecycle(candidate, options.url);
				if (cleanupError) {
					ownedLifecycles.add(candidate);
					throw new AggregateError(
						[error, cleanupError], 'Offline video resolution and cleanup failed.', { cause: error },
					);
				}
			}
			if (currentTokens.get(binding.occurrenceKey) === token) {
				currentTokens.delete(binding.occurrenceKey);
			}
			throw error;
		} finally {
			abortScope.dispose();
			activeResolution = false;
		}
	};

	function assertLifecycleCurrent(lifecycle: SourceLifecycle): void {
		if (disposed || lifecycle.retired
			|| !lifecycle.video.isConnected
			|| currentTokens.get(lifecycle.occurrenceKey) !== lifecycle.token) {
			throw new Error('The offline HTML video source lifecycle is no longer current.');
		}
	}

	async function createLifecycle(
		asset: VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot,
		occurrenceKey: string,
		token: object,
		signal: AbortSignal,
	): Promise<SourceLifecycle> {
		throwIfAborted(signal);
		const video = options.document.createElement('video');
		if (!video || typeof video !== 'object') throw new Error('Browser video decoding is unavailable.');
		video.preload = 'auto';
		video.muted = true;
		video.playsInline = true;
		video.autoplay = false;
		const objectUrl = options.url.createObjectURL(asset.blob);
		if (typeof objectUrl !== 'string' || objectUrl.length < 1) {
			throw new Error('The browser did not create an offline video object URL.');
		}
		const cleanup = mediaCleanup(video, objectUrl);
		let lifecycle: SourceLifecycle | null = null;
		try {
			mountOffscreenVideo(video, options.document);
			// HAVE_METADATA is not drawable readiness: Firefox can strand the first
			// paused frame callback when a seek begins before current frame data exists.
			const ready = waitForCurrentFrameData(video, signal, options.timeoutMs);
			video.src = objectUrl;
			video.load();
			await ready;
			throwIfAborted(signal);
			const decodedWidth = video.videoWidth;
			const decodedHeight = video.videoHeight;
			const matchesDecoded = decodedWidth === asset.decodedWidth
				&& decodedHeight === asset.decodedHeight;
			const matchesDisplay = decodedWidth === asset.displayWidth
				&& decodedHeight === asset.displayHeight;
			if (!matchesDecoded && !matchesDisplay) {
				throw new RangeError(
					`Offline video decoded geometry ${String(decodedWidth)}x${String(decodedHeight)} `
					+ `does not match admitted decoded ${String(asset.decodedWidth)}x${String(asset.decodedHeight)} `
					+ `or display ${String(asset.displayWidth)}x${String(asset.displayHeight)} dimensions.`,
				);
			}
			if (!Number.isFinite(video.duration) || video.duration <= 0) {
				throw new RangeError('The offline video source requires a positive finite duration.');
			}
			video.pause();
			lifecycle = {
				asset,
				occurrenceKey,
				video,
				decodedWidth,
				decodedHeight,
				objectUrl,
				token,
				lifetime: new AbortController(),
				cleanup,
				port: null as unknown as VideoRetimePreviewMediaPort,
				presentation: null as unknown as VideoKeyframeOfflineSourcePresentation,
				retired: false,
			};
			const port = options.createSeekPort(video, Object.freeze({
				assertCurrent: () => { assertLifecycleCurrent(lifecycle!); },
				timeoutMs: options.timeoutMs,
			}));
			lifecycle.port = port;
			lifecycle.presentation = createPresentation(lifecycle);
			return lifecycle;
		} catch (error) {
			const cleanupError = cleanupMedia(cleanup, options.url);
			if (cleanupError) failedMediaCleanups.add(cleanup);
			if (cleanupError) throw new AggregateError([error, cleanupError], 'Offline video setup and cleanup failed.', { cause: error });
			throw error;
		}
	}

	function createPresentation(lifecycle: SourceLifecycle): VideoKeyframeOfflineSourcePresentation {
		const { asset } = lifecycle;
		return Object.freeze({
			sourceId: asset.sourceId,
			identity: asset.identity,
			drawable: lifecycle.video as unknown as TexImageSource,
			// HTMLVideoElement intrinsic geometry is engine-dependent: some
			// browsers expose the decoder-rotated pixels while others also apply
			// the admitted pixel aspect ratio. The texture must describe the
			// drawable this engine actually supplies; display geometry remains the
			// canonical target applied by the compositor.
			decodedWidth: lifecycle.decodedWidth,
			decodedHeight: lifecycle.decodedHeight,
			displayWidth: asset.displayWidth,
			displayHeight: asset.displayHeight,
			async present(
				entryValue: Readonly<Record<string, unknown>>,
				requestValue: Readonly<{ readonly signal: AbortSignal }>,
			): Promise<void> {
				assertLifecycleCurrent(lifecycle);
				const request = sourceRequest(requestValue);
				const abortScope = createAbortScope([request.signal, lifetime.signal, lifecycle.lifetime.signal]);
				try {
					throwIfAborted(abortScope.signal);
					const binding = bindVideoKeyframeOfflineHtmlVideoEntry(entryValue, options.assets);
					if (binding.asset !== asset || binding.occurrenceKey !== lifecycle.occurrenceKey) {
						throw new Error('The offline video presentation received a different source occurrence.');
					}
					const descriptor = Reflect.apply(asset.presentationForEntry, undefined, [binding.entry]);
					const seek = createVideoRetimeHtmlVideoPresentationRequest(descriptor, abortScope.signal);
					await lifecycle.port.present(seek);
					throwIfAborted(abortScope.signal);
					assertLifecycleCurrent(lifecycle);
				} finally {
					abortScope.dispose();
				}
			},
			dispose(): void { retireLifecycle(lifecycle); },
		});
	}

	function retireLifecycle(lifecycle: SourceLifecycle): void {
		if (!lifecycle.retired) {
			lifecycle.retired = true;
			lifecycle.lifetime.abort();
			if (lifecycles.get(lifecycle.occurrenceKey) === lifecycle) {
				lifecycles.delete(lifecycle.occurrenceKey);
			}
			if (currentTokens.get(lifecycle.occurrenceKey) === lifecycle.token) {
				currentTokens.delete(lifecycle.occurrenceKey);
			}
		}
		const failure = cleanupLifecycle(lifecycle, options.url);
		if (failure) throw failure;
		ownedLifecycles.delete(lifecycle);
	}

	function dispose(): void {
		if (!disposed) {
			disposed = true;
			lifetime.abort();
			lifecycles.clear();
			currentTokens.clear();
		}
		const failures: Error[] = [];
		for (const lifecycle of [...ownedLifecycles]) {
			try { retireLifecycle(lifecycle); } catch (error) { failures.push(errorValue(error)); }
		}
		for (const cleanup of [...failedMediaCleanups]) {
			const failure = cleanupMedia(cleanup, options.url);
			if (failure) failures.push(failure);
			else failedMediaCleanups.delete(cleanup);
		}
		if (failures.length > 0) throw new AggregateError(failures, 'Offline HTML video source cleanup failed.');
	}

	return Object.freeze({ resolveSource, dispose });
}

function snapshotOptions(value: unknown): NormalizedOptions {
	const record = closedRecord(value, 'offline HTML video source resolver options', ['sources'], [
		'timeoutMs', 'document', 'url', 'createSeekPort',
	]);
	const assets = admitVideoKeyframeOfflineHtmlVideoSourceAssets(record.sources);
	const timeoutMs = record.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : boundedTimeout(record.timeoutMs);
	const documentValue = record.document ?? globalThis.document;
	if (!documentValue || typeof documentValue !== 'object'
		|| typeof (documentValue as OfflineHtmlVideoDocument).createElement !== 'function') {
		throw new Error('Browser video decoding is unavailable.');
	}
	const body = (documentValue as Pick<Document, 'body'>).body;
	if (!body || typeof body.append !== 'function') {
		throw new Error('Browser video attachment is unavailable.');
	}
	const urlValue = record.url ?? globalThis.URL;
	if (!urlValue || (typeof urlValue !== 'object' && typeof urlValue !== 'function')
		|| typeof (urlValue as OfflineObjectUrlPort).createObjectURL !== 'function'
		|| typeof (urlValue as OfflineObjectUrlPort).revokeObjectURL !== 'function') {
		throw new Error('Browser object URL support is unavailable.');
	}
	const createVideo = (name: 'video'): OfflineHtmlVideoElement => (
		(documentValue as Pick<Document, 'createElement'>).createElement(name)
	);
	const appendVideo = (video: OfflineHtmlVideoElement): void => {
		body.append(video as unknown as Node);
	};
	const objectUrl = urlValue as OfflineObjectUrlPort;
	const url = Object.freeze({
		createObjectURL: objectUrl.createObjectURL.bind(urlValue),
		revokeObjectURL: objectUrl.revokeObjectURL.bind(urlValue),
	});
	let createSeekPort = record.createSeekPort;
	if (createSeekPort === undefined) {
		createSeekPort = (video: OfflineHtmlVideoElement, options: VideoRetimeHtmlVideoSeekPortOptions) => (
			createVideoRetimeHtmlVideoSeekPort(video as unknown as HTMLVideoElement, options)
		);
	}
	if (typeof createSeekPort !== 'function') {
		throw new TypeError('Offline HTML video seek-port creation must be a function.');
	}
	return Object.freeze({
		assets,
		timeoutMs,
		document: Object.freeze({ createElement: createVideo, append: appendVideo }),
		url,
		createSeekPort: createSeekPort as NormalizedOptions['createSeekPort'],
	});
}

/** Keep Firefox's decoded frame surface live without exposing export-owned media in the UI. */
function mountOffscreenVideo(
	video: OfflineHtmlVideoElement,
	document: OfflineHtmlVideoDocument,
): void {
	video.style.position = 'fixed';
	video.style.left = '-10000px';
	video.style.top = '0px';
	video.style.width = '1px';
	video.style.height = '1px';
	video.style.pointerEvents = 'none';
	document.append(video);
}

function sourceRequest(value: unknown): Readonly<{ signal: AbortSignal }> {
	const request = closedRecord(value, 'offline video source request', ['signal']);
	if (typeof AbortSignal === 'undefined' || !(request.signal instanceof AbortSignal)) {
		throw new TypeError('An offline video source request requires an AbortSignal.');
	}
	return Object.freeze({ signal: request.signal });
}

function waitForCurrentFrameData(
	video: OfflineHtmlVideoElement,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<void> {
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			video.removeEventListener('loadeddata', onLoaded);
			video.removeEventListener('error', onError);
			video.removeEventListener('abort', onMediaAbort);
			signal.removeEventListener('abort', onSignalAbort);
			if (error) reject(error); else resolve();
		};
		const onLoaded = (): void => { finish(); };
		const onError = (): void => { finish(mediaError(video, 'The offline video frame data failed to load.')); };
		const onMediaAbort = (): void => { finish(new Error('The offline video frame data load was aborted.')); };
		const onSignalAbort = (): void => { finish(abortError()); };
		const timer = setTimeout(() => {
			finish(new Error(`The offline video frame data load timed out after ${String(timeoutMs)} ms.`));
		}, timeoutMs);
		video.addEventListener('loadeddata', onLoaded, { once: true });
		video.addEventListener('error', onError, { once: true });
		video.addEventListener('abort', onMediaAbort, { once: true });
		signal.addEventListener('abort', onSignalAbort, { once: true });
		if (signal.aborted) onSignalAbort();
	});
}

function createAbortScope(signals: readonly AbortSignal[]) {
	const controller = new AbortController();
	const sources = [...new Set(signals)];
	const onAbort = (): void => { controller.abort(); };
	for (const signal of sources) {
		if (signal.aborted) { controller.abort(); break; }
		signal.addEventListener('abort', onAbort, { once: true });
	}
	return Object.freeze({
		signal: controller.signal,
		dispose(): void {
			for (const signal of sources) signal.removeEventListener('abort', onAbort);
		},
	});
}

function mediaCleanup(video: OfflineHtmlVideoElement, objectUrl: string): MediaCleanup {
	return { video, objectUrl, paused: false, sourceCleared: false, reloaded: false, removed: false, revoked: false };
}

function cleanupLifecycle(lifecycle: SourceLifecycle, url: OfflineObjectUrlPort): Error | null {
	return cleanupMedia(lifecycle.cleanup, url);
}

function cleanupMedia(cleanup: MediaCleanup, url: OfflineObjectUrlPort): Error | null {
	const failures: Error[] = [];
	if (!cleanup.paused) try { cleanup.video.pause(); cleanup.paused = true; } catch (error) { failures.push(errorValue(error)); }
	if (!cleanup.sourceCleared) try {
		Reflect.apply(cleanup.video.removeAttribute, cleanup.video, ['src']);
		cleanup.sourceCleared = true;
	} catch (error) { failures.push(errorValue(error)); }
	if (!cleanup.reloaded) try { cleanup.video.load(); cleanup.reloaded = true; } catch (error) { failures.push(errorValue(error)); }
	if (!cleanup.removed) try { cleanup.video.remove(); cleanup.removed = true; } catch (error) { failures.push(errorValue(error)); }
	if (!cleanup.revoked) try { url.revokeObjectURL(cleanup.objectUrl); cleanup.revoked = true; } catch (error) { failures.push(errorValue(error)); }
	if (failures.length === 0) return null;
	return failures.length === 1 ? failures[0]! : new AggregateError(failures, 'Offline video media cleanup failed.');
}

function closedRecord(
	value: unknown,
	name: string,
	required: readonly string[],
	optional: readonly string[] = [],
): Readonly<Record<string, unknown>> {
	const record = dataRecord(value, name);
	const keys = Reflect.ownKeys(record);
	const allowed = new Set([...required, ...optional]);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| required.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} must be a closed own-data record.`);
	}
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) snapshot[String(key)] = data(record, String(key), name);
	return Object.freeze(snapshot);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function boundedTimeout(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_TIMEOUT_MS) {
		throw new RangeError(`Offline video timeoutMs must be between 1 and ${String(MAXIMUM_TIMEOUT_MS)}.`);
	}
	return Number(value);
}

function mediaError(video: OfflineHtmlVideoElement, fallback: string): Error {
	return video.error === null ? new Error(fallback) : new Error(`${fallback} MediaError code ${String(video.error.code)}.`);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw abortError();
}

function abortError(): DOMException {
	return new DOMException('The offline HTML video source operation was cancelled.', 'AbortError');
}

function errorValue(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
