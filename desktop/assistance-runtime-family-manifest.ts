/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU-only payload contracts for the additional Milestone 7 runtimes. */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import {
	lstat, open, readdir, realpath,
} from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve } from 'node:path';

export const ASSISTANCE_RUNTIME_FAMILY_MANIFEST_SCHEMA_VERSION = 1;
export const ASSISTANCE_RUNTIME_FAMILY_TARGETS = Object.freeze([
	'mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64',
] as const);

const GIB = 1024 ** 3;

export const ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS = Object.freeze({
	'onnxruntime-node': Object.freeze({
		runtimeVersion: '1.29.0',
		sourceUrl: 'https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.29.0.tgz',
		sourceRevision: '1.29.0',
		loader: 'node-module' as const,
		minimumSystemMemoryBytes: 0,
	}),
	'whisper-cpp': Object.freeze({
		runtimeVersion: 'v1.9.3',
		sourceUrl: 'https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.3',
		sourceRevision: 'v1.9.3',
		loader: 'executable' as const,
		minimumSystemMemoryBytes: 0,
	}),
	'llama-cpp': Object.freeze({
		runtimeVersion: 'b10509',
		sourceUrl: 'https://github.com/ggml-org/llama.cpp',
		sourceRevision: 'b10509',
		loader: 'executable' as const,
		minimumSystemMemoryBytes: 16 * GIB,
	}),
});

export type AssistanceRuntimeFamilyId = keyof typeof ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS;
export type AssistanceRuntimeFamilyTargetId = (typeof ASSISTANCE_RUNTIME_FAMILY_TARGETS)[number];

export interface AssistanceRuntimeFamilyFileV1 {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly executable: boolean;
}

export interface AssistanceRuntimeFamilyAuthenticatedTargetV1 {
	readonly id: AssistanceRuntimeFamilyTargetId;
	readonly status: 'authenticated';
	readonly entrypoint: string;
	readonly files: readonly AssistanceRuntimeFamilyFileV1[];
}

export interface AssistanceRuntimeFamilyPendingTargetV1 {
	readonly id: AssistanceRuntimeFamilyTargetId;
	readonly status: 'pending-external';
	readonly blockedBy: string;
}

export type AssistanceRuntimeFamilyTargetV1 =
	| AssistanceRuntimeFamilyAuthenticatedTargetV1
	| AssistanceRuntimeFamilyPendingTargetV1;

export interface AssistanceRuntimeFamilyManifestV1 {
	readonly schemaVersion: typeof ASSISTANCE_RUNTIME_FAMILY_MANIFEST_SCHEMA_VERSION;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly runtimeVersion: string;
	readonly source: Readonly<{ readonly url: string; readonly revision: string }>;
	readonly executionProvider: 'cpu';
	readonly runtimePrefix: string;
	readonly targets: readonly AssistanceRuntimeFamilyTargetV1[];
}

export interface AssistanceRuntimeFamilyDescriptorFile extends AssistanceRuntimeFamilyFileV1 {
	readonly relativePath: string;
	readonly path: string;
}

export interface AssistanceRuntimeFamilyDescriptor {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly runtimeVersion: string;
	readonly target: AssistanceRuntimeFamilyTargetId;
	readonly executionProvider: 'cpu';
	readonly entrypoint: string;
	readonly files: readonly AssistanceRuntimeFamilyDescriptorFile[];
}

export type AssistanceRuntimeFamilyUnavailableReason =
	| 'unsupported-platform'
	| 'manifest-missing'
	| 'manifest-invalid'
	| 'payload-pending-external'
	| 'payload-missing'
	| 'payload-digest-mismatch'
	| 'insufficient-system-memory';

export type AssistanceRuntimeFamilyAvailability =
	| Readonly<{ readonly status: 'available'; readonly descriptor: AssistanceRuntimeFamilyDescriptor }>
	| Readonly<{
		readonly status: 'unavailable';
		readonly reason: AssistanceRuntimeFamilyUnavailableReason;
		readonly detail: string;
	}>;

export interface AssistanceRuntimeFamilyAvailabilityOptions {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly manifest: unknown;
	readonly runtimeRoot: string;
	readonly platform?: string;
	readonly architecture?: string;
	readonly totalMemoryBytes: number;
}

const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_FILE_BYTES = 16 * GIB;
const MAXIMUM_FILES = 512;
const MANIFEST_KEYS = Object.freeze([
	'schemaVersion', 'familyId', 'runtimeVersion', 'source', 'executionProvider',
	'runtimePrefix', 'targets',
]);

export function assistanceRuntimeFamilyTargetFor(
	platform: string,
	architecture: string,
): AssistanceRuntimeFamilyTargetId | null {
	const operatingSystem = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	const target = `${operatingSystem}-${architecture}`;
	return (ASSISTANCE_RUNTIME_FAMILY_TARGETS as readonly string[]).includes(target)
		? target as AssistanceRuntimeFamilyTargetId : null;
}

export function validateAssistanceRuntimeFamilyManifestV1(
	value: unknown,
): AssistanceRuntimeFamilyManifestV1 {
	const record = exactRecord(value, MANIFEST_KEYS, 'runtime-family manifest');
	if (record.schemaVersion !== ASSISTANCE_RUNTIME_FAMILY_MANIFEST_SCHEMA_VERSION
		|| typeof record.familyId !== 'string'
		|| !Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, record.familyId)) {
		throw new TypeError('The runtime-family manifest identity or version is invalid.');
	}
	const familyId = record.familyId as AssistanceRuntimeFamilyId;
	const definition = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId];
	const source = exactRecord(record.source, ['url', 'revision'], 'runtime-family source');
	if (record.runtimeVersion !== definition.runtimeVersion
		|| source.url !== definition.sourceUrl || source.revision !== definition.sourceRevision
		|| record.executionProvider !== 'cpu'
		|| record.runtimePrefix !== `assistance/${familyId}/${definition.runtimeVersion}`) {
		throw new TypeError('The runtime-family manifest must bind the reviewed version, source, prefix, and CPU provider.');
	}
	if (!Array.isArray(record.targets) || record.targets.length !== ASSISTANCE_RUNTIME_FAMILY_TARGETS.length) {
		throw new TypeError('The runtime-family manifest target inventory is not exact.');
	}
	const byId = new Map<AssistanceRuntimeFamilyTargetId, AssistanceRuntimeFamilyTargetV1>();
	for (const candidate of record.targets) {
		const target = validateTarget(candidate, definition.loader);
		if (byId.has(target.id)) throw new TypeError('The runtime-family manifest repeats a target.');
		byId.set(target.id, target);
	}
	if (ASSISTANCE_RUNTIME_FAMILY_TARGETS.some((id) => !byId.has(id))) {
		throw new TypeError('The runtime-family manifest target inventory is not exact.');
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_RUNTIME_FAMILY_MANIFEST_SCHEMA_VERSION,
		familyId,
		runtimeVersion: definition.runtimeVersion,
		source: Object.freeze({ url: definition.sourceUrl, revision: definition.sourceRevision }),
		executionProvider: 'cpu',
		runtimePrefix: record.runtimePrefix as string,
		targets: Object.freeze(ASSISTANCE_RUNTIME_FAMILY_TARGETS.map((id) => byId.get(id)!)),
	});
}

export async function describeAssistanceRuntimeFamilyAvailability(
	options: AssistanceRuntimeFamilyAvailabilityOptions,
): Promise<AssistanceRuntimeFamilyAvailability> {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	const targetId = assistanceRuntimeFamilyTargetFor(platform, architecture);
	if (targetId === null) {
		return unavailable('unsupported-platform',
			`${platform}-${architecture} is not a Milestone 7 CPU runtime target.`);
	}
	if (options.manifest === null || options.manifest === undefined) {
		return unavailable('manifest-missing',
			`The ${options.familyId} runtime has no admitted payload manifest.`);
	}
	let manifest: AssistanceRuntimeFamilyManifestV1;
	try {
		manifest = validateAssistanceRuntimeFamilyManifestV1(options.manifest);
		if (manifest.familyId !== options.familyId) {
			throw new TypeError('The runtime manifest belongs to a different family.');
		}
	} catch (error) {
		return unavailable('manifest-invalid', errorMessage(error));
	}
	const target = manifest.targets.find(({ id }) => id === targetId)!;
	if (target.status === 'pending-external') {
		return unavailable('payload-pending-external', target.blockedBy);
	}
	const minimumMemory = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[manifest.familyId]
		.minimumSystemMemoryBytes;
	if (!Number.isSafeInteger(options.totalMemoryBytes) || options.totalMemoryBytes < 1
		|| options.totalMemoryBytes < minimumMemory) {
		return unavailable('insufficient-system-memory',
			`${manifest.familyId} requires at least ${String(minimumMemory)} bytes of system memory.`);
	}
	let root: string;
	try {
		root = absoluteRoot(options.runtimeRoot);
	} catch (error) {
		return unavailable('manifest-invalid', errorMessage(error));
	}
	const targetRoot = resolve(root, manifest.runtimePrefix, targetId);
	try {
		const files = await verifyTargetClosure(targetRoot, target.files);
		return Object.freeze({
			status: 'available' as const,
			descriptor: Object.freeze({
				familyId: manifest.familyId,
				runtimeVersion: manifest.runtimeVersion,
				target: targetId,
				executionProvider: 'cpu' as const,
				entrypoint: resolve(targetRoot, target.entrypoint),
				files,
			}),
		});
	} catch (error) {
		return unavailable(isMissingError(error) ? 'payload-missing' : 'payload-digest-mismatch',
			`The ${manifest.familyId} ${targetId} payload failed authentication: ${errorMessage(error)}`);
	}
}

function validateTarget(
	value: unknown,
	loader: 'node-module' | 'executable',
): AssistanceRuntimeFamilyTargetV1 {
	if (!plainRecord(value) || typeof value.id !== 'string'
		|| !(ASSISTANCE_RUNTIME_FAMILY_TARGETS as readonly string[]).includes(value.id)) {
		throw new TypeError('A runtime-family target identity is invalid.');
	}
	const id = value.id as AssistanceRuntimeFamilyTargetId;
	if (value.status === 'pending-external') {
		exactKeys(value, ['id', 'status', 'blockedBy'], 'pending runtime-family target');
		if (typeof value.blockedBy !== 'string' || value.blockedBy.trim().length < 24
			|| value.blockedBy.length > 1_024) {
			throw new TypeError('A pending runtime-family target needs one bounded external blocker.');
		}
		return Object.freeze({ id, status: 'pending-external', blockedBy: value.blockedBy });
	}
	if (value.status !== 'authenticated') throw new TypeError('A runtime-family target status is invalid.');
	exactKeys(value, ['id', 'status', 'entrypoint', 'files'], 'authenticated runtime-family target');
	const entrypoint = relativePayloadPath(value.entrypoint, 'entrypoint');
	if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAXIMUM_FILES) {
		throw new TypeError('An authenticated runtime-family target file inventory is invalid.');
	}
	const files = value.files.map(validateFile);
	if (new Set(files.map(({ path }) => path)).size !== files.length) {
		throw new TypeError('An authenticated runtime-family target repeats a file.');
	}
	const entryFile = files.find(({ path }) => path === entrypoint);
	if (!entryFile || entryFile.executable !== (loader === 'executable')) {
		throw new TypeError('The runtime-family entrypoint is absent or has the wrong execution kind.');
	}
	return Object.freeze({ id, status: 'authenticated', entrypoint, files: Object.freeze(files) });
}

function validateFile(value: unknown): AssistanceRuntimeFamilyFileV1 {
	const record = exactRecord(value, ['path', 'byteLength', 'sha256', 'executable'],
		'runtime-family file');
	const path = relativePayloadPath(record.path, 'file');
	if (!Number.isSafeInteger(record.byteLength) || (record.byteLength as number) < 1
		|| (record.byteLength as number) > MAXIMUM_FILE_BYTES
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)
		|| typeof record.executable !== 'boolean') {
		throw new TypeError('A runtime-family file descriptor is invalid.');
	}
	return Object.freeze({
		path, byteLength: record.byteLength as number, sha256: record.sha256,
		executable: record.executable,
	});
}

async function verifyTargetClosure(
	targetRoot: string,
	expected: readonly AssistanceRuntimeFamilyFileV1[],
): Promise<readonly AssistanceRuntimeFamilyDescriptorFile[]> {
	await regularDirectory(targetRoot, 'runtime-family target root');
	const inventory = await inventoryFiles(targetRoot);
	const expectedPaths = expected.map(({ path }) => path).sort();
	if (JSON.stringify(inventory.files) !== JSON.stringify(expectedPaths)) {
		throw new Error('The runtime-family payload file inventory is not exact.');
	}
	const expectedDirectories = new Set(expectedPaths.flatMap(parentDirectories));
	if (inventory.directories.some((path) => !expectedDirectories.has(path))) {
		throw new Error('The runtime-family payload contains an unlisted directory.');
	}
	return Object.freeze(await Promise.all(expected.map(async (file) => {
		const absolutePath = resolve(targetRoot, file.path);
		await verifyFile(absolutePath, file);
		return Object.freeze({ ...file, relativePath: file.path, path: absolutePath });
	})));
}

async function inventoryFiles(
	root: string,
	directory = '',
	depth = 0,
): Promise<Readonly<{ files: string[]; directories: string[] }>> {
	if (depth > 12) throw new Error('The runtime-family payload directory depth is excessive.');
	const entries = await readdir(resolve(root, directory), { withFileTypes: true });
	const files: string[] = [];
	const directories: string[] = [];
	for (const entry of entries) {
		const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
		if (entry.isSymbolicLink()) throw new Error('The runtime-family payload contains a symbolic link.');
		if (entry.isFile()) files.push(path);
		else if (entry.isDirectory()) {
			directories.push(path);
			const nested = await inventoryFiles(root, path, depth + 1);
			files.push(...nested.files); directories.push(...nested.directories);
		} else throw new Error('The runtime-family payload contains a non-regular entry.');
		if (files.length + directories.length > MAXIMUM_FILES * 2) {
			throw new Error('The runtime-family payload inventory is excessive.');
		}
	}
	return { files: files.sort(), directories: directories.sort() };
}

async function verifyFile(path: string, descriptor: AssistanceRuntimeFamilyFileV1): Promise<void> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size !== descriptor.byteLength) {
		throw new Error('A runtime-family payload file type or length is invalid.');
	}
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error('A runtime-family payload file changed while opening.');
		}
		const hash = createHash('sha256');
		let bytes = 0;
		for await (const chunk of handle.createReadStream({ autoClose: false })) {
			bytes += chunk.byteLength;
			if (bytes > descriptor.byteLength) break;
			hash.update(chunk);
		}
		const after = await handle.stat();
		if (bytes !== descriptor.byteLength || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
			|| hash.digest('hex') !== descriptor.sha256) {
			throw new Error('A runtime-family payload file digest is invalid.');
		}
	} finally {
		await handle?.close();
	}
}

async function regularDirectory(path: string, label: string): Promise<void> {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`The ${label} is not a canonical regular directory.`);
	}
}

function parentDirectories(path: string): string[] {
	const values: string[] = [];
	let parent = posix.dirname(path);
	while (parent !== '.') { values.push(parent); parent = posix.dirname(parent); }
	return values;
}

function relativePayloadPath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 240
		|| value.includes('\\') || posix.isAbsolute(value) || posix.normalize(value) !== value
		|| value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
		throw new TypeError(`The runtime-family ${label} path is unsafe.`);
	}
	return value;
}

function absoluteRoot(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| relative(value, resolve(value)) !== '') {
		throw new TypeError('The runtime-family root must be an absolute normalized path.');
	}
	return value;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!plainRecord(value)) throw new TypeError(`The ${label} must be a plain record.`);
	exactKeys(value, keys, label);
	return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(value);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} carries unsupported fields.`);
	}
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function unavailable(
	reason: AssistanceRuntimeFamilyUnavailableReason,
	detail: string,
): AssistanceRuntimeFamilyAvailability {
	return Object.freeze({ status: 'unavailable' as const, reason, detail });
}

function isMissingError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
