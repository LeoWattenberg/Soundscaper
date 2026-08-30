/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
	lstat, open, realpath,
	type FileHandle,
} from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	SoundscaperDeliveryFilesystemAuthority,
	SoundscaperDeliveryFilesystemSession,
} from './soundscaper-delivery-filesystem-authority.ts';

export interface SoundscaperDeliveryRoot {
	readonly grantId: string;
	readonly rootPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
	readonly authorizedAtMs: number;
	readonly revokedAtMs: number | null;
}

export interface SoundscaperDeliveryRootObservation {
	readonly canonicalPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
}

export interface SoundscaperDeliveryWriteDeclaration {
	readonly claimId: string;
	readonly fileName: string;
	readonly jobId: string;
	readonly finalPrefixByteLength?: number;
	readonly maximumSize?: number;
	readonly size?: number;
	/** Main-private native-session reference; never accepted from renderer IPC. */
	readonly stagingName?: string;
	/** Main-private lease fence, checked after every awaited filesystem operation. */
	readonly assertFence?: (operation: string) => void;
}

export interface SoundscaperDeliveryStagedFile {
	readonly byteLength: number;
	readonly finalName: string;
	readonly sha256: string;
	readonly stagingName: string;
	readonly stagingRecoveryToken: string;
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
}

export interface SoundscaperDeliveryFileInspection {
	readonly byteLength: number;
	readonly sha256: string;
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
}

export interface SoundscaperDeliveryFileIdentity {
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
}

export class SoundscaperDeliveryRootStore {
	readonly #database: DatabaseSync;
	readonly #observe: (path: unknown) => Promise<SoundscaperDeliveryRootObservation>;

	constructor(
		database: DatabaseSync,
		observe: (path: unknown) => Promise<SoundscaperDeliveryRootObservation> = observeSoundscaperDeliveryRoot,
	) {
		this.#database = database;
		this.#observe = observe;
	}

	prepareAuthorization(path: unknown): Promise<SoundscaperDeliveryRootObservation> {
		return this.#observe(path);
	}

	authorize(observation: SoundscaperDeliveryRootObservation, nowMs: number): SoundscaperDeliveryRoot {
		const grant: SoundscaperDeliveryRoot = Object.freeze({
			grantId: randomBytes(24).toString('hex'),
			rootPath: observation.canonicalPath,
			volumeIdentity: observation.volumeIdentity,
			directoryIdentity: observation.directoryIdentity,
			authorizedAtMs: nowMs,
			revokedAtMs: null,
		});
		this.#database.prepare(`
			INSERT INTO delivery_roots (
				grant_id, root_path, volume_identity, directory_identity, authorized_at_ms, revoked_at_ms
			) VALUES (?, ?, ?, ?, ?, NULL)
		`).run(
			grant.grantId, grant.rootPath, grant.volumeIdentity,
			grant.directoryIdentity, grant.authorizedAtMs,
		);
		return grant;
	}

	read(grantId: unknown): SoundscaperDeliveryRoot | null {
		const row = this.#database.prepare(
			'SELECT * FROM delivery_roots WHERE grant_id = ?',
		).get(id(grantId, 'root grant')) as Record<string, unknown> | undefined;
		return row ? decodeRoot(row) : null;
	}

	require(grantId: unknown): SoundscaperDeliveryRoot {
		const root = this.read(grantId);
		if (!root) throw new Error('The Soundscaper delivery root does not exist.');
		return root;
	}

	revoke(grantId: unknown, nowMs: number): boolean {
		return this.#database.prepare(`
			UPDATE delivery_roots SET revoked_at_ms = ?
			WHERE grant_id = ? AND revoked_at_ms IS NULL
		`).run(nowMs, id(grantId, 'root grant')).changes === 1;
	}

	async prepareReauthorization(grantId: unknown, path: unknown): Promise<SoundscaperDeliveryRoot> {
		const root = this.require(grantId);
		const observed = await this.#observe(path);
		if (observed.canonicalPath !== root.rootPath
			|| observed.volumeIdentity !== root.volumeIdentity
			|| observed.directoryIdentity !== root.directoryIdentity) {
			throw new Error('A delivery root can only be reauthorized as the same physical directory.');
		}
		return root;
	}

	reauthorize(root: SoundscaperDeliveryRoot): SoundscaperDeliveryRoot {
		this.#database.prepare(
			'UPDATE delivery_roots SET revoked_at_ms = NULL WHERE grant_id = ?',
		).run(root.grantId);
		return Object.freeze({ ...root, revokedAtMs: null });
	}

	async revalidate(root: SoundscaperDeliveryRoot): Promise<boolean> {
		if (root.revokedAtMs !== null) return false;
		try {
			const observed = await this.#observe(root.rootPath);
			return observed.canonicalPath === root.rootPath
				&& observed.volumeIdentity === root.volumeIdentity
				&& observed.directoryIdentity === root.directoryIdentity;
		} catch { return false; }
	}
}

export class SoundscaperDeliveryWrite {
	readonly claimId: string;
	readonly finalName: string;
	readonly jobId: string;
	readonly stagingName: string;
	readonly stagingRecoveryToken: string;
	readonly writeId: string;
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
	readonly #declaredBytes: number;
	readonly #exact: boolean;
	readonly #finalPrefixByteLength: number;
	readonly #session: SoundscaperDeliveryFilesystemSession;
	readonly #assertFence: (operation: string) => void;
	#bytesWritten = 0;
	#prefixPatched = false;
	#sealed: SoundscaperDeliveryFileInspection | null = null;

	private constructor(
		declaration: SoundscaperDeliveryWriteDeclaration,
		session: SoundscaperDeliveryFilesystemSession,
		stagingName: string,
	) {
		this.#assertFence = declaration.assertFence ?? (() => undefined);
		this.claimId = declaration.claimId;
		this.jobId = declaration.jobId;
		this.finalName = fileName(declaration.fileName);
		this.stagingName = stagingName;
		this.stagingRecoveryToken = session.recoveryToken;
		this.writeId = randomBytes(24).toString('hex');
		this.volumeIdentity = session.volumeIdentity;
		this.fileIdentity = session.fileIdentity;
		this.#exact = declaration.size !== undefined;
		this.#declaredBytes = byteLength(
			this.#exact ? declaration.size : declaration.maximumSize,
			this.#exact ? 'declared size' : 'maximum size',
		);
		this.#finalPrefixByteLength = declaration.finalPrefixByteLength ?? 0;
		if (this.#finalPrefixByteLength !== 0 && this.#finalPrefixByteLength !== 32) {
			throw new RangeError('A Soundscaper delivery final prefix must contain exactly 32 bytes.');
		}
		if (this.#finalPrefixByteLength && !this.#exact) {
			throw new Error('A Soundscaper delivery final prefix requires an exact-size write.');
		}
		this.#session = session;
	}

	static async open(
		filesystem: SoundscaperDeliveryFilesystemAuthority,
		root: SoundscaperDeliveryRoot,
		declaration: SoundscaperDeliveryWriteDeclaration,
	): Promise<SoundscaperDeliveryWrite> {
		const finalName = fileName(declaration.fileName);
		const jobId = id(declaration.jobId, 'job');
		const claimId = id(declaration.claimId, 'claim');
		const stagingName = declaration.stagingName === undefined
			? randomBytes(24).toString('hex')
			: id(declaration.stagingName, 'staging session');
		const admitted = Object.freeze({
			claimId, jobId, fileName: finalName, stagingName,
			...(declaration.size === undefined ? {} : { size: declaration.size }),
			...(declaration.maximumSize === undefined ? {} : { maximumSize: declaration.maximumSize }),
			...(declaration.finalPrefixByteLength === undefined ? {}
				: { finalPrefixByteLength: declaration.finalPrefixByteLength }),
			...(declaration.assertFence === undefined ? {} : { assertFence: declaration.assertFence }),
		});
		validateWriteDeclaration(admitted);
		const fence = declaration.assertFence ?? (() => undefined);
		let session: SoundscaperDeliveryFilesystemSession | null = null;
		try {
			session = await filesystem.open({
				root, reference: stagingName, finalName,
				maximumBytes: byteLength(
					admitted.size === undefined ? admitted.maximumSize : admitted.size,
					admitted.size === undefined ? 'maximum size' : 'declared size',
				),
				finalPrefixByteLength: (admitted.finalPrefixByteLength ?? 0) as 0 | 32,
				fence,
			});
			if (session.reference !== stagingName || session.volumeIdentity !== root.volumeIdentity) {
				throw new Error('The native delivery session changed its staging or volume authority.');
			}
			return new SoundscaperDeliveryWrite(admitted, session, stagingName);
		} catch (error) {
			if (session) await session.abort().catch(() => undefined);
			throw error;
		}
	}

	get bytesWritten(): number { return this.#bytesWritten; }

	async write(offset: unknown, value: unknown): Promise<number> {
		this.#assertOpen();
		const bytes = binary(value);
		if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) {
			throw new RangeError('A Soundscaper delivery chunk must be between 1 byte and 4 MiB.');
		}
		if (offset !== this.#bytesWritten || bytes.byteLength > this.#declaredBytes - this.#bytesWritten) {
			throw new RangeError('The Soundscaper delivery stream lost synchronization or exceeded its declaration.');
		}
		const accepted = await this.#session.write(this.#bytesWritten, bytes);
		if (accepted !== bytes.byteLength) throw new Error('The delivery staging session accepted a short write.');
		this.#bytesWritten += bytes.byteLength;
		return this.#bytesWritten;
	}

	async patchFinalPrefix(value: unknown): Promise<number> {
		this.#assertOpen();
		const bytes = binary(value);
		if (!this.#finalPrefixByteLength || bytes.byteLength !== this.#finalPrefixByteLength
			|| this.#bytesWritten !== this.#declaredBytes || this.#prefixPatched) {
			throw new Error('The Soundscaper delivery final prefix is not admissible.');
		}
		const accepted = await this.#session.patch(0, bytes);
		if (accepted !== bytes.byteLength) throw new Error('The delivery final prefix accepted a short write.');
		this.#prefixPatched = true;
		return this.#bytesWritten;
	}

	async finish(): Promise<SoundscaperDeliveryStagedFile> {
		this.#assertOpen();
		if (this.#exact && this.#bytesWritten !== this.#declaredBytes) {
			throw new Error('The Soundscaper delivery exact-size stream is incomplete.');
		}
		if (this.#finalPrefixByteLength && !this.#prefixPatched) {
			throw new Error('The Soundscaper delivery final prefix was not patched.');
		}
		const inspected = await this.#session.seal(this.#bytesWritten);
		if (inspected.byteLength !== this.#bytesWritten
			|| !sameDeliveryFileIdentity(inspected, this)) {
			throw new Error('The Soundscaper delivery staging file changed before sealing.');
		}
		this.#sealed = inspected;
		return Object.freeze({
			...inspected, finalName: this.finalName, stagingName: this.stagingName,
			stagingRecoveryToken: this.stagingRecoveryToken,
		});
	}

	async inspectSealed(): Promise<SoundscaperDeliveryFileInspection> {
		if (!this.#sealed || this.#session.settled) throw new Error('The delivery native session is not sealed.');
		const inspected = await this.#session.inspect();
		if (inspected.byteLength !== this.#sealed.byteLength || inspected.sha256 !== this.#sealed.sha256
			|| !sameDeliveryFileIdentity(inspected, this)) {
			throw new Error('The Soundscaper delivery native session changed after sealing.');
		}
		return inspected;
	}

	async publish(journalId: string, assertReady: () => Promise<void>): Promise<SoundscaperDeliveryFileInspection> {
		const sealed = await this.inspectSealed();
		this.#assertFence('publication-authority');
		await assertReady();
		this.#assertFence('publication-ready');
		const published = await this.#session.publish(this.finalName, journalId);
		if (published.byteLength !== sealed.byteLength || published.sha256 !== sealed.sha256
			|| !sameDeliveryFileIdentity(published, sealed)) {
			throw new Error('The Soundscaper delivery helper published a different sealed artifact.');
		}
		return published;
	}

	async abort(): Promise<void> {
		const removed = await this.#session.abort();
		if (removed === 'foreign') throw new Error('The Soundscaper delivery staging file lost ownership before cleanup.');
	}

	/** Close a stale owner's descriptor without removing the new owner's recovery artifact. */
	async abandon(): Promise<void> {
		await this.#session.abandon();
	}

	get settled(): boolean { return this.#session.settled; }

	#assertOpen(): void {
		if (this.#sealed || this.#session.settled) throw new Error('The Soundscaper delivery write is closed.');
	}
}

/** Durably order an authenticated publication before its SQLite journal advances. */
export async function syncSoundscaperDeliveryRootDirectory(
	root: SoundscaperDeliveryRoot,
	assertFence: (operation: string) => void = () => undefined,
): Promise<void> {
	let handle: FileHandle;
	try {
		handle = await open(
			root.rootPath,
			constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
		);
		assertFence('directory-open');
	} catch (error) {
		throw new Error('Soundscaper delivery cannot establish a destination-directory durability barrier.', { cause: error });
	}
	try {
		const details = await handle.stat({ bigint: true });
		assertFence('directory-stat');
		if (!details.isDirectory()
			|| fileIdentity(details).volumeIdentity !== root.volumeIdentity
			|| `device:${details.dev.toString(16)}:inode:${details.ino.toString(16)}` !== root.directoryIdentity) {
			throw new Error('The Soundscaper delivery directory changed before its durability barrier.');
		}
		await handle.sync();
		assertFence('directory-sync');
	} finally {
		await handle.close();
		assertFence('directory-close');
	}
}

export async function inspectDeliveryFile(
	root: SoundscaperDeliveryRoot,
	name: string,
	assertFence: (operation: string) => void = () => undefined,
): Promise<SoundscaperDeliveryFileInspection | null> {
	let handle: FileHandle;
	try {
		handle = await open(
			await rootFile(root, name, assertFence),
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
		);
		assertFence('inspect-open');
	} catch (error) {
		if (hasCode(error, 'ENOENT')) return null;
		throw error;
	}
	try {
		const before = await handle.stat({ bigint: true });
		assertFence('inspect-stat-before');
		if (!before.isFile()) throw new Error('A Soundscaper delivery artifact must be a regular file.');
		const digest = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let offset = 0;
		for (;;) {
			const read = await handle.read(buffer, 0, buffer.length, offset);
			assertFence('inspect-read');
			if (read.bytesRead === 0) break;
			digest.update(buffer.subarray(0, read.bytesRead));
			offset += read.bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		assertFence('inspect-stat-after');
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| BigInt(offset) !== after.size) throw new Error('The delivery artifact changed during inspection.');
		if (after.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('The delivery artifact is too large to inspect safely.');
		return Object.freeze({
			byteLength: Number(after.size), sha256: digest.digest('hex'), ...fileIdentity(after),
		});
	} finally { await handle.close(); assertFence('inspect-close'); }
}

export function sameDeliveryFileIdentity(
	left: SoundscaperDeliveryFileIdentity,
	right: SoundscaperDeliveryFileIdentity,
): boolean {
	return left.volumeIdentity === right.volumeIdentity && left.fileIdentity === right.fileIdentity;
}

async function rootFile(
	root: SoundscaperDeliveryRoot,
	name: string,
	assertFence: (operation: string) => void = () => undefined,
): Promise<string> {
	const observed = await observeSoundscaperDeliveryRoot(root.rootPath).catch(() => null);
	assertFence('root-observation');
	if (!observed || observed.canonicalPath !== root.rootPath
		|| observed.volumeIdentity !== root.volumeIdentity
		|| observed.directoryIdentity !== root.directoryIdentity || root.revokedAtMs !== null) {
		throw new Error('The Soundscaper delivery root no longer matches its authorization.');
	}
	const leaf = fileName(name);
	const path = join(root.rootPath, leaf);
	if (resolve(path) !== path) throw new Error('The delivery artifact escaped its authorized root.');
	return path;
}

export async function observeSoundscaperDeliveryRoot(
	value: unknown,
): Promise<SoundscaperDeliveryRootObservation> {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError('A Soundscaper delivery root must be an absolute path.');
	}
	const canonicalPath = await realpath(resolve(value));
	const details = await lstat(canonicalPath, { bigint: true });
	if (!details.isDirectory() || details.isSymbolicLink()) {
		throw new Error('A Soundscaper delivery root must be a regular directory.');
	}
	const device = details.dev.toString(16);
	return Object.freeze({
		canonicalPath,
		volumeIdentity: `device:${device}`,
		directoryIdentity: `device:${device}:inode:${details.ino.toString(16)}`,
	});
}

function decodeRoot(row: Record<string, unknown>): SoundscaperDeliveryRoot {
	return Object.freeze({
		grantId: id(row.grant_id, 'stored root grant'),
		rootPath: String(row.root_path),
		volumeIdentity: String(row.volume_identity),
		directoryIdentity: String(row.directory_identity),
		authorizedAtMs: Number(row.authorized_at_ms),
		revokedAtMs: row.revoked_at_ms === null ? null : Number(row.revoked_at_ms),
	});
}

function fileName(value: unknown): string {
	if (typeof value !== 'string' || value !== basename(value) || value === '.' || value === '..'
		|| /[\0-\x1f/\\]/u.test(value) || new TextEncoder().encode(value).byteLength > 220) {
		throw new TypeError('A Soundscaper delivery file name must be one bounded safe leaf name.');
	}
	return value;
}

function id(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError(`A Soundscaper delivery ${label} id is invalid.`);
	}
	return value;
}

function byteLength(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 65 * 1024 ** 3) {
		throw new RangeError(`The Soundscaper delivery ${label} is invalid.`);
	}
	return Number(value);
}

function validateWriteDeclaration(declaration: SoundscaperDeliveryWriteDeclaration): void {
	const exact = declaration.size !== undefined;
	byteLength(exact ? declaration.size : declaration.maximumSize, exact ? 'declared size' : 'maximum size');
	const prefix = declaration.finalPrefixByteLength ?? 0;
	if (prefix !== 0 && prefix !== 32) {
		throw new RangeError('A Soundscaper delivery final prefix must contain exactly 32 bytes.');
	}
	if (prefix && !exact) throw new Error('A Soundscaper delivery final prefix requires an exact-size write.');
}

function binary(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return Uint8Array.from(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	throw new TypeError('Soundscaper delivery bytes must be binary data.');
}

function hasCode(error: unknown, code: string): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function fileIdentity(details: Readonly<{ dev: bigint; ino: bigint }>): SoundscaperDeliveryFileIdentity {
	return Object.freeze({
		volumeIdentity: `device:${details.dev.toString(16)}`,
		fileIdentity: `inode:${details.ino.toString(16)}`,
	});
}
