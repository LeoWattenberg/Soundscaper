/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Loads the optional speech runtime and turns its output into a recognition
 * result the editor can ingest.
 *
 * The runtime is an optional dependency, so it is imported lazily and its
 * absence is an ordinary reported capability rather than a crash: deterministic
 * editing stays complete without it. The adapter also refuses to describe a
 * model as usable when the runtime that would load it is missing, which keeps
 * "assistance unavailable" a single answer instead of a failure discovered
 * halfway through a job.
 */

export interface SpeechRuntimeStatus {
	readonly available: boolean;
	/** Why the runtime is unavailable, or null when it loaded. */
	readonly reason: string | null;
	readonly moduleId: string;
}

export interface RecognizedWordResult {
	readonly text: string;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly confidence?: number | null;
}

export interface RecognizedSegmentResult {
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly text?: string;
	readonly words?: readonly RecognizedWordResult[];
	readonly speaker?: string | null;
}

export interface SpeechRecognitionResult {
	readonly language: string | null;
	readonly segments: readonly RecognizedSegmentResult[];
}

/**
 * Absolute paths to the artifacts a recognizer needs, resolved from the store.
 *
 * The transducer is three separate graphs. An export that fuses the decoder
 * and joiner into one file belongs to a different loader and will not load
 * here, which is worth stating because such exports are common and the
 * failure appears as a config error rather than a packaging one.
 */
export interface SpeechModelPaths {
	readonly encoder: string;
	readonly decoder: string;
	readonly joiner: string;
	readonly tokens: string;
}

export interface SpeechRecognitionRequest {
	readonly audioPath: string;
	readonly model: SpeechModelPaths;
	readonly language?: string | null;
	readonly threads?: number;
}

export interface SpeechRuntimeAdapter {
	status(): Promise<SpeechRuntimeStatus>;
	recognize(request: SpeechRecognitionRequest): Promise<SpeechRecognitionResult>;
}

export const SPEECH_RUNTIME_MODULE_ID = 'sherpa-onnx-node';

/** A recognizer the adapter can drive. Kept minimal so tests can supply one. */
export interface SpeechRecognizerFactory {
	create(request: SpeechRecognitionRequest): Promise<{
		recognize(audioPath: string): Promise<SpeechRecognitionResult>;
		dispose?(): void;
	}>;
}

export interface SpeechRuntimeAdapterOptions {
	readonly moduleId?: string;
	/** Injected for tests; production resolves the optional dependency. */
	readonly load?: (moduleId: string) => Promise<unknown>;
	/** Builds a recognizer from a loaded runtime module. */
	readonly createFactory?: (runtime: unknown) => SpeechRecognizerFactory;
}

function describeLoadFailure(error: unknown): string {
	const code = typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: '';
	if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
		return 'The optional speech runtime is not installed.';
	}
	const message = error instanceof Error ? error.message : String(error);
	return `The optional speech runtime failed to load: ${message}`;
}

/**
 * Creates the adapter. Loading is attempted once and the outcome is cached,
 * because a missing optional dependency does not become present later in the
 * same process, and retrying it on every job would turn one clear answer into
 * repeated latency.
 */
export function createSpeechRuntimeAdapter(
	options: SpeechRuntimeAdapterOptions = {},
): SpeechRuntimeAdapter {
	const moduleId = options.moduleId ?? SPEECH_RUNTIME_MODULE_ID;
	const load = options.load ?? ((id: string) => import(/* @vite-ignore */ id));
	let resolved: Promise<{ runtime: unknown | null; reason: string | null }> | null = null;

	function resolveRuntime(): Promise<{ runtime: unknown | null; reason: string | null }> {
		resolved ??= load(moduleId)
			.then((runtime) => ({ runtime, reason: null }))
			.catch((error: unknown) => ({ runtime: null, reason: describeLoadFailure(error) }));
		return resolved;
	}

	return Object.freeze({
		async status(): Promise<SpeechRuntimeStatus> {
			const { runtime, reason } = await resolveRuntime();
			return Object.freeze({ available: runtime !== null, reason, moduleId });
		},

		async recognize(request: SpeechRecognitionRequest): Promise<SpeechRecognitionResult> {
			if (typeof request?.audioPath !== 'string' || request.audioPath === '') {
				throw new TypeError('Recognition needs an audio path.');
			}
			for (const key of ['encoder', 'decoder', 'joiner', 'tokens'] as const) {
				if (typeof request.model?.[key] !== 'string' || request.model[key] === '') {
					throw new TypeError(`Recognition needs the model ${key} path.`);
				}
			}
			const { runtime, reason } = await resolveRuntime();
			if (runtime === null) {
				throw new Error(reason ?? 'The optional speech runtime is unavailable.');
			}
			const createFactory = options.createFactory;
			if (typeof createFactory !== 'function') {
				throw new Error('No speech recognizer factory is wired for this runtime yet.');
			}
			const recognizer = await createFactory(runtime).create(request);
			try {
				return normalizeRecognition(await recognizer.recognize(request.audioPath));
			} finally {
				recognizer.dispose?.();
			}
		},
	});
}

/**
 * Checks the shape the ingest boundary depends on. The runtime is third-party
 * native code, so its output is validated rather than trusted.
 */
export function normalizeRecognition(value: unknown): SpeechRecognitionResult {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('A recognition result must be an object.');
	}
	const candidate = value as Partial<SpeechRecognitionResult>;
	if (!Array.isArray(candidate.segments)) {
		throw new TypeError('A recognition result needs an array of segments.');
	}
	for (const [index, segment] of candidate.segments.entries()) {
		if (typeof segment !== 'object' || segment === null) {
			throw new TypeError(`Recognized segment ${index} must be an object.`);
		}
		for (const key of ['startSeconds', 'endSeconds'] as const) {
			const time = (segment as Record<string, unknown>)[key];
			if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
				throw new RangeError(`Recognized segment ${index} ${key} must be a finite, non-negative number.`);
			}
		}
	}
	const language = candidate.language ?? null;
	if (language !== null && (typeof language !== 'string' || language.trim() === '')) {
		throw new TypeError('A recognized language must be a non-empty string or null.');
	}
	return Object.freeze({ language, segments: Object.freeze([...candidate.segments]) });
}
