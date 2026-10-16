/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native GPU attempts are bounded by the authenticated runtime's capabilities. */

import type { AssistanceRuntimeFamilyDescriptor } from './assistance-runtime-family-manifest.ts';

export type AssistanceNativeGpuProvider = 'cpu' | 'metal' | 'vulkan';

export class AssistanceNativeCliExecutionError extends Error {
	readonly name = 'AssistanceNativeCliExecutionError';
}

/** Only missing or incompatible OS loaders classify spawn failures as retryable. */
export function assistanceNativeCliSpawnErrorV1(message: string, cause: unknown): Error {
	const code = cause !== null && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
	return code === 'ENOENT' || code === 'ELIBBAD'
		? new AssistanceNativeCliExecutionError(message, { cause }) : new Error(message, { cause });
}

export function assistanceNativeGpuEntrypointV1(
	descriptor: AssistanceRuntimeFamilyDescriptor,
	provider: AssistanceNativeGpuProvider,
): string {
	if (provider !== 'vulkan') return descriptor.entrypoint;
	const entrypoint = descriptor.accelerationEntrypoints?.vulkan;
	if (!entrypoint) throw new TypeError('The authenticated Vulkan runtime has no companion entrypoint.');
	return entrypoint;
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
	let provider: AssistanceNativeGpuProvider = descriptor.executionProviders?.includes('vulkan')
		? 'vulkan' : descriptor.executionProviders?.includes('metal') ? 'metal' : 'cpu';
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
