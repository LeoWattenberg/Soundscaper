/* SPDX-License-Identifier: AGPL-3.0-only */

/** Terminateable whisper.cpp v1.9.3 CLI worker owned by its utility process. */

import { createHash } from 'node:crypto';
import { mkdtemp, open, rmdir, unlink, writeFile } from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import { dirname, join } from 'node:path';

import type { AssistanceRuntimeFamilyAdmittedJob } from './assistance-runtime-family-job-contract.ts';
import type { AssistanceRuntimeFamilyInnerWorker } from './assistance-runtime-family-utility-worker.ts';
import {
	runAssistanceRuntimeFamilyWorkerJobV1,
	type AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	inspectAssistanceSpeechWaveV1,
	readAssistanceVoiceActivityInputV1,
} from './assistance-voice-activity-input.ts';
import type { VoiceActivitySegment } from './assistance-vad-runtime.ts';

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
	readonly terminationGraceMs?: number;
}

const DEFAULT_TERMINATION_GRACE_MS = 500;
const MAXIMUM_TERMINATION_GRACE_MS = 1_000;
const MAXIMUM_STDERR_BYTES = 64 * 1024;
const MAXIMUM_TRANSCRIPT_SEGMENTS = 100_000;
const MAXIMUM_SEGMENT_TEXT_BYTES = 16_384;
const MAXIMUM_OFFSET_MS = 7 * 24 * 60 * 60 * 1_000;
const SEGMENT_COPY_BYTES = 1024 * 1024;

interface NormalizedWhisperResult {
	readonly language: string;
	readonly segments: readonly Readonly<{
		readonly startSeconds: number;
		readonly endSeconds: number;
		readonly text: string;
	}>[];
}

type WhisperLanguage = 'auto' | 'en';

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
	const terminationGraceMs = boundedTerminationGrace(options.terminationGraceMs);
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
			execute: (context) => executeWhisperCpp(context, spawn, terminationGraceMs),
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
	terminationGraceMs: number,
): Promise<unknown> {
	context.signal?.throwIfAborted();
	const grant = context.grant;
	if (grant.familyId !== 'whisper-cpp' || grant.task !== 'speech-recognition'
		|| context.job.descriptor.familyId !== 'whisper-cpp'
		|| context.job.descriptor.runtimeVersion !== 'v1.9.3') {
		throw new TypeError('The whisper.cpp adapter received a foreign authenticated job.');
	}
	const settings = context.settings;
	const inputRoles = JSON.stringify(settings.inputRoles);
	if (settings.operation !== 'speech-recognition'
		|| (inputRoles !== '["audio"]' && inputRoles !== '["audio","voice-activity"]')
		|| JSON.stringify(settings.outputRoles) !== '["transcript"]') {
		throw new TypeError('The whisper.cpp adapter settings do not bind speech recognition.');
	}
	const language = whisperLanguage(settings.language);
	const input = grant.inputs.find(({ role }) => role === 'audio');
	const voiceActivity = grant.inputs.find(({ role }) => role === 'voice-activity');
	if (!input || input.mediaType !== 'audio/wav'
		|| grant.inputs.filter(({ role }) => role === 'audio').length !== 1
		|| grant.inputs.filter(({ role }) => role === 'voice-activity').length > 1
		|| grant.inputs.length !== (voiceActivity ? 2 : 1)
		|| (voiceActivity !== undefined && voiceActivity.mediaType !== 'application/json'
			&& voiceActivity.mediaType !== 'application/vnd.soundscaper.voice-activity+json')
		|| (voiceActivity !== undefined) !== (inputRoles === '["audio","voice-activity"]')
		|| grant.models.length !== 1
		|| !grant.models[0]!.modelId.startsWith('whisper-')
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'transcript') {
		throw new TypeError('The whisper.cpp adapter requires exact audio, VAD, model, and transcript grants.');
	}
	const model = grant.models[0]!;
	const output = grant.outputs[0]!;
	context.onProgress(0);
	let normalized: Readonly<{ language: string | null; segments: readonly unknown[] }>;
	if (voiceActivity === undefined) {
		const stdout = await runWhisperCli(
			context, spawn, model.path, input.path, language, output.maximumByteLength,
			terminationGraceMs,
		);
		normalized = normalizeWhisperJson(stdout, 0);
	} else {
		normalized = await recognizeVoiceActivityRanges(
			context, spawn, input.path, voiceActivity.path, model.path, language,
			output.maximumByteLength, terminationGraceMs,
		);
	}
	if (language !== 'auto' && normalized.language !== null && normalized.language !== language) {
		throw new TypeError('The whisper.cpp result language disagrees with the authenticated selection.');
	}
	context.signal?.throwIfAborted();
	const body = Buffer.from(JSON.stringify(normalized), 'utf8');
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

async function recognizeVoiceActivityRanges(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	spawn: AssistanceWhisperCppSpawn,
	audioPath: string,
	voiceActivityPath: string,
	modelPath: string,
	language: WhisperLanguage,
	maximumOutputBytes: number,
	terminationGraceMs: number,
): Promise<Readonly<{ language: string | null; segments: readonly unknown[] }>> {
	const geometry = await inspectAssistanceSpeechWaveV1(audioPath, context.signal);
	const activity = await readAssistanceVoiceActivityInputV1(
		voiceActivityPath, geometry.sampleCount, context.signal,
	);
	if (activity.segments.length === 0) {
		return Object.freeze({ language: null, segments: Object.freeze([]) });
	}
	const directory = await mkdtemp(join(dirname(context.grant.outputs[0]!.path), '.whisper-vad-'));
	const segmentPath = join(directory, 'segment.wav');
	const languages = new Set<string>();
	const segments: unknown[] = [];
	try {
		await writeFile(segmentPath, new Uint8Array());
		for (const [index, range] of activity.segments.entries()) {
			context.signal?.throwIfAborted();
			await writeSpeechSegmentWave(audioPath, segmentPath, range, context.signal);
			const stdout = await runWhisperCli(
				context, spawn, modelPath, segmentPath, language, maximumOutputBytes,
				terminationGraceMs,
			);
			const normalized = normalizeWhisperJson(
				stdout, range.startSample / geometry.sampleRate,
				range.sampleCount / geometry.sampleRate,
			);
			languages.add(normalized.language);
			segments.push(...normalized.segments);
			context.signal?.throwIfAborted();
			context.onProgress((index + 1) / (activity.segments.length + 1));
		}
		if (languages.size !== 1) {
			throw new Error('whisper.cpp VAD ranges returned conflicting languages.');
		}
		return Object.freeze({ language: [...languages][0]!, segments: Object.freeze(segments) });
	} finally {
		await unlink(segmentPath).catch(() => undefined);
		await rmdir(directory).catch(() => undefined);
	}
}

async function runWhisperCli(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	spawn: AssistanceWhisperCppSpawn,
	modelPath: string,
	audioPath: string,
	language: WhisperLanguage,
	maximumOutputBytes: number,
	terminationGraceMs: number,
): Promise<Uint8Array> {
	return runCli({
		spawn,
		executable: context.job.descriptor.entrypoint,
		args: Object.freeze([
			'--model', modelPath, '--file', audioPath,
			'--output-json', '--output-file', '-', '--no-prints', '--no-gpu',
			'--temperature', '0', '--temperature-inc', '0', '--no-fallback',
			'--language', language, '--threads', '4',
		]),
		maximumStdoutBytes: maximumOutputBytes,
		terminationGraceMs,
		signal: context.signal,
	});
}

function whisperLanguage(value: unknown): WhisperLanguage {
	if (value !== 'auto' && value !== 'en') {
		throw new TypeError('The authenticated whisper.cpp language is unsupported.');
	}
	return value;
}

async function writeSpeechSegmentWave(
	sourcePath: string,
	destinationPath: string,
	range: VoiceActivitySegment,
	signal?: AbortSignal,
): Promise<void> {
	const source = await open(sourcePath, 'r');
	const destination = await open(destinationPath, 'r+');
	try {
		signal?.throwIfAborted();
		const dataByteLength = range.sampleCount * Float32Array.BYTES_PER_ELEMENT;
		const header = canonicalFloatWaveHeader(range.sampleCount);
		await destination.truncate(0);
		await destination.write(header, 0, header.byteLength, 0);
		const buffer = new Uint8Array(Math.min(SEGMENT_COPY_BYTES, dataByteLength));
		let copied = 0;
		while (copied < dataByteLength) {
			signal?.throwIfAborted();
			const length = Math.min(buffer.byteLength, dataByteLength - copied);
			const sourceOffset = 44 + range.startSample * 4 + copied;
			const { bytesRead } = await source.read(buffer, 0, length, sourceOffset);
			if (bytesRead !== length) throw new Error('The authenticated speech WAV ended during VAD slicing.');
			assertFiniteFloatSamples(buffer.subarray(0, bytesRead));
			await destination.write(buffer, 0, bytesRead, header.byteLength + copied);
			copied += bytesRead;
		}
		await destination.sync();
		signal?.throwIfAborted();
	} finally {
		await Promise.all([source.close(), destination.close()]);
	}
}

function canonicalFloatWaveHeader(sampleCount: number): Uint8Array {
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	writeAscii(header, 0, 'RIFF');
	view.setUint32(4, 36 + sampleCount * 4, true);
	writeAscii(header, 8, 'WAVE');
	writeAscii(header, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 16_000, true);
	view.setUint32(28, 64_000, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 32, true);
	writeAscii(header, 36, 'data');
	view.setUint32(40, sampleCount * 4, true);
	return header;
}

function assertFiniteFloatSamples(bytes: Uint8Array): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset < bytes.byteLength; offset += 4) {
		if (!Number.isFinite(view.getFloat32(offset, true))) {
			throw new RangeError('The authenticated speech WAV contains a non-finite sample.');
		}
	}
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		target[offset + index] = value.charCodeAt(index);
	}
}

async function runCli(options: Readonly<{
	spawn: AssistanceWhisperCppSpawn;
	executable: string;
	args: readonly string[];
	maximumStdoutBytes: number;
	terminationGraceMs: number;
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
		let terminating = false;
		let terminalError: Error | null = null;
		let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
		const abort = (): void => {
			stop(options.signal?.reason instanceof Error
				? options.signal.reason
				: new DOMException('The whisper.cpp CLI was cancelled.', 'AbortError'));
		};
		const finish = (error: Error | null, result?: Uint8Array): void => {
			if (settled) return;
			settled = true;
			if (forceKillTimer !== null) clearTimeout(forceKillTimer);
			options.signal?.removeEventListener('abort', abort);
			if (error) reject(error); else resolve(result!);
		};
		const forceKill = (): void => {
			if (settled) return;
			try { child.kill('SIGKILL'); }
			catch (error) {
				terminalError ??= new Error('The whisper.cpp CLI could not be force-terminated.', {
					cause: error,
				});
			}
			finish(terminalError ?? new Error('The whisper.cpp CLI was force-terminated.'));
		};
		const stop = (error: Error): void => {
			if (settled || terminating) return;
			terminating = true;
			terminalError = error;
			forceKillTimer = setTimeout(forceKill, options.terminationGraceMs);
			try { child.kill('SIGTERM'); }
			catch { forceKill(); }
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		child.stdout.on('data', (value) => {
			if (settled || terminating) return;
			let bytes: Uint8Array;
			try { bytes = bytesFrom(value); }
			catch (error) {
				stop(new TypeError('The whisper.cpp stdout stream is invalid.', { cause: error }));
				return;
			}
			stdoutBytes += bytes.byteLength;
			if (stdoutBytes > options.maximumStdoutBytes) {
				stop(new RangeError('The whisper.cpp stdout exceeded its authenticated output bound.'));
				return;
			}
			stdout.push(bytes);
		});
		child.stderr.on('data', (value) => {
			if (settled || terminating) return;
			try { stderrBytes += bytesFrom(value).byteLength; }
			catch (error) {
				stop(new TypeError('The whisper.cpp diagnostic stream is invalid.', { cause: error }));
				return;
			}
			if (stderrBytes > MAXIMUM_STDERR_BYTES) {
				stop(new RangeError('The whisper.cpp diagnostic output exceeded its bound.'));
			}
		});
		child.once('error', (error) => {
			stop(new Error('The authenticated whisper.cpp CLI failed to execute.', { cause: error }));
		});
		child.once('close', (code, processSignal) => {
			if (settled) return;
			if (terminating) {
				finish(terminalError ?? new Error('The whisper.cpp CLI was terminated.'));
				return;
			}
			if (code !== 0 || processSignal !== null) {
				finish(new Error('The authenticated whisper.cpp CLI did not complete successfully.'));
				return;
			}
			const result = new Uint8Array(stdoutBytes);
			let offset = 0;
			for (const chunk of stdout) { result.set(chunk, offset); offset += chunk.byteLength; }
			finish(null, result);
		});
		if (options.signal?.aborted) abort();
	});
}

function boundedTerminationGrace(value: number | undefined): number {
	const admitted = value ?? DEFAULT_TERMINATION_GRACE_MS;
	if (!Number.isSafeInteger(admitted) || admitted < 1 || admitted > MAXIMUM_TERMINATION_GRACE_MS) {
		throw new RangeError('The whisper.cpp termination grace is invalid.');
	}
	return admitted;
}

function inspectChild(value: AssistanceWhisperCppChild): AssistanceWhisperCppChild {
	if (!value || typeof value.once !== 'function' || typeof value.kill !== 'function'
		|| !value.stdout || typeof value.stdout.on !== 'function'
		|| !value.stderr || typeof value.stderr.on !== 'function') {
		throw new TypeError('The whisper.cpp process factory returned an invalid child.');
	}
	return value;
}

function normalizeWhisperJson(
	bytes: Uint8Array,
	offsetSeconds: number,
	maximumDurationSeconds?: number,
): NormalizedWhisperResult {
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
		if (end <= start || start < previousEnd
			|| (maximumDurationSeconds !== undefined && end / 1_000 > maximumDurationSeconds)) {
			throw new RangeError('The whisper.cpp transcript timing is empty, overlapping, or out of order.');
		}
		previousEnd = end;
		if (typeof segment.text !== 'string' || segment.text.length < 1
			|| Buffer.byteLength(segment.text, 'utf8') > MAXIMUM_SEGMENT_TEXT_BYTES) {
			throw new RangeError('The whisper.cpp transcript segment text is invalid.');
		}
		return Object.freeze({ startSeconds: start / 1_000 + offsetSeconds,
			endSeconds: end / 1_000 + offsetSeconds, text: segment.text });
	});
	return Object.freeze({ language: result.language, segments: Object.freeze(segments) });
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
