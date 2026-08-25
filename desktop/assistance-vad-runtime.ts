/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed result and runtime boundary for authenticated voice activity. */

import type { SpeechRuntimeStatus } from './assistance-speech-runtime.ts';

const MAXIMUM_SEGMENTS = 100_000;

export interface VoiceActivitySegment {
	readonly startSample: number;
	readonly sampleCount: number;
}

export interface VoiceActivityResult {
	readonly sampleRate: number;
	readonly segments: readonly VoiceActivitySegment[];
}

export interface VoiceActivityRequest {
	readonly modelId?: string;
	readonly audioPath: string;
	readonly model: Readonly<{ readonly model: string }>;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

export interface VoiceActivityRuntimeAdapter {
	status(): Promise<SpeechRuntimeStatus>;
	detect(request: VoiceActivityRequest): Promise<VoiceActivityResult>;
}

export function normalizeVoiceActivityResult(value: unknown): VoiceActivityResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A voice-activity result must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'sampleRate')
		|| !Object.hasOwn(record, 'segments')) {
		throw new TypeError('A voice-activity result must carry exactly sampleRate and segments.');
	}
	if (!Number.isSafeInteger(record.sampleRate) || (record.sampleRate as number) !== 16_000) {
		throw new RangeError('A voice-activity result must use the exact 16 kHz preparation rate.');
	}
	if (!Array.isArray(record.segments) || record.segments.length > MAXIMUM_SEGMENTS) {
		throw new RangeError('A voice-activity result exceeds its segment bound.');
	}
	let priorEnd = 0;
	const segments = record.segments.map((value, index): VoiceActivitySegment => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`Voice-activity segment ${index} must be a plain record.`);
		}
		const segment = value as Record<string, unknown>;
		if (Object.keys(segment).length !== 2 || !Object.hasOwn(segment, 'startSample')
			|| !Object.hasOwn(segment, 'sampleCount')) {
			throw new TypeError(`Voice-activity segment ${index} has an invalid shape.`);
		}
		if (!Number.isSafeInteger(segment.startSample) || (segment.startSample as number) < 0
			|| !Number.isSafeInteger(segment.sampleCount) || (segment.sampleCount as number) < 1) {
			throw new RangeError(`Voice-activity segment ${index} has invalid sample geometry.`);
		}
		const startSample = segment.startSample as number;
		const sampleCount = segment.sampleCount as number;
		const end = startSample + sampleCount;
		if (!Number.isSafeInteger(end)) throw new RangeError(`Voice-activity segment ${index} exceeds safe timing.`);
		if (startSample < priorEnd) {
			throw new RangeError('Voice-activity segments must be ordered and disjoint.');
		}
		priorEnd = end;
		return Object.freeze({ startSample, sampleCount });
	});
	return Object.freeze({ sampleRate: 16_000, segments: Object.freeze(segments) });
}
