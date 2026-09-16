/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_LAME_WASM = Object.freeze({
	file: 'src/common/editor/lame/lame.wasm',
	byteLength: 214_198,
	sha256: 'e8ca1786d95a56ead1fc2294be98ea68d31eed5837abd79d2a3322a0af946c6f',
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
