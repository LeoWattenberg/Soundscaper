/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated ownership and bounded cleanup for durable selected-V20 V7/V8 input stages. */

import { constants } from 'node:fs';
import {
	lstat, mkdir, open, readdir, realpath, rmdir, unlink,
} from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS,
	nativeRenderInputClosedRecord,
	nativeRenderInputDigest,
	nativeRenderInputDigestValue,
	nativeRenderInputNonNegative,
	nativeRenderInputSafeSum,
	nativeRenderInputStageId,
} from './native-services-render-input-contract.ts';

const OWNERSHIP_FILE = /^stage-([a-f0-9]{40})\.ownership\.json$/u;
const MAXIMUM_OWNERSHIP_BYTES = 4 * 1_024;
const OWNED_STAGE_FILES = new Set([
	'input-00.frames',
	'input-00.wav',
	'input-01.wav',
	'manifest.json',
	'manifest.sha256',
	'claimed.json',
]);

interface NativeRenderInputStageOwnershipBodyV1 {
	readonly stageVersion: 1;
	readonly stageId: string;
	readonly createdAtMs: number;
	readonly expiresAtMs: number;
	readonly declaredByteLength: number;
	readonly identityDigest: string;
	readonly bindingDigest: string;
}

export interface NativeRenderInputStageOwnershipV1
	extends NativeRenderInputStageOwnershipBodyV1 {
	readonly authenticator: string;
}

export interface NativeRenderInputOwnedStage {
	readonly root: string;
	readonly ownership: NativeRenderInputStageOwnershipV1;
	readonly ownershipPath: string;
	readonly directory: string;
	readonly directoryPresent: boolean;
	readonly claimedMarkerPresent: boolean;
}

export function createNativeRenderInputStageOwnership(
	stageIdValue: string,
	createdAtMsValue: number,
	declaredByteLengthValue: number,
	identityDigestValue: string,
	bindingDigestValue: string,
): NativeRenderInputStageOwnershipV1 {
	const createdAtMs = nativeRenderInputNonNegative(createdAtMsValue, 'stage creation time');
	const body: NativeRenderInputStageOwnershipBodyV1 = Object.freeze({
		stageVersion: 1,
		stageId: nativeRenderInputStageId(stageIdValue),
		createdAtMs,
		expiresAtMs: nativeRenderInputSafeSum(
			createdAtMs,
			FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS,
		),
		declaredByteLength: nativeRenderInputNonNegative(
			declaredByteLengthValue,
			'stage declared byte length',
		),
		identityDigest: nativeRenderInputDigestValue(identityDigestValue, 'stage identity'),
		bindingDigest: nativeRenderInputDigestValue(bindingDigestValue, 'stage binding'),
	});
	return Object.freeze({
		...body,
		authenticator: nativeRenderInputDigest(JSON.stringify(body)),
	});
}

/** Persist ownership before creating the directory, closing the unauthenticated-dir crash window. */
export async function createNativeRenderInputOwnedStage(
	rootValue: string,
	ownership: NativeRenderInputStageOwnershipV1,
): Promise<NativeRenderInputOwnedStage> {
	const root = await requireNativeRenderInputRoot(rootValue, true);
	const exact = nativeRenderInputStageOwnership(ownership);
	const ownershipPath = nativeRenderInputOwnershipPath(root, exact.stageId);
	const directory = nativeRenderInputStageDirectory(root, exact.stageId);
	let wroteOwnership = false;
	let createdDirectory = false;
	try {
		await writeExclusiveSynced(ownershipPath, JSON.stringify(exact));
		wroteOwnership = true;
		await mkdir(directory, { recursive: false, mode: 0o700 });
		createdDirectory = true;
		await requireExactStageDirectory(directory);
		return Object.freeze({
			root,
			ownership: exact,
			ownershipPath,
			directory,
			directoryPresent: true,
			claimedMarkerPresent: false,
		});
	} catch (error) {
		if (wroteOwnership && !createdDirectory) await unlink(ownershipPath).catch(() => undefined);
		throw error;
	}
}

export async function listNativeRenderInputOwnedStages(
	rootValue: string,
): Promise<readonly NativeRenderInputOwnedStage[]> {
	const root = await requireNativeRenderInputRoot(rootValue, true);
	const entries = await readdir(root, { withFileTypes: true });
	const stages: NativeRenderInputOwnedStage[] = [];
	for (const entry of entries) {
		const match = OWNERSHIP_FILE.exec(entry.name);
		if (!match) continue;
		if (!entry.isFile() || entry.isSymbolicLink()) {
			throw new Error('A native render-input ownership record is not one regular file.');
		}
		const stageId = nativeRenderInputStageId(match[1]);
		const owned = await readNativeRenderInputOwnedStage(root, stageId);
		if (owned === null) throw new Error('A native render-input ownership record disappeared.');
		stages.push(owned);
	}
	stages.sort((left, right) => left.ownership.stageId.localeCompare(right.ownership.stageId));
	return Object.freeze(stages);
}

export async function readNativeRenderInputOwnedStage(
	rootValue: string,
	stageIdValue: string,
): Promise<NativeRenderInputOwnedStage | null> {
	const root = await requireNativeRenderInputRoot(rootValue, true);
	const stageId = nativeRenderInputStageId(stageIdValue);
	const ownershipPath = nativeRenderInputOwnershipPath(root, stageId);
	let ownership: NativeRenderInputStageOwnershipV1;
	try {
		ownership = nativeRenderInputStageOwnership(
			JSON.parse((await readBoundedRegularFile(ownershipPath)).toString('utf8')) as unknown,
		);
	} catch (error) {
		if (missing(error)) return null;
		throw error;
	}
	if (ownership.stageId !== stageId) {
		throw new Error('A native render-input ownership record changed stage identity.');
	}
	const directory = nativeRenderInputStageDirectory(root, stageId);
	let directoryPresent = false;
	try {
		await requireExactStageDirectory(directory);
		directoryPresent = true;
	} catch (error) {
		if (!missing(error)) throw error;
	}
	const claimedMarkerPresent = directoryPresent
		? await regularFilePresent(join(directory, 'claimed.json'))
		: false;
	return Object.freeze({
		root, ownership, ownershipPath, directory, directoryPresent, claimedMarkerPresent,
	});
}

/** Delete only the exact regular files admitted under a main-authenticated ownership sidecar. */
export async function removeNativeRenderInputOwnedStage(
	stage: NativeRenderInputOwnedStage,
): Promise<void> {
	const reread = await readNativeRenderInputOwnedStage(
		stage.root,
		stage.ownership.stageId,
	);
	if (reread === null) return;
	if (JSON.stringify(reread.ownership) !== JSON.stringify(stage.ownership)) {
		throw new Error('A native render-input ownership record changed before reclamation.');
	}
	if (reread.directoryPresent) {
		const entries = await readdir(reread.directory, { withFileTypes: true });
		if (entries.length > OWNED_STAGE_FILES.size) {
			throw new Error('A native render-input stage contains an unsupported entry.');
		}
		for (const entry of entries) {
			if (!OWNED_STAGE_FILES.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
				throw new Error('A native render-input stage contains an unauthenticated entry.');
			}
			const path = join(reread.directory, entry.name);
			const details = await lstat(path);
			if (!details.isFile() || details.isSymbolicLink()) {
				throw new Error('A native render-input stage entry changed filesystem type.');
			}
		}
		for (const entry of entries) await unlink(join(reread.directory, entry.name));
		await rmdir(reread.directory);
	}
	const sidecar = await lstat(reread.ownershipPath);
	if (!sidecar.isFile() || sidecar.isSymbolicLink()) {
		throw new Error('A native render-input ownership record changed filesystem type.');
	}
	await unlink(reread.ownershipPath);
}

export function nativeRenderInputStageDirectory(root: string, stageIdValue: string): string {
	return join(root, `stage-${nativeRenderInputStageId(stageIdValue)}`);
}

export async function requireNativeRenderInputRoot(
	value: string,
	create: boolean,
): Promise<string> {
	if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value
		|| value.includes('\0')) {
		throw new TypeError('The native render-input staging root must be an absolute normalized path.');
	}
	if (create) await mkdir(value, { recursive: true, mode: 0o700 });
	// Resolve once here so that every path below is derived from the canonical root, which
	// is what lets the stage directories be checked against their exact expected spelling.
	return requireExactDirectory(value);
}

function nativeRenderInputStageOwnership(value: unknown): NativeRenderInputStageOwnershipV1 {
	const row = nativeRenderInputClosedRecord(value, [
		'stageVersion', 'stageId', 'createdAtMs', 'expiresAtMs', 'declaredByteLength',
		'identityDigest', 'bindingDigest', 'authenticator',
	], 'render-input ownership record');
	if (row.stageVersion !== 1) {
		throw new TypeError('A native render-input ownership record has an unsupported version.');
	}
	const body: NativeRenderInputStageOwnershipBodyV1 = Object.freeze({
		stageVersion: 1,
		stageId: nativeRenderInputStageId(row.stageId),
		createdAtMs: nativeRenderInputNonNegative(row.createdAtMs, 'stage creation time'),
		expiresAtMs: nativeRenderInputNonNegative(row.expiresAtMs, 'stage expiry time'),
		declaredByteLength: nativeRenderInputNonNegative(
			row.declaredByteLength,
			'stage declared byte length',
		),
		identityDigest: nativeRenderInputDigestValue(row.identityDigest, 'stage identity'),
		bindingDigest: nativeRenderInputDigestValue(row.bindingDigest, 'stage binding'),
	});
	if (body.expiresAtMs !== nativeRenderInputSafeSum(
		body.createdAtMs,
		FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS,
	) || row.authenticator !== nativeRenderInputDigest(JSON.stringify(body))) {
		throw new Error('A native render-input ownership record failed authentication.');
	}
	const ownership = Object.freeze({
		...body,
		authenticator: nativeRenderInputDigestValue(row.authenticator, 'stage ownership'),
	});
	if (JSON.stringify(ownership) !== JSON.stringify(value)) {
		throw new Error('A native render-input ownership record is not canonical.');
	}
	return ownership;
}

async function readBoundedRegularFile(path: string): Promise<Buffer> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const details = await handle.stat();
		if (!details.isFile() || details.size < 1 || details.size > MAXIMUM_OWNERSHIP_BYTES) {
			throw new Error('A native render-input ownership record exceeds its byte ceiling.');
		}
		const bytes = Buffer.alloc(details.size);
		const result = await handle.read(bytes, 0, bytes.length, 0);
		if (result.bytesRead !== bytes.length) {
			throw new Error('A native render-input ownership record changed during inspection.');
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

async function writeExclusiveSynced(path: string, payload: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
		0o600,
	);
	try {
		await handle.writeFile(payload);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/**
 * Admit one directory and report its canonical path. The named entry itself must be a real
 * directory and never a link, which is the redirection this store has to refuse. Its
 * ancestors are a different matter: the caller is handed its root by the OS, and that
 * spelling is legitimately an alias of the canonical one — a `/var` symlink on macOS, an
 * 8.3 short name on Windows — so requiring the caller's own string to equal its resolved
 * form refuses ordinary platform paths rather than any attack.
 */
async function requireExactDirectory(path: string): Promise<string> {
	const details = await lstat(path);
	if (!details.isDirectory() || details.isSymbolicLink()) {
		throw new Error('A native render-input directory changed filesystem identity.');
	}
	return realpath(path);
}

/** A stage directory sits directly under the canonical root, so it is its own canonical path. */
async function requireExactStageDirectory(path: string): Promise<void> {
	if (await requireExactDirectory(path) !== path) {
		throw new Error('A native render-input directory changed filesystem identity.');
	}
}

async function regularFilePresent(path: string): Promise<boolean> {
	try {
		const details = await lstat(path);
		if (!details.isFile() || details.isSymbolicLink()) {
			throw new Error('A native render-input claim marker is not one regular file.');
		}
		return true;
	} catch (error) {
		if (missing(error)) return false;
		throw error;
	}
}

function nativeRenderInputOwnershipPath(root: string, stageId: string): string {
	return join(root, ownershipFileName(stageId));
}

function ownershipFileName(stageId: string): string {
	return `stage-${stageId}.ownership.json`;
}

function missing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error
		&& (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}
