/* SPDX-License-Identifier: AGPL-3.0-only */

/** The only process/thread context permitted to load sherpa-onnx native code. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';

import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { verifyAssistanceNativeRuntimePayload } from './assistance-native-runtime-payload.mjs';
import { createSherpaDiarizerFactory } from './project-library-runtime/desktop/assistance-sherpa-diarizer.js';
import { createSherpaRecognizerFactory } from './project-library-runtime/desktop/assistance-sherpa-recognizer.js';
import { createSherpaVadFactory } from './project-library-runtime/desktop/assistance-sherpa-vad.js';
import { createSpeechRuntimeAdapter } from './project-library-runtime/desktop/assistance-speech-runtime.js';
import { validateAssistanceSpeechJobGrant } from './project-library-runtime/desktop/assistance-speech-job-contract.js';

const runtime = createSpeechRuntimeAdapter({
	createFactory: createSherpaRecognizerFactory,
	load: loadVerifiedRuntime,
});

void run().then(
	(result) => parentPort?.postMessage({ type: 'result', result }),
	(error) => parentPort?.postMessage({
		type: 'error',
		error: {
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		},
	}),
);

async function run() {
	const grant = validateAssistanceSpeechJobGrant(workerData);
	if (grant.operation === 'status') return runtime.status();
	const modelFiles = grant.operation === 'recognize'
		? Object.values(grant.model)
		: grant.operation === 'diarize-speakers' ? Object.values(grant.models) : [grant.model];
	for (const file of [grant.audio, ...modelFiles]) await verifyGrantedFile(file);
	parentPort?.postMessage({ type: 'progress', value: 0 });
	if (grant.operation === 'detect-voice-activity') {
		const detector = createSherpaVadFactory(await loadVerifiedRuntime());
		return detector.detect({
			modelId: grant.modelId,
			audioPath: grant.audio.path,
			model: { model: grant.model.path },
			onProgress: ({ completed, total }) => parentPort?.postMessage({
				type: 'progress', value: total === 0 ? 1 : completed / total,
			}),
		});
	}
	if (grant.operation === 'diarize-speakers') {
		const diarizer = createSherpaDiarizerFactory(await loadVerifiedRuntime());
		return diarizer.diarize({
			audioPath: grant.audio.path,
			modelIds: grant.modelIds,
			models: {
				segmentation: grant.models.segmentation.path,
				embedding: grant.models.embedding.path,
			},
			onProgress: ({ completed, total }) => parentPort?.postMessage({
				type: 'progress', value: total === 0 ? 1 : completed / total,
			}),
		});
	}
	return runtime.recognize({
		modelId: grant.modelId,
		audioPath: grant.audio.path,
		model: {
			encoder: grant.model.encoder.path,
			decoder: grant.model.decoder.path,
			joiner: grant.model.joiner.path,
			tokens: grant.model.tokens.path,
		},
		language: grant.language,
		threads: grant.threads,
	});
}

async function loadVerifiedRuntime() {
	const targetId = process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_TARGET;
	const outputRoot = process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_ROOT;
	const verified = await verifyAssistanceNativeRuntimePayload({
		manifest: assistanceNativeRuntimeManifest,
		targetId,
		outputRoot,
	});
	if (verified.status !== 'built' || verified.moduleSpecifier === null) {
		const error = new Error(verified.blockedBy ?? 'The optional speech runtime is unsupported.');
		error.code = 'MODULE_NOT_FOUND';
		throw error;
	}
	return import(verified.moduleSpecifier);
}

async function verifyGrantedFile(grant) {
	const before = await lstat(grant.path);
	if (!before.isFile() || before.isSymbolicLink()
		|| before.dev !== grant.identity.dev || before.ino !== grant.identity.ino || before.size !== grant.bytes) {
		throw new Error(`The granted assistance ${grant.role} file no longer matches its captured identity.`);
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(grant.path)) hash.update(chunk);
	const after = await lstat(grant.path);
	if (!after.isFile() || after.isSymbolicLink()
		|| before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| hash.digest('hex') !== grant.sha256) {
		throw new Error(`The granted assistance ${grant.role} file no longer matches its captured digest.`);
	}
}
