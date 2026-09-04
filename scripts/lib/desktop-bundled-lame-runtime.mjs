/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_LAME_WASM = Object.freeze({
	file: 'src/common/editor/lame/lame.wasm',
	byteLength: 213_293,
	sha256: 'd624f2202ce5a560ca38bc156cb80441fe93ec799e59a35d0f9379a990256123',
});

/** Copy only the exact reviewed LAME payload into the compiled desktop graph. */
export async function stageDesktopBundledLameRuntime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_LAME_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop LAME payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_LAME_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_LAME_WASM.sha256) {
		throw new Error('The reviewed desktop LAME payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_LAME_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
