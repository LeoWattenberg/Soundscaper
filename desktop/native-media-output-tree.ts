/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated, self-describing publication trees for professional still sequences. */

import { createHash } from 'node:crypto';
import { lstat, opendir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import type { NativeMediaV14EncodeProfileId } from '../src/common/editor/native-media-v14-native-dispatch.ts';
import {
	acquireNativeMediaDirectoryLease,
	acquireNativeMediaFileLease,
	type NativeMediaDirectoryLease,
	type NativeMediaFileIdentity,
} from './native-media-filesystem-lease.ts';

export const NATIVE_MEDIA_OUTPUT_TREE_MANIFEST = 'framescaper-output-tree-v1.json';
export const NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_FILES = 2_000_001;
export const NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_MANIFEST_BYTES = 256 * 1024 ** 2;
export const NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_BYTES = 16 * 1024 ** 4;

const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
const GRANT_ID = /^[a-f0-9]{16,64}$/u;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const SEQUENCE_PROFILES = Object.freeze({
	'encode-png-sequence': 'png',
	'encode-tiff-sequence': 'tiff',
	'encode-openexr-sequence': 'exr',
} as const);

export type NativeMediaOutputTreeProfileId = keyof typeof SEQUENCE_PROFILES;

export interface NativeMediaOutputTreeIdentityV1 {
	readonly kind: 'framescaper-native-output-tree-v1';
	readonly jobId: string;
	readonly planFingerprint: string;
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly sourceInventorySha256: string;
	readonly profileId: NativeMediaOutputTreeProfileId;
	readonly frameCount: number;
	readonly extension: 'png' | 'tiff' | 'exr';
}

export interface NativeMediaOutputTreeFileV1 {
	readonly relativePath: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface NativeMediaOutputTreeSummaryV1 {
	readonly identity: NativeMediaOutputTreeIdentityV1;
	readonly fileCount: number;
	readonly manifestByteLength: number;
	readonly manifestSha256: string;
}

export function admitNativeMediaOutputTreeSummary(
	value: unknown,
	expectedIdentity?: NativeMediaOutputTreeIdentityV1,
): NativeMediaOutputTreeSummaryV1 {
	const row = plainRecord(value, ['identity', 'fileCount', 'manifestByteLength', 'manifestSha256']);
	const identity = admitNativeMediaOutputTreeIdentity(row.identity);
	if (expectedIdentity && JSON.stringify(identity) !== JSON.stringify(expectedIdentity)) invalid('tree summary identity');
	const fileCount = boundedCount(row.fileCount, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_FILES, 'file count');
	const manifestByteLength = boundedCount(
		row.manifestByteLength, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_MANIFEST_BYTES, 'manifest length',
	);
	if (fileCount !== identity.frameCount + 1 || manifestByteLength < 1
		|| typeof row.manifestSha256 !== 'string' || !SHA256.test(row.manifestSha256)) {
		invalid('tree summary');
	}
	return Object.freeze({ identity, fileCount, manifestByteLength, manifestSha256: row.manifestSha256 });
}

export interface NativeMediaAuthenticatedOutputTree {
	readonly kind: 'directory';
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<NativeMediaFileIdentity>;
	readonly tree: NativeMediaOutputTreeSummaryV1;
}

export interface NativeMediaOutputTreeLease {
	readonly path: string;
	readonly authenticated: NativeMediaAuthenticatedOutputTree;
	revalidate(): Promise<void>;
	close(): Promise<void>;
}

interface OutputTreeRequest {
	readonly path: string;
	readonly maximumBytes: number;
	readonly identity: NativeMediaOutputTreeIdentityV1;
	readonly manifestSha256?: string;
	readonly directoryIdentity?: Readonly<NativeMediaFileIdentity>;
	readonly nativeManifestSha256?: string;
}

export function createNativeMediaOutputTreeIdentity(input: Readonly<{
	readonly jobId: string;
	readonly planFingerprint: string;
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly sources: readonly Readonly<{ readonly sourceId: string; readonly contentSha256: string }>[];
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly frameCount: number;
}>): NativeMediaOutputTreeIdentityV1 {
	if (!JOB_ID.test(input.jobId) || !SHA256.test(input.planFingerprint)
		|| !GRANT_ID.test(input.rootGrantId)) invalid('identity');
	const extension = SEQUENCE_PROFILES[input.profileId as NativeMediaOutputTreeProfileId];
	if (!extension) invalid('profile');
	const frameCount = boundedCount(input.frameCount, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_FILES - 1, 'frame count');
	if (frameCount < 1 || !Array.isArray(input.sources) || input.sources.length < 1
		|| input.sources.length > 4_096) invalid('source inventory');
	const seen = new Set<string>();
	const sources = input.sources.map((source) => {
		if (!SOURCE_ID.test(source.sourceId) || !SHA256.test(source.contentSha256)
			|| seen.has(source.sourceId)) invalid('source inventory');
		seen.add(source.sourceId);
		return Object.freeze({ sourceId: source.sourceId, contentSha256: source.contentSha256 });
	});
	return Object.freeze({
		kind: 'framescaper-native-output-tree-v1', jobId: input.jobId,
		planFingerprint: input.planFingerprint, rootGrantId: input.rootGrantId,
		relativeDestination: assertNativeMediaRelativeDestination(input.relativeDestination),
		sourceInventorySha256: digest(Buffer.from(JSON.stringify(sources))),
		profileId: input.profileId as NativeMediaOutputTreeProfileId, frameCount, extension,
	});
}

/** Validate the host manifest and add the main/helper-authenticated tree manifest exclusively. */
export async function sealNativeMediaOutputTree(
	requestValue: OutputTreeRequest,
): Promise<NativeMediaAuthenticatedOutputTree> {
	const request = admittedRequest(requestValue);
	const directory = await acquireNativeMediaDirectoryLease({ path: request.path });
	try {
		await assertManifestAbsent(request.path);
		const files = await inspectNativeSequenceFiles(
			request.path, request.identity, request.maximumBytes, request.nativeManifestSha256,
		);
		const contentByteLength = safeSum(files.map(({ byteLength }) => byteLength), request.maximumBytes);
		const manifest = Object.freeze({
			schemaVersion: 1, identity: request.identity,
			fileCount: files.length, contentByteLength, files,
		});
		const bytes = Buffer.from(JSON.stringify(manifest));
		if (bytes.byteLength > NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_MANIFEST_BYTES
			|| safeSum([contentByteLength, bytes.byteLength], request.maximumBytes) > request.maximumBytes) {
			invalid('manifest bound');
		}
		await writeFile(join(request.path, NATIVE_MEDIA_OUTPUT_TREE_MANIFEST), bytes, {
			flag: 'wx', mode: 0o600,
		});
		await directory.revalidate();
		const lease = await acquireNativeMediaOutputTreeLease({
			...request, manifestSha256: digest(bytes), directoryIdentity: directory.identity,
		});
		try { return lease.authenticated; } finally { await lease.close(); }
	} finally {
		await directory.close();
	}
}

export async function acquireNativeMediaOutputTreeLease(
	requestValue: OutputTreeRequest,
): Promise<NativeMediaOutputTreeLease> {
	const request = admittedRequest(requestValue);
	const directory = await acquireNativeMediaDirectoryLease({
		path: request.path, ...(request.directoryIdentity ? { identity: request.directoryIdentity } : {}),
	});
	try {
		const authenticated = await inspectSealedTree(request, directory);
		return new HeldOutputTreeLease(request, directory, authenticated);
	} catch (error) {
		await directory.close().catch(() => undefined);
		throw error;
	}
}

/** Main-side inspection uses the self-authenticated identity carried by the manifest. */
export async function inspectNativeMediaOutputTree(path: string): Promise<NativeMediaAuthenticatedOutputTree> {
	const { bytes, authenticated: manifest } = await authenticatedBytes(
		join(path, NATIVE_MEDIA_OUTPUT_TREE_MANIFEST), NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_MANIFEST_BYTES,
	);
	const parsed = parsedRecord(bytes, ['schemaVersion', 'identity', 'fileCount', 'contentByteLength', 'files']);
	const identity = admitNativeMediaOutputTreeIdentity(parsed.identity);
	const request = admittedRequest({
		path, maximumBytes: NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_BYTES,
		identity, manifestSha256: manifest.sha256,
	});
	const directory = await acquireNativeMediaDirectoryLease({ path });
	try { return await inspectSealedTree(request, directory); }
	finally { await directory.close(); }
}

class HeldOutputTreeLease implements NativeMediaOutputTreeLease {
	readonly path: string;
	readonly authenticated: NativeMediaAuthenticatedOutputTree;
	readonly #request: OutputTreeRequest;
	readonly #directory: NativeMediaDirectoryLease;
	#closed = false;
	constructor(request: OutputTreeRequest, directory: NativeMediaDirectoryLease,
		authenticated: NativeMediaAuthenticatedOutputTree) {
		this.path = request.path; this.#request = request;
		this.#directory = directory; this.authenticated = authenticated;
	}
	async revalidate(): Promise<void> {
		if (this.#closed) invalid('closed lease');
		await this.#directory.revalidate();
		const observed = await inspectSealedTree(this.#request, this.#directory);
		if (JSON.stringify(observed) !== JSON.stringify(this.authenticated)) invalid('lease identity');
	}
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true; await this.#directory.close();
	}
}

async function inspectSealedTree(
	request: OutputTreeRequest,
	directory: NativeMediaDirectoryLease,
): Promise<NativeMediaAuthenticatedOutputTree> {
	await directory.revalidate();
	const manifestPath = join(request.path, NATIVE_MEDIA_OUTPUT_TREE_MANIFEST);
	const { bytes, authenticated: manifest } = await authenticatedBytes(
		manifestPath, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_MANIFEST_BYTES,
	);
	if (request.manifestSha256 !== undefined && request.manifestSha256 !== manifest.sha256) {
		invalid('manifest digest');
	}
	const parsed = parsedRecord(bytes, ['schemaVersion', 'identity', 'fileCount', 'contentByteLength', 'files']);
	if (parsed.schemaVersion !== 1 || JSON.stringify(admitNativeMediaOutputTreeIdentity(parsed.identity))
		!== JSON.stringify(request.identity)) invalid('manifest identity');
	const files = admittedFiles(parsed.files, request.identity);
	const contentBytes = safeSum(files.map(({ byteLength }) => byteLength), request.maximumBytes);
	if (parsed.fileCount !== files.length || parsed.contentByteLength !== contentBytes) invalid('manifest aggregate');
	await assertExactDirectory(request.path, [...files.map(({ relativePath }) => relativePath),
		NATIVE_MEDIA_OUTPUT_TREE_MANIFEST]);
	for (const file of files) {
		const lease = await acquireNativeMediaFileLease({
			path: containedFile(request.path, file.relativePath), byteLength: file.byteLength,
			sha256: file.sha256,
		});
		try { await lease.revalidate(); } finally { await lease.close(); }
	}
	const byteLength = safeSum([contentBytes, manifest.byteLength], request.maximumBytes);
	await directory.revalidate();
	return Object.freeze({
		kind: 'directory', byteLength, sha256: manifest.sha256,
		identity: directory.identity,
		tree: Object.freeze({
			identity: request.identity, fileCount: files.length,
			manifestByteLength: manifest.byteLength, manifestSha256: manifest.sha256,
		}),
	});
}

async function inspectNativeSequenceFiles(path: string, identity: NativeMediaOutputTreeIdentityV1,
	maximumBytes: number, expectedManifestSha256?: string): Promise<readonly NativeMediaOutputTreeFileV1[]> {
	const nativeName = 'manifest.json';
	const native = await authenticatedBytes(containedFile(path, nativeName),
		Math.min(maximumBytes, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_MANIFEST_BYTES));
	if (expectedManifestSha256 && native.authenticated.sha256 !== expectedManifestSha256) {
		invalid('native image-sequence manifest digest');
	}
	const parsed = parsedRecord(native.bytes, ['schemaVersion', 'profileId', 'frameCount', 'frames']);
	if (parsed.schemaVersion !== 1 || parsed.profileId !== identity.profileId
		|| parsed.frameCount !== identity.frameCount || !Array.isArray(parsed.frames)
		|| parsed.frames.length !== identity.frameCount) invalid('native image-sequence manifest');
	const files: NativeMediaOutputTreeFileV1[] = [];
	for (let ordinal = 0; ordinal < identity.frameCount; ordinal += 1) {
		const row = plainRecord(parsed.frames[ordinal], ['ordinal', 'fileName', 'byteLength', 'sha256']);
		const relativePath = frameName(ordinal, identity.extension);
		if (row.ordinal !== ordinal || row.fileName !== relativePath) invalid('native image-sequence file inventory');
		const byteLength = boundedCount(row.byteLength, maximumBytes, 'frame length');
		if (typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) invalid('native image-sequence digest');
		const lease = await acquireNativeMediaFileLease({
			path: containedFile(path, relativePath), byteLength, sha256: row.sha256,
		});
		try { await lease.revalidate(); } finally { await lease.close(); }
		files.push(Object.freeze({ relativePath, byteLength, sha256: row.sha256 }));
	}
	files.push(Object.freeze({
		relativePath: nativeName, byteLength: native.authenticated.byteLength,
		sha256: native.authenticated.sha256,
	}));
	await assertExactDirectory(path, files.map(({ relativePath }) => relativePath));
	safeSum(files.map(({ byteLength }) => byteLength), maximumBytes);
	return Object.freeze(files);
}

function admittedFiles(value: unknown, identity: NativeMediaOutputTreeIdentityV1): readonly NativeMediaOutputTreeFileV1[] {
	if (!Array.isArray(value) || value.length !== identity.frameCount + 1
		|| value.length > NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_FILES) invalid('manifest file inventory');
	return Object.freeze(value.map((entry, index) => {
		const row = plainRecord(entry, ['relativePath', 'byteLength', 'sha256']);
		const expected = index === identity.frameCount ? 'manifest.json' : frameName(index, identity.extension);
		if (row.relativePath !== expected || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
			invalid('manifest file inventory');
		}
		return Object.freeze({
			relativePath: expected,
			byteLength: boundedCount(row.byteLength, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_BYTES, 'file length'),
			sha256: row.sha256,
		});
	}));
}

export function admitNativeMediaOutputTreeIdentity(value: unknown): NativeMediaOutputTreeIdentityV1 {
	const row = plainRecord(value, ['kind', 'jobId', 'planFingerprint', 'rootGrantId',
		'relativeDestination', 'sourceInventorySha256', 'profileId', 'frameCount', 'extension']);
	const extension = SEQUENCE_PROFILES[row.profileId as NativeMediaOutputTreeProfileId];
	if (row.kind !== 'framescaper-native-output-tree-v1' || typeof row.jobId !== 'string'
		|| !JOB_ID.test(row.jobId) || typeof row.planFingerprint !== 'string' || !SHA256.test(row.planFingerprint)
		|| typeof row.rootGrantId !== 'string' || !GRANT_ID.test(row.rootGrantId)
		|| typeof row.sourceInventorySha256 !== 'string' || !SHA256.test(row.sourceInventorySha256)
		|| !extension || row.extension !== extension) invalid('manifest identity');
	return Object.freeze({
		kind: 'framescaper-native-output-tree-v1', jobId: row.jobId,
		planFingerprint: row.planFingerprint, rootGrantId: row.rootGrantId,
		relativeDestination: assertNativeMediaRelativeDestination(row.relativeDestination as string),
		sourceInventorySha256: row.sourceInventorySha256,
		profileId: row.profileId as NativeMediaOutputTreeProfileId,
		frameCount: boundedCount(row.frameCount, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_FILES - 1, 'frame count'),
		extension,
	});
}

function admittedRequest(value: OutputTreeRequest): OutputTreeRequest {
	if (!value || typeof value.path !== 'string' || !isAbsolute(value.path)
		|| value.path.includes('\0') || resolve(value.path) !== value.path) invalid('path');
	const maximumBytes = boundedCount(value.maximumBytes, NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_BYTES, 'maximum bytes');
	if (maximumBytes < 1) invalid('maximum bytes');
	const identity = admitNativeMediaOutputTreeIdentity(value.identity);
	if (value.manifestSha256 !== undefined && !SHA256.test(value.manifestSha256)) invalid('manifest digest');
	if (value.nativeManifestSha256 !== undefined && !SHA256.test(value.nativeManifestSha256)) {
		invalid('native manifest digest');
	}
	return Object.freeze({
		path: value.path, maximumBytes, identity,
		...(value.manifestSha256 ? { manifestSha256: value.manifestSha256 } : {}),
		...(value.directoryIdentity ? { directoryIdentity: value.directoryIdentity } : {}),
		...(value.nativeManifestSha256 ? { nativeManifestSha256: value.nativeManifestSha256 } : {}),
	});
}

async function authenticatedBytes(path: string, maximumBytes: number) {
	const lease = await acquireNativeMediaFileLease({ path, maximumBytes });
	try {
		const bytes = await readFile(path);
		if (bytes.byteLength !== lease.authenticated.byteLength
			|| digest(bytes) !== lease.authenticated.sha256) invalid('manifest changed during read');
		await lease.revalidate();
		return Object.freeze({ bytes, authenticated: lease.authenticated });
	} finally { await lease.close(); }
}

async function assertExactDirectory(path: string, expected: readonly string[]): Promise<void> {
	const names: string[] = [];
	const directory = await opendir(path);
	try {
		for await (const entry of directory) {
			if (!FILE_NAME.test(entry.name)) invalid('file inventory');
			const stat = await lstat(containedFile(path, entry.name));
			if (stat.isSymbolicLink() || !stat.isFile()) invalid('regular file inventory');
			names.push(entry.name);
			if (names.length > NATIVE_MEDIA_OUTPUT_TREE_MAXIMUM_FILES + 1) invalid('file count');
		}
	} finally { await directory.close().catch(() => undefined); }
	if (JSON.stringify(names.sort()) !== JSON.stringify([...expected].sort())) invalid('file inventory');
}

function containedFile(root: string, name: string): string {
	if (!FILE_NAME.test(name)) invalid('contained file name');
	const path = resolve(root, name);
	const child = relative(root, path);
	if (!child || child !== name || child.startsWith('..') || isAbsolute(child)) invalid('containment');
	return path;
}

function frameName(ordinal: number, extension: string): string {
	return `frame-${String(ordinal).padStart(8, '0')}.${extension}`;
}

async function assertManifestAbsent(path: string): Promise<void> {
	try { await lstat(join(path, NATIVE_MEDIA_OUTPUT_TREE_MANIFEST)); invalid('existing tree manifest'); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function parsedRecord(bytes: Uint8Array, fields: readonly string[]): Record<string, unknown> {
	let value: unknown;
	try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; }
	catch { return invalid('manifest JSON'); }
	return plainRecord(value, fields);
}

function plainRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		invalid('manifest record');
	}
	return value as Record<string, unknown>;
}

function boundedCount(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) invalid(label);
	return Number(value);
}

function safeSum(values: readonly number[], maximum: number): number {
	let total = 0;
	for (const value of values) {
		total += value;
		if (!Number.isSafeInteger(total) || total > maximum) invalid('aggregate byte bound');
	}
	return total;
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function invalid(label: string): never { throw new Error(`The native media output tree has invalid ${label}.`); }
