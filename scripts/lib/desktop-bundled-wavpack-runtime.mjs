/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_WAVPACK_WASM = Object.freeze({
	file: 'src/common/editor/wavpack/wavpack.wasm',
	byteLength: 145_537,
	sha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
});

/** Copy only the exact reviewed WavPack payload into the compiled desktop graph. */
export async function stageDesktopBundledWavPackRuntime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_WAVPACK_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop WavPack payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_WAVPACK_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_WAVPACK_WASM.sha256) {
		throw new Error('The reviewed desktop WavPack payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_WAVPACK_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
