/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectAiffBlobPcm } from '../aiff-pcm-chunk-reader.ts';
import { inspectWavBlobPcm } from '../wav-import.js';

interface AudioRelinkCandidateSource {
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
}

interface AudioRelinkCandidateFile extends Blob {
	readonly name?: string;
}

interface AudioRelinkDescriptor {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

/** Structurally admit one maintained PCM replacement without decoding or retaining its samples. */
export async function admitChangedContentAudioCandidate(
	file: AudioRelinkCandidateFile,
	source: AudioRelinkCandidateSource,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<void> {
	throwIfAborted(options.signal);
	const kind = candidateKind(file, source.mimeType);
	const inspected = kind === 'aiff'
		? await inspectAiffBlobPcm(file, { signal: options.signal })
		: await inspectWavBlobPcm(file, { signal: options.signal });
	throwIfAborted(options.signal);
	const descriptor = audioDescriptor(inspected);
	if (descriptor.frameCount !== source.frameCount) {
		throw new Error('The selected linked audio original does not match the source frame count.');
	}
	if (descriptor.channelCount !== source.channelCount) {
		throw new Error('The selected linked audio original does not match the source channel count.');
	}
	if (descriptor.sampleRate !== source.sampleRate
		|| descriptor.sampleRate !== source.originalSampleRate) {
		throw new Error('The selected linked audio original does not match the source sample rate.');
	}
}

function candidateKind(
	file: AudioRelinkCandidateFile,
	mimeType: string,
): 'aiff' | 'wav' {
	if (!(file instanceof Blob)) throw new TypeError('A linked audio replacement File is required.');
	if ((file.type || mimeType) !== mimeType) {
		throw new TypeError('The selected linked audio original does not match the source MIME type.');
	}
	const name = typeof file.name === 'string' ? file.name : '';
	if (mimeType === 'audio/aiff' && /\.(?:aif|aiff)$/iu.test(name)) return 'aiff';
	if (mimeType === 'audio/rf64' && /\.rf64$/iu.test(name)) return 'wav';
	if (mimeType === 'audio/wav' && /\.wav$/iu.test(name)) return 'wav';
	throw new TypeError('The selected linked audio original has an unsupported file identity.');
}

function audioDescriptor(value: unknown): AudioRelinkDescriptor {
	if (!value || typeof value !== 'object') {
		throw new TypeError('The selected linked audio original has no PCM descriptor.');
	}
	const candidate = value as Partial<AudioRelinkDescriptor>;
	for (const field of ['frameCount', 'channelCount', 'sampleRate'] as const) {
		if (!Number.isSafeInteger(candidate[field]) || Number(candidate[field]) < 1) {
			throw new RangeError(`The selected linked audio original has an invalid ${field}.`);
		}
	}
	return candidate as AudioRelinkDescriptor;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw (signal.reason instanceof Error
		? signal.reason
		: new DOMException('The changed-content audio probe was aborted.', 'AbortError'));
}
