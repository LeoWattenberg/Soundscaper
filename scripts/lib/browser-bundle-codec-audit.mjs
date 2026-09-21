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
const TRIM_MEDIA_FFMPEG_FACADE = /^assets\/ffmpeg-(?!(?:core|runtime-public-policy)-)[a-z\d_-]+\.js$/iu;
const TRIM_MEDIA_FFMPEG_RUNTIME = /^assets\/editor-ffmpeg-runtime-[a-z\d_-]+\.js$/iu;
const TRIM_MEDIA_BROWSER_RUNTIME = /^assets\/browser-ffmpeg-runtime-[a-z\d_-]+\.js$/iu;
const TRIM_MEDIA_PUBLIC_POLICY = /^assets\/ffmpeg-runtime-public-policy-[a-z\d_-]+\.js$/iu;
const TRIM_MEDIA_SDK = /^assets\/esm-[a-z\d_-]+\.js$/iu;
const TRIM_MEDIA_SDK_WORKER = /^assets\/worker-[a-z\d_-]+\.js$/iu;

/** Prove that application FFmpeg is confined to the browser's dynamic trim-media lease. */
export function auditBrowserBundleCodecComposition({ root }) {
	if (typeof root !== 'string' || root.trim() === '') {
		throw new TypeError('A browser bundle root is required.');
	}
	const auditRoot = resolve(root);
	const metadata = lstatSync(auditRoot);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error('The browser bundle root is not a regular directory.');
	}
	const files = [];
	visit(auditRoot);
	const trimMediaFfmpegFiles = admittedTrimMediaFfmpegFiles(files);
	for (const { name, source } of files) {
		if (trimMediaFfmpegFiles.has(name)) continue;
		const inspectedSource = [...trimMediaFfmpegFiles]
			.reduce((value, allowed) => value.replaceAll(allowed.split('/').at(-1), ''), source);
		if (FORBIDDEN_APPLICATION_FFMPEG.some((pattern) => pattern.test(name) || pattern.test(inspectedSource))) {
			throw new Error(`The browser bundle retains an application-supplied FFmpeg seam: ${name}.`);
		}
	}
	return Object.freeze({ status: 'browser-codec-composition', inspectedFileCount: files.length });

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
			files.push(Object.freeze({ name, source }));
		}
	}
}

/** Admit the one application FFmpeg closure used by the browser's dynamic trim lease. */
function admittedTrimMediaFfmpegFiles(files) {
	const facades = files.filter(({ name }) => TRIM_MEDIA_FFMPEG_FACADE.test(name));
	if (facades.length === 0) return new Set();
	if (facades.length !== 1) throw invalidTrimMediaRuntime('exactly one FFmpeg facade is required');
	const facade = facades[0];
	const facadeName = facade.name.split('/').at(-1);
	for (const file of files.filter(({ name, source }) => (
		name.startsWith('assets/') && name.endsWith('.js') && name !== facade.name && source.includes(facadeName)
	))) {
		const dynamicImport = new RegExp(`import\\(\\s*['"\`]\\./${escapeRegExp(facadeName)}['"\`]\\s*\\)`, 'u');
		if (!dynamicImport.test(file.source)) {
			throw invalidTrimMediaRuntime(`the FFmpeg facade is statically reachable from ${file.name}`);
		}
	}
	const runtime = referencedRuntimeFile(files, facade, TRIM_MEDIA_FFMPEG_RUNTIME, 'runtime');
	const browserRuntime = referencedRuntimeFile(files, runtime, TRIM_MEDIA_BROWSER_RUNTIME, 'browser runtime manager');
	const publicPolicy = referencedRuntimeFile(files, runtime, TRIM_MEDIA_PUBLIC_POLICY, 'public runtime policy');
	const sdk = referencedRuntimeFile(files, runtime, TRIM_MEDIA_SDK, 'FFmpeg SDK');
	const worker = referencedRuntimeFile(files, sdk, TRIM_MEDIA_SDK_WORKER, 'FFmpeg SDK worker');
	return new Set([facade.name, runtime.name, browserRuntime.name, publicPolicy.name, sdk.name, worker.name]);
}

function referencedRuntimeFile(files, owner, pattern, label) {
	const candidates = files.filter(({ name }) => (
		pattern.test(name) && owner.source.includes(name.split('/').at(-1))
	));
	if (candidates.length !== 1) {
		throw invalidTrimMediaRuntime(`${owner.name} must reference exactly one ${label}`);
	}
	return candidates[0];
}

function invalidTrimMediaRuntime(reason) {
	return new Error(`The browser bundle retains an application-supplied FFmpeg seam: ${reason}.`);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
