/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

export const OPENFX_TEST_FIXTURE_ENV = 'SCAPE_NODE_TEST_OPENFX_FIXTURE';

const BASIC_ARTIFACTS = ['plugin', 'runtime'] as const;
const RUNTIME_ARTIFACTS = [
	...BASIC_ARTIFACTS, 'scanner',
] as const;
type Artifact = typeof RUNTIME_ARTIFACTS[number];

interface NativeBuild {
	readonly exactRetimeAvailable: boolean;
	readonly plugin?: string;
	readonly runtime?: string;
	readonly scanner?: string;
}

interface FixtureManifest {
	readonly repositoryRoot: string;
	readonly platform: string;
	readonly architecture: string;
	readonly available: boolean;
	readonly exactRetimeAvailable: boolean;
	readonly artifacts: Readonly<Record<string, { readonly file: string; readonly sha256: string }>>;
}

interface FixtureOptions {
	readonly repositoryRoot: string;
	readonly fixtureRoot: string;
	readonly artifacts: readonly Artifact[];
}

/** Only consumers of this particular conformance fixture need its compilation. */
export function openFxTestFixtureArtifacts(testFiles: readonly string[]): readonly Artifact[] {
	if (testFiles.some(file => basename(file) === 'framescaper-openfx-native-runtime.test.js')) return RUNTIME_ARTIFACTS;
	return testFiles.some(file => ['framescaper-openfx-gpu-source.test.js', 'framescaper-openfx-native-interact.test.js'].includes(basename(file)))
		? BASIC_ARTIFACTS : [];
}

/** Fresh compilation belongs to one runner invocation, never a persistent cache. */
export async function prepareOpenFxTestFixture(
	options: FixtureOptions,
	build?: () => NativeBuild | null,
): Promise<void> {
	let cleanup: () => void = () => undefined;
	try {
		mkdirSync(options.fixtureRoot, { recursive: true });
		if (build === undefined) {
			const fixture = await import('../../tests/helpers/openfx-native-scanner-fixture.js');
			cleanup = fixture.cleanupOpenFxNativeContractFixture;
			build = () => fixture.buildOpenFxNativeContractFixture({ skip: () => undefined });
		}
		const native = build();
		const artifacts: Record<string, { file: string; sha256: string }> = {};
		const publish = (name: string, source: string) => {
			if (!lstatSync(source).isFile()) throw new Error(`OpenFX fixture ${name} must be a regular file.`);
			const file = `${name}${extname(source)}`;
			const target = join(options.fixtureRoot, file);
			copyFileSync(source, target);
			artifacts[name] = { file, sha256: digest(readFileSync(target)) };
		};
		if (native !== null) {
			for (const name of options.artifacts) {
				const source = native[name];
				if (!source) throw new Error(`OpenFX fixture ${name} is missing.`);
				publish(name, source);
			}
		}
		const manifest: FixtureManifest = {
			repositoryRoot: resolve(options.repositoryRoot), platform: process.platform, architecture: process.arch,
			available: native !== null, exactRetimeAvailable: native?.exactRetimeAvailable ?? false, artifacts,
		};
		writeFileSync(join(options.fixtureRoot, 'fixture.json'), JSON.stringify(manifest), { flag: 'wx' });
	} catch (error) {
		rmSync(options.fixtureRoot, { recursive: true, force: true });
		throw error;
	} finally {
		cleanup();
	}
}

/** Every test process owns copies of the binaries and its mutable scratch tree. */
export function copyOpenFxTestFixture(options: {
	readonly repositoryRoot: string;
	readonly directory: string;
	readonly environment?: NodeJS.ProcessEnv;
}): { readonly artifacts: Readonly<Record<string, string>>; readonly digests: Readonly<Record<string, string>>; readonly exactRetimeAvailable: boolean } | null | undefined {
	const fixtureRoot = (options.environment ?? process.env)[OPENFX_TEST_FIXTURE_ENV];
	if (!fixtureRoot) return undefined;
	const manifest = readManifest(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf8'));
	if (manifest.repositoryRoot !== resolve(options.repositoryRoot)
		|| manifest.platform !== process.platform || manifest.architecture !== process.arch) return undefined;
	if (!manifest.available) return null;
	mkdirSync(options.directory, { recursive: true });
	const artifacts: Record<string, string> = {};
	const digests: Record<string, string> = {};
	for (const [name, artifact] of Object.entries(manifest.artifacts)) {
		const source = join(fixtureRoot, artifact.file);
		if (!lstatSync(source).isFile()) throw new Error(`OpenFX fixture ${name} must be a regular file.`);
		const target = join(options.directory, artifact.file);
		copyFileSync(source, target);
		if (digest(readFileSync(target)) !== artifact.sha256) throw new Error(`OpenFX fixture ${name} digest does not match its fresh build.`);
		artifacts[name] = target;
		digests[name] = artifact.sha256;
	}
	return { artifacts, digests, exactRetimeAvailable: manifest.exactRetimeAvailable };
}

function readManifest(source: string): FixtureManifest {
	const value: unknown = JSON.parse(source);
	if (typeof value !== 'object' || value === null
		|| !('repositoryRoot' in value) || typeof value.repositoryRoot !== 'string'
		|| !('platform' in value) || typeof value.platform !== 'string'
		|| !('architecture' in value) || typeof value.architecture !== 'string'
		|| !('available' in value) || typeof value.available !== 'boolean'
		|| !('exactRetimeAvailable' in value) || typeof value.exactRetimeAvailable !== 'boolean'
		|| !('artifacts' in value) || typeof value.artifacts !== 'object' || value.artifacts === null) {
		throw new Error('Invalid OpenFX test fixture manifest.');
	}
	for (const [name, artifact] of Object.entries(value.artifacts)) {
		if (!/^[a-zA-Z][a-zA-Z0-9-]*$/u.test(name)
			|| typeof artifact !== 'object' || artifact === null
			|| !('file' in artifact) || typeof artifact.file !== 'string'
			|| !/^[a-zA-Z][a-zA-Z0-9-]*(?:\.(?:exe|so|dll|dylib))?$/u.test(artifact.file)
			|| !('sha256' in artifact) || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
			throw new Error('Invalid OpenFX test fixture artifact.');
		}
	}
	return value as FixtureManifest;
}

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
