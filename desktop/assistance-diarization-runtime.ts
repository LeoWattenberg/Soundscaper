/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed result and runtime boundary for authenticated speaker diarization. */

import type { SpeechRuntimeStatus } from './assistance-speech-runtime.ts';

const MAXIMUM_TURNS = 100_000;

export interface SpeakerTurnResult {
	readonly startSample: number;
	readonly sampleCount: number;
	readonly speakerId: number;
}

export interface SpeakerDiarizationResult {
	readonly sampleRate: number;
	readonly turns: readonly SpeakerTurnResult[];
}

export interface SpeakerDiarizationRequest {
	readonly audioPath: string;
	readonly models: Readonly<{
		readonly segmentation: string;
		readonly embedding: string;
	}>;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

export interface SpeakerDiarizationRuntimeAdapter {
	status(): Promise<SpeechRuntimeStatus>;
	diarize(request: SpeakerDiarizationRequest): Promise<SpeakerDiarizationResult>;
}

export function normalizeSpeakerDiarizationResult(value: unknown): SpeakerDiarizationResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A speaker-diarization result must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'sampleRate')
		|| !Object.hasOwn(record, 'turns')) {
		throw new TypeError('A speaker-diarization result must carry exactly sampleRate and turns.');
	}
	if (!Number.isSafeInteger(record.sampleRate) || record.sampleRate !== 16_000) {
		throw new RangeError('A speaker-diarization result must use the exact 16 kHz preparation rate.');
	}
	if (!Array.isArray(record.turns) || record.turns.length > MAXIMUM_TURNS) {
		throw new RangeError('A speaker-diarization result exceeds its turn bound.');
	}
	let prior: SpeakerTurnResult | null = null;
	const turns = record.turns.map((value, index): SpeakerTurnResult => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`Speaker turn ${index} must be a plain record.`);
		}
		const turn = value as Record<string, unknown>;
		if (Object.keys(turn).length !== 3 || !Object.hasOwn(turn, 'startSample')
			|| !Object.hasOwn(turn, 'sampleCount') || !Object.hasOwn(turn, 'speakerId')) {
			throw new TypeError(`Speaker turn ${index} has an invalid shape.`);
		}
		if (!Number.isSafeInteger(turn.startSample) || (turn.startSample as number) < 0
			|| !Number.isSafeInteger(turn.sampleCount) || (turn.sampleCount as number) < 1
			|| !Number.isSafeInteger(turn.speakerId) || (turn.speakerId as number) < 0) {
			throw new RangeError(`Speaker turn ${index} has invalid timing or identity.`);
		}
		const normalized = Object.freeze({
			startSample: turn.startSample as number,
			sampleCount: turn.sampleCount as number,
			speakerId: turn.speakerId as number,
		});
		if (!Number.isSafeInteger(normalized.startSample + normalized.sampleCount)) {
			throw new RangeError(`Speaker turn ${index} exceeds safe timing.`);
		}
		if (prior && compareSpeakerTurns(prior, normalized) > 0) {
			throw new RangeError('Speaker turns must be ordered by stable start, speaker, and duration fields.');
		}
		prior = normalized;
		return normalized;
	});
	return Object.freeze({ sampleRate: 16_000, turns: Object.freeze(turns) });
}

export function compareSpeakerTurns(left: SpeakerTurnResult, right: SpeakerTurnResult): number {
	return left.startSample - right.startSample || left.speakerId - right.speakerId
		|| left.sampleCount - right.sampleCount;
}
