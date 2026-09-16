/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_VORBIS_WASM = Object.freeze({
	file: 'src/common/editor/vorbis/vorbis.wasm',
	byteLength: 526_926,
	sha256: 'cfa42717394ce29f8af676fb0ad7bff632306f75e536211eb85b7cc5aaf09aa0',
});

/** Copy only the exact reviewed libvorbis/libogg payload into the compiled desktop graph. */
export async function stageDesktopBundledVorbisRuntime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_VORBIS_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop Ogg Vorbis payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_VORBIS_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_VORBIS_WASM.sha256) {
		throw new Error('The reviewed desktop Ogg Vorbis payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_VORBIS_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
