/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Publishing verified bytes without ever clobbering what is already there.
 *
 * Every staging path in the runtime pipeline wants the same guarantee: the
 * destination must not exist, the bytes must be assembled somewhere else, and
 * the destination must still not exist at the moment it is claimed. Writing that
 * twice invites the two copies to drift, and the failure it protects against —
 * silently overwriting a published runtime — is the one that must never be
 * reachable by accident.
 */

import { link, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

/**
 * Fills a temporary sibling directory and renames the result into place.
 *
 * `fill` receives the temporary directory and returns the path to rename — the
 * directory itself when a whole tree is being published, or one file inside it
 * when a single file is. The destination is checked for absence twice: once
 * before any bytes are written, and once immediately before the rename, so a
 * path that appears while the staging directory is being filled is refused
 * rather than overwritten. The temporary directory is removed either way.
 */
export async function renameIntoPlaceExclusively(destination, label, fill) {
	const parent = dirname(destination);
	await mkdir(parent, { recursive: true });
	await assertPathMissing(destination, label);
	const temporary = await mkdtemp(resolve(parent, `.${basename(destination)}-`));
	try {
		const staged = await fill(temporary);
		await assertPathMissing(destination, label);
		await claimPathExclusively(staged, destination, label);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

/**
 * Moves the staged path onto the destination, refusing an entry already there.
 *
 * The absence check before this call cannot make the claim safe on its own:
 * `rename` replaces a destination file atomically, so an entry that appears in
 * the window between the check and the move is silently overwritten — the one
 * outcome this module exists to prevent. A regular file is therefore claimed
 * with `link`, which fails with EEXIST instead of replacing. A directory has no
 * portable no-replace rename, but `rename` already refuses a directory holding
 * anything. The destination is checked again at the claim boundary so even an
 * empty directory that appeared during staging is refused.
 */
export async function claimPathExclusively(staged, destination, label) {
	if ((await lstat(staged)).isDirectory()) {
		await assertPathMissing(destination, label);
		await rename(staged, destination);
		return;
	}
	try {
		await link(staged, destination);
	} catch (error) {
		if (error?.code === 'EEXIST') {
			throw new Error(`${label} already exists: ${destination}`, { cause: error });
		}
		throw error;
	}
}

export async function assertPathMissing(path, label) {
	try {
		await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return;
		throw error;
	}
	throw new Error(`${label} already exists: ${path}`);
}
