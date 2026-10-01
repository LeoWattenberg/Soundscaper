/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact candidate enumeration and post-snapshot filesystem grants for professional peers. */

import type { Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { HelperFileIdentity } from './helper-job-grant.ts';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import type { NativeChildIsolationPathGrant } from './native-child-isolation-launcher.ts';

/** Retain the 513th candidate so each caller can report truncation after scanning 512. */
export async function collectProfessionalCandidates(
	root: string,
	admitLeaf: (path: string, metadata: Stats) => boolean,
): Promise<readonly string[]> {
	const output: string[] = [];
	async function visit(directory: string, depth: number): Promise<void> {
		if (depth > 16 || output.length > 512) return;
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const metadata = await lstat(path);
			if (metadata.isSymbolicLink()) continue;
			if (admitLeaf(path, metadata)) output.push(path);
			else if (metadata.isDirectory()) await visit(path, depth + 1);
			if (output.length > 512) return;
		}
	}
	await visit(root, 0);
	return Object.freeze(output);
}

/** Reopen only the reviewed immutable snapshot and bind its full device/inode identity. */
export async function exactProfessionalCandidateGrant(
	path: string,
	expected: Readonly<HelperFileIdentity>,
	allowDirectory: boolean,
	diagnostic: string,
): Promise<NativeChildIsolationPathGrant> {
	const metadata = await lstat(path, { bigint: true });
	const identity = nativeChildFileIdentityFromStat(metadata);
	if (metadata.isSymbolicLink() || (!metadata.isFile() && !(allowDirectory && metadata.isDirectory()))
		|| Number(BigInt.asUintN(64, metadata.dev)) !== expected.dev
		|| Number(BigInt.asUintN(64, metadata.ino)) !== expected.ino
		|| await realpath(path) !== path) throw new Error(diagnostic);
	return Object.freeze({
		path, kind: metadata.isDirectory() ? 'directory' as const : 'file' as const, identity,
	});
}
