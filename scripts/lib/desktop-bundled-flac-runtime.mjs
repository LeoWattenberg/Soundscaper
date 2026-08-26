/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_FLAC_WASM = Object.freeze({
	file: 'src/common/editor/flac/flac.wasm',
	byteLength: 153_076,
	sha256: '0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986',
});

/** Copy only the exact reviewed libFLAC payload into the compiled desktop graph. */
export async function stageDesktopBundledFlacRuntime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_FLAC_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop FLAC payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_FLAC_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_FLAC_WASM.sha256) {
		throw new Error('The reviewed desktop FLAC payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_FLAC_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
