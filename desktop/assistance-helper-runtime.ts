/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-side speech adapter that grants exact files to the assistance helper. */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

import {
	ASSISTANCE_JOB_PROTOCOL_VERSION,
} from './assistance-job-protocol.ts';
import type { AssistanceJobProgress, AssistanceJobRun } from './assistance-job-host.ts';
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

export interface AssistanceSpeechHostPort {
	start(
		request: unknown,
		onProgress?: (progress: AssistanceJobProgress) => void,
	): AssistanceJobRun;
	dispose(): void;
}

export interface AssistanceHelperRuntimeOptions {
	readonly host: AssistanceSpeechHostPort;
	readonly mintJobId?: () => string;
}

export function createAssistanceHelperRuntimeAdapter(
	options: AssistanceHelperRuntimeOptions,
): SpeechRuntimeAdapter & Readonly<{ dispose(): void }> {
	const mintJobId = options.mintJobId ?? (() => randomBytes(20).toString('hex'));

	async function run(grant: AssistanceSpeechJobGrant): Promise<unknown> {
		return options.host.start({
			protocolVersion: ASSISTANCE_JOB_PROTOCOL_VERSION,
			jobId: mintJobId(),
			kind: 'speech',
			grant,
		}).completed;
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
			const grant = await authorizeRecognition(request);
			return normalizeRecognition(await run(grant));
		},
		dispose: () => options.host.dispose(),
	});
}

async function authorizeRecognition(
	request: SpeechRecognitionRequest,
): Promise<AssistanceSpeechJobGrant> {
	if (!request || typeof request.audioPath !== 'string' || !request.model) {
		throw new TypeError('Recognition needs one audio file and one speech model.');
	}
	const [audio, encoder, decoder, joiner, tokens] = await Promise.all([
		fileGrant(request.audioPath, 'audio'),
		fileGrant(request.model.encoder, 'encoder'),
		fileGrant(request.model.decoder, 'decoder'),
		fileGrant(request.model.joiner, 'joiner'),
		fileGrant(request.model.tokens, 'tokens'),
	]);
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
): Promise<AssistanceSpeechFileGrant> {
	if (typeof path !== 'string' || path === '') throw new TypeError(`Recognition needs the ${role} path.`);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink()) {
		throw new TypeError(`The assistance ${role} grant must name one regular file.`);
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
	const after = await lstat(path);
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
