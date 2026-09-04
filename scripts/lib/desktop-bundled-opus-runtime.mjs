/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_OPUS_WASM = Object.freeze({
	file: 'src/common/editor/opus/opus.wasm',
	byteLength: 385_914,
	sha256: 'c972c5019a7f56dfe9c712cb15c25ebb54b55b16b19b3b99a5b02c31ef311685',
});

/** Copy only the exact reviewed libopus/libogg payload into the compiled desktop graph. */
export async function stageDesktopBundledOpusRuntime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_OPUS_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop Ogg Opus payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_OPUS_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_OPUS_WASM.sha256) {
		throw new Error('The reviewed desktop Ogg Opus payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_OPUS_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
