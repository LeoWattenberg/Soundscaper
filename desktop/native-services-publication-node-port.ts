/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only, root-granted filesystem publication for regular files and sealed trees. */

import { constants } from 'node:fs';
import {
	link, lstat, open, realpath, rename, rm, unlink,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import {
	inspectNativeMediaOutputTree,
	type NativeMediaAuthenticatedOutputTree,
} from './native-media-output-tree.ts';
import type { FramescaperNativeRootGrant } from './native-services-root-repository.ts';
import type {
	FramescaperNativePublicationPort,
	FramescaperNativePublishedFileObservation,
} from './native-services-publication.ts';

export interface FramescaperNativePublicationNodePortOptions {
	/** Test seam; production always uses Node's same-filesystem rename. */
	readonly renameDirectory?: (source: string, destination: string) => Promise<void>;
}

/**
 * Directory publication is one same-parent rename while the main broker holds
 * the exclusive queue/root fence. It never falls back to copy on EXDEV. Every
 * broker-published authenticated tree is non-empty, so a concurrent broker
 * winner cannot be replaced by the later POSIX rename. Node exposes no portable
 * RENAME_NOREPLACE flag: the preflight does not defend an empty destination
 * created by an external same-user process in the syscall race window.
 */
export function createFramescaperNativePublicationNodePort(
	grant: FramescaperNativeRootGrant,
	options: FramescaperNativePublicationNodePortOptions = {},
): FramescaperNativePublicationPort {
	const renameDirectory = options.renameDirectory ?? rename;
	return Object.freeze({
		inspect: (relativePath: string) => inspectFramescaperGrantedFile(grant, relativePath),
		renameTemporarySibling: async (temporaryRelativePath: string, relativeDestination: string) => {
			const { temporary, destination } = await publicationSiblings(
				grant, temporaryRelativePath, relativeDestination,
			);
			const details = await lstat(temporary);
			if (!details.isFile() || details.isSymbolicLink()) {
				throw new Error('Native publication requires a regular-file temporary sibling.');
			}
			await assertAbsent(destination);
			await link(temporary, destination);
			await unlink(temporary);
		},
		removePublishedOutput: async (
			relativeDestination: string,
			expected: FramescaperNativePublishedFileObservation,
		) => {
			const observed = await inspectFramescaperGrantedFile(grant, relativeDestination);
			if (observed === null || observed.symbolicLink
				|| observed.byteLength !== expected.byteLength || observed.sha256 !== expected.sha256) {
				throw new Error('Native publication cleanup refuses an output whose identity changed.');
			}
			await unlink(await grantedPath(grant, relativeDestination, true));
		},
		inspectOutputTree: (relativePath: string) => inspectGrantedOutputTree(grant, relativePath),
		renameTemporaryOutputTree: async (temporaryRelativePath: string, relativeDestination: string) => {
			const { temporary, destination } = await publicationSiblings(
				grant, temporaryRelativePath, relativeDestination,
			);
			const before = await lstat(temporary);
			if (!before.isDirectory() || before.isSymbolicLink()) {
				throw new Error('Native image-sequence publication requires a regular directory.');
			}
			const parent = await lstat(dirname(temporary));
			if (!parent.isDirectory() || parent.isSymbolicLink() || parent.dev !== before.dev) {
				throw new Error('Native image-sequence publication requires one filesystem.');
			}
			await assertAbsent(destination);
			await renameDirectory(temporary, destination);
			const after = await lstat(destination);
			if (!after.isDirectory() || after.isSymbolicLink()
				|| after.dev !== before.dev || after.ino !== before.ino) {
				throw new Error('Native image-sequence publication changed directory identity.');
			}
		},
		removePublishedOutputTree: async (
			relativeDestination: string,
			expected: NativeMediaAuthenticatedOutputTree,
		) => {
			const observed = await inspectGrantedOutputTree(grant, relativeDestination);
			if (observed === null || !sameOutputTree(observed, expected)) {
				throw new Error('Native tree cleanup refuses an output whose identity changed.');
			}
			const path = await grantedPath(grant, relativeDestination, true);
			const details = await lstat(path);
			if (!details.isDirectory() || details.isSymbolicLink()
				|| details.dev !== expected.identity.dev || details.ino !== expected.identity.ino) {
				throw new Error('Native tree cleanup refuses a replaced directory.');
			}
			await rm(path, { recursive: true, force: false });
		},
	});
}

export async function inspectFramescaperGrantedFile(
	grant: FramescaperNativeRootGrant,
	relativePath: string,
): Promise<FramescaperNativePublishedFileObservation | null> {
	const path = await grantedPath(grant, relativePath, false);
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			return Object.freeze({ byteLength: 0, sha256: '0'.repeat(64), symbolicLink: true });
		}
		if (!stat.isFile()) throw new Error('A native media file output must be a regular file.');
		return Object.freeze({ ...await inspectRegularFile(path), symbolicLink: false });
	} catch (error) {
		if (missing(error)) return null;
		throw error;
	}
}

async function inspectGrantedOutputTree(
	grant: FramescaperNativeRootGrant,
	relativePath: string,
): Promise<NativeMediaAuthenticatedOutputTree | null> {
	const path = await grantedPath(grant, relativePath, false);
	let stat: Awaited<ReturnType<typeof lstat>>;
	try {
		stat = await lstat(path);
	} catch (error) {
		if (missing(error)) return null;
		throw error;
	}
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new Error('A native media output tree must be a regular directory.');
	}
	try { return await inspectNativeMediaOutputTree(path); }
	catch (error) {
		throw new Error('Native media output-tree manifest authentication failed.', { cause: error });
	}
}

async function publicationSiblings(
	grant: FramescaperNativeRootGrant,
	temporaryRelativePath: string,
	relativeDestination: string,
): Promise<Readonly<{ temporary: string; destination: string }>> {
	const temporary = await grantedPath(grant, temporaryRelativePath, true);
	const destination = await grantedPath(grant, relativeDestination, false);
	if (dirname(temporary) !== dirname(destination)) {
		throw new Error('Native publication requires a same-directory temporary sibling.');
	}
	return Object.freeze({ temporary, destination });
}

async function grantedPath(
	grant: FramescaperNativeRootGrant,
	relativePath: string,
	requireTarget: boolean,
): Promise<string> {
	await assertDirectoryIdentity(grant);
	const relativeDestination = publicationRelativePath(relativePath);
	const target = resolve(grant.rootPath, ...relativeDestination.split('/'));
	const child = relative(grant.rootPath, target);
	if (!child || child.startsWith('..') || isAbsolute(child)) {
		throw new Error('A native media path escaped its durable root.');
	}
	const parts = relativeDestination.split('/');
	let current = grant.rootPath;
	for (let index = 0; index < parts.length; index += 1) {
		current = join(current, parts[index]!);
		try {
			const stat = await lstat(current);
			if (stat.isSymbolicLink()) throw new Error('A native media path contains a symbolic link.');
			if (index < parts.length - 1 && !stat.isDirectory()) {
				throw new Error('A native media path parent is not a directory.');
			}
		} catch (error) {
			if (!missing(error) || requireTarget || index < parts.length - 1) throw error;
			break;
		}
	}
	return target;
}

async function assertDirectoryIdentity(grant: FramescaperNativeRootGrant): Promise<void> {
	if (grant.revokedAtMs !== null) throw new Error('The native publication root grant was revoked.');
	const stat = await lstat(grant.rootPath, { bigint: true });
	if (!stat.isDirectory() || stat.isSymbolicLink()
		|| `device:${stat.dev.toString(16)}` !== grant.volumeIdentity
		|| `device:${stat.dev.toString(16)}:inode:${stat.ino.toString(16)}` !== grant.directoryIdentity
		|| await realpath(grant.rootPath) !== grant.rootPath) {
		throw new Error('The native durable root no longer matches its authorized identity.');
	}
}

async function inspectRegularFile(path: string): Promise<Readonly<{ byteLength: number; sha256: string }>> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat();
		if (!before.isFile()) throw new Error('A native service input must be a regular file.');
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let position = 0;
		for (;;) {
			const result = await handle.read(buffer, 0, buffer.length, position);
			if (result.bytesRead === 0) break;
			hash.update(buffer.subarray(0, result.bytesRead));
			position += result.bytesRead;
		}
		const after = await handle.stat();
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || position !== after.size) {
			throw new Error('A native service file changed during verification.');
		}
		return Object.freeze({ byteLength: after.size, sha256: hash.digest('hex') });
	} finally { await handle.close(); }
}

function publicationRelativePath(value: string): string {
	if (typeof value === 'string') {
		const temporary = /^(.*)\.[a-f0-9]{16}\.partial$/u.exec(value);
		if (temporary) {
			assertNativeMediaRelativeDestination(temporary[1]);
			return value;
		}
	}
	return assertNativeMediaRelativeDestination(value);
}

async function assertAbsent(path: string): Promise<void> {
	try {
		await lstat(path);
		throw new Error('Native publication refuses to replace an existing destination.');
	} catch (error) {
		if (!missing(error)) throw error;
	}
}

function sameOutputTree(
	left: NativeMediaAuthenticatedOutputTree,
	right: NativeMediaAuthenticatedOutputTree,
): boolean {
	return left.byteLength === right.byteLength && left.sha256 === right.sha256
		&& left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino
		&& JSON.stringify(left.tree) === JSON.stringify(right.tree);
}

function missing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error
		&& (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}
