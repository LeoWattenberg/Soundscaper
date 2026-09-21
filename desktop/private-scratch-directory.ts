/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared private-directory creation and rollback for bounded desktop codec jobs. */

import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

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
