/* SPDX-License-Identifier: AGPL-3.0-only */

/** Terminateable llama.cpp b10509 editorial CLI worker owned by its utility process. */

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
	AssistanceRuntimeFamilyAdmittedJob,
	AssistanceRuntimeFamilyInputGrantV1,
} from './assistance-runtime-family-job-contract.ts';
import type { AssistanceRuntimeFamilyInnerWorker } from './assistance-runtime-family-utility-worker.ts';
import {
	runAssistanceRuntimeFamilyWorkerJobV1,
	type AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	ASSISTANCE_EDITORIAL_GENERATION_MAXIMUM_OUTPUT_TOKENS,
	reviewAssistanceEditorialGenerationOutputV1,
	reviewAssistanceEditorialGenerationPlanV1,
	type AssistanceEditorialGenerationPlanV1,
} from '../src/common/editor/assistance/editorial-generation-v1.ts';

interface AssistanceLlamaCppReadable {
	on(event: 'data', listener: (chunk: unknown) => void): this;
}

export interface AssistanceLlamaCppChild {
	readonly stdout: AssistanceLlamaCppReadable;
	readonly stderr: AssistanceLlamaCppReadable;
	once(event: 'error', listener: (error: unknown) => void): this;
	once(event: 'close', listener: (code: number | null, signal: string | null) => void): this;
	kill(signal?: NodeJS.Signals): boolean;
}

export type AssistanceLlamaCppSpawn = (
	executable: string,
	args: readonly string[],
	options: Readonly<{
		stdio: readonly ['ignore', 'pipe', 'pipe'];
		windowsHide: true;
		shell: false;
		env: Readonly<Record<string, string | undefined>>;
	}>,
) => AssistanceLlamaCppChild;

export interface AssistanceLlamaCppWorkerSpawnerOptions {
	readonly spawn?: AssistanceLlamaCppSpawn;
}

const MODEL_ID = 'qwen3-4b-q4-k-m';
const MAXIMUM_PLAN_BYTES = 1024 * 1024;
const MAXIMUM_STDERR_BYTES = 64 * 1024;
const TERMINATION_ESCALATION_MILLISECONDS = 750;

export function createAssistanceLlamaCppWorkerSpawnerV1(
	options: AssistanceLlamaCppWorkerSpawnerOptions = {},
): (
	job: AssistanceRuntimeFamilyAdmittedJob,
	options: Readonly<{ readonly onProgress: (value: number) => void }>,
) => AssistanceRuntimeFamilyInnerWorker {
	if (options.spawn !== undefined && typeof options.spawn !== 'function') {
		throw new TypeError('The llama.cpp process factory is invalid.');
	}
	const spawn = options.spawn ?? (nodeSpawn as unknown as AssistanceLlamaCppSpawn);
	return (job, runOptions) => {
		if (job?.familyId !== 'llama-cpp' || job?.task !== 'editorial-generation'
			|| !runOptions || typeof runOptions.onProgress !== 'function') {
			throw new TypeError('The llama.cpp worker received a foreign runtime-family job.');
		}
		const controller = new AbortController();
		const completion = runAssistanceRuntimeFamilyWorkerJobV1({
			job,
			signal: controller.signal,
			onProgress: runOptions.onProgress,
			execute: (context) => executeLlamaCppEditorial(context, spawn),
		});
		let termination: Promise<void> | null = null;
		return Object.freeze({
			completion,
			terminate(): Promise<void> {
				if (termination) return termination;
				controller.abort(new DOMException('The llama.cpp worker was terminated.', 'AbortError'));
				termination = completion.then(() => undefined, () => undefined);
				return termination;
			},
		});
	};
}

async function executeLlamaCppEditorial(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	spawn: AssistanceLlamaCppSpawn,
): Promise<unknown> {
	context.signal?.throwIfAborted();
	const grant = context.grant;
	if (grant.familyId !== 'llama-cpp' || grant.task !== 'editorial-generation'
		|| context.job.descriptor.familyId !== 'llama-cpp'
		|| context.job.descriptor.runtimeVersion !== 'b10509'
		|| context.job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError('The llama.cpp adapter received a foreign authenticated job.');
	}
	const settings = context.settings;
	if (settings.schemaVersion !== 1 || settings.operation !== 'editorial-generation'
		|| JSON.stringify(settings.inputRoles) !== '["editorial-context"]'
		|| JSON.stringify(settings.outputRoles) !== '["editorial-proposal"]') {
		throw new TypeError('The llama.cpp adapter settings do not bind editorial generation.');
	}
	if (grant.inputs.length !== 1 || grant.inputs[0]!.role !== 'editorial-context'
		|| grant.models.length !== 1 || grant.models[0]!.modelId !== MODEL_ID
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'editorial-proposal') {
		throw new TypeError('The llama.cpp adapter requires one exact context, Qwen model, and proposal output.');
	}
	const input = grant.inputs[0]!;
	const model = grant.models[0]!;
	const output = grant.outputs[0]!;
	if (input.byteLength > MAXIMUM_PLAN_BYTES) {
		throw new RangeError('The editorial generation plan exceeds its adapter byte bound.');
	}
	const plan = await readEditorialPlan(input);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const stdout = await withInvocationFiles(plan, context.signal, async (files) => await runCli({
		spawn,
		executable: context.job.descriptor.entrypoint,
		args: Object.freeze([
			'--model', model.path, '--file', files.prompt, '--grammar-file', files.grammar,
			'--offline', '--device', 'none', '--gpu-layers', '0', '--no-kv-offload',
			'--no-op-offload', '--spec-type', 'none',
			'--no-mmproj', '--threads', '4', '--predict',
			String(ASSISTANCE_EDITORIAL_GENERATION_MAXIMUM_OUTPUT_TOKENS),
			'--temp', '0', '--top-k', '1', '--top-p', '1', '--seed', '0',
			'--reasoning', 'off', '--reasoning-budget', '0', '--single-turn',
			'--no-context-shift', '--no-display-prompt', '--no-show-timings', '--no-perf',
			'--no-warmup', '--no-escape', '--color', 'off', '--simple-io',
			'--log-verbosity', '1',
		]),
		maximumStdoutBytes: Math.min(output.maximumByteLength, plan.runtime.maximumOutputBytes),
		signal: context.signal,
		env: restrictedEnvironment(files.root),
	}));
	context.signal?.throwIfAborted();
	const reviewed = reviewAssistanceEditorialGenerationOutputV1(plan, stdout);
	const body = Buffer.from(JSON.stringify(reviewed), 'utf8');
	if (body.byteLength < 1 || body.byteLength > output.maximumByteLength) {
		throw new RangeError('The normalized llama.cpp output exceeds its authenticated bound.');
	}
	await writeFile(output.path, body);
	context.signal?.throwIfAborted();
	context.onProgress(1);
	return Object.freeze({
		resultVersion: 1,
		jobId: grant.jobId,
		familyId: grant.familyId,
		task: grant.task,
		outputs: Object.freeze([Object.freeze({
			claimId: output.claimId,
			role: output.role,
			mediaType: output.mediaType,
			byteLength: body.byteLength,
			sha256: createHash('sha256').update(body).digest('hex'),
		})]),
	});
}

async function readEditorialPlan(
	input: AssistanceRuntimeFamilyInputGrantV1,
): Promise<AssistanceEditorialGenerationPlanV1> {
	const bytes = await readFile(input.path);
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) {
		throw new RangeError('The editorial generation plan exceeds its adapter byte bound.');
	}
	if (bytes.byteLength !== input.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
		throw new Error('The editorial generation plan changed after grant authentication.');
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The editorial generation plan is not valid UTF-8 JSON.', { cause: error });
	}
	return reviewAssistanceEditorialGenerationPlanV1(value);
}

async function withInvocationFiles<T>(
	plan: AssistanceEditorialGenerationPlanV1,
	signal: AbortSignal | undefined,
	run: (paths: Readonly<{ root: string; prompt: string; grammar: string }>) => Promise<T>,
): Promise<T> {
	signal?.throwIfAborted();
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-llama-cpp-'));
	const prompt = join(root, 'prompt.txt');
	const grammar = join(root, 'editorial.gbnf');
	try {
		await Promise.all([
			writeFile(prompt, plan.prompt, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
			writeFile(grammar, plan.runtime.grammar, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
		]);
		signal?.throwIfAborted();
		return await run(Object.freeze({ root, prompt, grammar }));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function runCli(options: Readonly<{
	spawn: AssistanceLlamaCppSpawn;
	executable: string;
	args: readonly string[];
	maximumStdoutBytes: number;
	signal?: AbortSignal;
	env: Readonly<Record<string, string | undefined>>;
}>): Promise<Uint8Array> {
	options.signal?.throwIfAborted();
	return await new Promise<Uint8Array>((resolve, reject) => {
		let child: AssistanceLlamaCppChild;
		try {
			child = inspectChild(options.spawn(options.executable, options.args, {
				stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, env: options.env,
			}));
		} catch (error) {
			reject(new Error('The authenticated llama.cpp CLI could not be started.', { cause: error }));
			return;
		}
		const stdout: Uint8Array[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;
		let pendingFailure: Error | null = null;
		let escalation: ReturnType<typeof setTimeout> | null = null;
		const stop = (error: Error): void => {
			if (settled || pendingFailure) return;
			pendingFailure = error;
			try { child.kill('SIGTERM'); }
			catch (cause) {
				pendingFailure = new Error('The llama.cpp CLI could not be terminated.', { cause });
			}
			escalation = setTimeout(() => {
				if (settled) return;
				try { child.kill('SIGKILL'); } catch { /* The helper host enforces the outer deadline. */ }
			}, TERMINATION_ESCALATION_MILLISECONDS);
			escalation.unref();
		};
		const abort = (): void => stop(options.signal?.reason instanceof Error
			? options.signal.reason
			: new DOMException('The llama.cpp CLI was cancelled.', 'AbortError'));
		options.signal?.addEventListener('abort', abort, { once: true });
		child.stdout.on('data', (value) => {
			if (settled || pendingFailure) return;
			let bytes: Uint8Array;
			try { bytes = bytesFrom(value); }
			catch (error) {
				stop(new TypeError('The llama.cpp stdout stream is invalid.', { cause: error }));
				return;
			}
			stdoutBytes += bytes.byteLength;
			if (stdoutBytes > options.maximumStdoutBytes) {
				stop(new RangeError('The llama.cpp stdout exceeded its authenticated output bound.'));
				return;
			}
			stdout.push(bytes);
		});
		child.stderr.on('data', (value) => {
			if (settled || pendingFailure) return;
			try { stderrBytes += bytesFrom(value).byteLength; }
			catch (error) {
				stop(new TypeError('The llama.cpp diagnostic stream is invalid.', { cause: error }));
				return;
			}
			if (stderrBytes > MAXIMUM_STDERR_BYTES) {
				stop(new RangeError('The llama.cpp diagnostic output exceeded its bound.'));
			}
		});
		child.once('error', (error) => {
			stop(new Error('The authenticated llama.cpp CLI failed to execute.', { cause: error }));
		});
		child.once('close', (code, processSignal) => {
			if (settled) return;
			settled = true;
			if (escalation) clearTimeout(escalation);
			options.signal?.removeEventListener('abort', abort);
			if (pendingFailure) { reject(pendingFailure); return; }
			if (code !== 0 || processSignal !== null) {
				reject(new Error('The authenticated llama.cpp CLI did not complete successfully.'));
				return;
			}
			const result = new Uint8Array(stdoutBytes);
			let offset = 0;
			for (const chunk of stdout) { result.set(chunk, offset); offset += chunk.byteLength; }
			resolve(result);
		});
		if (options.signal?.aborted) abort();
	});
}

function inspectChild(value: AssistanceLlamaCppChild): AssistanceLlamaCppChild {
	if (!value || typeof value.once !== 'function' || typeof value.kill !== 'function'
		|| !value.stdout || typeof value.stdout.on !== 'function'
		|| !value.stderr || typeof value.stderr.on !== 'function') {
		throw new TypeError('The llama.cpp process factory returned an invalid child.');
	}
	return value;
}

function restrictedEnvironment(root: string): Readonly<Record<string, string | undefined>> {
	const result: Record<string, string> = {
		LANG: process.env.LANG ?? 'C.UTF-8',
		LC_ALL: 'C.UTF-8',
		XDG_CONFIG_HOME: root,
		APPDATA: root,
		PROGRAMDATA: root,
	};
	for (const name of ['SystemRoot', 'WINDIR'] as const) {
		const value = process.env[name];
		if (value) result[name] = value;
	}
	return Object.freeze(result);
}

function bytesFrom(value: unknown): Uint8Array {
	if (typeof value === 'string') return Buffer.from(value);
	if (value instanceof Uint8Array) return Uint8Array.from(value);
	throw new TypeError('The llama.cpp process emitted a non-byte stream chunk.');
}
