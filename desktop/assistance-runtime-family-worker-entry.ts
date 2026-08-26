/* SPDX-License-Identifier: AGPL-3.0-only */

/** Worker-side authenticated execution seam; model adapters are injected and task-specific. */

import {
	authenticateAssistanceRuntimeFamilyJobGrantFilesV1,
	authenticateAssistanceRuntimeFamilyJobResultFilesV1,
} from './assistance-runtime-family-file-grants.ts';
import {
	validateAssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyAdmittedJob,
	type AssistanceRuntimeFamilyJobGrantV1,
	type AssistanceRuntimeFamilyJobResultV1,
} from './assistance-runtime-family-job-contract.ts';
import {
	validateAssistanceRuntimeFamilyDescriptorV1,
} from './assistance-runtime-family-process-protocol.ts';

export interface AssistanceRuntimeFamilyWorkerExecutionContext {
	readonly job: AssistanceRuntimeFamilyAdmittedJob;
	readonly grant: AssistanceRuntimeFamilyJobGrantV1;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly signal?: AbortSignal;
	onProgress(value: number): void;
}

export interface AssistanceRuntimeFamilyWorkerJobOptions {
	readonly job: AssistanceRuntimeFamilyAdmittedJob;
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number) => void;
	readonly execute: (
		context: AssistanceRuntimeFamilyWorkerExecutionContext,
	) => Promise<unknown>;
}

export class AssistanceRuntimeFamilyAdapterUnavailableError extends Error {
	readonly code = 'ADAPTER_UNAVAILABLE';
	constructor() {
		super('No reviewed model adapter is mounted for this runtime-family task.');
		this.name = 'AssistanceRuntimeFamilyAdapterUnavailableError';
	}
}

export async function runAssistanceRuntimeFamilyWorkerJobV1(
	options: AssistanceRuntimeFamilyWorkerJobOptions,
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	if (!options || typeof options.execute !== 'function') {
		throw new TypeError('The runtime-family worker needs one injected task adapter.');
	}
	options.signal?.throwIfAborted();
	const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(options.job?.descriptor);
	const request = validateAssistanceRuntimeFamilyJobRequestV1({
		protocolVersion: options.job?.protocolVersion,
		jobId: options.job?.jobId,
		familyId: options.job?.familyId,
		task: options.job?.task,
		maximumRssBytes: options.job?.maximumRssBytes,
		maximumDurationMs: options.job?.maximumDurationMs,
		grant: options.job?.grant,
	});
	if (descriptor.familyId !== request.familyId) {
		throw new TypeError('The runtime-family worker job selected a foreign runtime descriptor.');
	}
	const grant = await authenticateAssistanceRuntimeFamilyJobGrantFilesV1(
		request.grant, options.signal,
	);
	let active = true;
	const onProgress = (value: number): void => {
		options.signal?.throwIfAborted();
		if (!active || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
			throw new TypeError('Runtime-family worker progress must be a finite ratio in [0, 1].');
		}
		options.onProgress?.(value);
	};
	let candidate: unknown;
	try {
		candidate = await options.execute(Object.freeze({
			job: Object.freeze({ ...request, descriptor }),
			grant,
			settings: Object.freeze(JSON.parse(grant.settingsJson) as Record<string, unknown>),
			signal: options.signal,
			onProgress,
		}));
	} finally {
		active = false;
	}
	options.signal?.throwIfAborted();
	return await authenticateAssistanceRuntimeFamilyJobResultFilesV1(
		grant, candidate, options.signal,
	);
}

export async function unavailableAssistanceRuntimeFamilyWorkerAdapter(): Promise<never> {
	throw new AssistanceRuntimeFamilyAdapterUnavailableError();
}
