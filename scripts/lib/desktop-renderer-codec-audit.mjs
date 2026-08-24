/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const INSPECTED_EXTENSIONS = Object.freeze(new Set([
	'.cjs', '.css', '.html', '.js', '.json', '.mjs', '.txt', '.xml',
]));
const FORBIDDEN_BROWSER_RUNTIME = Object.freeze([
	/browser-ffmpeg-runtime/iu,
	/assets\.soundscaper\.org\/runtime\/ffmpeg/iu,
	/ffmpeg-core\.(?:js|wasm)/iu,
	/soundscaper-ffmpeg-runtime-v1-/iu,
]);

/** Prove that a desktop renderer cannot resolve or fetch the browser codec core. */
export async function auditDesktopRendererCodecComposition({ root }) {
	if (typeof root !== 'string' || root.trim() === '') {
		throw new TypeError('A desktop renderer root is required.');
	}
	const auditRoot = resolve(root);
	const metadata = await lstat(auditRoot);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error('The desktop renderer root is not a regular directory.');
	}
	let inspectedFileCount = 0;
	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const name = relative(auditRoot, path).split(sep).join('/');
			const entryMetadata = await lstat(path);
			if (entryMetadata.isSymbolicLink()) {
				throw new Error(`The desktop renderer contains a symbolic entry: ${name}.`);
			}
			if (entryMetadata.isDirectory()) {
				await visit(path);
				continue;
			}
			if (!entryMetadata.isFile()) throw new Error(`The desktop renderer contains a non-file entry: ${name}.`);
			if (!INSPECTED_EXTENSIONS.has(extname(name).toLowerCase())) continue;
			inspectedFileCount += 1;
			const source = await readFile(path, 'utf8');
			if (FORBIDDEN_BROWSER_RUNTIME.some((pattern) => pattern.test(name) || pattern.test(source))) {
				throw new Error(`The desktop renderer retains a browser FFmpeg runtime seam: ${name}.`);
			}
		}
	}
	await visit(auditRoot);
	return Object.freeze({ status: 'desktop-codec-composition', inspectedFileCount });
}
