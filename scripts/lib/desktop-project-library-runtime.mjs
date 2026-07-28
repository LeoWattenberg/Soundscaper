/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const EXPECTED_RUNTIME_FILES = Object.freeze([
	'application-lifecycle.js',
	'project-library-abort.js',
	'project-library-contract.js',
	'project-library-host.js',
	'project-library-persistence.js',
	'project-library.js',
]);

export async function compileDesktopProjectLibraryRuntime({ repositoryRoot, outputRoot }) {
	const root = resolveRequiredPath(repositoryRoot, 'repository root');
	const output = resolveRequiredPath(outputRoot, 'desktop runtime output');
	if (output === root) throw new TypeError('Desktop runtime output cannot overwrite the repository root');
	await mkdir(output, { recursive: true });
	await run(process.execPath, [
		resolve(root, 'node_modules/typescript/bin/tsc'),
		'--project', resolve(root, 'tsconfig.desktop-runtime.json'),
		'--outDir', output,
	], root);
	const files = (await readdir(output, { withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
	assertExpectedRuntime(files);
	for (const name of files) {
		const source = await readFile(join(output, name), 'utf8');
		if (/from ['"].*\.ts['"]/u.test(source)) throw new Error(`Desktop runtime ${name} retained a TypeScript import`);
	}
	return Object.freeze({ files: Object.freeze(files) });
}

export async function stageDesktopApplicationSources({
	desktopSourceRoot,
	applicationDesktopRoot,
	runtimeRoot,
}) {
	const sourceRoot = resolveRequiredPath(desktopSourceRoot, 'desktop source root');
	const applicationRoot = resolveRequiredPath(applicationDesktopRoot, 'application desktop root');
	const compiledRoot = resolveRequiredPath(runtimeRoot, 'compiled desktop runtime root');
	const runtimeFiles = (await readdir(compiledRoot, { withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
	assertExpectedRuntime(runtimeFiles);
	await cp(sourceRoot, applicationRoot, {
		recursive: true,
		filter: (source) => extname(source) !== '.ts',
	});
	await cp(compiledRoot, join(applicationRoot, 'project-library-runtime'), { recursive: true });
}

function assertExpectedRuntime(files) {
	if (files.length !== EXPECTED_RUNTIME_FILES.length
		|| files.some((name, index) => name !== EXPECTED_RUNTIME_FILES[index])) {
		throw new Error(`Desktop runtime output is incomplete or stale: ${files.join(', ')}`);
	}
}

function resolveRequiredPath(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Desktop runtime ${label} is required`);
	return resolve(value);
}

function run(command, args, cwd) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`Desktop runtime compiler exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}`));
		});
	});
}
