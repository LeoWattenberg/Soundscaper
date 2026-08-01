/* SPDX-License-Identifier: AGPL-3.0-only */

import { link, lstat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

const STAGE_ID = /^[a-f0-9]{32}$/u;
const UNSUPPORTED_LINK_CODES = new Set(['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV']);

type HardLink = (existingPath: string, newPath: string) => Promise<void>;

export interface DesktopLibraryMediaBodyReuseOptions {
	readonly directory: string;
	readonly finalPath: string;
	readonly hardLink?: HardLink;
	readonly randomId: () => string;
	readonly signal?: AbortSignal;
	readonly sourcePaths: readonly string[];
	readonly syncDirectory: () => Promise<void>;
	readonly verifySourcePath: (path: string) => Promise<boolean>;
	readonly verifyTargetPath: (path: string) => Promise<void>;
}

export class DesktopLibraryMediaReuseUnavailableError extends Error {
	constructor() {
		super('Desktop library managed-media body reuse is unavailable');
		this.name = 'DesktopLibraryMediaReuseUnavailableError';
	}
}

/** Try verified immutable donors without making reuse a handoff requirement. */
export async function reuseDesktopLibraryMediaBody(
	options: DesktopLibraryMediaBodyReuseOptions,
): Promise<boolean> {
	options.signal?.throwIfAborted();
	if (await pathExists(options.finalPath)) {
		await options.verifyTargetPath(options.finalPath);
		return true;
	}
	for (const sourcePath of options.sourcePaths) {
		options.signal?.throwIfAborted();
		if (!await options.verifySourcePath(sourcePath)) continue;
		const stageId = options.randomId();
		if (!STAGE_ID.test(stageId)) throw new TypeError('Desktop library managed-media stage id is invalid');
		const stagePath = join(options.directory, `.${basename(options.finalPath)}.${stageId}.reuse`);
		const linked = await createVerifiedStage(sourcePath, stagePath, options);
		if (linked === 'unsupported') return false;
		if (linked === 'unusable') continue;
		const promoted = await promoteVerifiedStage(stagePath, options);
		if (promoted === 'unsupported') return false;
		if (promoted === 'unusable') continue;
		return true;
	}
	return false;
}

async function createVerifiedStage(
	sourcePath: string,
	stagePath: string,
	options: DesktopLibraryMediaBodyReuseOptions,
): Promise<'linked' | 'unusable' | 'unsupported'> {
	try {
		await (options.hardLink ?? link)(sourcePath, stagePath);
	} catch (error) {
		options.signal?.throwIfAborted();
		if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EMLINK') return 'unusable';
		if (isUnsupportedLink(error)) return 'unsupported';
		throw error;
	}
	try {
		options.signal?.throwIfAborted();
		if (await options.verifySourcePath(stagePath)) return 'linked';
		await cleanupStage(stagePath, options.syncDirectory, new Error('Managed-media reuse donor changed'));
		return 'unusable';
	} catch (error) {
		await cleanupStage(stagePath, options.syncDirectory, error);
		throw error;
	}
}

async function promoteVerifiedStage(
	stagePath: string,
	options: DesktopLibraryMediaBodyReuseOptions,
): Promise<'linked' | 'unusable' | 'unsupported'> {
	try {
		options.signal?.throwIfAborted();
		await (options.hardLink ?? link)(stagePath, options.finalPath);
	} catch (error) {
		await cleanupStage(stagePath, options.syncDirectory, error);
		options.signal?.throwIfAborted();
		if (errorCode(error) === 'EEXIST') {
			await options.verifyTargetPath(options.finalPath);
			return 'linked';
		}
		if (errorCode(error) === 'EMLINK') return 'unusable';
		if (isUnsupportedLink(error)) return 'unsupported';
		throw error;
	}
	await cleanupStage(stagePath, options.syncDirectory, new Error('Managed-media reuse promotion cleanup failed'));
	return 'linked';
}

async function cleanupStage(
	stagePath: string,
	syncDirectory: () => Promise<void>,
	operationError: unknown,
): Promise<void> {
	try {
		await unlink(stagePath);
		await syncDirectory();
	} catch (cleanupError) {
		if (!isMissing(cleanupError)) {
			throw new AggregateError([operationError, cleanupError], 'Managed-media reuse cleanup failed');
		}
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}

function isUnsupportedLink(error: unknown): boolean {
	const code = errorCode(error);
	return (code !== undefined && UNSUPPORTED_LINK_CODES.has(code))
		|| (code === 'EPERM' && process.platform === 'win32');
}

function isMissing(error: unknown): boolean {
	return errorCode(error) === 'ENOENT';
}
