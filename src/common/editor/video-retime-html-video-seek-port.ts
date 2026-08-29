/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoRetimePreviewPresentationRequest,
	type VideoRetimePreviewMediaPort,
	type VideoRetimePreviewPresentationRequest,
} from './video-retime-preview-executor.ts';
import type {
	VideoRetimeFrameDescriptor,
} from './video-retime-frame-dispatch.ts';

export type {
	VideoRetimePreviewMediaPort,
	VideoRetimePreviewPresentationRequest,
} from './video-retime-preview-executor.ts';

export interface VideoRetimeHtmlVideoSeekPortOptions {
	readonly assertCurrent: () => void;
	readonly timeoutMs?: number;
}

interface ActiveSeek {
	readonly request: Readonly<{
		readonly drawableSourceFrame: number;
		readonly intervalStartSeconds: number;
		readonly intervalEndSeconds: number;
		readonly targetSeconds: number;
		readonly signal: AbortSignal;
	}>;
	readonly resolve: (result: Readonly<{ readonly mediaTime: number }>) => void;
	readonly reject: (error: Error) => void;
	seekIssued: boolean;
	seekComplete: boolean;
	presentedMediaTime: number | null;
	failure: Error | null;
	settled: boolean;
	frameCallbackId: number | null;
	timer: ReturnType<typeof setTimeout> | null;
	readonly onSeeked: () => void;
	readonly onMediaError: () => void;
	readonly onMediaAbort: () => void;
	readonly onSignalAbort: () => void;
}

interface VideoSourceIdentity {
	readonly currentSrc: string;
	readonly src: string;
	readonly srcObject: unknown;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAXIMUM_TIMEOUT_MS = 30_000;

/** Adapt one exact source-frame descriptor into this seek port's validated request. */
export function createVideoRetimeHtmlVideoPresentationRequest(
	descriptor: VideoRetimeFrameDescriptor,
	signal: AbortSignal,
): VideoRetimePreviewPresentationRequest {
	return createVideoRetimePreviewPresentationRequest(descriptor, signal);
}

/** Present one exact retime interval through an exclusively owned paused video element. */
export function createVideoRetimeHtmlVideoSeekPort(
	videoValue: HTMLVideoElement,
	optionsValue: VideoRetimeHtmlVideoSeekPortOptions,
): VideoRetimePreviewMediaPort {
	if (typeof HTMLVideoElement === 'undefined' || !(videoValue instanceof HTMLVideoElement)) {
		throw new TypeError('A real HTMLVideoElement is required for retime preview seeking.');
	}
	const video = videoValue;
	const options = closedDataSnapshot(
		optionsValue,
		'video retime HTML seek options',
		['assertCurrent'],
		['timeoutMs'],
	);
	const assertGeneration = functionValue(
		options.assertCurrent,
		'video retime HTML seek options.assertCurrent',
	);
	const timeoutMs = options.timeoutMs === undefined
		? DEFAULT_TIMEOUT_MS
		: boundedTimeout(options.timeoutMs);
	const sourceIdentity = videoSourceIdentity(video);
	const requestVideoFrameCallback = video.requestVideoFrameCallback;
	const cancelVideoFrameCallback = video.cancelVideoFrameCallback;
	if (typeof requestVideoFrameCallback !== 'function'
		|| typeof cancelVideoFrameCallback !== 'function') {
		throw new TypeError('Retime preview requires requestVideoFrameCallback and its cancellation peer.');
	}
	const requestFrame = requestVideoFrameCallback.bind(video);
	const cancelFrame = cancelVideoFrameCallback.bind(video);
	const addVideoListener = video.addEventListener.bind(video);
	const removeVideoListener = video.removeEventListener.bind(video);
	const pauseVideo = video.pause.bind(video);
	let active: ActiveSeek | null = null;
	let terminalError: Error | null = null;
	let cachedPresentation: Readonly<{
		readonly request: ActiveSeek['request'];
		readonly mediaTime: number;
	}> | null = null;

	const assertCurrent = (): void => {
		if (terminalError !== null) throw terminalError;
		try {
			assertGeneration();
			if (!sameVideoSourceIdentity(videoSourceIdentity(video), sourceIdentity)) {
				throw new Error('The retime preview video source changed after the seek port was bound.');
			}
			pauseVideo();
			if (!video.paused) throw new Error('The retime preview video must remain paused.');
		} catch (error) {
			terminalError = errorValue(error, 'The retime preview source is no longer current.');
			throw terminalError;
		}
	};

	const pause = (): void => {
		assertCurrent();
	};

	const present = (
		requestValue: VideoRetimePreviewPresentationRequest,
	): PromiseLike<Readonly<{ readonly mediaTime: number }>> => {
		assertCurrent();
		if (active !== null) {
			throw new Error('The retime preview seek port cannot overlap two media seeks.');
		}
		const request = presentationRequest(requestValue);
		if (request.signal.aborted) throw abortError();
		const duration = video.duration;
		if (!Number.isFinite(duration) || duration <= 0 || request.targetSeconds >= duration) {
			throw new RangeError('The retime preview target would be clamped by the media duration.');
		}
		// rVFC reports newly presented frames only. A repeated paused-frame
		// request can therefore reuse the last compositor-authenticated result
		// when both the exact request and the media element still name that frame.
		if (cachedPresentation !== null
			&& !video.seeking
			&& video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
			&& samePresentationRequest(cachedPresentation.request, request)
			&& mediaTimeInRequestedInterval(video.currentTime, request)) {
			return Promise.resolve(Object.freeze({ mediaTime: cachedPresentation.mediaTime }));
		}
		cachedPresentation = null;

		return new Promise<Readonly<{ readonly mediaTime: number }>>((resolve, reject) => {
			const seek = createActiveSeek(request, resolve, reject);
			active = seek;
			const requestPresentedFrame = (): void => {
				const mayPrecedeTargetAssignment = !seek.seekIssued;
				const frameCallbackId = requestFrame((_now, metadata) => {
					if (seek.settled) return;
					const mediaTime = metadata.mediaTime;
					if (!mediaTimeInRequestedInterval(mediaTime, request)) {
						// The callback is armed before currentTime is assigned so a pending
						// presentation may still report the preceding frame. Only that
						// pre-assignment callback may be discarded; a replacement callback
						// must authenticate the requested interval or fail closed.
						if (mayPrecedeTargetAssignment) {
							cancelFrame(frameCallbackId);
							if (seek.frameCallbackId === frameCallbackId) seek.frameCallbackId = null;
							try {
								requestPresentedFrame();
							} catch (error) {
								requestFailure(seek, errorValue(
									error, 'The retime preview frame request failed.',
								));
							}
							return;
						}
						requestFailure(seek, new RangeError(
							'The presented video frame is outside its requested half-open source interval.',
						));
						return;
					}
					seek.presentedMediaTime = mediaTime;
					// A compositor-authenticated frame after the media element has
					// stopped seeking is sufficient even when Firefox omits `seeked`
					// for an assignment within the frame that is already current.
					seek.seekComplete ||= !video.seeking;
					maybeSettle(seek);
				});
				if (seek.settled) {
					cancelFrame(frameCallbackId);
					return;
				}
				seek.frameCallbackId = frameCallbackId;
			};
			try {
				addVideoListener('seeked', seek.onSeeked);
				addVideoListener('error', seek.onMediaError);
				addVideoListener('abort', seek.onMediaAbort);
				request.signal.addEventListener('abort', seek.onSignalAbort, { once: true });
				if (request.signal.aborted) {
					seek.onSignalAbort();
					return;
				}
				requestPresentedFrame();
				seek.timer = setTimeout(() => {
					if (seek.settled) return;
					const error = new Error(`The retime preview seek timed out after ${String(timeoutMs)} ms.`);
					if (seek.seekIssued && video.seeking && !seek.seekComplete) terminalError = error;
					finishRejection(seek, error);
				}, timeoutMs);
				assertCurrent();
				if (seek.settled) return;
				seek.seekIssued = true;
				video.currentTime = request.targetSeconds;
			} catch (error) {
				const failure = errorValue(error, 'The retime preview seek setup failed.');
				if (seek.seekIssued && video.seeking) requestFailure(seek, failure);
				else {
					seek.seekIssued = false;
					finishRejection(seek, failure);
				}
			}
		});
	};

	function createActiveSeek(
		request: ActiveSeek['request'],
		resolve: ActiveSeek['resolve'],
		reject: ActiveSeek['reject'],
	): ActiveSeek {
		const seek: ActiveSeek = {
			request,
			resolve,
			reject,
			seekIssued: false,
			seekComplete: false,
			presentedMediaTime: null,
			failure: null,
			settled: false,
			frameCallbackId: null,
			timer: null,
			onSeeked: () => {
				if (seek.settled) return;
				seek.seekComplete = true;
				maybeSettle(seek);
			},
			onMediaError: () => {
				if (seek.settled) return;
				const error = mediaElementError(video, 'The retime preview video failed while seeking.');
				terminalError = error;
				requestFailure(seek, error);
			},
			onMediaAbort: () => {
				if (seek.settled) return;
				const error = new Error('The retime preview media load was aborted.');
				terminalError = error;
				requestFailure(seek, error);
			},
			onSignalAbort: () => {
				if (seek.settled) return;
				requestFailure(seek, abortError());
			},
		};
		return seek;
	}

	function requestFailure(seek: ActiveSeek, error: Error): void {
		if (seek.settled || seek.failure !== null) return;
		seek.failure = error;
		if (seek.frameCallbackId !== null) {
			cancelFrame(seek.frameCallbackId);
			seek.frameCallbackId = null;
		}
		if (!seek.seekIssued || !video.seeking) finishRejection(seek, error);
	}

	function maybeSettle(seek: ActiveSeek): void {
		if (seek.settled) return;
		if (seek.failure !== null) {
			if (!seek.seekIssued || !video.seeking) finishRejection(seek, seek.failure);
			return;
		}
		if (!seek.seekComplete || video.seeking || seek.presentedMediaTime === null) return;
		try {
			assertCurrent();
		} catch (error) {
			finishRejection(seek, errorValue(error, 'The retime preview source changed during a seek.'));
			return;
		}
		finishSuccess(seek, seek.presentedMediaTime);
	}

	function finishSuccess(seek: ActiveSeek, mediaTime: number): void {
		if (!beginSettlement(seek)) return;
		cachedPresentation = Object.freeze({ request: seek.request, mediaTime });
		seek.resolve(Object.freeze({ mediaTime }));
	}

	function finishRejection(seek: ActiveSeek, error: Error): void {
		if (!beginSettlement(seek)) return;
		seek.reject(error);
	}

	function beginSettlement(seek: ActiveSeek): boolean {
		if (seek.settled) return false;
		seek.settled = true;
		if (seek.timer !== null) {
			clearTimeout(seek.timer);
			seek.timer = null;
		}
		if (seek.frameCallbackId !== null) {
			cancelFrame(seek.frameCallbackId);
			seek.frameCallbackId = null;
		}
		removeVideoListener('seeked', seek.onSeeked);
		removeVideoListener('error', seek.onMediaError);
		removeVideoListener('abort', seek.onMediaAbort);
		seek.request.signal.removeEventListener('abort', seek.onSignalAbort);
		pauseVideo();
		if (active === seek) active = null;
		return true;
	}

	assertCurrent();
	return Object.freeze({ pause, assertCurrent, present });
}

function mediaTimeInRequestedInterval(mediaTime: number, request: ActiveSeek['request']): boolean {
	return Number.isFinite(mediaTime)
		&& mediaTime >= request.intervalStartSeconds
		&& mediaTime < request.intervalEndSeconds;
}

function samePresentationRequest(left: ActiveSeek['request'], right: ActiveSeek['request']): boolean {
	return left.drawableSourceFrame === right.drawableSourceFrame
		&& left.intervalStartSeconds === right.intervalStartSeconds
		&& left.intervalEndSeconds === right.intervalEndSeconds
		&& left.targetSeconds === right.targetSeconds;
}

function presentationRequest(value: unknown): ActiveSeek['request'] {
	const record = closedDataSnapshot(value, 'video retime preview presentation request', [
		'drawableSourceFrame', 'intervalStartSeconds', 'intervalEndSeconds', 'targetSeconds', 'signal',
	]);
	const drawableSourceFrame = nonNegativeSafeInteger(
		record.drawableSourceFrame,
		'video retime preview presentation request.drawableSourceFrame',
	);
	const intervalStartSeconds = finiteNumber(
		record.intervalStartSeconds,
		'video retime preview presentation request.intervalStartSeconds',
	);
	const intervalEndSeconds = finiteNumber(
		record.intervalEndSeconds,
		'video retime preview presentation request.intervalEndSeconds',
	);
	const targetSeconds = finiteNumber(
		record.targetSeconds,
		'video retime preview presentation request.targetSeconds',
	);
	if (intervalStartSeconds < 0 || intervalStartSeconds >= intervalEndSeconds
		|| targetSeconds < intervalStartSeconds || targetSeconds >= intervalEndSeconds) {
		throw new RangeError('The retime preview target must be contained by one non-negative interval.');
	}
	if (typeof AbortSignal === 'undefined' || !(record.signal instanceof AbortSignal)) {
		throw new TypeError('The retime preview presentation request requires an AbortSignal.');
	}
	return Object.freeze({
		drawableSourceFrame,
		intervalStartSeconds,
		intervalEndSeconds,
		targetSeconds,
		signal: record.signal,
	});
}

function closedDataSnapshot(
	value: unknown,
	name: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const keys = Reflect.ownKeys(value);
	const allowed = new Set([...requiredKeys, ...optionalKeys]);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} must be a closed own-data record.`);
	}
	const snapshot: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property, not an accessor.`);
		}
		snapshot[String(key)] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function videoSourceIdentity(video: HTMLVideoElement): VideoSourceIdentity {
	const currentSrc = video.currentSrc;
	const src = video.src;
	if ((!currentSrc || currentSrc.trim().length === 0) && (!src || src.trim().length === 0)) {
		throw new TypeError('The retime preview video requires a nonempty current source identity.');
	}
	return { currentSrc, src, srcObject: video.srcObject };
}

function sameVideoSourceIdentity(left: VideoSourceIdentity, right: VideoSourceIdentity): boolean {
	return left.currentSrc === right.currentSrc && left.src === right.src && left.srcObject === right.srcObject;
}

function boundedTimeout(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > MAXIMUM_TIMEOUT_MS) {
		throw new RangeError(`Retime preview timeoutMs must be a positive safe integer no greater than ${String(MAXIMUM_TIMEOUT_MS)}.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function functionValue(value: unknown, name: string): () => void {
	if (typeof value !== 'function') throw new TypeError(`${name} must be a function.`);
	return value as () => void;
}

function mediaElementError(video: HTMLVideoElement, fallback: string): Error {
	return video.error === null
		? new Error(fallback)
		: new Error(`${fallback} MediaError code ${String(video.error.code)}.`);
}

function errorValue(value: unknown, fallback: string): Error {
	return value instanceof Error ? value : new Error(value == null ? fallback : String(value));
}

function abortError(): DOMException {
	return new DOMException('The retime preview seek was cancelled.', 'AbortError');
}
