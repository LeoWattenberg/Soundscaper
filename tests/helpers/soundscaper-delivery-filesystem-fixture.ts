/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

import type {
	SoundscaperDeliveryFilesystemAuthority,
	SoundscaperDeliveryFilesystemFence,
	SoundscaperDeliveryFilesystemSession,
} from '../../desktop/soundscaper-delivery-filesystem-authority.ts';
import {
	inspectDeliveryFile,
	sameDeliveryFileIdentity,
	syncSoundscaperDeliveryRootDirectory,
	type SoundscaperDeliveryFileIdentity,
	type SoundscaperDeliveryFileInspection,
	type SoundscaperDeliveryRoot,
} from '../../desktop/soundscaper-delivery-root.ts';

/** Explicit test double. Production must never use its pathname cleanup. */
export function createSoundscaperDeliveryFilesystemFixture(
	privateRoot: string,
): SoundscaperDeliveryFilesystemAuthority {
	const pathFor = (reference: string) => join(privateRoot, `${reference}.stage`);
	const authority: SoundscaperDeliveryFilesystemAuthority = {
		async open({ root, reference, finalName, fence }) {
			await mkdir(privateRoot, { recursive: true, mode: 0o700 });
			const path = pathFor(reference);
			const handle = await open(path,
				constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
			fence('native-stage-open');
			const identity = identityFor(await handle.stat({ bigint: true }));
			fence('native-stage-stat');
			return new FixtureSession(root, reference, finalName, path, handle, identity, fence);
		},
		async removeRecovered(root, recoveryToken, expected, fence) {
			const path = pathFor(recoveryToken);
			const inspection = await inspectPrivate(path, root.volumeIdentity, fence);
			if (!inspection) return 'missing';
			if (!sameDeliveryFileIdentity(inspection, expected)) return 'foreign';
			if ('sha256' in expected && (inspection.byteLength !== expected.byteLength
				|| inspection.sha256 !== expected.sha256)) return 'foreign';
			await unlink(path);
			fence('native-recovery-remove');
			return 'removed';
		},
		async inspectFinal(root, finalName, fence) {
			return inspectDeliveryFile(root, finalName, fence);
		},
	};
	return Object.freeze(authority);
}

class FixtureSession implements SoundscaperDeliveryFilesystemSession {
	readonly reference: string;
	readonly recoveryToken: string;
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
	readonly #root: SoundscaperDeliveryRoot;
	readonly #finalName: string;
	readonly #path: string;
	readonly #handle: FileHandle;
	readonly #fence: SoundscaperDeliveryFilesystemFence;
	#settled = false;
	#sealed: SoundscaperDeliveryFileInspection | null = null;

	constructor(
		root: SoundscaperDeliveryRoot,
		reference: string,
		finalName: string,
		path: string,
		handle: FileHandle,
		identity: SoundscaperDeliveryFileIdentity,
		fence: SoundscaperDeliveryFilesystemFence,
	) {
		this.#root = root;
		this.reference = reference;
		this.recoveryToken = reference;
		this.#finalName = finalName;
		this.#path = path;
		this.#handle = handle;
		this.#fence = fence;
		this.volumeIdentity = identity.volumeIdentity;
		this.fileIdentity = identity.fileIdentity;
	}

	get settled(): boolean { return this.#settled; }

	async write(offset: number, bytes: Uint8Array): Promise<number> {
		const result = await this.#handle.write(bytes, 0, bytes.byteLength, offset);
		this.#fence('write');
		return result.bytesWritten;
	}

	async patch(offset: number, bytes: Uint8Array): Promise<number> {
		const result = await this.#handle.write(bytes, 0, bytes.byteLength, offset);
		this.#fence('patch-prefix');
		return result.bytesWritten;
	}

	async seal(byteLength: number): Promise<SoundscaperDeliveryFileInspection> {
		await this.#handle.sync();
		this.#fence('sync');
		const inspection = await inspectHandle(this.#handle, this.#fence);
		if (inspection.byteLength !== byteLength) throw new Error('Fixture delivery stage has the wrong length.');
		this.#sealed = inspection;
		return inspection;
	}

	inspect(): Promise<SoundscaperDeliveryFileInspection> {
		return inspectHandle(this.#handle, this.#fence);
	}

	async publish(finalName: string, _journalId: string): Promise<SoundscaperDeliveryFileInspection> {
		if (finalName !== this.#finalName || this.#settled || !this.#sealed) {
			throw new Error('Fixture delivery session cannot publish.');
		}
		const current = await inspectHandle(this.#handle, this.#fence);
		if (current.byteLength !== this.#sealed.byteLength || current.sha256 !== this.#sealed.sha256
			|| !sameDeliveryFileIdentity(current, this.#sealed)) {
			throw new Error('Fixture delivery session changed after its final authenticated inspection.');
		}
		const finalPath = join(this.#root.rootPath, finalName);
		await link(this.#path, finalPath);
		this.#fence('publication-link');
		const published = await inspectDeliveryFile(this.#root, finalName, this.#fence);
		if (!published || !sameDeliveryFileIdentity(published, this)) {
			throw new Error('Fixture delivery publication did not preserve its exact identity.');
		}
		await unlink(this.#path);
		this.#fence('publication-retire');
		await syncSoundscaperDeliveryRootDirectory(this.#root, this.#fence);
		await this.#handle.close();
		this.#settled = true;
		return published;
	}

	async abort(): Promise<'missing' | 'removed' | 'foreign'> {
		if (this.#settled) return 'missing';
		const inspection = await inspectPrivate(this.#path, this.volumeIdentity, this.#fence);
		if (!inspection) {
			await this.#handle.close().catch(() => undefined);
			this.#settled = true;
			return 'missing';
		}
		if (!sameDeliveryFileIdentity(inspection, this)) return 'foreign';
		await unlink(this.#path);
		this.#fence('native-stage-abort');
		await this.#handle.close().catch(() => undefined);
		this.#settled = true;
		return 'removed';
	}

	async abandon(): Promise<void> {
		if (this.#settled) return;
		await this.#handle.close().catch(() => undefined);
		this.#settled = true;
	}
}

async function inspectPrivate(
	path: string,
	volumeIdentity: string,
	fence: SoundscaperDeliveryFilesystemFence,
): Promise<SoundscaperDeliveryFileInspection | null> {
	let handle: FileHandle;
	try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
	catch (error) { if (hasCode(error, 'ENOENT')) return null; throw error; }
	try {
		const inspection = await inspectHandle(handle, fence);
		if (inspection.volumeIdentity !== volumeIdentity) throw new Error('Fixture stage changed volume.');
		return inspection;
	} finally { await handle.close(); }
}

async function inspectHandle(
	handle: FileHandle,
	fence: SoundscaperDeliveryFilesystemFence,
): Promise<SoundscaperDeliveryFileInspection> {
	const before = await handle.stat({ bigint: true });
	fence('native-inspect-stat-before');
	if (!before.isFile()) throw new Error('Fixture delivery stage must be a file.');
	const digest = createHash('sha256');
	const buffer = Buffer.allocUnsafe(1024 * 1024);
	let offset = 0;
	for (;;) {
		const result = await handle.read(buffer, 0, buffer.length, offset);
		fence('native-inspect-read');
		if (!result.bytesRead) break;
		digest.update(buffer.subarray(0, result.bytesRead));
		offset += result.bytesRead;
	}
	const after = await handle.stat({ bigint: true });
	fence('native-inspect-stat-after');
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| after.size !== BigInt(offset)) throw new Error('Fixture delivery stage changed while inspected.');
	return Object.freeze({
		byteLength: offset, sha256: digest.digest('hex'), ...identityFor(after),
	});
}

function identityFor(details: Readonly<{ dev: bigint; ino: bigint }>): SoundscaperDeliveryFileIdentity {
	return Object.freeze({
		volumeIdentity: `device:${details.dev.toString(16)}`,
		fileIdentity: `inode:${details.ino.toString(16)}`,
	});
}

function hasCode(error: unknown, code: string): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
