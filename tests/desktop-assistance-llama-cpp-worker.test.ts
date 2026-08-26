/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';

import {
	createAssistanceLlamaCppWorkerSpawnerV1,
	type AssistanceLlamaCppChild,
	type AssistanceLlamaCppSpawn,
} from '../desktop/assistance-llama-cpp-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import {
	createAssistanceEditorialGenerationPlanV1,
} from '../src/common/editor/assistance/editorial-generation-v1.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);
const OUTPUT_MIME_TYPE = 'application/vnd.soundscaper.editorial-proposal+json';

const EVIDENCE = Object.freeze([
	Object.freeze({
		candidateId: 'candidate-a', evidenceMode: 'transcript' as const,
		transcriptExcerpt: 'A compact opening promise.', visualSummary: 'Host in a medium shot.',
	}),
	Object.freeze({
		candidateId: 'candidate-b', evidenceMode: 'speechless' as const,
		transcriptExcerpt: null, visualSummary: 'Audience applause and a reveal.',
	}),
]);

const VALID_PROPOSAL = Object.freeze({
	schemaVersion: 1,
	candidates: Object.freeze([
		Object.freeze({ candidateId: 'candidate-b', title: 'The reveal', hook: 'Wait for it',
			chapters: Object.freeze(['Setup', 'Reveal']), explanation: 'Strong visual payoff.' }),
		Object.freeze({ candidateId: 'candidate-a', title: null, hook: null,
			chapters: Object.freeze([]), explanation: 'A clear spoken promise.' }),
	]),
});

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

class FakeChild extends EventEmitter implements AssistanceLlamaCppChild {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly signals: NodeJS.Signals[] = [];
	killed = false;
	constructor(private readonly closeOnSigterm = true) { super(); }
	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		this.killed = true;
		this.signals.push(signal);
		if (this.closeOnSigterm || signal === 'SIGKILL') {
			queueMicrotask(() => this.emit('close', null, signal));
		}
		return true;
	}
}

async function fixture(
	context: TestContext,
	options: Readonly<{ maximumByteLength?: number; planBody?: string; modelId?: string }> = {},
) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-llama-worker-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'editorial-context.json');
	const model = join(root, 'Qwen3-4B-Q4_K_M.gguf');
	const output = join(root, 'editorial-proposal.json');
	const plan = createAssistanceEditorialGenerationPlanV1(EVIDENCE);
	const inputBytes = Buffer.from(options.planBody ?? JSON.stringify(plan));
	const modelBytes = Buffer.from('gguf-model');
	await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes),
		writeFile(output, new Uint8Array())]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'llama-cpp', task: 'editorial-generation',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'editorial-generation',
			inputRoles: ['editorial-context'], outputRoles: ['editorial-proposal'] }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'editorial-context', mediaType: 'application/vnd.soundscaper.editorial-context+json',
			byteLength: inputBytes.byteLength, sha256: digest(inputBytes) }, path: input }],
		models: [{ modelId: options.modelId ?? 'qwen3-4b-q4-k-m', version: '1.0.0',
			artifactRole: 'qwen3-4b-q4-k-m', path: model,
			byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'editorial-proposal', mediaType: OUTPUT_MIME_TYPE,
			maximumByteLength: options.maximumByteLength ?? 256 * 1_024 }, path: output }],
	});
	const job = Object.freeze({
		protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'llama-cpp' as const,
		task: 'editorial-generation' as const, maximumRssBytes: 12 * 1024 ** 3,
		maximumDurationMs: 60_000, grant,
		descriptor: {
			familyId: 'llama-cpp' as const, runtimeVersion: 'b10509', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/llama-cli',
			files: [{ path: '/runtime/llama-cli', relativePath: 'llama-cli',
				byteLength: 1, sha256: '4'.repeat(64), executable: true }],
		},
	});
	return { job, plan, paths: { input, model, output } };
}

test('the llama.cpp worker runs one offline CPU-only greedy grammar invocation', async (context) => {
	const { job, plan, paths } = await fixture(context);
	const seen: Array<{
		executable: string;
		args: readonly string[];
		shell: boolean | undefined;
		prompt: string;
		grammar: string;
		env: Readonly<Record<string, string | undefined>> | undefined;
	}> = [];
	const spawn: AssistanceLlamaCppSpawn = (executable, args, options) => {
		const child = new FakeChild();
		const promptPath = args[args.indexOf('--file') + 1] as string;
		const grammarPath = args[args.indexOf('--grammar-file') + 1] as string;
		seen.push({ executable, args: [...args], shell: options.shell,
			prompt: readFileSync(promptPath, 'utf8'), grammar: readFileSync(grammarPath, 'utf8'),
			env: options.env });
		queueMicrotask(() => {
			child.stdout.end(`${JSON.stringify(VALID_PROPOSAL)}\n`);
			child.emit('close', 0, null);
		});
		return child;
	};
	const progress: number[] = [];
	const worker = createAssistanceLlamaCppWorkerSpawnerV1({ spawn })(job, {
		onProgress: (value) => progress.push(value),
	});
	const result = await worker.completion as { outputs: readonly { sha256: string }[] };
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.executable, '/runtime/llama-cli');
	assert.equal(seen[0]?.shell, false);
	assert.equal(seen[0]?.prompt, plan.prompt);
	assert.equal(seen[0]?.grammar, plan.runtime.grammar);
	const promptPath = seen[0]!.args[seen[0]!.args.indexOf('--file') + 1] as string;
	const grammarPath = seen[0]!.args[seen[0]!.args.indexOf('--grammar-file') + 1] as string;
	assert.deepEqual(seen[0]?.args, [
		'--model', paths.model, '--file', promptPath, '--grammar-file', grammarPath,
		'--offline', '--device', 'none', '--gpu-layers', '0', '--no-kv-offload',
		'--no-op-offload', '--spec-type', 'none',
		'--no-mmproj', '--threads', '4', '--predict', '32768', '--temp', '0',
		'--top-k', '1', '--top-p', '1', '--seed', '0', '--reasoning', 'off',
		'--reasoning-budget', '0', '--single-turn', '--no-context-shift',
		'--no-display-prompt', '--no-show-timings', '--no-perf', '--no-warmup',
		'--no-escape', '--color', 'off', '--simple-io', '--log-verbosity', '1',
	]);
	assert.equal(seen[0]?.env?.LLAMA_ARG_HF_REPO, undefined);
	assert.equal(seen[0]?.env?.HF_TOKEN, undefined);
	const body = await readFile(paths.output);
	assert.deepEqual(JSON.parse(body.toString()), VALID_PROPOSAL);
	assert.equal(result.outputs[0]?.sha256, digest(body));
	assert.deepEqual(progress, [0, 1]);
	await assert.rejects(readFile(promptPath), /ENOENT/iu);
	await assert.rejects(readFile(grammarPath), /ENOENT/iu);
});

test('unsafe editorial text is refused before the reservation is populated', async (context) => {
	const { job, paths } = await fixture(context);
	const unsafe = {
		...VALID_PROPOSAL,
		candidates: VALID_PROPOSAL.candidates.map((candidate, index) => ({
			...candidate,
			title: index === 0 ? '/tmp/run-this.sh' : candidate.title,
			chapters: [...candidate.chapters],
		})),
	};
	const spawn: AssistanceLlamaCppSpawn = () => {
		const child = new FakeChild();
		queueMicrotask(() => {
			child.stdout.end(JSON.stringify(unsafe));
			child.emit('close', 0, null);
		});
		return child;
	};
	const worker = createAssistanceLlamaCppWorkerSpawnerV1({ spawn })(job, {
		onProgress: () => undefined,
	});
	await assert.rejects(worker.completion, /path|URI|inert|editorial/iu);
	assert.equal((await readFile(paths.output)).byteLength, 0);
});

test('a foreign model or malformed closed plan never starts llama.cpp', async (context) => {
	const foreign = await fixture(context, { modelId: 'some-other-model' });
	const malformed = await fixture(context, { planBody: '{"operation":"editorial-generation"}' });
	let starts = 0;
	const spawn: AssistanceLlamaCppSpawn = () => { starts += 1; return new FakeChild(); };
	for (const job of [foreign.job, malformed.job]) {
		const worker = createAssistanceLlamaCppWorkerSpawnerV1({ spawn })(job, {
			onProgress: () => undefined,
		});
		await assert.rejects(worker.completion, /Qwen|plan|editorial/iu);
	}
	assert.equal(starts, 0);
	assert.equal((await readFile(foreign.paths.output)).byteLength, 0);
	assert.equal((await readFile(malformed.paths.output)).byteLength, 0);
});

test('termination kills and quiesces the exact llama.cpp child', async (context) => {
	const { job } = await fixture(context);
	const children: FakeChild[] = [];
	const spawn: AssistanceLlamaCppSpawn = () => {
		const child = new FakeChild(false); children.push(child); return child;
	};
	const worker = createAssistanceLlamaCppWorkerSpawnerV1({ spawn })(job, {
		onProgress: () => undefined,
	});
	for (let attempt = 0; children.length === 0 && attempt < 100; attempt += 1) {
		await new Promise((resolve) => { setTimeout(resolve, 1); });
	}
	const child = children[0];
	assert.ok(child);
	const started = performance.now();
	await worker.terminate();
	assert.equal(child.killed, true);
	assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
	assert.ok(performance.now() - started < 2_000);
	await assert.rejects(worker.completion, /abort|terminated|cancel/iu);
});
