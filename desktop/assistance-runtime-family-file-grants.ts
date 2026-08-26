/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main capture and worker-side re-authentication for path-private runtime-family grants. */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim,
	type AssistanceOutputReservation,
	type AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import {
	validateAssistanceRuntimeFamilyJobGrantV1,
	validateAssistanceRuntimeFamilyJobResultV1,
	type AssistanceRuntimeFamilyJobGrantV1,
	type AssistanceRuntimeFamilyJobResultV1,
	type AssistanceRuntimeFamilyTask,
} from './assistance-runtime-family-job-contract.ts';
import type {
	AssistanceRuntimeFamilyDescriptor,
	AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';
import {
	validateAssistanceRuntimeFamilyDescriptorV1,
} from './assistance-runtime-family-process-protocol.ts';

export interface AssistanceRuntimeFamilyInputCapture {
	readonly claim: AssistanceStagedInputClaim;
	readonly path: string;
}

export interface AssistanceRuntimeFamilyModelCapture {
	readonly modelId: string;
	readonly version: string;
	readonly artifactRole: string;
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AssistanceRuntimeFamilyOutputCapture {
	readonly reservation: AssistanceOutputReservation;
	readonly path: string;
}

export interface AssistanceRuntimeFamilyGrantCaptureOptions {
	readonly jobId: string;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly task: AssistanceRuntimeFamilyTask;
	readonly settingsJson: string;
	readonly inputs: readonly AssistanceRuntimeFamilyInputCapture[];
	readonly models: readonly AssistanceRuntimeFamilyModelCapture[];
	readonly outputs: readonly AssistanceRuntimeFamilyOutputCapture[];
	readonly signal?: AbortSignal;
}

interface InspectedFile {
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<{ readonly dev: number; readonly ino: number }>;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export async function captureAssistanceRuntimeFamilyJobGrantV1(
	options: AssistanceRuntimeFamilyGrantCaptureOptions,
): Promise<AssistanceRuntimeFamilyJobGrantV1> {
	options.signal?.throwIfAborted();
	if (!options || !Array.isArray(options.inputs) || !Array.isArray(options.models)
		|| !Array.isArray(options.outputs)) {
		throw new TypeError('Runtime-family grant capture options are invalid.');
	}
	const inputs = await Promise.all(options.inputs.map(async ({ claim: value, path }) => {
		const claim = validateAssistanceStagedInputClaim(value);
		if (claim.jobId !== options.jobId) throw new TypeError('A captured input belongs to another job.');
		const file = await inspectFile(path, {
			minimumBytes: claim.byteLength, maximumBytes: claim.byteLength,
			expectedSha256: claim.sha256, label: 'runtime-family input', signal: options.signal,
		});
		return Object.freeze({
			claimId: claim.claimId, role: claim.role, mediaType: claim.mediaType,
			path, byteLength: file.byteLength, sha256: file.sha256, identity: file.identity,
		});
	}));
	const models = await Promise.all(options.models.map(async (model) => {
		const file = await inspectFile(model.path, {
			minimumBytes: model.byteLength, maximumBytes: model.byteLength,
			expectedSha256: model.sha256, label: 'runtime-family model', signal: options.signal,
		});
		return Object.freeze({
			modelId: model.modelId, version: model.version, artifactRole: model.artifactRole,
			path: model.path, byteLength: file.byteLength, sha256: file.sha256, identity: file.identity,
		});
	}));
	const outputs = await Promise.all(options.outputs.map(async ({ reservation: value, path }) => {
		const reservation = validateAssistanceOutputReservation(value);
		if (reservation.jobId !== options.jobId) throw new TypeError('A captured output belongs to another job.');
		const file = await inspectFile(path, {
			minimumBytes: 0, maximumBytes: 0, expectedSha256: EMPTY_SHA256,
			label: 'runtime-family output', signal: options.signal,
		});
		return Object.freeze({
			claimId: reservation.claimId, role: reservation.role, mediaType: reservation.mediaType,
			path, maximumByteLength: reservation.maximumByteLength,
			initialByteLength: 0 as const, initialSha256: file.sha256, identity: file.identity,
		});
	}));
	options.signal?.throwIfAborted();
	return validateAssistanceRuntimeFamilyJobGrantV1({
		grantVersion: 1, jobId: options.jobId, familyId: options.familyId, task: options.task,
		settingsJson: options.settingsJson, inputs, models, outputs,
	});
}

export async function authenticateAssistanceRuntimeFamilyJobGrantFilesV1(
	value: unknown,
	signal?: AbortSignal,
): Promise<AssistanceRuntimeFamilyJobGrantV1> {
	const grant = validateAssistanceRuntimeFamilyJobGrantV1(value);
	signal?.throwIfAborted();
	await Promise.all([
		...grant.inputs.map((file) => inspectFile(file.path, {
			minimumBytes: file.byteLength, maximumBytes: file.byteLength,
			expectedSha256: file.sha256, expectedIdentity: file.identity,
			label: 'runtime-family input', signal,
		})),
		...grant.models.map((file) => inspectFile(file.path, {
			minimumBytes: file.byteLength, maximumBytes: file.byteLength,
			expectedSha256: file.sha256, expectedIdentity: file.identity,
			label: 'runtime-family model', signal,
		})),
		...grant.outputs.map((file) => inspectFile(file.path, {
			minimumBytes: 0, maximumBytes: 0,
			expectedSha256: EMPTY_SHA256, expectedIdentity: file.identity,
			label: 'runtime-family output', signal,
		})),
	]);
	signal?.throwIfAborted();
	return grant;
}

export async function authenticateAssistanceRuntimeFamilyJobResultFilesV1(
	grantValue: unknown,
	resultValue: unknown,
	signal?: AbortSignal,
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	const grant = validateAssistanceRuntimeFamilyJobGrantV1(grantValue);
	const result = validateAssistanceRuntimeFamilyJobResultV1(resultValue, grant);
	const grants = new Map(grant.outputs.map((output) => [output.claimId, output]));
	await Promise.all(result.outputs.map((output) => {
		const file = grants.get(output.claimId)!;
		return inspectFile(file.path, {
			minimumBytes: output.byteLength, maximumBytes: output.byteLength,
			expectedSha256: output.sha256, expectedIdentity: file.identity,
			label: 'runtime-family result output', signal,
		});
	}));
	signal?.throwIfAborted();
	return result;
}

export async function authenticateAssistanceRuntimeFamilyDescriptorFilesV1(
	value: unknown,
	signal?: AbortSignal,
): Promise<AssistanceRuntimeFamilyDescriptor> {
	const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(value);
	await Promise.all(descriptor.files.map((file) => inspectFile(file.path, {
		minimumBytes: file.byteLength, maximumBytes: file.byteLength,
		expectedSha256: file.sha256, label: 'runtime-family payload', signal,
	})));
	signal?.throwIfAborted();
	return descriptor;
}

async function inspectFile(
	path: string,
	options: Readonly<{
		readonly minimumBytes: number;
		readonly maximumBytes: number;
		readonly expectedSha256: string;
		readonly expectedIdentity?: Readonly<{ readonly dev: number; readonly ino: number }>;
		readonly label: string;
		readonly signal?: AbortSignal;
	}>,
): Promise<InspectedFile> {
	options.signal?.throwIfAborted();
	if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
		|| path.includes('\0') || await realpath(path) !== path) {
		throw new TypeError(`The ${options.label} path is not absolute and canonical.`);
	}
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink()
		|| before.size < options.minimumBytes || before.size > options.maximumBytes) {
		throw new Error(`The ${options.label} is not a regular file within its exact length.`);
	}
	const identity = Object.freeze({ dev: Number(before.dev), ino: Number(before.ino) });
	if (options.expectedIdentity && !sameIdentity(identity, options.expectedIdentity)) {
		throw new Error(`The ${options.label} file identity changed.`);
	}
	let handle;
	try {
		const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
		handle = await open(path, constants.O_RDONLY | noFollow);
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| !sameIdentity(identity, { dev: Number(opened.dev), ino: Number(opened.ino) })) {
			throw new Error(`The ${options.label} changed while opening.`);
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, opened.size)));
		let position = 0;
		while (position < opened.size) {
			options.signal?.throwIfAborted();
			const length = Math.min(buffer.byteLength, opened.size - position);
			const { bytesRead } = await handle.read(buffer, 0, length, position);
			if (bytesRead < 1) throw new Error(`The ${options.label} ended during authentication.`);
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		const after = await handle.stat();
		const pathAfter = await lstat(path);
		const sha256 = hash.digest('hex');
		if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
			|| after.ctimeMs !== opened.ctimeMs || pathAfter.size !== opened.size
			|| !sameIdentity(identity, { dev: Number(pathAfter.dev), ino: Number(pathAfter.ino) })
			|| sha256 !== options.expectedSha256) {
			throw new Error(`The ${options.label} digest, identity, or length changed.`);
		}
		return Object.freeze({ byteLength: opened.size, sha256, identity });
	} finally {
		await handle?.close();
	}
}

function sameIdentity(
	left: Readonly<{ readonly dev: number; readonly ino: number }>,
	right: Readonly<{ readonly dev: number; readonly ino: number }>,
): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}
