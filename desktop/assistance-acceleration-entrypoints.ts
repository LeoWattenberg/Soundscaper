/* SPDX-License-Identifier: AGPL-3.0-only */

import { posix, win32 } from 'node:path';

export interface AssistanceAccelerationEntrypoints {
	readonly vulkan: string;
}

interface EntrypointOptions {
	readonly familyId: string;
	readonly entrypoint: string;
	readonly executionProviders?: readonly string[];
	readonly absolute?: boolean;
	readonly files: readonly Readonly<{ path: string; relativePath?: string; executable: boolean }>[];
}

/** Vulkan can never replace the portable CPU entrypoint or escape its verified closure. */
export function validateAssistanceAccelerationEntrypoints(
	value: unknown,
	options: EntrypointOptions,
): AssistanceAccelerationEntrypoints | undefined {
	const vulkan = options.executionProviders?.includes('vulkan') === true;
	if (value === undefined && !vulkan) return undefined;
	if (!vulkan || !['whisper-cpp', 'llama-cpp'].includes(options.familyId)
		|| typeof value !== 'object' || value === null || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value))
		|| Object.keys(value).length !== 1 || !Object.hasOwn(value, 'vulkan')
		|| typeof (value as Record<string, unknown>).vulkan !== 'string') {
		throw new TypeError('Vulkan acceleration requires exactly one authenticated companion entrypoint.');
	}
	const path = (value as { vulkan: string }).vulkan;
	const companion = options.files.find((file) => file.path === path);
	const main = options.files.find((file) => file.path === options.entrypoint);
	const relative = companion?.relativePath ?? companion?.path;
	const mainRelative = main?.relativePath ?? main?.path;
	if (!companion?.executable || !main?.executable || path === options.entrypoint
		|| !relative || !mainRelative || relative !== `gpu/${posix.basename(mainRelative)}`) {
		throw new TypeError('The Vulkan companion must be a separate executable in the exact runtime closure.');
	}
	if (options.absolute) {
		const paths = options.entrypoint.startsWith('/') ? posix : win32;
		let root = options.entrypoint;
		for (let levels = mainRelative.split('/').length; levels > 0; levels -= 1) root = paths.dirname(root);
		if (paths.join(root, ...relative.split('/')) !== path) {
			throw new TypeError('The Vulkan companion must remain inside the authenticated target root.');
		}
	}
	return Object.freeze({ vulkan: path });
}
