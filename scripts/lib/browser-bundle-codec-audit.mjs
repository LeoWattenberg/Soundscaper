/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

const INSPECTED_EXTENSIONS = Object.freeze(new Set([
	'.cjs', '.css', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt', '.webmanifest', '.xml',
]));
const FORBIDDEN_APPLICATION_FFMPEG = Object.freeze([
	/@ffmpeg\/(?:core|ffmpeg)/iu,
	/ffmpeg-core(?:-[a-z\d_-]+)?\.(?:js|wasm)/iu,
	/(?:^|\/)ffmpeg-[a-z\d_-]+\.js$/iu,
	/browser-ffmpeg-runtime/iu,
	/createBrowserFfmpegRuntimeManager/iu,
	/assets\.soundscaper\.org\/runtime\/ffmpeg/iu,
	/soundscaper-ffmpeg-runtime-v1-/iu,
]);

/** Prove that a production browser bundle cannot resolve or fetch application-supplied FFmpeg. */
export function auditBrowserBundleCodecComposition({ root }) {
	if (typeof root !== 'string' || root.trim() === '') {
		throw new TypeError('A browser bundle root is required.');
	}
	const auditRoot = resolve(root);
	const metadata = lstatSync(auditRoot);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error('The browser bundle root is not a regular directory.');
	}
	let inspectedFileCount = 0;
	visit(auditRoot);
	return Object.freeze({ status: 'browser-codec-composition', inspectedFileCount });

	function visit(directory) {
		const entries = readdirSync(directory, { withFileTypes: true })
			.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const name = relative(auditRoot, path).split(sep).join('/');
			const entryMetadata = lstatSync(path);
			if (entryMetadata.isSymbolicLink()) {
				throw new Error(`The browser bundle contains a symbolic entry: ${name}.`);
			}
			if (entryMetadata.isDirectory()) {
				visit(path);
				continue;
			}
			if (!entryMetadata.isFile()) throw new Error(`The browser bundle contains a non-file entry: ${name}.`);
			const source = INSPECTED_EXTENSIONS.has(extname(name).toLowerCase())
				? readFileSync(path, 'utf8')
				: '';
			inspectedFileCount += 1;
			if (FORBIDDEN_APPLICATION_FFMPEG.some((pattern) => pattern.test(name) || pattern.test(source))) {
				throw new Error(`The browser bundle retains an application-supplied FFmpeg seam: ${name}.`);
			}
		}
	}
}
