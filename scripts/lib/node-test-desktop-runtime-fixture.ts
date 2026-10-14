/* SPDX-License-Identifier: AGPL-3.0-only */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileDesktopProjectLibraryRuntime } from './desktop-project-library-runtime.mjs';
import { recordVerifiedInputTree, verifyInputTree } from './verified-ci-input-tree.ts';

export const DESKTOP_RUNTIME_TEST_FIXTURE_ENV = 'SCAPE_NODE_TEST_DESKTOP_RUNTIME_FIXTURE';

const COMPILATION_TESTS = new Set([
	'desktop-project-library-packaging.test.js',
	'desktop-audio-codec-runtime-staging.test.js',
	'desktop-os-audio-codec-runtime-staging.test.js',
	'desktop-staged-typescript-guard.test.js',
	'desktop-native-helper-real-process.test.js',
]);

export interface RuntimeOptions {
	repositoryRoot: string;
	outputRoot: string;
}

export interface RuntimeResult {
	readonly files: readonly string[];
}

export type CompileRuntime = (options: RuntimeOptions) => Promise<RuntimeResult>;

export interface DesktopRuntimeFixtureManifest {
	schemaVersion: 2;
	repositoryRoot: string;
	files: string[];
	inputIdentity: string | null;
}

export function needsDesktopRuntimeTestFixture(testFiles: readonly string[]): boolean {
	return testFiles.some((file) => COMPILATION_TESTS.has(basename(file)));
}

/** The runner owns this temporary directory and removes it after its batches. */
export async function prepareDesktopRuntimeTestFixture(
	{ repositoryRoot, fixtureRoot }: { repositoryRoot: string; fixtureRoot: string },
	compile: CompileRuntime = compileDesktopProjectLibraryRuntime,
	inputIdentity: string | null = null,
): Promise<void> {
	try {
		await mkdir(fixtureRoot, { recursive: true });
		const result = await compile({ repositoryRoot, outputRoot: join(fixtureRoot, 'runtime') });
		await writeFile(join(fixtureRoot, 'fixture.json'), JSON.stringify({
			schemaVersion: 2, repositoryRoot: resolve(repositoryRoot), files: result.files, inputIdentity,
		}), { flag: 'wx' });
		recordVerifiedInputTree(desktopRuntimeFixtureTree(fixtureRoot, inputIdentity, result.files));
	} catch (error) {
		await rm(fixtureRoot, { recursive: true, force: true });
		throw error;
	}
}

/** Reuse this invocation's fresh compile; mutations stay in each test's copy. */
export async function compileDesktopRuntimeTestFixture(
	options: RuntimeOptions,
	{
		environment = process.env,
		compile = compileDesktopProjectLibraryRuntime,
	}: { environment?: NodeJS.ProcessEnv; compile?: CompileRuntime } = {},
): Promise<RuntimeResult> {
	const fixtureRoot = environment[DESKTOP_RUNTIME_TEST_FIXTURE_ENV];
	if (!fixtureRoot) return compile(options);
	const manifest = readDesktopRuntimeFixtureManifestFile(fixtureRoot);
	if (manifest.repositoryRoot !== resolve(options.repositoryRoot)) return compile(options);
	if (!verifyInputTree(desktopRuntimeFixtureTree(fixtureRoot, manifest.inputIdentity, manifest.files))) throw new Error('Prepared desktop runtime bytes changed.');
	await cp(join(fixtureRoot, 'runtime'), options.outputRoot, {
		recursive: true, force: false, errorOnExist: true,
	});
	if (!verifyInputTree({ ...desktopRuntimeFixtureTree(fixtureRoot, manifest.inputIdentity, manifest.files), root: options.outputRoot })) throw new Error('Copied desktop runtime bytes changed.');
	return Object.freeze({ files: Object.freeze(manifest.files) });
}

export function desktopRuntimeFixtureTree(fixtureRoot: string, inputIdentity: string | null, files: readonly string[]) {
	const inventory = createHash('sha256').update(JSON.stringify(files)).digest('hex');
	return { root: join(fixtureRoot, 'runtime'), receipt: join(fixtureRoot, 'runtime-receipt.json'), identity: `desktop-runtime-fixture-v2:${inputIdentity ?? 'fresh-invocation'}:${inventory}`, preserveModes: false };
}

export function readDesktopRuntimeFixtureManifestFile(fixtureRoot: string): DesktopRuntimeFixtureManifest {
	const path = join(fixtureRoot, 'fixture.json');
	if (!lstatSync(fixtureRoot).isDirectory() || !lstatSync(path).isFile() || lstatSync(path).size > 1024 * 1024) throw new Error('Invalid desktop runtime test fixture metadata.');
	return readDesktopRuntimeFixtureManifest(readFileSync(path, 'utf8'));
}

export function readDesktopRuntimeFixtureManifest(source: string): DesktopRuntimeFixtureManifest {
	const manifest: unknown = JSON.parse(source);
	if (source.length > 1024 * 1024 || typeof manifest !== 'object' || manifest === null
		|| !('schemaVersion' in manifest) || manifest.schemaVersion !== 2
		|| !('repositoryRoot' in manifest) || typeof manifest.repositoryRoot !== 'string'
		|| !('inputIdentity' in manifest) || manifest.inputIdentity !== null && typeof manifest.inputIdentity !== 'string'
		|| !('files' in manifest) || !Array.isArray(manifest.files)
		|| !manifest.files.every((file: unknown) => typeof file === 'string' && file !== '' && !file.includes('..') && !file.startsWith('/') && !file.includes('\\'))) {
		throw new Error('Invalid desktop runtime test fixture manifest.');
	}
	return { schemaVersion: 2, repositoryRoot: manifest.repositoryRoot, files: manifest.files as string[], inputIdentity: manifest.inputIdentity as string | null };
}

// A separate process retains compilation coverage under the runner's V8
// coverage environment and avoids compiling beneath unrelated test processes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [repositoryRoot, fixtureRoot] = process.argv.slice(2);
	if (!repositoryRoot || !fixtureRoot) throw new Error('Expected repository root and desktop runtime test fixture directory.');
	// V8 coverage is already active in this process. Stop passing it to tsc,
	// whose dependency internals do not contribute to repository coverage.
	delete process.env.NODE_V8_COVERAGE;
	await prepareDesktopRuntimeTestFixture({ repositoryRoot, fixtureRoot });
}
