/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-side speech adapter that grants exact files to the assistance helper. */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

import {
	ASSISTANCE_JOB_PROTOCOL_VERSION,
} from './assistance-job-protocol.ts';
import type {
	AssistanceJobProgress,
	AssistanceJobRun,
	AssistanceJobStartOptions,
} from './assistance-job-host.ts';
import {
	type SpeakerDiarizationRequest,
	type SpeakerDiarizationResult,
	type SpeakerDiarizationRuntimeAdapter,
} from './assistance-diarization-runtime.ts';
import {
	SPEECH_RUNTIME_MODULE_ID,
	normalizeRecognition,
	type SpeechRecognitionRequest,
	type SpeechRecognitionResult,
	type SpeechRuntimeAdapter,
	type SpeechRuntimeStatus,
} from './assistance-speech-runtime.ts';
import {
	validateAssistanceSpeechJobResult,
	type AssistanceSpeechFileGrant,
	type AssistanceSpeechJobGrant,
} from './assistance-speech-job-contract.ts';
import {
	type VoiceActivityRequest,
	type VoiceActivityResult,
	type VoiceActivityRuntimeAdapter,
} from './assistance-vad-runtime.ts';

export interface AssistanceSpeechHostPort {
	start(
		request: unknown,
		options?: AssistanceJobStartOptions | ((progress: AssistanceJobProgress) => void),
	): AssistanceJobRun;
	dispose(): void;
}

export interface AssistanceHelperRuntimeOptions {
	readonly host: AssistanceSpeechHostPort;
	readonly mintJobId?: () => string;
	/** Narrow stream seam used to keep grant capture independently abortable. */
	readonly openFileReadStream?: (path: string) => AssistanceFileReadStream;
}

export interface AssistanceFileReadStream extends AsyncIterable<Uint8Array> {
	destroy(error?: Error): unknown;
}

export function createAssistanceHelperRuntimeAdapter(
	options: AssistanceHelperRuntimeOptions,
): SpeechRuntimeAdapter & VoiceActivityRuntimeAdapter & SpeakerDiarizationRuntimeAdapter
	& Readonly<{ dispose(): void }> {
	const mintJobId = options.mintJobId ?? (() => randomBytes(20).toString('hex'));
	const openFileReadStream = options.openFileReadStream
		?? ((path: string): AssistanceFileReadStream => createReadStream(path));

	async function run(
		grant: AssistanceSpeechJobGrant,
		runOptions?: AssistanceJobStartOptions,
	): Promise<unknown> {
		return options.host.start({
			protocolVersion: ASSISTANCE_JOB_PROTOCOL_VERSION,
			jobId: mintJobId(),
			kind: 'speech',
			grant,
		}, runOptions).completed;
	}

	return Object.freeze({
		async status(): Promise<SpeechRuntimeStatus> {
			const grant = Object.freeze({
				operation: 'status' as const,
				moduleId: SPEECH_RUNTIME_MODULE_ID,
			});
			return validateAssistanceSpeechJobResult(await run(grant), grant) as SpeechRuntimeStatus;
		},
		async recognize(request: SpeechRecognitionRequest): Promise<SpeechRecognitionResult> {
			const grant = await authorizeRecognition(request, openFileReadStream);
			return normalizeRecognition(await run(grant, {
				signal: request.signal,
				onProgress: request.onProgress,
			}));
		},
		async detect(request: VoiceActivityRequest): Promise<VoiceActivityResult> {
			const grant = await authorizeVoiceActivity(request, openFileReadStream);
			return validateAssistanceSpeechJobResult(await run(grant, {
				signal: request.signal,
				onProgress: request.onProgress,
			}), grant) as VoiceActivityResult;
		},
		async diarize(request: SpeakerDiarizationRequest): Promise<SpeakerDiarizationResult> {
			const grant = await authorizeDiarization(request, openFileReadStream);
			return validateAssistanceSpeechJobResult(await run(grant, {
				signal: request.signal,
				onProgress: request.onProgress,
			}), grant) as SpeakerDiarizationResult;
		},
		dispose: () => options.host.dispose(),
	});
}

async function authorizeDiarization(
	request: SpeakerDiarizationRequest,
	openFileReadStream: (path: string) => AssistanceFileReadStream,
): Promise<AssistanceSpeechJobGrant> {
	if (!request || typeof request.audioPath !== 'string' || !request.models) {
		throw new TypeError('Speaker diarization needs audio, segmentation, and embedding files.');
	}
	request.signal?.throwIfAborted();
	const [audio, segmentation, embedding] = await Promise.all([
		fileGrant(request.audioPath, 'audio', request.signal, openFileReadStream),
		fileGrant(request.models.segmentation, 'segmentation-model', request.signal, openFileReadStream),
		fileGrant(request.models.embedding, 'embedding-model', request.signal, openFileReadStream),
	]);
	request.signal?.throwIfAborted();
	return Object.freeze({
		operation: 'diarize-speakers', moduleId: SPEECH_RUNTIME_MODULE_ID,
		modelIds: Object.freeze({
			segmentation: request.modelIds?.segmentation
				?? `local.segmentation.${segmentation.sha256.slice(0, 16)}`,
			embedding: request.modelIds?.embedding ?? `local.embedding.${embedding.sha256.slice(0, 16)}`,
		}),
		audio,
		models: Object.freeze({ segmentation, embedding }),
	});
}

async function authorizeVoiceActivity(
	request: VoiceActivityRequest,
	openFileReadStream: (path: string) => AssistanceFileReadStream,
): Promise<AssistanceSpeechJobGrant> {
	if (!request || typeof request.audioPath !== 'string' || !request.model) {
		throw new TypeError('Voice activity needs one audio file and one Silero model.');
	}
	request.signal?.throwIfAborted();
	const [audio, model] = await Promise.all([
		fileGrant(request.audioPath, 'audio', request.signal, openFileReadStream),
		fileGrant(request.model.model, 'vad-model', request.signal, openFileReadStream),
	]);
	request.signal?.throwIfAborted();
	return Object.freeze({
		operation: 'detect-voice-activity', moduleId: SPEECH_RUNTIME_MODULE_ID,
		modelId: request.modelId ?? `local.${model.sha256.slice(0, 16)}`,
		audio, model,
	});
}

async function authorizeRecognition(
	request: SpeechRecognitionRequest,
	openFileReadStream: (path: string) => AssistanceFileReadStream,
): Promise<AssistanceSpeechJobGrant> {
	if (!request || typeof request.audioPath !== 'string' || !request.model) {
		throw new TypeError('Recognition needs one audio file and one speech model.');
	}
	request.signal?.throwIfAborted();
	const [audio, encoder, decoder, joiner, tokens] = await Promise.all([
		fileGrant(request.audioPath, 'audio', request.signal, openFileReadStream),
		fileGrant(request.model.encoder, 'encoder', request.signal, openFileReadStream),
		fileGrant(request.model.decoder, 'decoder', request.signal, openFileReadStream),
		fileGrant(request.model.joiner, 'joiner', request.signal, openFileReadStream),
		fileGrant(request.model.tokens, 'tokens', request.signal, openFileReadStream),
	]);
	request.signal?.throwIfAborted();
	const modelId = request.modelId ?? `local.${encoder.sha256.slice(0, 16)}`;
	return Object.freeze({
		operation: 'recognize',
		moduleId: SPEECH_RUNTIME_MODULE_ID,
		modelId,
		audio,
		model: Object.freeze({ encoder, decoder, joiner, tokens }),
		language: request.language ?? null,
		threads: request.threads ?? 2,
	});
}

async function fileGrant(
	path: string,
	role: AssistanceSpeechFileGrant['role'],
	signal: AbortSignal | undefined,
	openFileReadStream: (path: string) => AssistanceFileReadStream,
): Promise<AssistanceSpeechFileGrant> {
	if (typeof path !== 'string' || path === '') throw new TypeError(`Recognition needs the ${role} path.`);
	signal?.throwIfAborted();
	const before = await lstat(path);
	signal?.throwIfAborted();
	if (!before.isFile() || before.isSymbolicLink()) {
		throw new TypeError(`The assistance ${role} grant must name one regular file.`);
	}
	const hash = createHash('sha256');
	const stream = openFileReadStream(path);
	const abortStream = (): void => { stream.destroy(streamAbortError(signal)); };
	signal?.addEventListener('abort', abortStream, { once: true });
	try {
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			hash.update(chunk);
		}
		signal?.throwIfAborted();
	} catch (error) {
		signal?.throwIfAborted();
		throw error;
	} finally {
		signal?.removeEventListener('abort', abortStream);
	}
	const after = await lstat(path);
	signal?.throwIfAborted();
	if (!after.isFile() || after.isSymbolicLink()
		|| before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
		throw new Error(`The assistance ${role} file changed while its grant was captured.`);
	}
	return Object.freeze({
		role,
		path,
		bytes: after.size,
		sha256: hash.digest('hex'),
		identity: Object.freeze({ dev: after.dev, ino: after.ino }),
	});
}

function streamAbortError(signal: AbortSignal | undefined): Error {
	if (signal?.reason instanceof Error) return signal.reason;
	return new DOMException('Assistance file grant capture was cancelled.', 'AbortError');
}
