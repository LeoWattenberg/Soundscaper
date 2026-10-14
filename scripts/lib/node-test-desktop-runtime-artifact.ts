/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { compileDesktopProjectLibraryRuntime } from './desktop-project-library-runtime.mjs';
import { desktopRuntimeFixtureTree, prepareDesktopRuntimeTestFixture, readDesktopRuntimeFixtureManifestFile, type CompileRuntime } from './node-test-desktop-runtime-fixture.ts';
import { fileDigest, verifyInputTree } from './verified-ci-input-tree.ts';

interface ArtifactOptions { readonly repositoryRoot: string; readonly fixtureRoot: string; }
type IdentifySource = (repositoryRoot: string) => string;

/** This artifact is compiled anew for one workflow, never restored across source revisions. */
export async function prepareDesktopRuntimeTestArtifact(options: ArtifactOptions, compile: CompileRuntime = compileDesktopProjectLibraryRuntime, identify: IdentifySource = desktopRuntimeFixtureSourceIdentity): Promise<void> {
	const identity = identify(options.repositoryRoot);
	try {
		await prepareDesktopRuntimeTestFixture(options, compile, identity);
		if (identify(options.repositoryRoot) !== identity) throw new Error('Desktop fixture inputs changed while compiling.');
	} catch (error) {
		await rm(options.fixtureRoot, { recursive: true, force: true });
		throw error;
	}
}

export function validateDesktopRuntimeTestArtifact(options: ArtifactOptions, identify: IdentifySource = desktopRuntimeFixtureSourceIdentity): void {
	const manifest = readDesktopRuntimeFixtureManifestFile(options.fixtureRoot);
	if (manifest.repositoryRoot !== resolve(options.repositoryRoot) || manifest.inputIdentity === null || manifest.inputIdentity !== identify(options.repositoryRoot)) {
		throw new Error('Desktop fixture source or toolchain differs from this checkout.');
	}
	if (!verifyInputTree(desktopRuntimeFixtureTree(options.fixtureRoot, manifest.inputIdentity, manifest.files))) throw new Error('Desktop fixture runtime bytes differ from their fresh compilation.');
}

/** Conservative input closure: source, recipes, configuration, payloads and actual compiler bytes. */
export function desktopRuntimeFixtureSourceIdentity(repositoryRoot: string): string {
	const git = (arguments_: readonly string[]): string => {
		const result = spawnSync('git', arguments_, { cwd: repositoryRoot, encoding: 'utf8' });
		if (result.status !== 0) throw new Error('Desktop artifact requires authenticated Git source inputs.');
		return result.stdout;
	};
	const files = git(['ls-files', '-z', '--', 'src', 'desktop', 'scripts', 'config', 'native', 'vendor', 'public', 'tsconfig*.json', 'package.json', 'package-lock.json', '.nvmrc', '.npmrc']).split('\0').filter(Boolean);
	const compilerRoots = ['node_modules/typescript', 'node_modules/esbuild'];
	if (existsSync(join(repositoryRoot, 'node_modules/@esbuild'))) compilerRoots.push('node_modules/@esbuild');
	for (const root of compilerRoots) {
		for (const entry of readdirSync(join(repositoryRoot, root), { recursive: true, withFileTypes: true })) {
			if (!entry.isDirectory()) files.push(relative(repositoryRoot, join(entry.parentPath, entry.name)));
		}
	}
	const override = process.env.ESBUILD_BINARY_PATH;
	return createHash('sha256').update(JSON.stringify({
		schemaVersion: 1, revision: git(['rev-parse', 'HEAD']).trim(), node: process.version, platform: process.platform, architecture: process.arch,
		imageOs: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
		esbuildOverride: override ? [override, fileDigest(resolve(repositoryRoot, override))] : null,
		files: [...new Set(files)].sort().map(file => [file, fileDigest(join(repositoryRoot, file))]),
	})).digest('hex');
}
