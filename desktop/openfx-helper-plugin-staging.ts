/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy exact approved plug-in bytes into one private helper reservation before native loading. */

import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { HelperExecutableGrant } from './helper-contract.ts';
import type { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';

export async function stageOpenFxPluginBinary(
	filesystem: NativeMediaHelperFilesystem,
	reservation: string,
	grant: HelperExecutableGrant,
	signal: AbortSignal,
): Promise<string> {
	signal.throwIfAborted();
	const path = join(reservation, 'plugin-binary.ofx');
	await copyFile(grant.path, path, constants.COPYFILE_EXCL);
	await filesystem.authenticateFile({
		path, byteLength: grant.bytes, sha256: grant.sha256,
	});
	await filesystem.revalidate();
	signal.throwIfAborted();
	return path;
}
