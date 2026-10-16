/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { nativeTestFixtureRecipes, type NativeTestFixtureKind, type NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';

export const NATIVE_TEST_FIXTURE_ENV = 'SCAPE_NODE_TEST_NATIVE_FIXTURE';
interface FixtureArtifact { readonly file: string; readonly inputSha256: string; readonly sha256: string; }
interface FixtureManifest {
	readonly schemaVersion: 1;
	readonly repositoryRoot: string;
	readonly platform: string;
	readonly architecture: string;
	readonly artifacts: Readonly<Partial<Record<NativeTestFixtureKind, FixtureArtifact>>>;
}
interface FixtureOptions {
	readonly repositoryRoot: string;
	readonly fixtureRoot: string;
	readonly kinds: readonly NativeTestFixtureKind[];
	readonly environment?: NodeJS.ProcessEnv;
}
interface CopyOptions {
	readonly repositoryRoot: string;
	readonly kind: NativeTestFixtureKind;
	readonly outputPath: string;
	readonly environment?: NodeJS.ProcessEnv;
}
type CompilerIdentity = (compiler: string) => string | null;
const compilerIdentities = new Map<string, string | null>();

function compilerIdentity(compiler: string): string | null {
	if (!compilerIdentities.has(compiler)) {
		const result = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
		compilerIdentities.set(compiler, result.status === 0 ? result.stdout : null);
	}
	return compilerIdentities.get(compiler) ?? null;
}

/** Every preparation is fresh; no compiled executable survives a Node runner invocation. */
export function prepareNativeTestFixtures(options: FixtureOptions, build = buildNativeRecipe, identify: CompilerIdentity = compilerIdentity): void {
	try {
		mkdirSync(options.fixtureRoot, { recursive: true });
		const recipes = nativeTestFixtureRecipes(options.repositoryRoot, options.environment);
		const artifacts: Partial<Record<NativeTestFixtureKind, FixtureArtifact>> = {};
		for (const kind of new Set(options.kinds)) {
			const recipe = recipes[kind];
			const compiler = identify(recipe.compiler);
			if (compiler === null && recipe.compiler === 'c++') continue;
			if (compiler === null) throw new Error(`Native fixture compiler ${recipe.compiler} is unavailable.`);
			const file = `${kind}${process.platform === 'win32' ? '.exe' : ''}`;
			const inputSha256 = recipeIdentity(recipe, compiler);
			build(recipe, join(options.fixtureRoot, file));
			artifacts[kind] = { file, inputSha256, sha256: digest(regularFileBytes(join(options.fixtureRoot, file))) };
		}
		const manifest: FixtureManifest = { schemaVersion: 1, repositoryRoot: resolve(options.repositoryRoot), platform: process.platform, architecture: process.arch, artifacts };
		writeFileSync(join(options.fixtureRoot, 'fixture.json'), JSON.stringify(manifest), { flag: 'wx' });
	} catch (error) {
		rmSync(options.fixtureRoot, { recursive: true, force: true });
		throw error;
	}
}

/** Copies are ordinary files, so one case cannot mutate another case's native executable. */
export function copyNativeTestFixture(options: CopyOptions, identify: CompilerIdentity = compilerIdentity): boolean {
	const environment = options.environment ?? process.env;
	const fixtureRoot = environment[NATIVE_TEST_FIXTURE_ENV];
	if (!fixtureRoot) return false;
	const metadata = lstatSync(fixtureRoot);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Native fixture root must be a regular directory.');
	const manifest = readManifest(regularFileBytes(join(fixtureRoot, 'fixture.json')));
	if (manifest.repositoryRoot !== resolve(options.repositoryRoot) || manifest.platform !== process.platform || manifest.architecture !== process.arch) {
		throw new Error('Native fixture belongs to another repository or host.');
	}
	const artifact = manifest.artifacts[options.kind];
	if (!artifact) return false;
	const recipe = nativeTestFixtureRecipes(options.repositoryRoot, environment)[options.kind];
	const compiler = identify(recipe.compiler);
	if (compiler === null || recipeIdentity(recipe, compiler) !== artifact.inputSha256) throw new Error('Native fixture source or compilation identity changed.');
	const source = join(fixtureRoot, artifact.file);
	if (digest(regularFileBytes(source)) !== artifact.sha256) throw new Error('Native fixture digest differs from its fresh compilation.');
	copyFileSync(source, options.outputPath, constants.COPYFILE_EXCL);
	if (digest(regularFileBytes(options.outputPath)) !== artifact.sha256) {
		rmSync(options.outputPath);
		throw new Error('Native fixture copy digest differs from its fresh compilation.');
	}
	return true;
}

export function compileNativeTestFixture(options: CopyOptions): void {
	if (copyNativeTestFixture(options)) return;
	buildNativeRecipe(nativeTestFixtureRecipes(options.repositoryRoot, options.environment)[options.kind], options.outputPath);
}

function buildNativeRecipe(recipe: NativeTestFixtureRecipe, outputPath: string): void {
	const result = spawnSync(recipe.compiler, [...recipe.arguments, ...recipe.sources, '-o', outputPath], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`Native fixture ${recipe.kind} failed to compile:\n${result.stderr || result.stdout}`);
}

function recipeIdentity(recipe: NativeTestFixtureRecipe, compiler: string): string {
	const files = new Set(recipe.sources);
	for (const root of recipe.headerRoots) {
		const metadata = lstatSync(root);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Native fixture include root must be a regular directory.');
		for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
			if (!entry.isDirectory()) files.add(join(entry.parentPath, entry.name));
		}
	}
	return digest(Buffer.from(JSON.stringify({ recipe, compiler, files: [...files].sort().map(file => [file, digest(regularFileBytes(file))]) })));
}

function regularFileBytes(path: string): Buffer {
	if (!lstatSync(path).isFile()) throw new Error(`Native fixture input must be a regular file: ${path}`);
	return readFileSync(path);
}

function readManifest(bytes: Buffer): FixtureManifest {
	if (bytes.byteLength > 1024 * 1024) throw new Error('Native fixture manifest exceeds its bound.');
	const value: unknown = JSON.parse(bytes.toString('utf8'));
	if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1
		|| !('repositoryRoot' in value) || typeof value.repositoryRoot !== 'string'
		|| !('platform' in value) || typeof value.platform !== 'string'
		|| !('architecture' in value) || typeof value.architecture !== 'string'
		|| !('artifacts' in value) || typeof value.artifacts !== 'object' || value.artifacts === null) throw new Error('Invalid native fixture manifest.');
	for (const [kind, artifact] of Object.entries(value.artifacts)) {
		if (!['media-contract', 'media-contract-exact', 'media-validator', 'delivery-filesystem'].includes(kind)
			|| typeof artifact !== 'object' || artifact === null
			|| !('file' in artifact) || artifact.file !== `${kind}${process.platform === 'win32' ? '.exe' : ''}`
			|| !('inputSha256' in artifact) || typeof artifact.inputSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.inputSha256)
			|| !('sha256' in artifact) || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error('Invalid native fixture artifact.');
	}
	return value as FixtureManifest;
}

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
