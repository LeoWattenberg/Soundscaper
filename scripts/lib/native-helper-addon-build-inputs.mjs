/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact repository-owned inputs shared by every target-native helper build. */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
	FIXTURE_PLUGIN_ROOT,
	FIXTURE_PLUGIN_SUFFIX,
	FIXTURE_PLUGIN_VARIANTS,
} from './native-fixture-plugins.mjs';
import { listNativeSourceTree } from './native-source-tree.mjs';

export const NATIVE_HELPER_FIXTURE_CMAKE_RECIPE = `${FIXTURE_PLUGIN_ROOT}/CMakeLists.txt`;

const VENDORED_HEADER_ALGORITHM = 'soundscaper-native-helper-vendored-header-closure-sha256-v1';
const VENDORED_HEADER_ROOT = 'vendor/pipewire-headers';

export function deriveNativeHelperVendoredHeaderClosure(repositoryRoot) {
	const root = resolve(repositoryRoot, VENDORED_HEADER_ROOT);
	const tree = listNativeSourceTree(root);
	assert(tree.irregular.length === 0,
		'The vendored PipeWire header closure must contain regular files only.');
	const files = tree.files.map((path) => {
		const name = relative(root, path).split('\\').join('/');
		const bytes = regularFile(path, `vendored PipeWire header ${name}`);
		return { path: name, byteLength: bytes.byteLength, sha256: sha256(bytes) };
	}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	assert(files.length > 0, 'The vendored PipeWire header closure is empty.');
	const identity = { algorithm: VENDORED_HEADER_ALGORITHM, files };
	return Object.freeze({
		algorithm: VENDORED_HEADER_ALGORITHM,
		fileCount: files.length,
		byteLength: files.reduce((total, file) => total + file.byteLength, 0),
		sha256: sha256(canonicalJson(identity)),
	});
}

export function authenticateNativeHelperBuildInputs({ repositoryRoot, manifest }) {
	const expectedHeaders = manifest.toolchain?.vendoredHeaders;
	assert(expectedHeaders?.root === VENDORED_HEADER_ROOT
		&& expectedHeaders.upstream === 'PipeWire 1.0.5'
		&& expectedHeaders.license === 'MIT',
	'The native helper vendored PipeWire header identity is invalid.');
	const vendoredHeaders = deriveNativeHelperVendoredHeaderClosure(repositoryRoot);
	assert(sameJson(vendoredHeaders, expectedHeaders.closure),
		'The vendored PipeWire header closure does not match its pin.');

	const fixtures = manifest.fixturePlugins;
	assert(fixtures?.root === FIXTURE_PLUGIN_ROOT && fixtures.suffix === FIXTURE_PLUGIN_SUFFIX
		&& Array.isArray(fixtures.sourceFiles),
	'The native helper fixture plug-in source identity is invalid.');
	const sourceRoot = resolve(repositoryRoot, FIXTURE_PLUGIN_ROOT, 'src');
	const sourceTree = listNativeSourceTree(sourceRoot);
	assert(sourceTree.irregular.length === 0,
		'The fixture plug-in source inventory must contain regular files only.');
	const present = sourceTree.files.map((path) => relative(sourceRoot, path).split('\\').join('/')).sort();
	const pinned = fixtures.sourceFiles.map(({ path }) => path).sort();
	assert(sameJson(present, pinned),
		'The fixture plug-in source inventory does not exactly match its pins.');
	const sourceFiles = fixtures.sourceFiles.map((descriptor) => {
		const bytes = regularFile(resolve(sourceRoot, descriptor.path),
			`fixture plug-in source ${descriptor.path}`);
		verifyDescriptor(bytes, descriptor, `fixture plug-in source ${descriptor.path}`);
		return { ...descriptor };
	});
	const recipeBytes = regularFile(resolve(repositoryRoot, NATIVE_HELPER_FIXTURE_CMAKE_RECIPE),
		'native helper fixture CMake recipe');
	return Object.freeze({
		vendoredHeaders,
		fixturePlugins: Object.freeze({
			root: FIXTURE_PLUGIN_ROOT,
			suffix: FIXTURE_PLUGIN_SUFFIX,
			sourceFiles,
			variants: FIXTURE_PLUGIN_VARIANTS.map((variant) => ({ ...variant })),
			cmakeRecipe: fileDescriptor(NATIVE_HELPER_FIXTURE_CMAKE_RECIPE, recipeBytes),
		}),
	});
}

function regularFile(path, label) {
	try {
		const metadata = lstatSync(path);
		assert(metadata.isFile() && !metadata.isSymbolicLink() && realpathSync(path) === path,
			`The ${label} is not one canonical regular file.`);
		return readFileSync(path);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(`The ${label}`)) throw error;
		throw new Error(`Unable to read the ${label}: ${error.message}`, { cause: error });
	}
}

function fileDescriptor(path, bytes) {
	return { name: path.split('/').at(-1), path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function verifyDescriptor(bytes, descriptor, label) {
	assert(Number.isSafeInteger(descriptor?.byteLength) && descriptor.byteLength > 0
		&& /^[a-f\d]{64}$/u.test(String(descriptor.sha256)), `The ${label} pin is invalid.`);
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length mismatch.`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest mismatch.`);
}

function canonicalJson(value) {
	return Buffer.from(`${JSON.stringify(sortJson(value), null, '\t')}\n`);
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function sameJson(left, right) {
	return canonicalJson(left).equals(canonicalJson(right));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
