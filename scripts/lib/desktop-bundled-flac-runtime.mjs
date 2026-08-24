/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_FLAC_WASM = Object.freeze({
	file: 'src/common/editor/flac/flac.wasm',
	byteLength: 153_044,
	sha256: '34acff0d67e3ac7f34816217ed7f5f859bf9a1c70f33eb3c347049f5fdf0d443',
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
