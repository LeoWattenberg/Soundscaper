/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../wav.js';

const MAXIMUM_UPLOAD_BYTES = 100_000_000;

interface DecodeContext {
	decodeAudioData(value: ArrayBuffer): Promise<AudioBuffer>;
	close(): Promise<void>;
}

export interface FreesoundUploadFilePreparationRuntime {
	readonly createDecodeContext?: () => DecodeContext;
	readonly encode?: typeof encodeWav;
	readonly maximumBytes?: number;
}

/** Convert browser-decodable audio that Freesound cannot ingest directly into 24-bit PCM WAV. */
export async function prepareFreesoundUploadFile(
	file: File,
	signal?: AbortSignal,
	runtime: FreesoundUploadFilePreparationRuntime = {},
): Promise<File> {
	signal?.throwIfAborted();
	const maximumBytes = runtime.maximumBytes ?? MAXIMUM_UPLOAD_BYTES;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('The Freesound upload byte limit is invalid.');
	}
	if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maximumBytes) {
		throw new RangeError('The input audio exceeds the 100 MB Freesound upload limit.');
	}
	const context = runtime.createDecodeContext?.() ?? createBrowserDecodeContext();
	let decoded: AudioBuffer;
	try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
	finally { await context.close(); }
	signal?.throwIfAborted();
	const expectedBytes = decoded.length * decoded.numberOfChannels * 3 + 4_096;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maximumBytes) {
		throw new RangeError('The converted audio exceeds the 100 MB Freesound upload limit.');
	}
	const channels = Array.from(
		{ length: decoded.numberOfChannels },
		(_, channel) => decoded.getChannelData(channel),
	);
	const bytes = (runtime.encode ?? encodeWav)(channels, {
		sampleRate: decoded.sampleRate,
		bitDepth: 24,
		float: false,
		dither: 'triangular',
	});
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximumBytes) {
		throw new RangeError('The converted audio exceeds the 100 MB Freesound upload limit.');
	}
	signal?.throwIfAborted();
	return new File([Uint8Array.from(bytes).buffer], `${fileStem(file.name)}.wav`, {
		type: 'audio/wav',
		lastModified: file.lastModified,
	});
}

function createBrowserDecodeContext(): DecodeContext {
	const scope = globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};
	const Context = scope.AudioContext ?? scope.webkitAudioContext;
	if (!Context) throw new Error('This audio format cannot be decoded in this browser.');
	return new Context({ latencyHint: 'playback' });
}

function fileStem(value: string): string {
	const stem = value.replace(/\\/gu, '/').split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? '';
	const safeStem = Array.from(stem, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127 || '/:*?"<>|'.includes(character) ? '-' : character;
	}).join('');
	return safeStem.replace(/^\.+/u, '').trim().slice(0, 220)
		|| 'soundscaper-audio';
}
