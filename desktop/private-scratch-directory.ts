/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared private-directory creation and rollback for bounded desktop codec jobs. */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Create one mode-0700 scratch child, removing it if final permission binding fails. */
export async function createPrivateScratchDirectory(
	root: string,
	prefix: string,
): Promise<string> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(root, prefix));
	try {
		await chmod(directory, 0o700);
		return directory;
	} catch (error) {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

interface PrivateScratchOperations {
	readonly createDirectory: typeof createPrivateScratchDirectory;
	readonly writeInput: typeof writeFile;
	readonly removeDirectory: typeof rm;
}

const PRIVATE_SCRATCH_OPERATIONS: PrivateScratchOperations = Object.freeze({
	createDirectory: createPrivateScratchDirectory,
	writeInput: writeFile,
	removeDirectory: rm,
});

/**
 * Own one private directory and exclusive mode-0600 input for a bounded callback.
 * Cleanup is attempted after every outcome and its failure deliberately replaces
 * the callback result, matching the desktop codec publication boundary.
 */
export async function withOwnedPrivateScratchInput<Result>(options: Readonly<{
	readonly root: string;
	readonly prefix: string;
	readonly inputFileName: string;
	readonly input: Uint8Array;
	readonly run: (custody: Readonly<{
		readonly directory: string;
		readonly inputPath: string;
	}>) => Promise<Result>;
	readonly failed: (error: unknown) => Result;
	readonly cleanupFailed: (error: unknown) => Result;
}>, operations: PrivateScratchOperations = PRIVATE_SCRATCH_OPERATIONS): Promise<Result> {
	let directory: string | null = null;
	let result!: Result;
	try {
		if (basename(options.inputFileName) !== options.inputFileName
			|| options.inputFileName === '.' || options.inputFileName === '..') {
			throw new TypeError('The private scratch input file name is invalid.');
		}
		directory = await operations.createDirectory(options.root, options.prefix);
		const inputPath = join(directory, options.inputFileName);
		await operations.writeInput(inputPath, options.input, { flag: 'wx', mode: 0o600 });
		result = await options.run(Object.freeze({ directory, inputPath }));
	} catch (error) {
		result = options.failed(error);
	} finally {
		if (directory !== null) {
			try {
				await operations.removeDirectory(directory, {
					recursive: true, force: true, maxRetries: 2, retryDelay: 25,
				});
			} catch (error) {
				result = options.cleanupFailed(error);
			}
		}
	}
	return result;
}
