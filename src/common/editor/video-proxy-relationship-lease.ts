/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoProxyCandidateOriginalIdentity } from './video-proxy-candidate-observation.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface OriginalLeasePort {
	readonly blob: Blob;
	readonly fingerprint: VideoProxyCandidateOriginalIdentity;
	assertCurrent(): void;
	release(): Awaitable<void>;
}

export interface CapturedVideoProxyOriginalLease {
	readonly blob: Blob;
	readonly fingerprint: VideoProxyCandidateOriginalIdentity;
	assertCurrent(): void;
	release(): Promise<void>;
}

const SHA256 = /^[a-f0-9]{64}$/u;

/** @internal Capture one repository lease and own its cleanup even when validation refuses. */
export async function captureVideoProxyOriginalLease(
	value: unknown,
): Promise<CapturedVideoProxyOriginalLease> {
	if (!value || typeof value !== 'object') throw new TypeError('A video proxy original lease is required.');
	const rawTarget = value as OriginalLeasePort;
	const releaseDescriptor = Object.getOwnPropertyDescriptor(value, 'release');
	const rawRelease = releaseDescriptor && Object.hasOwn(releaseDescriptor, 'value')
		? releaseDescriptor.value : null;
	const releaseInvalid = async (): Promise<void> => {
		if (typeof rawRelease !== 'function') throw new TypeError('A video proxy original lease requires a release function.');
		await Reflect.apply(rawRelease, rawTarget, []) as Awaitable<void>;
	};
	try {
		const raw = closedRecord(value, ['blob', 'fingerprint', 'assertCurrent', 'release'], 'video proxy original lease');
		if (typeof raw.assertCurrent !== 'function' || raw.release !== rawRelease) {
			throw new TypeError('A video proxy original lease requires stable currentness and release functions.');
		}
		const assertCurrent = raw.assertCurrent as () => void;
		const release = rawRelease as () => Awaitable<void>;
		const blob = raw.blob as Blob;
		const fingerprint = captureIdentity(raw.fingerprint);
		const receiver = Object.freeze({ blob, fingerprint, assertCurrent, release });
		let released = false;
		return Object.freeze({
			blob,
			fingerprint,
			assertCurrent: () => { Reflect.apply(assertCurrent, receiver, []); },
			async release() {
				if (released) return;
				released = true;
				await Reflect.apply(release, receiver, []) as Awaitable<void>;
			},
		});
	} catch (error) {
		try {
			await releaseInvalid();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Video proxy lease validation and cleanup both failed.');
		}
		throw error;
	}
}

export async function releaseVideoProxyOriginalLease(
	lease: CapturedVideoProxyOriginalLease | null,
	noFailure: unknown,
): Promise<unknown> {
	if (!lease) return noFailure;
	try {
		await lease.release();
		return noFailure;
	} catch (error) {
		return error;
	}
}

export function sameVideoProxyOriginalIdentity(
	left: VideoProxyCandidateOriginalIdentity,
	right: VideoProxyCandidateOriginalIdentity,
): boolean {
	return left.authority === right.authority && left.projectId === right.projectId
		&& left.sourceId === right.sourceId && left.storageKey === right.storageKey
		&& left.mimeType === right.mimeType && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256 && left.generationToken === right.generationToken;
}

function captureIdentity(value: unknown): VideoProxyCandidateOriginalIdentity {
	const raw = closedRecord(value, [
		'authority', 'projectId', 'sourceId', 'storageKey', 'mimeType',
		'byteLength', 'sha256', 'generationToken',
	], 'video proxy original fingerprint');
	if (raw.authority !== 'owned' && raw.authority !== 'linked') {
		throw new RangeError('The video proxy original authority kind is invalid.');
	}
	const sha256 = string(raw.sha256, 'original sha256');
	if (!SHA256.test(sha256)) throw new TypeError('The video proxy original SHA-256 is invalid.');
	return Object.freeze({
		authority: raw.authority,
		projectId: string(raw.projectId, 'original projectId'),
		sourceId: string(raw.sourceId, 'original sourceId'),
		storageKey: string(raw.storageKey, 'original storageKey'),
		mimeType: videoMimeType(raw.mimeType),
		byteLength: positiveInteger(raw.byteLength, 'original byteLength'),
		sha256,
		generationToken: string(raw.generationToken, 'original generationToken'),
	});
}

function closedRecord(value: unknown, allowed: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a closed object.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a closed object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== allowed.length || keys.some((key) => typeof key !== 'string' || !allowed.includes(key))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const result: Record<string, unknown> = {};
	for (const key of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
		}
		result[key] = descriptor.value;
	}
	return result;
}

function string(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function videoMimeType(value: unknown): string {
	const result = string(value, 'original MIME type');
	if (!/^video\/[a-z0-9!#$&^_.+\-]+$/u.test(result)) throw new TypeError('The original MIME type is invalid.');
	return result;
}
