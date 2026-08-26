/* SPDX-License-Identifier: AGPL-3.0-only */

/** Silero VAD execution through the authenticated Sherpa runtime. */

import {
	normalizeVoiceActivityResult,
	type VoiceActivityRequest,
	type VoiceActivityResult,
} from './assistance-vad-runtime.ts';

const SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = 512;

interface SherpaSpeechSegment {
	readonly start: number;
	readonly samples: Float32Array;
}

interface SherpaVadInstance {
	acceptWaveform(samples: Float32Array): void;
	isEmpty(): boolean;
	front(): SherpaSpeechSegment;
	pop(): void;
	flush(): void;
	clear(): void;
}

interface SherpaVadModule {
	readonly Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVadInstance;
	readWave(path: string): Readonly<{ samples: Float32Array; sampleRate: number }>;
}

function exposesVad(value: unknown): value is SherpaVadModule {
	const candidate = value as Partial<SherpaVadModule> | null;
	return typeof candidate?.Vad === 'function' && typeof candidate.readWave === 'function';
}

function resolveRuntimeModule(runtime: unknown): SherpaVadModule {
	if (exposesVad(runtime)) return runtime;
	const withDefault = (runtime as { default?: unknown } | null)?.default;
	if (exposesVad(withDefault)) return withDefault;
	throw new TypeError('The speech runtime does not expose Silero VAD.');
}

export function createSherpaVadFactory(runtime: unknown): Readonly<{
	detect(request: VoiceActivityRequest): Promise<VoiceActivityResult>;
}> {
	const module = resolveRuntimeModule(runtime);
	return Object.freeze({
		async detect(request: VoiceActivityRequest): Promise<VoiceActivityResult> {
			if (typeof request?.audioPath !== 'string' || request.audioPath === ''
				|| typeof request.model?.model !== 'string' || request.model.model === '') {
				throw new TypeError('Voice activity needs one audio file and one Silero model.');
			}
			request.signal?.throwIfAborted();
			const wave = module.readWave(request.audioPath);
			if (wave.sampleRate !== SAMPLE_RATE) {
				throw new RangeError('Voice activity requires exact 16 kHz selected audio.');
			}
			const vad = new module.Vad({
				sileroVad: {
					model: request.model.model, threshold: 0.5,
					minSilenceDuration: 0.5, minSpeechDuration: 0.25,
					windowSize: WINDOW_SAMPLES, maxSpeechDuration: 30,
				},
				sampleRate: SAMPLE_RATE, numThreads: 2, provider: 'cpu', debug: 0,
			}, 60);
			const segments: Array<{ startSample: number; sampleCount: number }> = [];
			const drain = (): void => {
				while (!vad.isEmpty()) {
					const segment = vad.front();
					segments.push({ startSample: segment.start, sampleCount: segment.samples.length });
					vad.pop();
				}
			};
			try {
				for (let offset = 0; offset < wave.samples.length; offset += WINDOW_SAMPLES) {
					request.signal?.throwIfAborted();
					const end = Math.min(offset + WINDOW_SAMPLES, wave.samples.length);
					vad.acceptWaveform(wave.samples.subarray(offset, end));
					drain();
					request.onProgress?.(Object.freeze({ completed: end, total: wave.samples.length }));
				}
				vad.flush();
				drain();
				request.signal?.throwIfAborted();
				for (const [index, segment] of segments.entries()) {
					if (segment.startSample + segment.sampleCount > wave.samples.length) {
						throw new RangeError(`Sherpa VAD segment ${index} exceeds the selected audio.`);
					}
				}
				return normalizeVoiceActivityResult({ sampleRate: SAMPLE_RATE, segments });
			} finally {
				vad.clear();
			}
		},
	});
}
