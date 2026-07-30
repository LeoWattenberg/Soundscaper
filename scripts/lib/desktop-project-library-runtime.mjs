/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const EXPECTED_RUNTIME_FILES = Object.freeze([
	'desktop/application-lifecycle.js',
	'desktop/project-library-abort.js',
	'desktop/project-library-contract.js',
	'desktop/project-library-database.js',
	'desktop/project-library-editor-service.js',
	'desktop/project-library-file-inventory.js',
	'desktop/project-library-host.js',
	'desktop/project-library-persistence.js',
	'desktop/project-library-projects.js',
	'desktop/project-library-reclamation.js',
	'desktop/project-library.js',
	'src/common/editor/adm-project-metadata.js',
	'src/common/editor/broadcast-wave.js',
	'src/common/editor/cart-metadata.js',
	'src/common/editor/ixml.js',
	'src/common/editor/persisted-audio-effect-validation.js',
	'src/common/editor/project-bext-metadata.js',
	'src/common/editor/project-feature-requirements.js',
	'src/common/editor/project-schema-version.js',
	'src/common/editor/project-v9-document-validation.js',
	'src/common/editor/project-v9-media-validation.js',
	'src/common/editor/project-v9-validation-primitives.js',
	'src/common/editor/project-v9-validation.js',
	'src/common/editor/scape-project-document.js',
	'src/common/editor/stable-id.js',
	'src/common/editor/terminal-channel-widths.js',
	'src/common/editor/video-effects.js',
	'src/common/editor/video-timeline.js',
	'src/common/editor/wav-opaque-chunks.js',
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
	const files = await listRuntimeFiles(output);
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
	const runtimeFiles = await listRuntimeFiles(compiledRoot);
	assertExpectedRuntime(runtimeFiles);
	await cp(sourceRoot, applicationRoot, {
		recursive: true,
		filter: (source) => extname(source) !== '.ts',
	});
	await cp(compiledRoot, join(applicationRoot, 'project-library-runtime'), { recursive: true });
}

async function listRuntimeFiles(root, relativeRoot = '') {
	const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...await listRuntimeFiles(root, relativePath));
		else if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
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
