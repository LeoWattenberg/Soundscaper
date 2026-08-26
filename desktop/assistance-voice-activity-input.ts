/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict semantic admission for an authenticated VAD result consumed by ASR. */

import { open, readFile, stat } from 'node:fs/promises';

import {
	normalizeVoiceActivityResult,
	type VoiceActivityResult,
} from './assistance-vad-runtime.ts';

const MAXIMUM_VOICE_ACTIVITY_BYTES = 16 * 1024 * 1024;
const CANONICAL_WAVE_HEADER_BYTES = 44;
const SPEECH_SAMPLE_RATE = 16_000;

export interface AssistanceSpeechWaveGeometryV1 {
	readonly sampleRate: typeof SPEECH_SAMPLE_RATE;
	readonly sampleCount: number;
	readonly dataOffset: typeof CANONICAL_WAVE_HEADER_BYTES;
}

export async function readAssistanceVoiceActivityInputV1(
	path: string,
	maximumSampleCount: number,
	signal?: AbortSignal,
): Promise<VoiceActivityResult> {
	signal?.throwIfAborted();
	if (typeof path !== 'string' || path === '') {
		throw new TypeError('Speech recognition needs an authenticated voice-activity path.');
	}
	if (!Number.isSafeInteger(maximumSampleCount) || maximumSampleCount < 1) {
		throw new RangeError('Speech recognition audio has invalid sample geometry.');
	}
	const metadata = await stat(path);
	if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAXIMUM_VOICE_ACTIVITY_BYTES) {
		throw new RangeError('The authenticated voice-activity body exceeds its semantic bound.');
	}
	const bytes = await readFile(path, { signal });
	signal?.throwIfAborted();
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The authenticated voice-activity body is malformed UTF-8 JSON.', {
			cause: error,
		});
	}
	const result = normalizeVoiceActivityResult(parsed);
	for (const [index, segment] of result.segments.entries()) {
		if (segment.startSample + segment.sampleCount > maximumSampleCount) {
			throw new RangeError(`Voice-activity segment ${String(index)} exceeds the authenticated audio.`);
		}
	}
	return result;
}

export async function inspectAssistanceSpeechWaveV1(
	path: string,
	signal?: AbortSignal,
): Promise<AssistanceSpeechWaveGeometryV1> {
	signal?.throwIfAborted();
	if (typeof path !== 'string' || path === '') {
		throw new TypeError('Speech recognition needs an authenticated audio path.');
	}
	const handle = await open(path, 'r');
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size < CANONICAL_WAVE_HEADER_BYTES + 4
			|| metadata.size > 0xffff_ffff + 8) {
			throw new RangeError('Speech recognition needs one canonical RIFF Float32 WAV.');
		}
		const header = new Uint8Array(CANONICAL_WAVE_HEADER_BYTES);
		const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
		if (bytesRead !== header.byteLength) {
			throw new Error('The speech-recognition WAV header ended during review.');
		}
		assertCanonicalSpeechWaveHeader(header, metadata.size);
		const sampleCount = (metadata.size - CANONICAL_WAVE_HEADER_BYTES) / 4;
		if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
			throw new RangeError('The speech-recognition WAV has invalid sample geometry.');
		}
		signal?.throwIfAborted();
		return Object.freeze({ sampleRate: SPEECH_SAMPLE_RATE, sampleCount,
			dataOffset: CANONICAL_WAVE_HEADER_BYTES });
	} finally {
		await handle.close();
	}
}

function assertCanonicalSpeechWaveHeader(header: Uint8Array, byteLength: number): void {
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	if (ascii(header, 0) !== 'RIFF' || ascii(header, 8) !== 'WAVE'
		|| view.getUint32(4, true) !== byteLength - 8
		|| ascii(header, 12) !== 'fmt ' || view.getUint32(16, true) !== 16
		|| view.getUint16(20, true) !== 3 || view.getUint16(22, true) !== 1
		|| view.getUint32(24, true) !== SPEECH_SAMPLE_RATE
		|| view.getUint32(28, true) !== SPEECH_SAMPLE_RATE * 4
		|| view.getUint16(32, true) !== 4 || view.getUint16(34, true) !== 32
		|| ascii(header, 36) !== 'data'
		|| view.getUint32(40, true) !== byteLength - CANONICAL_WAVE_HEADER_BYTES) {
		throw new TypeError('Speech recognition needs one canonical 16 kHz mono Float32 WAV.');
	}
}

function ascii(value: Uint8Array, offset: number): string {
	return String.fromCharCode(value[offset]!, value[offset + 1]!, value[offset + 2]!, value[offset + 3]!);
}
