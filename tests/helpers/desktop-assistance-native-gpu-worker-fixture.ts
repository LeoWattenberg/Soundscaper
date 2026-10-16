/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { TestContext } from 'node:test';

import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../../desktop/assistance-runtime-family-file-grants.ts';
import type { AssistanceRuntimeFamilyAdmittedJob } from '../../desktop/assistance-runtime-family-job-contract.ts';
import { createAssistanceEditorialGenerationPlanV1 } from '../../src/common/editor/assistance/editorial-generation-v1.ts';

export const VULKAN_TARGETS = ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'] as const;
export type VulkanTarget = typeof VULKAN_TARGETS[number];
export type NativeFamily = 'whisper-cpp' | 'llama-cpp';

export class NativeGpuTestChild extends EventEmitter {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly signals: NodeJS.Signals[] = [];
	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		this.signals.push(signal);
		queueMicrotask(() => this.emit('close', null, signal));
		return true;
	}
}

const JOB_ID = '1'.repeat(40);
const HASH = '4'.repeat(64);

export async function nativeGpuWorkerFixture(
	context: TestContext,
	family: NativeFamily,
	target: VulkanTarget = 'linux-x64',
	maximumByteLength = 64 * 1024,
): Promise<Readonly<{
	job: AssistanceRuntimeFamilyAdmittedJob;
	output: string;
	body: string;
	companion: string;
}>> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-gpu-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const speech = family === 'whisper-cpp';
	const input = join(root, 'input');
	const model = join(root, 'model');
	const output = join(root, 'output');
	const inputBytes = Buffer.from(speech ? 'authenticated-wave' : JSON.stringify(
		createAssistanceEditorialGenerationPlanV1([{ candidateId: 'candidate-a',
			evidenceMode: 'transcript', transcriptExcerpt: 'An opening promise.', visualSummary: 'Host.' }]),
	));
	const modelBytes = Buffer.from('authenticated-model');
	await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes), writeFile(output, '')]);
	const inputRole = speech ? 'audio' as const : 'editorial-context' as const;
	const outputRole = speech ? 'transcript' as const : 'editorial-proposal' as const;
	const task = speech ? 'speech-recognition' as const : 'editorial-generation' as const;
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: family, task,
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: task,
			inputRoles: [inputRole], outputRoles: [outputRole], ...(speech ? { language: 'auto' } : {}) }),
		inputs: [{ claim: { claimVersion: 1, claimId: '2'.repeat(40), jobId: JOB_ID,
			role: inputRole, mediaType: speech ? 'audio/wav' : 'application/vnd.soundscaper.editorial-context+json',
			byteLength: inputBytes.byteLength, sha256: digest(inputBytes) }, path: input }],
		models: [{ modelId: speech ? 'whisper-large-v3-turbo-ggml' : 'qwen3-4b-q4-k-m',
			version: '1.0.0', artifactRole: speech ? 'ggml-large-v3-turbo-q5_0' : 'qwen3-4b-q4-k-m',
			path: model, byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: '3'.repeat(40), jobId: JOB_ID,
			role: outputRole, mediaType: speech ? 'application/vnd.soundscaper.transcript+json'
				: 'application/vnd.soundscaper.editorial-proposal+json', maximumByteLength }, path: output }],
	});
	const executable = `${speech ? 'whisper-cli' : 'llama-completion'}${target.startsWith('win-') ? '.exe' : ''}`;
	const entrypoint = `/runtime/${executable}`;
	const companion = `/runtime/gpu/${executable}`;
	const job = Object.freeze<AssistanceRuntimeFamilyAdmittedJob>({
		protocolVersion: 1, jobId: JOB_ID, familyId: family, task,
		maximumRssBytes: 12 * 1024 ** 3, maximumDurationMs: 60_000, grant,
		descriptor: { familyId: family, runtimeVersion: speech ? 'v1.9.3' : 'b10509', target,
			executionProvider: 'cpu', executionProviders: ['cpu', 'vulkan'], entrypoint,
			accelerationEntrypoints: { vulkan: companion },
			files: [
				{ path: entrypoint, relativePath: executable, byteLength: 1, sha256: HASH, executable: true },
				{ path: companion, relativePath: `gpu/${executable}`, byteLength: 1, sha256: HASH, executable: true },
			] },
	});
	const body = speech ? JSON.stringify({ result: { language: 'en' }, transcription: [
		{ offsets: { from: 0, to: 1000 }, text: ' A promise.' },
	] }) : JSON.stringify({ schemaVersion: 1, candidates: [{ candidateId: 'candidate-a',
		title: 'Opening', hook: 'A promise', chapters: [], explanation: 'A clear opening.' }] });
	return { job, output, body, companion };
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
