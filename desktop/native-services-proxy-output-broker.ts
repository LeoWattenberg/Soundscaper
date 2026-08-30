/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned, pathless claims for completed authenticated V14 proxy outputs. */

import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import { framescaperNativeMediaV14ProxyOutputCeiling } from './native-media-v14-helper-adapter.ts';
import type { FramescaperNativeRootGrant } from './native-services-root-repository.ts';

const JOB_ID = /^[a-f0-9]{40}$/u;
const CLAIM_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_PROXY_BYTES = HELPER_DATA_PLANE_MAXIMUM_BYTES;
const MAXIMUM_READ_BYTES = 1024 * 1024;
export const FRAMESCAPER_NATIVE_PROXY_OUTPUT_MAXIMUM_OPEN_CLAIMS = 8;

interface PublishedProxyOutput {
	readonly jobId: string;
	readonly planFingerprint: string;
	readonly rootGrantId: string;
	readonly rootPath: string;
	readonly volumeIdentity: string;
	readonly directoryIdentity: string;
	readonly relativeDestination: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface OpenProxyOutputClaim extends PublishedProxyOutput {
	readonly claimId: string;
	readonly owner: object;
	readonly handle: FileHandle;
}

interface ActiveProxyOutputClaim {
	readonly owner: object;
	readonly jobId: string;
	readonly completion: Promise<void>;
	readonly settle: () => void;
}

export interface FramescaperNativeProxyOutputBrokerOptions {
	readonly queueRecord: (jobId: string) => NativeQueueRecordV3 | null;
	readonly rootGrant: (grantId: string) => FramescaperNativeRootGrant | null;
	readonly mintClaimId: () => string;
}

export class FramescaperNativeProxyOutputBroker {
	readonly #options: FramescaperNativeProxyOutputBrokerOptions;
	readonly #published = new Map<string, PublishedProxyOutput>();
	readonly #claims = new Map<string, OpenProxyOutputClaim>();
	readonly #active = new Set<ActiveProxyOutputClaim>();
	readonly #revokedOwners = new WeakSet<object>();
	#disposed = false;

	constructor(options: FramescaperNativeProxyOutputBrokerOptions) {
		if (typeof options?.queueRecord !== 'function' || typeof options.rootGrant !== 'function'
			|| typeof options.mintClaimId !== 'function') {
			throw new TypeError('Native proxy output claims require exact queue, root, and identity ports.');
		}
		this.#options = options;
	}

	recordPublished(
		record: NativeQueueRecordV3,
		root: FramescaperNativeRootGrant,
		receipt: Readonly<{ readonly planFingerprint: string; readonly byteLength: number; readonly sha256: string }>,
	): void {
		this.#assertOpen();
		this.#prunePublished();
		if (record.taskKind !== 'proxy-generation' || record.state !== 'running'
			|| root.grantId !== record.rootGrantId || root.revokedAtMs !== null
			|| receipt.planFingerprint !== record.planFingerprint
			|| !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength < 1
			|| receipt.byteLength > proxyOutputCeiling(record) || !SHA256.test(receipt.sha256)) {
			throw new Error('A published native proxy output lost queue, root, plan, or byte authority.');
		}
		const published = Object.freeze({
			jobId: record.jobId, planFingerprint: record.planFingerprint,
			rootGrantId: root.grantId, rootPath: root.rootPath,
			volumeIdentity: root.volumeIdentity, directoryIdentity: root.directoryIdentity,
			relativeDestination: assertNativeMediaRelativeDestination(record.relativeDestination),
			byteLength: receipt.byteLength, sha256: receipt.sha256,
		});
		const existing = this.#published.get(record.jobId);
		if (existing && JSON.stringify(existing) !== JSON.stringify(published)) {
			throw new Error('A native proxy queue job produced a different authenticated output receipt.');
		}
		this.#published.set(record.jobId, published);
	}

	async claim(ownerValue: object, request: Readonly<{ readonly jobId: string }>) {
		this.#assertOpen();
		const owner = exactOwner(ownerValue);
		const jobId = exactJobId(request?.jobId);
		if (this.#revokedOwners.has(owner)) {
			throw new Error('The native proxy output owner has been revoked.');
		}
		if (this.#claims.size + this.#active.size
			>= FRAMESCAPER_NATIVE_PROXY_OUTPUT_MAXIMUM_OPEN_CLAIMS) {
			throw new Error('The native proxy output claim capacity is exhausted.');
		}
		if ([...this.#claims.values()].some((claim) => claim.owner === owner && claim.jobId === jobId)
			|| [...this.#active].some((claim) => claim.owner === owner && claim.jobId === jobId)) {
			throw new Error('One renderer owner may hold only one claim for a native proxy output job.');
		}
		let settle = (): void => undefined;
		const completion = new Promise<void>((resolveCompletion) => { settle = resolveCompletion; });
		const active = Object.freeze({ owner, jobId, completion, settle });
		this.#active.add(active);
		try {
			const published = this.#published.get(jobId);
			const record = this.#options.queueRecord(jobId);
			if (!published || record?.taskKind !== 'proxy-generation'
				|| record.planFingerprint !== published.planFingerprint
				|| record.rootGrantId !== published.rootGrantId
				|| record.relativeDestination !== published.relativeDestination) {
				if (published) this.#published.delete(jobId);
				throw new Error('The completed native proxy output is not available for an exact claim.');
			}
			if (record.state !== 'completed') {
				throw new Error('The native proxy output queue job is not completed.');
			}
			const root = this.#options.rootGrant(published.rootGrantId);
			if (!root || root.revokedAtMs !== null || !sameRoot(root, published)) {
				throw new Error('The native proxy output root is no longer authorized.');
			}
			const path = inside(published.rootPath, published.relativeDestination);
			const before = await lstat(path);
			if (!before.isFile() || before.isSymbolicLink() || before.size !== published.byteLength) {
				throw new Error('The completed native proxy output changed type or byte length.');
			}
			const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const after = await handle.stat();
				if (!after.isFile() || after.size !== published.byteLength
					|| after.dev !== before.dev || after.ino !== before.ino
					|| await digestHandle(handle, published.byteLength) !== published.sha256) {
					throw new Error('The completed native proxy output changed authenticated identity.');
				}
				this.#assertOpen();
				if (this.#revokedOwners.has(owner)) {
					throw new Error('The native proxy output owner was revoked during authentication.');
				}
				const claimId = exactClaimId(this.#options.mintClaimId());
				if (this.#claims.has(claimId)) throw new Error('A native proxy output claim identity was reused.');
				this.#claims.set(claimId, Object.freeze({ ...published, claimId, owner, handle }));
				return Object.freeze({
					claimId, byteLength: published.byteLength, sha256: published.sha256,
					mimeType: 'video/quicktime' as const,
				});
			} catch (error) {
				await handle.close().catch(() => undefined);
				throw error;
			}
		} finally {
			this.#active.delete(active);
			active.settle();
		}
	}

	async read(ownerValue: object, request: Readonly<{
		readonly claimId: string; readonly offset: number; readonly length: number;
	}>): Promise<Uint8Array> {
		this.#assertOpen();
		const owner = exactOwner(ownerValue);
		const claim = this.#claims.get(exactClaimId(request?.claimId));
		const offset = boundedInteger(request?.offset, 0, MAXIMUM_PROXY_BYTES, 'proxy output offset');
		const length = boundedInteger(request?.length, 1, MAXIMUM_READ_BYTES, 'proxy output read length');
		if (!claim || claim.owner !== owner || offset + length > claim.byteLength) {
			throw new Error('The native proxy output range is not authorized by this claim.');
		}
		const bytes = new Uint8Array(length);
		const result = await claim.handle.read(bytes, 0, length, offset);
		if (result.bytesRead !== length) throw new Error('The native proxy output range read was short.');
		return bytes;
	}

	async release(ownerValue: object, request: Readonly<{ readonly claimId: string }>): Promise<boolean> {
		const owner = exactOwner(ownerValue);
		const claimId = exactClaimId(request?.claimId);
		const claim = this.#claims.get(claimId);
		if (!claim || claim.owner !== owner) return false;
		this.#claims.delete(claimId);
		await claim.handle.close();
		return true;
	}

	async disposeOwner(ownerValue: object): Promise<number> {
		const owner = exactOwner(ownerValue);
		this.#revokedOwners.add(owner);
		await Promise.all([...this.#active]
			.filter((claim) => claim.owner === owner).map(({ completion }) => completion));
		const claims = [...this.#claims.values()].filter((claim) => claim.owner === owner);
		await Promise.all(claims.map((claim) => this.release(owner, { claimId: claim.claimId })));
		return claims.length;
	}

	async dispose(): Promise<boolean> {
		if (this.#disposed) return false;
		this.#disposed = true;
		await Promise.all([...this.#active].map(({ completion }) => completion));
		const claims = [...this.#claims.values()];
		this.#claims.clear();
		this.#published.clear();
		await Promise.all(claims.map(({ handle }) => handle.close().catch(() => undefined)));
		return true;
	}

	#assertOpen(): void {
		if (this.#disposed) throw new Error('The native proxy output broker is disposed.');
	}

	#prunePublished(): void {
		for (const [jobId, published] of this.#published) {
			const record = this.#options.queueRecord(jobId);
			if (!record || record.taskKind !== 'proxy-generation'
				|| (record.state !== 'running' && record.state !== 'completed')
				|| record.planFingerprint !== published.planFingerprint
				|| record.rootGrantId !== published.rootGrantId
				|| record.relativeDestination !== published.relativeDestination) {
				this.#published.delete(jobId);
			}
		}
	}
}

function proxyOutputCeiling(record: NativeQueueRecordV3): number {
	let plan: unknown;
	try { plan = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('A native proxy queue plan is not JSON.'); }
	return framescaperNativeMediaV14ProxyOutputCeiling(createNativeMediaPlanEnvelopeV2(plan));
}

async function digestHandle(handle: FileHandle, byteLength: number): Promise<string> {
	const hash = createHash('sha256');
	const buffer = Buffer.allocUnsafe(MAXIMUM_READ_BYTES);
	for (let offset = 0; offset < byteLength;) {
		const length = Math.min(buffer.byteLength, byteLength - offset);
		const result = await handle.read(buffer, 0, length, offset);
		if (result.bytesRead !== length) throw new Error('The native proxy output ended during authentication.');
		hash.update(buffer.subarray(0, length));
		offset += length;
	}
	return hash.digest('hex');
}

function inside(root: string, relativePath: string): string {
	if (!isAbsolute(root)) throw new TypeError('A native proxy output root must be absolute.');
	const value = resolve(root, ...assertNativeMediaRelativeDestination(relativePath).split('/'));
	const child = relative(root, value);
	if (!child || child.startsWith('..') || isAbsolute(child)) {
		throw new Error('A native proxy output escaped its authorized root.');
	}
	return value;
}

function sameRoot(root: FramescaperNativeRootGrant, published: PublishedProxyOutput): boolean {
	return root.rootPath === published.rootPath && root.volumeIdentity === published.volumeIdentity
		&& root.directoryIdentity === published.directoryIdentity;
}

function exactOwner(value: unknown): object {
	if (!value || typeof value !== 'object') throw new TypeError('A native proxy output requires its renderer owner.');
	return value;
}
function exactJobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID.test(value)) throw new TypeError('A native proxy output job ID is invalid.');
	return value;
}
function exactClaimId(value: unknown): string {
	if (typeof value !== 'string' || !CLAIM_ID.test(value)) throw new TypeError('A native proxy output claim ID is invalid.');
	return value;
}
function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The native ${name} is invalid.`);
	}
	return Number(value);
}
