/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native GPU attempts are bounded by the authenticated runtime's capabilities. */

import type { AssistanceRuntimeFamilyDescriptor } from './assistance-runtime-family-manifest.ts';

export type AssistanceNativeGpuProvider = 'cpu' | 'metal';

export class AssistanceNativeCliExecutionError extends Error {
	readonly name = 'AssistanceNativeCliExecutionError';
}

export interface AssistanceNativeGpuExecutor {
	run<T>(
		signal: AbortSignal | undefined,
		execute: (provider: AssistanceNativeGpuProvider) => Promise<T>,
	): Promise<T>;
}

export function createAssistanceNativeGpuExecutorV1(
	descriptor: AssistanceRuntimeFamilyDescriptor,
): AssistanceNativeGpuExecutor {
	let provider: AssistanceNativeGpuProvider = descriptor.executionProviders?.includes('metal')
		? 'metal' : 'cpu';
	return Object.freeze({
		async run<T>(
			signal: AbortSignal | undefined,
			execute: (selected: AssistanceNativeGpuProvider) => Promise<T>,
		): Promise<T> {
			signal?.throwIfAborted();
			try {
				return await execute(provider);
			} catch (error) {
				signal?.throwIfAborted();
				if (provider === 'cpu' || !(error instanceof AssistanceNativeCliExecutionError)) {
					throw error;
				}
				// A failed backend stays disabled for subsequent VAD ranges in this job.
				provider = 'cpu';
				return await execute(provider);
			}
		},
	});
}
