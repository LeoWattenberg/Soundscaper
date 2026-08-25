/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build-time proof that each bundled codec manifest binds its complete compiled JS closure. */

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix, resolve } from 'node:path';
import ts from 'typescript';

import {
	BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME,
	DESKTOP_BUNDLED_AUDIO_CODEC_CONTROL_FILES,
	DESKTOP_BUNDLED_AUDIO_CODEC_EXECUTION_FILES,
	createBundledAudioCodecRuntimeManifest,
	serializeBundledAudioCodecRuntimeManifest,
} from '../../desktop/bundled-audio-codec-runtime-payload.mjs';

const HELPER_PATH = 'project-library-runtime/desktop/bundled-audio-codec-helper-process.js';
const AUTHENTICATED_DYNAMIC_IMPORTS = new Set([
	'pathToFileURL(path).href',
	'__rewriteRelativeImportExtension(pathToFileURL(path).href)',
]);

export async function stageBundledAudioCodecRuntimeManifest(options) {
	const desktopRoot = absoluteRoot(options?.desktopRoot);
	await assertBundledAudioCodecRuntimeClosure({ desktopRoot });
	const manifest = await createBundledAudioCodecRuntimeManifest({ desktopRoot });
	await writeFile(
		join(desktopRoot, BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME),
		serializeBundledAudioCodecRuntimeManifest(manifest),
		{ flag: 'wx', mode: 0o600 },
	);
	return manifest;
}

export async function assertBundledAudioCodecRuntimeClosure(options) {
	const desktopRoot = absoluteRoot(options?.desktopRoot);
	await assertControlClosure(desktopRoot);
	for (const [codec, expectedFiles] of Object.entries(DESKTOP_BUNDLED_AUDIO_CODEC_EXECUTION_FILES)) {
		const expected = new Set(expectedFiles);
		const entry = expectedFiles.find((path) => path.endsWith(`bundled-${codec}-audio-codec-runtime.js`));
		if (entry === undefined) throw new Error(`Bundled codec ${codec} has no execution entry module.`);
		const visited = new Set();
		await visitModule({ desktopRoot, codec, path: entry, expected, visited });
		const actual = [...visited].sort();
		if (actual.length !== expectedFiles.length
			|| actual.some((path, index) => path !== expectedFiles[index])) {
			const missing = expectedFiles.filter((path) => !visited.has(path));
			throw new Error(
				`Bundled codec ${codec} manifest has unreachable execution files: ${missing.join(', ') || '(none)'}.`,
			);
		}
	}
}

async function assertControlClosure(desktopRoot) {
	const expected = new Set(DESKTOP_BUNDLED_AUDIO_CODEC_CONTROL_FILES);
	const visited = new Set();
	for (const path of [
		'bundled-audio-codec-electron-spawn.mjs',
		'bundled-audio-codec-runtime-payload.mjs',
		HELPER_PATH,
		'project-library-runtime/desktop/bundled-audio-codec-isolated-runtime.js',
	]) await visitModule({ desktopRoot, codec: 'control', path, expected, visited });
	const actual = [...visited].sort();
	const expectedFiles = [...expected].sort();
	if (actual.length !== expectedFiles.length
		|| actual.some((path, index) => path !== expectedFiles[index])) {
		const missing = expectedFiles.filter((path) => !visited.has(path));
		throw new Error(`Bundled codec control manifest has unreachable files: ${missing.join(', ')}.`);
	}
}

async function visitModule({ desktopRoot, codec, path, expected, visited }) {
	if (visited.has(path)) return;
	if (!expected.has(path)) {
		throw new Error(`Bundled codec ${codec} imports an unauthenticated module: ${path}.`);
	}
	visited.add(path);
	const source = await readFile(resolve(desktopRoot, path), 'utf8');
	for (const specifier of moduleSpecifiers(path, source)) {
		if (specifier.startsWith('node:')) continue;
		if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
			throw new Error(`Bundled codec ${codec} imports unsupported module authority: ${specifier}.`);
		}
		const dependency = posix.normalize(posix.join(posix.dirname(path), specifier));
		if (!dependency.startsWith('project-library-runtime/') || !dependency.endsWith('.js')) {
			throw new Error(`Bundled codec ${codec} imports an invalid staged module: ${dependency}.`);
		}
		await visitModule({ desktopRoot, codec, path: dependency, expected, visited });
	}
}

function moduleSpecifiers(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const specifiers = [];
	let authenticatedDynamicImports = 0;
	function visit(node) {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier !== undefined) {
			if (!ts.isStringLiteral(node.moduleSpecifier)) {
				throw new Error(`Bundled codec module ${path} has a non-literal module specifier.`);
			}
			specifiers.push(node.moduleSpecifier.text);
		}
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
				specifiers.push(node.arguments[0].text);
			} else if (path === HELPER_PATH && node.arguments.length === 1
				&& AUTHENTICATED_DYNAMIC_IMPORTS.has(node.arguments[0].getText(file))) {
				authenticatedDynamicImports += 1;
			} else {
				throw new Error(`Bundled codec module ${path} has a non-literal dynamic import.`);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	if (path === HELPER_PATH && authenticatedDynamicImports !== 1) {
		throw new Error('Bundled codec helper has an unexpected authenticated module import authority.');
	}
	return Object.freeze(specifiers);
}

function absoluteRoot(value) {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
		throw new TypeError('The bundled codec staged desktop root is invalid.');
	}
	return resolve(value);
}
