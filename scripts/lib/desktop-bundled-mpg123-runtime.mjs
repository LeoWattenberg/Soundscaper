/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DESKTOP_BUNDLED_MPG123_WASM = Object.freeze({
	file: 'src/common/editor/mpg123/mpg123.wasm',
	byteLength: 172_327,
	sha256: '2c5a60ce737adb0adb98df8301c76804bffeb59373fe7fbce2c8383e926dd7be',
});

/** Copy only the exact reviewed mpg123 decoder payload into the compiled desktop graph. */
export async function stageDesktopBundledMpg123Runtime({ repositoryRoot, outputRoot }) {
	const source = join(repositoryRoot, DESKTOP_BUNDLED_MPG123_WASM.file);
	const sourceMetadata = await lstat(source);
	if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
		throw new Error('The reviewed desktop mpg123 payload must be a regular file.');
	}
	const payload = await readFile(source);
	const digest = createHash('sha256').update(payload).digest('hex');
	if (payload.byteLength !== DESKTOP_BUNDLED_MPG123_WASM.byteLength
		|| digest !== DESKTOP_BUNDLED_MPG123_WASM.sha256) {
		throw new Error('The reviewed desktop mpg123 payload does not match its exact evidence.');
	}
	const destination = join(outputRoot, DESKTOP_BUNDLED_MPG123_WASM.file);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, payload, { flag: 'wx', mode: 0o644 });
}
