/* SPDX-License-Identifier: AGPL-3.0-only */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileDesktopProjectLibraryRuntime } from './desktop-project-library-runtime.mjs';

export const DESKTOP_RUNTIME_TEST_FIXTURE_ENV = 'SCAPE_NODE_TEST_DESKTOP_RUNTIME_FIXTURE';

const COMPILATION_TESTS = new Set([
	'desktop-project-library-packaging.test.js',
	'desktop-audio-codec-runtime-staging.test.js',
	'desktop-os-audio-codec-runtime-staging.test.js',
	'desktop-staged-typescript-guard.test.js',
	'desktop-native-helper-real-process.test.js',
]);

interface RuntimeOptions {
	repositoryRoot: string;
	outputRoot: string;
}

interface RuntimeResult {
	readonly files: readonly string[];
}

type CompileRuntime = (options: RuntimeOptions) => Promise<RuntimeResult>;

interface FixtureManifest {
	repositoryRoot: string;
	files: string[];
}

export function needsDesktopRuntimeTestFixture(testFiles: readonly string[]): boolean {
	return testFiles.some((file) => COMPILATION_TESTS.has(basename(file)));
}

/** The runner owns this temporary directory and removes it after its batches. */
export async function prepareDesktopRuntimeTestFixture(
	{ repositoryRoot, fixtureRoot }: { repositoryRoot: string; fixtureRoot: string },
	compile: CompileRuntime = compileDesktopProjectLibraryRuntime,
): Promise<void> {
	try {
		await mkdir(fixtureRoot, { recursive: true });
		const result = await compile({ repositoryRoot, outputRoot: join(fixtureRoot, 'runtime') });
		await writeFile(join(fixtureRoot, 'fixture.json'), JSON.stringify({
			repositoryRoot: resolve(repositoryRoot), files: result.files,
		}), { flag: 'wx' });
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
	const manifest = readFixtureManifest(await readFile(join(fixtureRoot, 'fixture.json'), 'utf8'));
	if (manifest.repositoryRoot !== resolve(options.repositoryRoot)) return compile(options);
	await cp(join(fixtureRoot, 'runtime'), options.outputRoot, {
		recursive: true, force: false, errorOnExist: true,
	});
	return Object.freeze({ files: Object.freeze(manifest.files) });
}

function readFixtureManifest(source: string): FixtureManifest {
	const manifest: unknown = JSON.parse(source);
	if (typeof manifest !== 'object' || manifest === null
		|| !('repositoryRoot' in manifest) || typeof manifest.repositoryRoot !== 'string'
		|| !('files' in manifest) || !Array.isArray(manifest.files)
		|| !manifest.files.every((file: unknown) => typeof file === 'string')) {
		throw new Error('Invalid desktop runtime test fixture manifest.');
	}
	return { repositoryRoot: manifest.repositoryRoot, files: manifest.files as string[] };
}

// A separate process retains compilation coverage under the runner's V8
// coverage environment and avoids compiling beneath unrelated test processes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [repositoryRoot, fixtureRoot] = process.argv.slice(2);
	if (!repositoryRoot || !fixtureRoot) throw new Error('Expected repository root and desktop runtime test fixture directory.');
	await prepareDesktopRuntimeTestFixture({ repositoryRoot, fixtureRoot });
}
