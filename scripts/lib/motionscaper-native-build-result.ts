/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { MOTION_NATIVE_SOURCE_MANIFEST, MOTION_NATIVE_SOURCE_ROOT, verifyMotionscaperNativeSourceManifest } from './motionscaper-native-source.ts';
import type { MotionNativeFilePin, MotionNativeTarget } from './motionscaper-native-source.ts';
import { MOTION_NATIVE_PRECISION, MOTION_NATIVE_SELF_TEST } from './motionscaper-native-build.ts';
import { assertSoundscaperNativeBinaryArchitecture } from './soundscaper-native-binary-architecture.mjs';
import { validateSoundscaperProfessionalNativeDependencyClosure } from './soundscaper-professional-native-dependency-inspection.mjs';

interface Inspection { readonly artifactPath: string; readonly architecture: unknown; readonly imports: readonly string[]; readonly rpaths: readonly string[] }
interface TestEvidence { readonly id: string; readonly status: 'passed'; readonly outputSha256: string }
export interface MotionNativeBuildReceipt {
	readonly schemaVersion: 1; readonly productId: 'motionscaper'; readonly helperContractVersion: 1; readonly carrierVersion: 1;
	readonly target: MotionNativeTarget; readonly sourceRevision: string; readonly sourceManifestSha256: string;
	readonly dependencySourceSha256: string; readonly dependencyRecipeSha256: string; readonly toolchainIdentity: string;
	readonly buildCommandsSha256: string; readonly payload: MotionNativeFilePin; readonly notices: MotionNativeFilePin;
	readonly precision: typeof MOTION_NATIVE_PRECISION; readonly selfTest: typeof MOTION_NATIVE_SELF_TEST;
	readonly dependencyInspections: readonly Inspection[]; readonly tests: readonly TestEvidence[];
}
export interface VerifiedMotionNativeBuild {
	readonly resultRoot: string; readonly receipt: MotionNativeBuildReceipt; readonly receiptSha256: string;
}
const RECEIPT_KEYS = ['schemaVersion', 'productId', 'helperContractVersion', 'carrierVersion', 'target',
	'sourceRevision', 'sourceManifestSha256', 'dependencySourceSha256', 'dependencyRecipeSha256', 'toolchainIdentity',
	'buildCommandsSha256', 'payload', 'notices', 'precision', 'selfTest', 'dependencyInspections', 'tests'];

/** This verifies a CI build receipt and bytes; packaged smoke still executes the admitted helper. */
export async function verifyMotionscaperNativeBuildResult(options: {
	readonly repositoryRoot: string; readonly resultRoot: string; readonly target: MotionNativeTarget;
}): Promise<VerifiedMotionNativeBuild> {
	const root = resolve(options.resultRoot);
	const stat = await lstat(root);
	if (!isAbsolute(options.resultRoot) || options.resultRoot !== root || !stat.isDirectory() || stat.isSymbolicLink()
		|| await realpath(root) !== root) throw new Error('Motionscaper native result is not a canonical directory.');
	const bytes = await boundedFile(join(root, 'build-result.json'), 1024 * 1024);
	const input: unknown = JSON.parse(bytes.toString('utf8'));
	if (!bytes.equals(Buffer.from(`${JSON.stringify(input, null, '\t')}\n`))) throw new Error('Motionscaper native receipt is not canonical JSON.');
	const receipt = parseReceipt(input, options.target);
	const inventory = (await readdir(root)).sort();
	if (JSON.stringify(inventory) !== JSON.stringify(['build-result.json', receipt.payload.path, receipt.notices.path].sort())) throw new Error('Motionscaper native artifact inventory is not exact.');
	const source = await verifyMotionscaperNativeSourceManifest(options.repositoryRoot);
	const sourceBytes = await readFile(join(options.repositoryRoot, MOTION_NATIVE_SOURCE_MANIFEST));
	if (sha(sourceBytes) !== receipt.sourceManifestSha256 || source.dependencySource.sha256 !== receipt.dependencySourceSha256) throw new Error('Motionscaper native artifact source pins differ from this checkout.');
	const committed = spawnSync('git', ['show', `${receipt.sourceRevision}:${MOTION_NATIVE_SOURCE_MANIFEST}`], {
		cwd: options.repositoryRoot, shell: false, maxBuffer: 2 * 1024 * 1024, timeout: 10_000,
	});
	if (committed.status !== 0 || !committed.stdout.equals(sourceBytes)) throw new Error('Motionscaper native source receipt is not bound to a committed source manifest.');
	const binary = await pinnedFile(root, receipt.payload, 256 * 1024 * 1024);
	const architecture: unknown = assertSoundscaperNativeBinaryArchitecture(binary, receipt.target);
	const inspection = receipt.dependencyInspections[0];
	if (JSON.stringify(architecture) !== JSON.stringify(inspection.architecture)) throw new Error('Motionscaper native architecture receipt differs from its binary.');
	await validateSoundscaperProfessionalNativeDependencyClosure({ target: receipt.target,
		artifacts: [receipt.payload], runtimeArtifacts: [], root,
		inspectDependencies: (): Promise<Omit<Inspection, 'artifactPath'>> => Promise.resolve(inspection),
	});
	const notices = await pinnedFile(root, receipt.notices, 2 * 1024 * 1024);
	const expectedNotices = `${await readFile(join(options.repositoryRoot, MOTION_NATIVE_SOURCE_ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')}\n\n${await readFile(join(options.repositoryRoot, 'native/framescaper-media-host/THIRD_PARTY_NOTICES.md'), 'utf8')}`;
	if (!notices.equals(Buffer.from(expectedNotices))) throw new Error('Motionscaper native notices omit the exact codec closure.');
	return { resultRoot: root, receipt, receiptSha256: sha(bytes) };
}
function parseReceipt(input: unknown, target: MotionNativeTarget): MotionNativeBuildReceipt {
	const value = record(input, RECEIPT_KEYS);
	if (value.schemaVersion !== 1 || value.productId !== 'motionscaper' || value.helperContractVersion !== 1
		|| value.carrierVersion !== 1) throw new Error('Motionscaper native receipt identity is invalid.');
	if (value.target !== target) throw new Error('Motionscaper native receipt target is invalid.');
	if (typeof value.sourceRevision !== 'string' || !/^[a-f\d]{40}$/u.test(value.sourceRevision)) throw new Error('Motionscaper native source revision is invalid.');
	for (const field of ['sourceManifestSha256', 'dependencySourceSha256', 'dependencyRecipeSha256', 'toolchainIdentity', 'buildCommandsSha256']) digest(value[field]);
	const payload = pin(value.payload, `motionscaper-media-host${target.startsWith('win-') ? '.exe' : ''}`);
	const notices = pin(value.notices, 'THIRD_PARTY_NOTICES.md');
	if (JSON.stringify(value.precision) !== JSON.stringify(MOTION_NATIVE_PRECISION)) throw new Error('Motionscaper native precision disclosure is invalid.');
	if (JSON.stringify(value.selfTest) !== JSON.stringify(MOTION_NATIVE_SELF_TEST)) throw new Error('Motionscaper native helper capability is invalid.');
	if (!Array.isArray(value.dependencyInspections) || value.dependencyInspections.length !== 1) throw new Error('Motionscaper native dependency evidence is incomplete.');
	const inspection = record(value.dependencyInspections[0], ['artifactPath', 'architecture', 'imports', 'rpaths']);
	if (inspection.artifactPath !== payload.path) throw new Error('Motionscaper native dependency identity is invalid.');
	const imports = stringList(inspection.imports); const rpaths = stringList(inspection.rpaths);
	if (rpaths.length !== 0) throw new Error('Motionscaper native helper has an unexpected runtime search path.');
	if (!Array.isArray(value.tests) || value.tests.length !== 2) throw new Error('Motionscaper native test evidence is incomplete.');
	const tests = value.tests.map((item: unknown, index: number): TestEvidence => {
		const entry = record(item, ['id', 'status', 'outputSha256']);
		const id = index === 0 ? 'motionscaper-native-ctest' : 'motionscaper-native-self-test';
		if (entry.id !== id || entry.status !== 'passed') throw new Error('Motionscaper native test evidence did not pass.');
		return { id, status: 'passed', outputSha256: digest(entry.outputSha256) };
	});
	return { schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1, target,
		sourceRevision: value.sourceRevision, sourceManifestSha256: digest(value.sourceManifestSha256),
		dependencySourceSha256: digest(value.dependencySourceSha256), dependencyRecipeSha256: digest(value.dependencyRecipeSha256),
		toolchainIdentity: digest(value.toolchainIdentity), buildCommandsSha256: digest(value.buildCommandsSha256),
		payload, notices, precision: MOTION_NATIVE_PRECISION, selfTest: MOTION_NATIVE_SELF_TEST,
		dependencyInspections: [{ artifactPath: payload.path, architecture: inspection.architecture, imports, rpaths }], tests,
	};
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('Motionscaper native receipt fields are not closed.');
	return value as Record<string, unknown>;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new Error('Motionscaper native digest is invalid.'); return value;
}
function pin(value: unknown, path: string): MotionNativeFilePin {
	const entry = record(value, ['path', 'byteLength', 'sha256']);
	if (entry.path !== path || typeof entry.byteLength !== 'number' || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1) throw new Error('Motionscaper native artifact pin is invalid.');
	return { path, byteLength: entry.byteLength, sha256: digest(entry.sha256) };
}
function stringList(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length > 256 || value.some(item => typeof item !== 'string' || item.length < 1 || item.length > 1024)) throw new Error('Motionscaper native dependency list is invalid.');
	return value as string[];
}
async function pinnedFile(root: string, pin: MotionNativeFilePin, maximum: number): Promise<Buffer> {
	const bytes = await boundedFile(join(root, pin.path), maximum);
	if (bytes.byteLength !== pin.byteLength || sha(bytes) !== pin.sha256) throw new Error('Motionscaper native artifact digest differs from its pin.'); return bytes;
}
async function boundedFile(path: string, maximum: number): Promise<Buffer> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum || await realpath(path) !== path) throw new Error('Motionscaper native artifact is not one bounded regular file.');
	const bytes = await readFile(path); const after = await lstat(path);
	if (bytes.byteLength !== before.size || after.ino !== before.ino || after.dev !== before.dev
		|| after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size) throw new Error('Motionscaper native artifact changed while reading.'); return bytes;
}
function sha(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
