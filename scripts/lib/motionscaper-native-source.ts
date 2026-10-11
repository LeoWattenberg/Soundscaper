/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MOTION_NATIVE_SOURCE_ROOT = 'native/motionscaper-media-host';
export const MOTION_NATIVE_SOURCE_MANIFEST = `${MOTION_NATIVE_SOURCE_ROOT}/source-manifest.json`;
export const MOTION_NATIVE_TARGETS = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const;
export type MotionNativeTarget = typeof MOTION_NATIVE_TARGETS[number];
export interface MotionNativeFilePin { readonly path: string; readonly byteLength: number; readonly sha256: string }
export interface MotionNativeSourceManifest {
	readonly schemaVersion: 1; readonly productId: 'motionscaper'; readonly helperContractVersion: 1;
	readonly carrierVersion: 1; readonly hostVersion: '0.1.0'; readonly license: 'AGPL-3.0-only';
	readonly dependencySource: MotionNativeFilePin; readonly targets: readonly MotionNativeTarget[];
	readonly sourceFiles: readonly MotionNativeFilePin[];
}
const SHARED = [
	'native/common/sha256.cpp', 'native/common/sha256.hpp',
	'native/framescaper-media-host/src/strict_json.cpp', 'native/framescaper-media-host/src/strict_json.hpp',
	'src/common/editor/motion-native-frame-carrier-v1.ts', 'src/common/editor/motion-native-pcm-carrier-v1.ts',
	'scripts/lib/motionscaper-native-source.ts', 'scripts/lib/motionscaper-native-build.ts',
	'scripts/lib/framescaper-media-host-toolchain.mjs',
	'scripts/lib/soundscaper-native-binary-architecture.mjs',
	'scripts/lib/soundscaper-professional-native-dependency-inspection.mjs',
	'scripts/lib/soundscaper-professional-native-build-result-contract.mjs',
	'desktop/soundscaper-professional-linux-system-libraries.ts',
	'scripts/build-motionscaper-media-host.mjs', 'scripts/refresh-motionscaper-native-sources.mjs',
];
export async function createMotionscaperNativeSourceManifest(repositoryRoot: string): Promise<MotionNativeSourceManifest> {
	const root = resolve(repositoryRoot);
	const paths = [
		`${MOTION_NATIVE_SOURCE_ROOT}/CMakeLists.txt`, `${MOTION_NATIVE_SOURCE_ROOT}/THIRD_PARTY_NOTICES.md`, ...SHARED,
		...await regularFiles(root, `${MOTION_NATIVE_SOURCE_ROOT}/src`), ...await regularFiles(root, `${MOTION_NATIVE_SOURCE_ROOT}/tests`),
	].sort();
	return { schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1,
		hostVersion: '0.1.0', license: 'AGPL-3.0-only', targets: MOTION_NATIVE_TARGETS,
		dependencySource: await pin(root, 'native/framescaper-media-host/source-manifest.json'),
		sourceFiles: await Promise.all(paths.map((path) => pin(root, path))) };
}
export async function verifyMotionscaperNativeSourceManifest(repositoryRoot: string): Promise<MotionNativeSourceManifest> {
	const value: unknown = JSON.parse(await readFile(join(repositoryRoot, MOTION_NATIVE_SOURCE_MANIFEST), 'utf8'));
	const expected = await createMotionscaperNativeSourceManifest(repositoryRoot);
	if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Motionscaper native source closure differs from its exact pins.');
	return expected;
}
async function pin(root: string, path: string): Promise<MotionNativeFilePin> {
	const metadata = await lstat(join(root, path));
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) throw new Error(`Motionscaper native source is not one bounded regular file: ${path}`);
	const bytes = await readFile(join(root, path));
	return { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function regularFiles(root: string, path: string): Promise<string[]> {
	const metadata = await lstat(join(root, path));
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Motionscaper native source directory is not regular.');
	const paths: string[] = [];
	for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
		if (entry.isDirectory()) paths.push(...await regularFiles(root, `${path}/${entry.name}`));
		else if (entry.isFile()) paths.push(`${path}/${entry.name}`);
		else throw new Error('Motionscaper native source closure contains an unadmitted link.');
	}
	return paths;
}
