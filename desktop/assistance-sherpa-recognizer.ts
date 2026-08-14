/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Maps the speech runtime's transducer output onto the recognition result the
 * editor ingests.
 *
 * The runtime returns sub-word tokens, not words: a decode of "I don't" comes
 * back as `' I'`, `' don'`, `"'"`, `'t'`, with one timestamp and one duration
 * per token and an empty `words` array. A leading space is the word boundary,
 * which is the SentencePiece convention this model was trained with. That was
 * measured against the shipped model rather than assumed, because getting it
 * wrong silently produces word timings that look plausible and cut in the
 * wrong places.
 */

import type {
	RecognizedWordResult,
	SpeechModelPaths,
	SpeechRecognitionResult,
	SpeechRecognizerFactory,
} from './assistance-speech-runtime.ts';

/** The raw shape the runtime returns for one decoded stream. */
export interface SherpaTransducerResult {
	readonly text?: string;
	readonly tokens?: readonly string[];
	readonly timestamps?: readonly number[];
	readonly durations?: readonly number[];
	readonly lang?: string;
}

function assertAligned(result: SherpaTransducerResult): {
	tokens: readonly string[];
	timestamps: readonly number[];
	durations: readonly number[];
} {
	const tokens = result.tokens ?? [];
	const timestamps = result.timestamps ?? [];
	const durations = result.durations ?? [];
	if (timestamps.length !== tokens.length) {
		throw new RangeError('The speech runtime returned a timestamp per token mismatch.');
	}
	if (durations.length !== 0 && durations.length !== tokens.length) {
		throw new RangeError('The speech runtime returned a duration per token mismatch.');
	}
	return { tokens, timestamps, durations };
}

/**
 * Groups sub-word tokens into words. A word starts at its first token and ends
 * at the last token's timestamp plus that token's duration, so punctuation
 * attached to a word keeps the word's span rather than extending it.
 */
export function assembleWordsFromTokens(
	result: SherpaTransducerResult,
): readonly RecognizedWordResult[] {
	const { tokens, timestamps, durations } = assertAligned(result);
	const words: RecognizedWordResult[] = [];
	let text = '';
	let startSeconds = 0;
	let endSeconds = 0;

	const flush = () => {
		const trimmed = text.trim();
		if (trimmed !== '') {
			words.push(Object.freeze({
				text: trimmed,
				startSeconds,
				endSeconds: Math.max(endSeconds, startSeconds),
				confidence: null,
			}));
		}
		text = '';
	};

	for (const [index, token] of tokens.entries()) {
		const at = timestamps[index] as number;
		const through = at + (durations[index] ?? 0);
		if (token.startsWith(' ') && text !== '') flush();
		if (text === '') startSeconds = at;
		text += token;
		endSeconds = through;
	}
	flush();
	return Object.freeze(words);
}

/**
 * Converts one decoded stream into a recognition result.
 *
 * An offline decode covers the whole submitted range, so it produces a single
 * segment. Splitting a long recording into utterances is voice-activity
 * detection's job, and inventing segment boundaries here would fabricate
 * structure the model never reported.
 */
export function sherpaResultToRecognition(
	result: SherpaTransducerResult,
	durationSeconds: number,
): SpeechRecognitionResult {
	if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
		throw new RangeError('A recognized range needs a finite, non-negative duration.');
	}
	const words = assembleWordsFromTokens(result);
	// The runtime reports an empty string, not a missing field, when a model
	// identifies no language. Blank is "unreported" here, not a language.
	const language = (result.lang ?? '').trim() === '' ? null : (result.lang as string);
	const text = (result.text ?? '').trim();
	if (text === '' && words.length === 0) {
		return Object.freeze({ language, segments: Object.freeze([]) });
	}
	const startSeconds = words.length > 0 ? (words[0] as RecognizedWordResult).startSeconds : 0;
	const endSeconds = words.length > 0
		? Math.max(durationSeconds, (words.at(-1) as RecognizedWordResult).endSeconds)
		: durationSeconds;
	return Object.freeze({
		language,
		segments: Object.freeze([Object.freeze({
			startSeconds,
			endSeconds,
			text: text === '' ? words.map(({ text: value }) => value).join(' ') : text,
			words,
			speaker: null,
		})]),
	});
}

/** The runtime surface this adapter uses, kept narrow so tests can supply it. */
export interface SherpaRuntimeModule {
	OfflineRecognizer: new (config: unknown) => {
		createStream(): {
			acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
		};
		decode(stream: unknown): void;
		getResult(stream: unknown): SherpaTransducerResult;
	};
	readWave(path: string): { samples: Float32Array; sampleRate: number };
}

export interface SherpaFactoryOptions {
	readonly numThreads?: number;
	readonly provider?: string;
}

function transducerConfig(model: SpeechModelPaths, options: SherpaFactoryOptions) {
	if (typeof model.joiner !== 'string' || model.joiner === '') {
		throw new TypeError('This runtime needs a separate joiner model.');
	}
	return {
		featConfig: { sampleRate: 16_000, featureDim: 80 },
		modelConfig: {
			transducer: { encoder: model.encoder, decoder: model.decoder, joiner: model.joiner },
			tokens: model.tokens,
			numThreads: options.numThreads ?? 2,
			provider: options.provider ?? 'cpu',
			debug: 0,
			modelType: 'nemo_transducer',
		},
		decodingMethod: 'greedy_search',
	};
}

/**
 * Builds recognizers over the loaded runtime. One recognizer is created per
 * job and released with it, so a cancelled or failed job leaves no model
 * resident in the helper.
 */
function exposesRecognizer(value: unknown): value is SherpaRuntimeModule {
	const candidate = value as Partial<SherpaRuntimeModule> | null;
	return typeof candidate?.OfflineRecognizer === 'function' && typeof candidate.readWave === 'function';
}

/**
 * Resolves the module the runtime actually exposes. The package is CommonJS,
 * so a dynamic import hands back a namespace whose interop default carries the
 * API while the namespace itself does not. Both shapes reach here depending on
 * how the caller loaded it, and guessing wrong fails only at the first job.
 */
function resolveRuntimeModule(runtime: unknown): SherpaRuntimeModule {
	if (exposesRecognizer(runtime)) return runtime;
	const withDefault = (runtime as { default?: unknown } | null)?.default;
	if (exposesRecognizer(withDefault)) return withDefault;
	throw new TypeError('The speech runtime does not expose an offline recognizer.');
}

export function createSherpaRecognizerFactory(
	runtime: unknown,
	options: SherpaFactoryOptions = {},
): SpeechRecognizerFactory {
	const module = resolveRuntimeModule(runtime);
	return {
		async create(request) {
			const recognizer = new module.OfflineRecognizer(transducerConfig(request.model, options));
			return {
				async recognize(audioPath: string): Promise<SpeechRecognitionResult> {
					const wave = module.readWave(audioPath);
					const stream = recognizer.createStream();
					stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
					recognizer.decode(stream);
					return sherpaResultToRecognition(
						recognizer.getResult(stream),
						wave.samples.length / wave.sampleRate,
					);
				},
			};
		},
	};
}
