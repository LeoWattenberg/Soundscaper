/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_TWOLAME_WASM = Object.freeze({
	file: 'src/common/editor/twolame/twolame.wasm',
	byteLength: 148_312,
	sha256: '8b89b6a12eab302c92960865c6b1c7d33df86d6d8760c8549a8ee38a99ef2b30',
});

/** Copy only the exact reviewed TwoLAME payload into the compiled desktop graph. */
export async function stageDesktopBundledTwolameRuntime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_TWOLAME_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop TwoLAME payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_TWOLAME_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_TWOLAME_WASM.sha256) {
		throw new Error('The reviewed desktop TwoLAME payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_TWOLAME_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
