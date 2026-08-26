/* SPDX-License-Identifier: AGPL-3.0-only */

/** Terminateable whisper.cpp v1.9.3 CLI worker owned by its utility process. */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';

import type { AssistanceRuntimeFamilyAdmittedJob } from './assistance-runtime-family-job-contract.ts';
import type { AssistanceRuntimeFamilyInnerWorker } from './assistance-runtime-family-utility-worker.ts';
import {
	runAssistanceRuntimeFamilyWorkerJobV1,
	type AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';

interface AssistanceWhisperCppReadable {
	on(event: 'data', listener: (chunk: unknown) => void): this;
}

export interface AssistanceWhisperCppChild {
	readonly stdout: AssistanceWhisperCppReadable;
	readonly stderr: AssistanceWhisperCppReadable;
	once(event: 'error', listener: (error: unknown) => void): this;
	once(event: 'close', listener: (code: number | null, signal: string | null) => void): this;
	kill(signal?: NodeJS.Signals): boolean;
}

export type AssistanceWhisperCppSpawn = (
	executable: string,
	args: readonly string[],
	options: Readonly<{
		stdio: readonly ['ignore', 'pipe', 'pipe'];
		windowsHide: true;
		shell: false;
	}>,
) => AssistanceWhisperCppChild;

export interface AssistanceWhisperCppWorkerSpawnerOptions {
	readonly spawn?: AssistanceWhisperCppSpawn;
}

const MAXIMUM_STDERR_BYTES = 64 * 1024;
const MAXIMUM_TRANSCRIPT_SEGMENTS = 100_000;
const MAXIMUM_SEGMENT_TEXT_BYTES = 16_384;
const MAXIMUM_OFFSET_MS = 7 * 24 * 60 * 60 * 1_000;

export function createAssistanceWhisperCppWorkerSpawnerV1(
	options: AssistanceWhisperCppWorkerSpawnerOptions = {},
): (
	job: AssistanceRuntimeFamilyAdmittedJob,
	options: Readonly<{ readonly onProgress: (value: number) => void }>,
) => AssistanceRuntimeFamilyInnerWorker {
	if (options.spawn !== undefined && typeof options.spawn !== 'function') {
		throw new TypeError('The whisper.cpp process factory is invalid.');
	}
	const spawn = options.spawn ?? (nodeSpawn as unknown as AssistanceWhisperCppSpawn);
	return (job, runOptions) => {
		if (job?.familyId !== 'whisper-cpp' || job?.task !== 'speech-recognition'
			|| !runOptions || typeof runOptions.onProgress !== 'function') {
			throw new TypeError('The whisper.cpp worker received a foreign runtime-family job.');
		}
		const controller = new AbortController();
		const completion = runAssistanceRuntimeFamilyWorkerJobV1({
			job,
			signal: controller.signal,
			onProgress: runOptions.onProgress,
			execute: (context) => executeWhisperCpp(context, spawn),
		});
		let termination: Promise<void> | null = null;
		return Object.freeze({
			completion,
			terminate(): Promise<void> {
				if (termination) return termination;
				controller.abort(new DOMException('The whisper.cpp worker was terminated.', 'AbortError'));
				termination = completion.then(() => undefined, () => undefined);
				return termination;
			},
		});
	};
}

async function executeWhisperCpp(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	spawn: AssistanceWhisperCppSpawn,
): Promise<unknown> {
	context.signal?.throwIfAborted();
	const grant = context.grant;
	if (grant.familyId !== 'whisper-cpp' || grant.task !== 'speech-recognition'
		|| context.job.descriptor.familyId !== 'whisper-cpp'
		|| context.job.descriptor.runtimeVersion !== 'v1.9.3') {
		throw new TypeError('The whisper.cpp adapter received a foreign authenticated job.');
	}
	const settings = context.settings;
	if (settings.operation !== 'speech-recognition'
		|| JSON.stringify(settings.inputRoles) !== '["audio"]'
		|| JSON.stringify(settings.outputRoles) !== '["transcript"]') {
		throw new TypeError('The whisper.cpp adapter settings do not bind speech recognition.');
	}
	if (grant.inputs.length !== 1 || grant.inputs[0]!.role !== 'audio'
		|| grant.inputs[0]!.mediaType !== 'audio/wav'
		|| grant.models.length !== 1
		|| !grant.models[0]!.modelId.startsWith('whisper-')
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'transcript') {
		throw new TypeError('The whisper.cpp adapter requires one exact WAV, GGML model, and transcript output.');
	}
	const input = grant.inputs[0]!;
	const model = grant.models[0]!;
	const output = grant.outputs[0]!;
	context.onProgress(0);
	const stdout = await runCli({
		spawn,
		executable: context.job.descriptor.entrypoint,
		args: Object.freeze([
			'--model', model.path, '--file', input.path,
			'--output-json', '--output-file', '-', '--no-prints', '--no-gpu',
			'--temperature', '0', '--temperature-inc', '0', '--no-fallback',
			'--language', 'auto', '--threads', '4',
		]),
		maximumStdoutBytes: output.maximumByteLength,
		signal: context.signal,
	});
	context.signal?.throwIfAborted();
	const body = normalizeWhisperJson(stdout);
	if (body.byteLength < 1 || body.byteLength > output.maximumByteLength) {
		throw new RangeError('The normalized whisper.cpp output exceeds its authenticated bound.');
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

async function runCli(options: Readonly<{
	spawn: AssistanceWhisperCppSpawn;
	executable: string;
	args: readonly string[];
	maximumStdoutBytes: number;
	signal?: AbortSignal;
}>): Promise<Uint8Array> {
	options.signal?.throwIfAborted();
	return await new Promise<Uint8Array>((resolve, reject) => {
		let child: AssistanceWhisperCppChild;
		try {
			child = inspectChild(options.spawn(options.executable, options.args, {
				stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
			}));
		} catch (error) {
			reject(new Error('The authenticated whisper.cpp CLI could not be started.', { cause: error }));
			return;
		}
		const stdout: Uint8Array[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;
		let aborted = false;
		const abort = (): void => {
			if (settled || aborted) return;
			aborted = true;
			try { child.kill('SIGTERM'); }
			catch (error) { fail(new Error('The whisper.cpp CLI could not be terminated.', { cause: error })); }
		};
		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			options.signal?.removeEventListener('abort', abort);
			try { if (!aborted) child.kill('SIGTERM'); } catch { /* Preserve the primary failure. */ }
			reject(error);
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		child.stdout.on('data', (value) => {
			if (settled) return;
			let bytes: Uint8Array;
			try { bytes = bytesFrom(value); }
			catch (error) {
				fail(new TypeError('The whisper.cpp stdout stream is invalid.', { cause: error }));
				return;
			}
			stdoutBytes += bytes.byteLength;
			if (stdoutBytes > options.maximumStdoutBytes) {
				fail(new RangeError('The whisper.cpp stdout exceeded its authenticated output bound.'));
				return;
			}
			stdout.push(bytes);
		});
		child.stderr.on('data', (value) => {
			if (settled) return;
			try { stderrBytes += bytesFrom(value).byteLength; }
			catch (error) {
				fail(new TypeError('The whisper.cpp diagnostic stream is invalid.', { cause: error }));
				return;
			}
			if (stderrBytes > MAXIMUM_STDERR_BYTES) {
				fail(new RangeError('The whisper.cpp diagnostic output exceeded its bound.'));
			}
		});
		child.once('error', (error) => {
			fail(new Error('The authenticated whisper.cpp CLI failed to execute.', { cause: error }));
		});
		child.once('close', (code, processSignal) => {
			if (settled) return;
			settled = true;
			options.signal?.removeEventListener('abort', abort);
			if (aborted || options.signal?.aborted) {
				reject(options.signal?.reason instanceof Error
					? options.signal.reason
					: new DOMException('The whisper.cpp CLI was cancelled.', 'AbortError'));
				return;
			}
			if (code !== 0 || processSignal !== null) {
				reject(new Error('The authenticated whisper.cpp CLI did not complete successfully.'));
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

function inspectChild(value: AssistanceWhisperCppChild): AssistanceWhisperCppChild {
	if (!value || typeof value.once !== 'function' || typeof value.kill !== 'function'
		|| !value.stdout || typeof value.stdout.on !== 'function'
		|| !value.stderr || typeof value.stderr.on !== 'function') {
		throw new TypeError('The whisper.cpp process factory returned an invalid child.');
	}
	return value;
}

function normalizeWhisperJson(bytes: Uint8Array): Uint8Array {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The whisper.cpp CLI returned malformed UTF-8 JSON.', { cause: error });
	}
	const root = record(value, 'whisper.cpp result');
	const result = record(root.result, 'whisper.cpp language result');
	if (typeof result.language !== 'string' || result.language.length < 2 || result.language.length > 32
		|| !/^[A-Za-z][A-Za-z-]*$/u.test(result.language)) {
		throw new TypeError('The whisper.cpp language is invalid.');
	}
	if (!Array.isArray(root.transcription)
		|| root.transcription.length > MAXIMUM_TRANSCRIPT_SEGMENTS) {
		throw new RangeError('The whisper.cpp transcript segment inventory is invalid.');
	}
	let previousEnd = 0;
	const segments = root.transcription.map((candidate, index) => {
		const segment = record(candidate, `whisper.cpp segment ${String(index)}`);
		const offsets = record(segment.offsets, `whisper.cpp segment ${String(index)} offsets`);
		const start = milliseconds(offsets.from, `segment ${String(index)} start`);
		const end = milliseconds(offsets.to, `segment ${String(index)} end`);
		if (end <= start || start < previousEnd) {
			throw new RangeError('The whisper.cpp transcript timing is empty, overlapping, or out of order.');
		}
		previousEnd = end;
		if (typeof segment.text !== 'string' || segment.text.length < 1
			|| Buffer.byteLength(segment.text, 'utf8') > MAXIMUM_SEGMENT_TEXT_BYTES) {
			throw new RangeError('The whisper.cpp transcript segment text is invalid.');
		}
		return Object.freeze({ startSeconds: start / 1_000, endSeconds: end / 1_000,
			text: segment.text });
	});
	return Buffer.from(JSON.stringify({ language: result.language, segments }), 'utf8');
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}

function milliseconds(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAXIMUM_OFFSET_MS) {
		throw new RangeError(`The whisper.cpp ${label} is invalid.`);
	}
	return Number(value);
}

function bytesFrom(value: unknown): Uint8Array {
	if (typeof value === 'string') return Buffer.from(value);
	if (value instanceof Uint8Array) return Uint8Array.from(value);
	throw new TypeError('The whisper.cpp process emitted a non-byte stream chunk.');
}
