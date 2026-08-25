/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pyannote/ERes2Net diarization through the authenticated Sherpa runtime. */

import {
	compareSpeakerTurns,
	normalizeSpeakerDiarizationResult,
	type SpeakerDiarizationRequest,
	type SpeakerDiarizationResult,
	type SpeakerTurnResult,
} from './assistance-diarization-runtime.ts';

const SAMPLE_RATE = 16_000;

interface SherpaSpeakerSegment {
	readonly start: number;
	readonly end: number;
	readonly speaker: number;
}

interface SherpaDiarizerInstance {
	readonly sampleRate: number;
	process(samples: Float32Array): readonly SherpaSpeakerSegment[];
}

interface SherpaDiarizerModule {
	readonly OfflineSpeakerDiarization: new (config: unknown) => SherpaDiarizerInstance;
	readWave(path: string): Readonly<{ samples: Float32Array; sampleRate: number }>;
}

function exposesDiarizer(value: unknown): value is SherpaDiarizerModule {
	const candidate = value as Partial<SherpaDiarizerModule> | null;
	return typeof candidate?.OfflineSpeakerDiarization === 'function'
		&& typeof candidate.readWave === 'function';
}

function resolveRuntimeModule(runtime: unknown): SherpaDiarizerModule {
	if (exposesDiarizer(runtime)) return runtime;
	const withDefault = (runtime as { default?: unknown } | null)?.default;
	if (exposesDiarizer(withDefault)) return withDefault;
	throw new TypeError('The speech runtime does not expose offline speaker diarization.');
}

export function createSherpaDiarizerFactory(runtime: unknown): Readonly<{
	diarize(request: SpeakerDiarizationRequest): Promise<SpeakerDiarizationResult>;
}> {
	const module = resolveRuntimeModule(runtime);
	return Object.freeze({
		async diarize(request: SpeakerDiarizationRequest): Promise<SpeakerDiarizationResult> {
			if (typeof request?.audioPath !== 'string' || request.audioPath === ''
				|| typeof request.models?.segmentation !== 'string' || request.models.segmentation === ''
				|| typeof request.models?.embedding !== 'string' || request.models.embedding === '') {
				throw new TypeError('Speaker diarization needs audio, segmentation, and embedding files.');
			}
			request.signal?.throwIfAborted();
			const wave = module.readWave(request.audioPath);
			if (wave.sampleRate !== SAMPLE_RATE || !(wave.samples instanceof Float32Array)) {
				throw new RangeError('Speaker diarization requires exact 16 kHz selected audio.');
			}
			const diarizer = new module.OfflineSpeakerDiarization({
				segmentation: {
					pyannote: { model: request.models.segmentation },
					numThreads: 2, debug: 0, provider: 'cpu',
				},
				embedding: {
					model: request.models.embedding,
					numThreads: 2, debug: 0, provider: 'cpu',
				},
				clustering: { numClusters: 0, threshold: 0.5 },
				minDurationOn: 0.3,
				minDurationOff: 0.5,
			});
			if (diarizer.sampleRate !== SAMPLE_RATE) {
				throw new RangeError('The speaker diarizer does not use the exact 16 kHz preparation rate.');
			}
			request.onProgress?.(Object.freeze({ completed: 0, total: wave.samples.length }));
			request.signal?.throwIfAborted();
			const nativeTurns = diarizer.process(wave.samples);
			request.signal?.throwIfAborted();
			if (!Array.isArray(nativeTurns)) {
				throw new TypeError('The speaker diarizer returned an invalid segment collection.');
			}
			const turns = nativeTurns.map((turn, index) => speakerTurn(turn, index, wave.samples.length));
			turns.sort(compareSpeakerTurns);
			request.onProgress?.(Object.freeze({ completed: wave.samples.length, total: wave.samples.length }));
			return normalizeSpeakerDiarizationResult({ sampleRate: SAMPLE_RATE, turns });
		},
	});
}

function speakerTurn(value: unknown, index: number, audioSampleCount: number): SpeakerTurnResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Sherpa speaker segment ${index} must be a record.`);
	}
	const segment = value as Partial<SherpaSpeakerSegment>;
	if (typeof segment.start !== 'number' || !Number.isFinite(segment.start) || segment.start < 0
		|| typeof segment.end !== 'number' || !Number.isFinite(segment.end) || segment.end <= segment.start
		|| !Number.isSafeInteger(segment.speaker) || (segment.speaker as number) < 0) {
		throw new RangeError(`Sherpa speaker segment ${index} has invalid timing or identity.`);
	}
	const startSample = Math.round(segment.start * SAMPLE_RATE);
	const endSample = Math.round(segment.end * SAMPLE_RATE);
	if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) || endSample <= startSample) {
		throw new RangeError(`Sherpa speaker segment ${index} has unrepresentable sample timing.`);
	}
	if (endSample > audioSampleCount) {
		throw new RangeError(`Sherpa speaker segment ${index} exceeds the selected audio.`);
	}
	return Object.freeze({
		startSample, sampleCount: endSample - startSample, speakerId: segment.speaker as number,
	});
}
