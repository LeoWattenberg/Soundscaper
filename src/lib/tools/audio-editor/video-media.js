export const AUDIO_EDITOR_VIDEO_FILE_ACCEPT = 'video/mp4,video/webm,.mp4,.m4v,.webm';
export const AUDIO_EDITOR_VIDEO_THUMBNAIL_INTERVAL_SECONDS = 5;

const VIDEO_FILE_EXTENSION = /\.(?:m4v|mp4|webm)$/i;
const DEFAULT_METADATA_TIMEOUT_MS = 15_000;

export function isAudioEditorVideoFile(value) {
	const type = String(value?.type || '').trim().toLowerCase();
	const name = String(value?.name || '').trim();
	return type.startsWith('video/') || VIDEO_FILE_EXTENSION.test(name);
}

export function audioEditorVideoThumbnailTimes(durationSeconds, options = {}) {
	const duration = Math.max(0, Number(durationSeconds) || 0);
	const interval = positiveFinite(
		options.intervalSeconds ?? AUDIO_EDITOR_VIDEO_THUMBNAIL_INTERVAL_SECONDS,
		'Thumbnail interval',
	);
	const maximum = Math.max(1, Math.floor(Number(options.maximum) || 2_000));
	if (!duration) return Object.freeze([0]);
	const result = [];
	for (let timestamp = 0; timestamp < duration && result.length < maximum; timestamp += interval) {
		result.push(timestamp);
	}
	const finalTimestamp = Math.max(0, duration - Math.min(0.05, duration / 2));
	if (result.length < maximum && finalTimestamp - (result.at(-1) ?? -Infinity) > interval / 4) {
		result.push(finalTimestamp);
	}
	return Object.freeze(result);
}

/**
 * Creates one browser-native decoder session which can inspect a video and
 * capture several frames without repeatedly loading the source.
 */
export async function createAudioEditorVideoFrameExtractor(file, options = {}) {
	if (!(file instanceof Blob)) throw new TypeError('A video Blob or File is required.');
	const document = options.document ?? globalThis.document;
	const urlApi = options.urlApi ?? globalThis.URL;
	if (!document?.createElement || !urlApi?.createObjectURL) {
		throw new Error('Browser video decoding is unavailable.');
	}
	const video = document.createElement('video');
	const objectUrl = urlApi.createObjectURL(file);
	let disposed = false;
	video.preload = 'metadata';
	video.muted = true;
	video.playsInline = true;
	video.src = objectUrl;
	try {
		await waitForMediaEvent(video, 'loadedmetadata', {
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS,
			errorMessage: 'The browser could not read this video.',
		});
	} catch (error) {
		video.removeAttribute?.('src');
		video.load?.();
		urlApi.revokeObjectURL?.(objectUrl);
		throw error;
	}

	const durationSeconds = nonNegativeFinite(video.duration, 'Video duration');
	const width = positiveInteger(video.videoWidth, 'Video width');
	const height = positiveInteger(video.videoHeight, 'Video height');
	const metadata = Object.freeze({
		durationSeconds,
		width,
		height,
		aspectRatio: width / height,
		mimeType: String(file.type || ''),
		byteLength: Number(file.size) || 0,
	});

	async function capture(timestampSeconds, captureOptions = {}) {
		if (disposed) throw new Error('The video frame extractor is closed.');
		const timestamp = Math.max(0, Math.min(
			Math.max(0, durationSeconds - 0.001),
			Number(timestampSeconds) || 0,
		));
		if (Math.abs(Number(video.currentTime) - timestamp) > 0.001) {
			const seeked = waitForMediaEvent(video, 'seeked', {
				signal: captureOptions.signal ?? options.signal,
				timeoutMs: captureOptions.timeoutMs ?? options.timeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS,
				errorMessage: 'The browser could not seek this video.',
			});
			video.currentTime = timestamp;
			await seeked;
		}
		const maximumWidth = positiveInteger(captureOptions.maximumWidth ?? 320, 'Thumbnail width');
		const maximumHeight = positiveInteger(captureOptions.maximumHeight ?? 180, 'Thumbnail height');
		const scale = Math.min(1, maximumWidth / width, maximumHeight / height);
		const outputWidth = Math.max(2, Math.round(width * scale));
		const outputHeight = Math.max(2, Math.round(height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = outputWidth;
		canvas.height = outputHeight;
		const context = canvas.getContext?.('2d', { alpha: false });
		if (!context?.drawImage) throw new Error('Canvas video-frame capture is unavailable.');
		context.drawImage(video, 0, 0, outputWidth, outputHeight);
		const mimeType = String(captureOptions.mimeType || 'image/webp');
		const quality = Math.max(0, Math.min(1, Number(captureOptions.quality ?? 0.78)));
		const blob = await canvasToBlob(canvas, mimeType, quality);
		return Object.freeze({
			timestampSeconds: timestamp,
			width: outputWidth,
			height: outputHeight,
			mimeType: blob.type || mimeType,
			blob,
		});
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		video.pause?.();
		video.removeAttribute?.('src');
		video.load?.();
		urlApi.revokeObjectURL?.(objectUrl);
	}

	return Object.freeze({ metadata, capture, dispose });
}

function waitForMediaEvent(media, successEvent, options = {}) {
	const signal = options.signal;
	if (signal?.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		let timeout = 0;
		const cleanup = () => {
			media.removeEventListener?.(successEvent, onSuccess);
			media.removeEventListener?.('error', onError);
			signal?.removeEventListener?.('abort', onAbort);
			if (timeout) globalThis.clearTimeout?.(timeout);
		};
		const onSuccess = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error(options.errorMessage || 'The media operation failed.'));
		};
		const onAbort = () => {
			cleanup();
			reject(abortError());
		};
		media.addEventListener?.(successEvent, onSuccess, { once: true });
		media.addEventListener?.('error', onError, { once: true });
		signal?.addEventListener?.('abort', onAbort, { once: true });
		const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
		if (timeoutMs) timeout = globalThis.setTimeout?.(onError, timeoutMs);
	});
}

function canvasToBlob(canvas, mimeType, quality) {
	if (typeof canvas.toBlob === 'function') {
		return new Promise((resolve, reject) => canvas.toBlob(
			(blob) => blob ? resolve(blob) : reject(new Error('The video thumbnail could not be encoded.')),
			mimeType,
			quality,
		));
	}
	if (typeof canvas.toDataURL !== 'function') {
		return Promise.reject(new Error('Canvas image encoding is unavailable.'));
	}
	const [header, payload = ''] = canvas.toDataURL(mimeType, quality).split(',');
	const resolvedMimeType = /data:([^;,]+)/.exec(header)?.[1] || mimeType;
	const bytes = typeof globalThis.atob === 'function'
		? Uint8Array.from(globalThis.atob(payload), (character) => character.charCodeAt(0))
		: new TextEncoder().encode(payload);
	return Promise.resolve(new Blob([bytes], { type: resolvedMimeType }));
}

function positiveFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function nonNegativeFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function positiveInteger(value, name) {
	const number = Math.round(Number(value));
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive integer.`);
	return number;
}

function abortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
