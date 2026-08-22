/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import {
	link, lstat, open, opendir, realpath, rm, unlink,
} from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import type {
	FramescaperNativePublicationPort,
	FramescaperNativePublishedFileObservation,
	NativeImageSequenceCheckpointFrameV1,
} from './native-services-publication.ts';
import {
	createFramescaperNativeFilesystemCheckpointStore,
	type FramescaperNativeCheckpointStore,
} from './native-services-checkpoint-recovery.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootObservation,
	FramescaperNativeRootSelection,
} from './native-services-root-repository.ts';
import type { FramescaperNativeScratchCleanupPort } from './native-services-scratch-repository.ts';
import type {
	FramescaperNativeWatchEntry,
	FramescaperNativeWatchProbeResult,
} from './native-services-watch-repository.ts';
import type {
	FramescaperNativeWatchLinkedLocator,
} from './native-services-watch-import-broker.ts';

const MAXIMUM_SCAN_ENTRIES = 100_000;
const MAXIMUM_MANIFEST_BYTES = 65_536;
const SCRATCH_DIRECTORY = /^job-[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface FramescaperNativeServicesNodePortsOptions {
	readonly scratchRoot: string;
	readonly selectDirectory: () => Promise<string | null>;
	readonly watchLocator?: FramescaperNativeWatchLocatorAuthority;
	readonly now?: () => number;
	readonly mintOpaqueId?: () => string;
}

export interface FramescaperNativeWatchLocatorAuthority {
	readonly registerPath: (path: string, options: Readonly<{
		owner: object;
		displayName: string;
	}>) => Promise<FramescaperNativeWatchLinkedLocator>;
	readonly release: (
		locator: Readonly<{ locatorId: string; locatorRevision: string }>,
		owner: object,
	) => Promise<boolean>;
}

export interface FramescaperNativeServicesNodePorts {
	readonly mintOpaqueId: () => string;
	readonly selectRoot: () => Promise<FramescaperNativeRootSelection | null>;
	readonly probeRoot: (grant: FramescaperNativeRootGrant) => Promise<FramescaperNativeRootObservation>;
	readonly watchScan: (
		rule: WatchRuleV1,
		root: FramescaperNativeRootGrant,
	) => Promise<readonly FramescaperNativeWatchEntry[]>;
	readonly watchProbe: (entry: FramescaperNativeWatchEntry) => Promise<FramescaperNativeWatchProbeResult>;
	readonly watchRegisterLocator: (
		entry: FramescaperNativeWatchEntry,
		contentSha256: string,
		owner: object,
	) => Promise<FramescaperNativeWatchLinkedLocator>;
	readonly watchReleaseLocator: FramescaperNativeWatchLocatorAuthority['release'];
	readonly scratchCleanup: FramescaperNativeScratchCleanupPort;
	readonly publicationPortFor: (grant: FramescaperNativeRootGrant) => FramescaperNativePublicationPort;
	readonly checkpointInspectFor: (
		grant: FramescaperNativeRootGrant,
	) => (frame: NativeImageSequenceCheckpointFrameV1) => Promise<Readonly<{
		byteLength: number;
		sha256: string;
		symbolicLink: boolean;
	}> | null>;
	readonly checkpointStore: FramescaperNativeCheckpointStore;
}

/** Node filesystem seams kept wholly in Electron main; no absolute path crosses IPC. */
export function createFramescaperNativeServicesNodePorts(
	options: FramescaperNativeServicesNodePortsOptions,
): FramescaperNativeServicesNodePorts {
	const scratchRoot = absoluteCanonicalPath(options.scratchRoot, 'scratch root');
	const now = options.now ?? (() => Date.now());
	const mintOpaqueId = options.mintOpaqueId ?? (() => randomBytes(20).toString('hex'));
	const watchPaths = new Map<string, Readonly<{
		path: string;
		sizeBytes: number;
		modifiedAtMs: number;
	}>>();

	const selectRoot = async (): Promise<FramescaperNativeRootSelection | null> => {
		const selected = await options.selectDirectory();
		if (selected === null) return null;
		const selectedPath = absoluteCanonicalPath(selected, 'selected durable root');
		const selectedStat = await lstat(selectedPath, { bigint: true });
		if (selectedStat.isSymbolicLink()) {
			throw new Error('A native durable root cannot be selected through a symbolic link.');
		}
		if (!selectedStat.isDirectory()) throw new Error('A native durable root must be a directory.');
		const canonicalPath = absoluteCanonicalPath(await realpath(selectedPath), 'selected durable root');
		const stat = await lstat(canonicalPath, { bigint: true });
		if (!stat.isDirectory() || stat.isSymbolicLink()) {
			throw new Error('A native durable root must resolve to a regular directory.');
		}
		return Object.freeze({
			grantId: opaqueId(mintOpaqueId()),
			rootPath: canonicalPath,
			volumeIdentity: volumeIdentity(stat.dev),
			directoryIdentity: directoryIdentity(stat.dev, stat.ino),
			authorizedAtMs: timestamp(now()),
		});
	};

	const probeRoot = async (
		grant: FramescaperNativeRootGrant,
	): Promise<FramescaperNativeRootObservation> => {
		try {
			const stat = await lstat(grant.rootPath, { bigint: true });
			const canonicalPath = absoluteCanonicalPath(await realpath(grant.rootPath), 'observed durable root');
			return Object.freeze({
				exists: true,
				directory: stat.isDirectory(),
				symbolicLink: stat.isSymbolicLink(),
				canonicalPath,
				volumeIdentity: volumeIdentity(stat.dev),
				directoryIdentity: directoryIdentity(stat.dev, stat.ino),
			});
		} catch (error) {
			if (!missing(error)) throw error;
			return Object.freeze({
				exists: false, directory: false, symbolicLink: false,
				canonicalPath: grant.rootPath,
				volumeIdentity: grant.volumeIdentity,
				directoryIdentity: grant.directoryIdentity,
			});
		}
	};

	const watchScan = async (
		_rule: WatchRuleV1,
		root: FramescaperNativeRootGrant,
	): Promise<readonly FramescaperNativeWatchEntry[]> => {
		await assertDirectoryIdentity(root);
		watchPaths.clear();
		const entries: FramescaperNativeWatchEntry[] = [];
		const directory = await opendir(root.rootPath);
		try {
			for await (const directoryEntry of directory) {
				if (entries.length >= MAXIMUM_SCAN_ENTRIES) {
					throw new RangeError('A native watch directory exceeds its entry ceiling.');
				}
				const entryPath = join(root.rootPath, directoryEntry.name);
				const stat = await lstat(entryPath, { bigint: true });
				const entry = Object.freeze({
					name: boundedName(directoryEntry.name),
					fileIdentity: directoryIdentity(stat.dev, stat.ino),
					sizeBytes: safeBigInt(stat.size, 'watch entry size'),
					modifiedAtMs: safeBigInt(stat.mtimeMs, 'watch entry modification time'),
					isDirectory: stat.isDirectory(),
					symbolicLink: stat.isSymbolicLink(),
				});
				entries.push(entry);
				if (!entry.isDirectory && !entry.symbolicLink) {
					watchPaths.set(entry.fileIdentity, Object.freeze({
						path: entryPath,
						sizeBytes: entry.sizeBytes,
						modifiedAtMs: entry.modifiedAtMs,
					}));
				}
			}
		} finally {
			await directory.close().catch(() => undefined);
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));
		return Object.freeze(entries);
	};

	const watchProbe = async (
		entry: FramescaperNativeWatchEntry,
	): Promise<FramescaperNativeWatchProbeResult> => {
		const expected = watchPaths.get(entry.fileIdentity);
		if (!expected || expected.sizeBytes !== entry.sizeBytes
			|| expected.modifiedAtMs !== entry.modifiedAtMs) return failedProbe();
		try {
			const stat = await lstat(expected.path, { bigint: true });
			if (!stat.isFile() || stat.isSymbolicLink()
				|| directoryIdentity(stat.dev, stat.ino) !== entry.fileIdentity
				|| safeBigInt(stat.size, 'watch probe size') !== entry.sizeBytes
				|| safeBigInt(stat.mtimeMs, 'watch probe modification time') !== entry.modifiedAtMs) {
				return failedProbe();
			}
			const observed = await inspectRegularFile(expected.path);
			return Object.freeze({ succeeded: true, contentSha256: observed.sha256 });
		} catch (error) {
			if (missing(error) || changedDuringRead(error)) return failedProbe();
			throw error;
		}
	};

	const watchRegisterLocator = async (
		entry: FramescaperNativeWatchEntry,
		contentSha256: string,
		owner: object,
	): Promise<FramescaperNativeWatchLinkedLocator> => {
		if (!options.watchLocator) throw new Error('The main-private watch locator authority is unavailable.');
		if (!SHA256.test(contentSha256)) throw new TypeError('A watch locator requires an exact SHA-256 digest.');
		const expected = watchPaths.get(entry.fileIdentity);
		const before = await watchProbe(entry);
		if (!expected || !before.succeeded || before.contentSha256 !== contentSha256) {
			throw new Error('The watched file changed before locator registration.');
		}
		const locator = await options.watchLocator.registerPath(expected.path, {
			owner, displayName: entry.name,
		});
		try {
			const after = await watchProbe(entry);
			if (!after.succeeded || after.contentSha256 !== contentSha256
				|| locator.name !== entry.name || locator.size !== entry.sizeBytes
				|| locator.lastModified !== entry.modifiedAtMs) {
				throw new Error('The watched file changed during locator registration.');
			}
			return pathlessWatchLocator(locator);
		} catch (error) {
			await options.watchLocator.release(locator, owner).catch(() => false);
			throw error;
		}
	};

	const scratchCleanup: FramescaperNativeScratchCleanupPort = Object.freeze({
		inspect: async (directoryName: string) => inspectScratchManifest(scratchRoot, directoryName),
		remove: async (directoryName: string) => {
			const directoryPath = scratchDirectoryPath(scratchRoot, directoryName);
			const stat = await lstat(directoryPath);
			if (!stat.isDirectory() || stat.isSymbolicLink()) {
				throw new Error('Native scratch cleanup refuses a non-directory or symbolic link.');
			}
			await rm(directoryPath, { recursive: true, force: false });
		},
	});

	const publicationPortFor = (
		grant: FramescaperNativeRootGrant,
	): FramescaperNativePublicationPort => Object.freeze({
		inspect: (relativePath: string) => inspectGrantedFile(grant, relativePath),
		renameTemporarySibling: async (temporaryRelativePath: string, relativeDestination: string) => {
			const temporary = await grantedPath(grant, temporaryRelativePath, true);
			const destination = await grantedPath(grant, relativeDestination, false);
			if (dirname(temporary) !== dirname(destination)) {
				throw new Error('Native publication requires a same-directory temporary sibling.');
			}
			if ((await lstat(temporary)).isSymbolicLink()) {
				throw new Error('Native publication refuses a symbolic-link temporary sibling.');
			}
			try {
				await lstat(destination);
				throw new Error('Native publication refuses to replace an existing destination.');
			} catch (error) {
				if (!missing(error)) throw error;
			}
			await link(temporary, destination);
			await unlink(temporary);
		},
		removePublishedOutput: async (
			relativeDestination: string,
			expected: FramescaperNativePublishedFileObservation,
		) => {
			const observed = await inspectGrantedFile(grant, relativeDestination);
			if (observed === null || observed.symbolicLink
				|| observed.byteLength !== expected.byteLength || observed.sha256 !== expected.sha256) {
				throw new Error('Native publication cleanup refuses an output whose identity changed.');
			}
			await unlink(await grantedPath(grant, relativeDestination, true));
		},
	});

	return Object.freeze({
		mintOpaqueId,
		selectRoot,
		probeRoot,
		watchScan,
		watchProbe,
		watchRegisterLocator,
		watchReleaseLocator: (
			locator: Readonly<{ locatorId: string; locatorRevision: string }>,
			owner: object,
		) => {
			if (!options.watchLocator) return Promise.resolve(false);
			return options.watchLocator.release(locator, owner);
		},
		scratchCleanup,
		publicationPortFor,
		checkpointInspectFor: (grant: FramescaperNativeRootGrant) => (
			frame: NativeImageSequenceCheckpointFrameV1,
		) => inspectGrantedFile(grant, frame.relativePath),
		checkpointStore: createFramescaperNativeFilesystemCheckpointStore(scratchRoot),
	});
}

function pathlessWatchLocator(value: FramescaperNativeWatchLinkedLocator): FramescaperNativeWatchLinkedLocator {
	const fields = ['locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified'];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('The watch locator authority returned a non-pathless result.');
	}
	return Object.freeze({ ...value });
}

async function inspectScratchManifest(
	scratchRoot: string,
	directoryName: string,
): Promise<Readonly<{ jobId: string; manifestDigest: string; rootIdentity: string }> | null> {
	const directoryPath = scratchDirectoryPath(scratchRoot, directoryName);
	try {
		const directoryStat = await lstat(directoryPath);
		if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return null;
		const manifestPath = join(directoryPath, 'manifest.json');
		const bytes = await readSmallRegularFile(manifestPath, MAXIMUM_MANIFEST_BYTES);
		const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
		if (!plainExactRecord(parsed, ['jobId', 'manifestDigest', 'rootIdentity'])) return null;
		if (typeof parsed.jobId !== 'string' || directoryName !== `job-${parsed.jobId}`
			|| typeof parsed.manifestDigest !== 'string' || !SHA256.test(parsed.manifestDigest)
			|| typeof parsed.rootIdentity !== 'string' || parsed.rootIdentity.length === 0
			|| parsed.rootIdentity.length > 256 || parsed.rootIdentity.includes('\0')) return null;
		return Object.freeze({
			jobId: parsed.jobId,
			manifestDigest: parsed.manifestDigest,
			rootIdentity: parsed.rootIdentity,
		});
	} catch (error) {
		if (missing(error) || error instanceof SyntaxError) return null;
		throw error;
	}
}

async function inspectGrantedFile(
	grant: FramescaperNativeRootGrant,
	relativePath: string,
): Promise<Readonly<{ byteLength: number; sha256: string; symbolicLink: boolean }> | null> {
	const path = await grantedPath(grant, relativePath, false);
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			return Object.freeze({ byteLength: 0, sha256: '0'.repeat(64), symbolicLink: true });
		}
		if (!stat.isFile()) throw new Error('A native media output must be a regular file.');
		return Object.freeze({ ...await inspectRegularFile(path), symbolicLink: false });
	} catch (error) {
		if (missing(error)) return null;
		throw error;
	}
}

async function grantedPath(
	grant: FramescaperNativeRootGrant,
	relativePath: string,
	requireTarget: boolean,
): Promise<string> {
	await assertDirectoryIdentity(grant);
	const relativeDestination = publicationRelativePath(relativePath);
	const target = resolve(grant.rootPath, ...relativeDestination.split('/'));
	if (relative(grant.rootPath, target).startsWith('..') || isAbsolute(relative(grant.rootPath, target))) {
		throw new Error('A native media path escaped its durable root.');
	}
	const parts = relativeDestination.split('/');
	let current = grant.rootPath;
	for (let index = 0; index < parts.length; index += 1) {
		current = join(current, parts[index]!);
		try {
			const stat = await lstat(current);
			if (stat.isSymbolicLink()) throw new Error('A native media path contains a symbolic link.');
			if (index < parts.length - 1 && !stat.isDirectory()) {
				throw new Error('A native media path parent is not a directory.');
			}
		} catch (error) {
			if (!missing(error) || requireTarget || index < parts.length - 1) throw error;
			break;
		}
	}
	return target;
}

async function assertDirectoryIdentity(grant: FramescaperNativeRootGrant): Promise<void> {
	const stat = await lstat(grant.rootPath, { bigint: true });
	if (!stat.isDirectory() || stat.isSymbolicLink()
		|| volumeIdentity(stat.dev) !== grant.volumeIdentity
		|| directoryIdentity(stat.dev, stat.ino) !== grant.directoryIdentity
		|| await realpath(grant.rootPath) !== grant.rootPath) {
		throw new Error('The native durable root no longer matches its authorized identity.');
	}
}

async function inspectRegularFile(path: string): Promise<Readonly<{ byteLength: number; sha256: string }>> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile()) throw new Error('A native service input must be a regular file.');
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let position = 0;
		while (true) {
			const result = await handle.read(buffer, 0, buffer.length, position);
			if (result.bytesRead === 0) break;
			hash.update(buffer.subarray(0, result.bytesRead));
			position += result.bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || BigInt(position) !== after.size) {
			throw new Error('A native service file changed during verification.');
		}
		return Object.freeze({
			byteLength: safeBigInt(after.size, 'verified file length'),
			sha256: hash.digest('hex'),
		});
	} finally {
		await handle.close();
	}
}

async function readSmallRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > maximumBytes) throw new Error('A native manifest is not a bounded regular file.');
		const bytes = Buffer.alloc(stat.size);
		const result = await handle.read(bytes, 0, bytes.length, 0);
		if (result.bytesRead !== bytes.length) throw new Error('A native manifest changed during inspection.');
		return bytes;
	} finally {
		await handle.close();
	}
}

function scratchDirectoryPath(scratchRoot: string, directoryName: string): string {
	if (!SCRATCH_DIRECTORY.test(directoryName)) {
		throw new TypeError('A native scratch cleanup path must be a deterministic job directory.');
	}
	return join(scratchRoot, directoryName);
}

function publicationRelativePath(value: string): string {
	if (typeof value === 'string') {
		const temporary = /^(.*)\.[a-f0-9]{16}\.partial$/u.exec(value);
		if (temporary) {
			assertNativeMediaRelativeDestination(temporary[1]);
			return value;
		}
	}
	return assertNativeMediaRelativeDestination(value);
}

function absoluteCanonicalPath(value: string, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || normalize(value) !== value) {
		throw new TypeError(`The native-services ${label} must be an absolute normalized path.`);
	}
	return value;
}

function opaqueId(value: string): string {
	if (!/^[a-f0-9]{16,64}$/u.test(value)) throw new TypeError('A native-services id mint returned an invalid id.');
	return value;
}

function boundedName(value: string): string {
	if (value.length === 0 || value.length > 255 || value.includes('\0') || /[\\/]/u.test(value)) {
		throw new TypeError('A native watch entry has an invalid name.');
	}
	return value;
}

function volumeIdentity(device: bigint): string {
	return `device:${device.toString(16)}`;
}

function directoryIdentity(device: bigint, inode: bigint): string {
	return `${volumeIdentity(device)}:inode:${inode.toString(16)}`;
}

function safeBigInt(value: bigint, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`A native ${label} is out of range.`);
	return number;
}

function timestamp(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('A native-services timestamp is invalid.');
	return value;
}

function failedProbe(): FramescaperNativeWatchProbeResult {
	return Object.freeze({ succeeded: false, contentSha256: null });
}

function missing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error
		&& (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}

function changedDuringRead(error: unknown): boolean {
	return error instanceof Error && error.message === 'A native service file changed during verification.';
}

function plainExactRecord(
	value: unknown,
	fields: readonly string[],
): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype
		&& Object.keys(value).sort().join('|') === [...fields].sort().join('|'));
}
