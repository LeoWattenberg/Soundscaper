/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAssistanceHelperRuntimeAdapter } from '../desktop/assistance-helper-runtime.ts';
import { validateAssistanceJobRequest } from '../desktop/assistance-job-protocol.ts';
import { SPEECH_RUNTIME_MODULE_ID } from '../desktop/assistance-speech-runtime.ts';

const RESULT = Object.freeze({ language: null, segments: Object.freeze([]) });

test('main grants exact digest-bound audio and model artifacts to the speech helper', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = Object.fromEntries(await Promise.all(
		['audio', 'encoder', 'decoder', 'joiner', 'tokens'].map(async (role) => {
			const path = join(root, `${role}.bin`);
			await writeFile(path, `${role}-bytes`);
			return [role, path];
		}),
	)) as Record<string, string>;
	const requests: unknown[] = [];
	const runtime = createAssistanceHelperRuntimeAdapter({
		mintJobId: () => 'ab'.repeat(20),
		host: {
			start(request) {
				requests.push(request);
				return { jobId: 'ab'.repeat(20), completed: Promise.resolve(RESULT), cancel: () => Promise.resolve() };
			},
			dispose() {},
		},
	});

	assert.deepEqual(await runtime.recognize({
		modelId: 'parakeet-tdt-0.6b-v2',
		audioPath: paths.audio!,
		model: {
			encoder: paths.encoder!, decoder: paths.decoder!, joiner: paths.joiner!, tokens: paths.tokens!,
		},
		language: 'en', threads: 4,
	}), RESULT);
	const admitted = validateAssistanceJobRequest(requests[0]);
	assert.equal(admitted.grant.operation, 'recognize');
	if (admitted.grant.operation !== 'recognize') return;
	assert.equal(admitted.grant.modelId, 'parakeet-tdt-0.6b-v2');
	assert.deepEqual(
		[admitted.grant.audio, ...Object.values(admitted.grant.model)].map(({ role }) => role),
		['audio', 'encoder', 'decoder', 'joiner', 'tokens'],
	);
	for (const file of [admitted.grant.audio, ...Object.values(admitted.grant.model)]) {
		const bytes = await readFile(file.path);
		assert.equal(file.bytes, bytes.byteLength);
		assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
		assert.ok(file.identity.dev >= 0 && file.identity.ino >= 0);
	}
});

test('runtime status is answered by the helper rather than loading sherpa in main', async () => {
	let request: unknown = null;
	const runtime = createAssistanceHelperRuntimeAdapter({
		mintJobId: () => 'cd'.repeat(20),
		host: {
			start(value) {
				request = value;
				return {
					jobId: 'cd'.repeat(20),
					completed: Promise.resolve({
						available: false, reason: 'not installed', moduleId: SPEECH_RUNTIME_MODULE_ID,
					}),
					cancel: () => Promise.resolve(),
				};
			},
			dispose() {},
		},
	});
	assert.equal((await runtime.status()).available, false);
	assert.deepEqual(validateAssistanceJobRequest(request).grant, {
		operation: 'status', moduleId: SPEECH_RUNTIME_MODULE_ID,
	});
	const registration = await readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.doesNotMatch(registration, /assistance-sherpa-recognizer|createSpeechRuntimeAdapter/u);
	assert.match(registration, /assistance-helper-process\.js/u);
});

test('a missing or non-file grant is refused before any helper job starts', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let starts = 0;
	const runtime = createAssistanceHelperRuntimeAdapter({
		host: {
			start() { starts += 1; throw new Error('must not start'); },
			dispose() {},
		},
	});
	await assert.rejects(runtime.recognize({
		audioPath: join(root, 'missing.wav'),
		model: { encoder: root, decoder: root, joiner: root, tokens: root },
	}), /ENOENT|regular file/iu);
	assert.equal(starts, 0);
});
