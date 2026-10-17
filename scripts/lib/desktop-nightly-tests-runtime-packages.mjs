/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertDirectory, readRequiredJson } from './desktop-nightly-tests-staging-filesystem.mjs';
const PACKAGE_NAME = /^(?:@[a-z\d](?:[a-z\d._-]*[a-z\d])?\/[a-z\d](?:[a-z\d._-]*[a-z\d])?|[a-z\d](?:[a-z\d._-]*[a-z\d])?)$/u;

export const NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS = Object.freeze([
	'@axe-core/playwright',
	'@echogarden/pffft-wasm',
	'@ffmpeg/core',
	'@ffmpeg/ffmpeg',
	'@fontsource/inter',
	'@noble/hashes',
	'@playwright/test',
	'@zip.js/zip.js',
	'@vitejs/plugin-react',
	'canvaskit-wasm',
	'esbuild',
	'fflate',
	'mediabunny',
	'react',
	'react-dom',
	'saxes',
	'sql.js',
	'typescript',
	'vite',
]);

// esbuild publishes its compiled binary as one optional dependency per platform
// and resolves it from `process.arch` at run time. The closure walk deliberately
// ignores optional dependencies, so the installed binary package is admitted
// here instead: exactly one may be present, and the launcher points
// ESBUILD_BINARY_PATH at it so the packaged runner never repeats that lookup
// against an Electron whose architecture differs from the build host's Node.
const ESBUILD_BINARY_SCOPE = '@esbuild';

export async function resolveNightlyTestRuntimePackages(root) {
	root = resolve(root);
	const packages = new Map(), visited = new Set();
	const pending = NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.map(name => ({ name, parent: root }));
	if (NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes('esbuild')) pending.push({ name: await resolveEsbuildBinaryPackage(root), parent: root });
	while (pending.length) {
		const { name, parent } = pending.shift();
		assertPackageName(name);
		const packageRoot = await installedPackage(root, parent, name);
		if (visited.has(packageRoot)) continue;
		visited.add(packageRoot);
		const metadata = await readRequiredJson(join(packageRoot, 'package.json'), `runtime package ${name}`);
		if (metadata.name !== name || typeof metadata.version !== 'string' || !metadata.version) {
			throw new Error(`Runtime package ${name} has mismatched package metadata.`);
		}
		// A nested dependency keeps its installed version and resolution position;
		// copying the owning package already retains its complete nested subtree.
		if (packageRoot === join(root, 'node_modules', ...name.split('/'))) packages.set(name, { name, version: metadata.version, root: packageRoot });
		if (name === 'rolldown' || name === 'lightningcss') pending.push(...(await installedNativeBindings(root, name, metadata)).map(name => ({ name, parent: root })));
		for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) {
			assertPackageName(dependency);
			pending.push({ name: dependency, parent: packageRoot });
		}
	}
	return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function installedPackage(root, parent, name) {
	let cursor = parent;
	while (cursor === root || cursor.startsWith(`${root}/`) || cursor.startsWith(`${root}\\`)) {
		const candidate = join(cursor, 'node_modules', ...name.split('/'));
		try { await lstat(candidate); return candidate; }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
		if (cursor === root) break;
		cursor = dirname(cursor);
	}
	throw new Error(`Required runtime package ${name} is missing from the installed dependency closure of ${parent}.`);
}

async function resolveEsbuildBinaryPackage(root) {
	const scopeRoot = join(root, 'node_modules', ESBUILD_BINARY_SCOPE);
	await assertDirectory(scopeRoot, 'installed esbuild binary package scope');
	const installed = (await readdir(scopeRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	if (installed.length !== 1) {
		throw new Error(
			`Exactly one ${ESBUILD_BINARY_SCOPE} binary package must be installed, found ${installed.length}`
			+ `${installed.length ? `: ${installed.join(', ')}` : '.'}`,
		);
	}
	return `${ESBUILD_BINARY_SCOPE}/${installed[0]}`;
}


async function installedNativeBindings(root, owner, metadata) {
	const prefix = owner === 'rolldown' ? '@rolldown/binding-' : 'lightningcss-';
	const installed = [];
	for (const [name, version] of Object.entries(metadata.optionalDependencies ?? {})) {
		if (!name.startsWith(prefix)) continue;
		const path = join(root, 'node_modules', ...name.split('/'));
		try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
		const candidate = await readRequiredJson(join(path, 'package.json'), `${owner} native binding`);
		if (candidate.name !== name || candidate.version !== version || !candidate.os?.includes(process.platform)
			|| !candidate.cpu?.includes(process.arch)) throw new Error(`${owner} native binding ${name} does not match its installed target and pinned version.`);
		installed.push(name);
	}
	// Linux npm installs the two libc variants for the same CPU. Other targets
	// have one binding. Neither unrelated optional runtimes nor WASI are admitted.
	if (installed.length < 1 || installed.length > (process.platform === 'linux' ? 2 : 1)) {
		throw new Error(`${owner} requires its exact installed target-native binding closure.`);
	}
	return installed;
}
function assertPackageName(name) {
	if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) throw new Error(`Unsafe runtime package name: ${String(name)}.`);
}
