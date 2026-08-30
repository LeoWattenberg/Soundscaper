/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy-verify-settings-swap relocation for a complete authenticated model store. */

import { createHash } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import {
	copyFile,
	lstat,
	mkdir,
	open,
	readdir,
	rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { LocalModelCapacity } from './local-model-capacity.ts';
import { FileLocalModelStore, isLocalModelDirectorySyncErrorBenign } from './local-model-store.ts';

const STORE_DIRECTORIES = Object.freeze(['blobs', 'manifests', 'staging'] as const);
const BLOB_NAME_PATTERN = /^sha256-([a-f\d]{64})$/u;
const MODEL_MANIFEST_PATTERN = /^([a-z\d][a-z\d.-]{0,62}[a-z\d])\.json$/u;
const PARTIAL_NAME_PATTERN = /^(?:sha256-[a-f\d]{64}|[a-f\d]{32})\.part$/u;

export type LocalModelRelocationCopyFile = (
	source: string,
	target: string,
	mode: number,
) => PromiseLike<void> | void;

export interface LocalModelRelocationOptions {
	readonly source: FileLocalModelStore;
	readonly targetDirectory: string;
	/** Must commit atomically or reject without changing the setting. */
	readonly persistTarget: (targetDirectory: string) => PromiseLike<void> | void;
	readonly capacity?: LocalModelCapacity;
	readonly copyFileImpl?: LocalModelRelocationCopyFile;
	readonly removeSourceImpl?: (sourceDirectory: string) => PromiseLike<void> | void;
}

export interface LocalModelRelocationResult {
	readonly modelsDirectory: string;
	readonly totalBytes: number;
	readonly fileCount: number;
	readonly sourceRemoved: boolean;
}

interface StoreFileSnapshot {
	readonly relativePath: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface StoreSnapshot {
	readonly files: readonly StoreFileSnapshot[];
	readonly totalBytes: number;
}

const DEFAULT_CAPACITY = new LocalModelCapacity();

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function isWithin(parent: string, child: string): boolean {
	const relation = relative(parent, child);
	return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function targetPath(sourceRoot: string, value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError('A local-model relocation target must be absolute.');
	}
	const target = resolve(value);
	if (isWithin(sourceRoot, target) || isWithin(target, sourceRoot)) {
		throw new Error('Local-model source and target directories must not overlap or be nested.');
	}
	return target;
}

async function assertAbsent(path: string): Promise<void> {
	try {
		await lstat(path);
		throw new Error('The local-model relocation target already exists; target collision refused.');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return;
		throw error;
	}
}

async function digestOf(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
	return hash.digest('hex');
}

async function syncPath(path: string): Promise<void> {
	let handle = null;
	try {
		handle = await open(path, 'r');
		await handle.sync();
	} catch (error) {
		if (!isLocalModelDirectorySyncErrorBenign(error)) throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

function validOwnedFile(directory: typeof STORE_DIRECTORIES[number], name: string): boolean {
	if (directory === 'blobs') return BLOB_NAME_PATTERN.test(name);
	if (directory === 'manifests') return MODEL_MANIFEST_PATTERN.test(name);
	return PARTIAL_NAME_PATTERN.test(name);
}

async function authenticateStoreSnapshot(store: FileLocalModelStore): Promise<StoreSnapshot> {
	const rootMetadata = await lstat(store.rootPath);
	if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
		throw new Error('The local-model source root must be a regular non-symbolic directory.');
	}
	const rootEntries = await readdir(store.rootPath, { withFileTypes: true });
	const rootNames = rootEntries.map(({ name }) => name).sort();
	if (rootNames.length !== STORE_DIRECTORIES.length
		|| STORE_DIRECTORIES.some((name) => !rootNames.includes(name))) {
		throw new Error('The authenticated local-model store contains unexpected root content.');
	}
	const files: StoreFileSnapshot[] = [];
	let totalBytes = 0;
	for (const directory of STORE_DIRECTORIES) {
		const directoryEntry = rootEntries.find(({ name }) => name === directory);
		if (!directoryEntry?.isDirectory() || directoryEntry.isSymbolicLink()) {
			throw new Error(`The authenticated local-model ${directory} directory is invalid.`);
		}
		const absoluteDirectory = join(store.rootPath, directory);
		const entries = await readdir(absoluteDirectory, { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (!entry.isFile() || entry.isSymbolicLink() || !validOwnedFile(directory, entry.name)) {
				throw new Error(`The authenticated local-model store rejects unexpected ${directory} content.`);
			}
			const absolutePath = join(absoluteDirectory, entry.name);
			const metadata = await lstat(absolutePath);
			if (!metadata.isFile() || metadata.isSymbolicLink()) {
				throw new Error('A local-model relocation source file is not regular.');
			}
			const sha256 = await digestOf(absolutePath);
			if (directory === 'blobs' && BLOB_NAME_PATTERN.exec(entry.name)?.[1] !== sha256) {
				throw new Error(`The local-model source blob ${entry.name} does not match its digest name.`);
			}
			const nextTotal = totalBytes + metadata.size;
			if (!Number.isSafeInteger(nextTotal)) {
				throw new RangeError('The local-model relocation snapshot exceeds the safe byte domain.');
			}
			totalBytes = nextTotal;
			files.push(Object.freeze({
				relativePath: join(directory, entry.name), byteLength: metadata.size, sha256,
			}));
		}
	}
	for (const file of files.filter(({ relativePath }) => relativePath.startsWith(`manifests${sep}`))) {
		const name = file.relativePath.slice('manifests'.length + 1);
		const modelId = MODEL_MANIFEST_PATTERN.exec(name)?.[1];
		if (!modelId) throw new Error('The authenticated local-model manifest name is invalid.');
		let manifest;
		try {
			manifest = await store.readManifest(modelId);
		} catch (error) {
			throw new Error(`The local-model source manifest ${name} is invalid.`, { cause: error });
		}
		if (!manifest || manifest.modelId !== modelId) {
			throw new Error(`The local-model source manifest ${name} does not bind its file name.`);
		}
		for (const artifact of manifest.artifacts) {
			if (!await store.verifyArtifact(artifact)) {
				throw new Error(`The local-model source manifest ${name} references unauthenticated bytes.`);
			}
		}
	}
	return Object.freeze({ files: Object.freeze(files), totalBytes });
}

function snapshotsEqual(left: StoreSnapshot, right: StoreSnapshot): boolean {
	return left.totalBytes === right.totalBytes
		&& left.files.length === right.files.length
		&& left.files.every((file, index) => {
			const candidate = right.files[index];
			return candidate?.relativePath === file.relativePath
				&& candidate.byteLength === file.byteLength
				&& candidate.sha256 === file.sha256;
		});
}

async function copySnapshot(
	source: FileLocalModelStore,
	target: FileLocalModelStore,
	snapshot: StoreSnapshot,
	copyFileImpl: LocalModelRelocationCopyFile,
	consume: (byteLength: number) => unknown,
): Promise<void> {
	for (const directory of STORE_DIRECTORIES) {
		await mkdir(join(target.rootPath, directory), { mode: 0o700 });
	}
	for (const file of snapshot.files) {
		const destination = join(target.rootPath, file.relativePath);
		await copyFileImpl(join(source.rootPath, file.relativePath), destination, fsConstants.COPYFILE_EXCL);
		consume(file.byteLength);
		await syncPath(destination);
	}
	for (const directory of STORE_DIRECTORIES) await syncPath(join(target.rootPath, directory));
	await syncPath(target.rootPath);
}

/**
 * Settings are the final authority swap. Before that callback, the source is
 * unchanged and a failed/corrupt destination is removed. A post-swap source
 * cleanup failure deliberately leaves a verified duplicate instead of rolling
 * back the now-valid target.
 */
export async function relocateLocalModelStore(
	options: LocalModelRelocationOptions,
): Promise<LocalModelRelocationResult> {
	const source = options.source;
	const targetDirectory = targetPath(source.rootPath, options.targetDirectory);
	await assertAbsent(targetDirectory);
	await source.initialize();
	const sourceSnapshot = await authenticateStoreSnapshot(source);
	const targetParent = dirname(targetDirectory);
	await mkdir(targetParent, { recursive: true, mode: 0o700 });
	const reservation = await (options.capacity ?? DEFAULT_CAPACITY)
		.reserve(targetParent, sourceSnapshot.totalBytes);
	let targetCreated = false;
	let settingsPersisted = false;
	try {
		await mkdir(targetDirectory, { mode: 0o700 });
		targetCreated = true;
		const target = new FileLocalModelStore(targetDirectory);
		await copySnapshot(
			source,
			target,
			sourceSnapshot,
			options.copyFileImpl ?? copyFile,
			(byteLength) => reservation.consume(byteLength),
		);
		const destinationSnapshot = await authenticateStoreSnapshot(target);
		if (!snapshotsEqual(sourceSnapshot, destinationSnapshot)) {
			throw new Error('Local-model destination verification does not match its authenticated source.');
		}
		const stableSourceSnapshot = await authenticateStoreSnapshot(source);
		if (!snapshotsEqual(sourceSnapshot, stableSourceSnapshot)) {
			throw new Error('The local-model source changed during relocation; settings were not updated.');
		}
		await options.persistTarget(targetDirectory);
		settingsPersisted = true;
		let sourceRemoved = true;
		try {
			await (options.removeSourceImpl ?? ((path: string) => rm(path, { recursive: true, force: false })))(
				source.rootPath,
			);
		} catch {
			sourceRemoved = false;
		}
		return Object.freeze({
			modelsDirectory: targetDirectory,
			totalBytes: sourceSnapshot.totalBytes,
			fileCount: sourceSnapshot.files.length,
			sourceRemoved,
		});
	} catch (error) {
		if (targetCreated && !settingsPersisted) {
			try {
				await rm(targetDirectory, { recursive: true, force: true });
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], 'Local-model relocation and target cleanup failed.');
			}
		}
		throw error;
	} finally {
		reservation.release();
	}
}
