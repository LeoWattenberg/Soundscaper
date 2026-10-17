/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../common/editor/closed-domain-value.ts';
import { id } from '../catalog/value-validation.ts';

export interface PhotoLibraryWriteAuthorityV1 {
	readonly signal: AbortSignal;
	assertActive(): void;
}

type LockPort = Pick<LockManager, 'request'> | null;
const NativeController = AbortController;
const abort = AbortController.prototype.abort;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const check = AbortSignal.prototype.throwIfAborted;

/** Shared with the legacy initializer; release it before acquiring selected namespace leases. */
export function withPhotoLibraryInitializationLockV1<Result>(locks: LockPort,
	operation: (authority: PhotoLibraryWriteAuthorityV1) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
	return hold(locks, ['lightscaper-photo-catalog:photo-library-default'], operation, signal);
}

/** Legacy sessions share this logical catalog lease; restored libraries use physical leases. */
export function withPhotoLibraryLegacyCatalogLockV1<Result>(locks: LockPort, catalogId: string,
	operation: (authority: PhotoLibraryWriteAuthorityV1) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
	return hold(locks, [`lightscaper-photo-catalog:${id(catalogId, 'catalog ID')}`], operation, signal);
}

/** Serializes restore and recovery; native request completion owns the lease lifetime. */
export function withPhotoLibraryRestoreLockV1<Result>(locks: LockPort,
	operation: (authority: PhotoLibraryWriteAuthorityV1) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
	return hold(locks, ['lightscaper-photo-library:restore'], operation, signal);
}

/** Physical names distinguish libraries whose archived catalog IDs happen to be identical. */
export function withPhotoLibraryNamespaceLocksV1<Result>(locks: LockPort, databaseNames: readonly string[],
	operation: (authority: PhotoLibraryWriteAuthorityV1) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
	const names = readClosedDomainArray(databaseNames, 'photo library database names', 1, 2).map(value => {
		if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
			throw new TypeError('Photo library database name requires a bounded identifier.');
		}
		return `lightscaper-photo-library:namespace:${value}`;
	}).sort();
	if (new Set(names).size !== names.length) throw new TypeError('Photo library database names must be distinct.');
	return hold(locks, names, operation, signal);
}

async function hold<Result>(locks: LockPort, names: readonly string[],
	operation: (authority: PhotoLibraryWriteAuthorityV1) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
	if (typeof operation !== 'function') throw new TypeError('Photo library lease operation is required.');
	const request = locks?.request;
	if (typeof request !== 'function') throw new Error('Durable photo libraries require browser namespace locks.');
	const stop = new NativeController();
	const forward = () => { Reflect.apply(abort, stop, [Reflect.apply(reason, signal!, [])]); };
	if (signal !== undefined) {
		// Intrinsic reads authenticate the real signal and retain opaque reasons without inspection.
		const cancelled = Reflect.apply(aborted, signal, []) as boolean;
		Reflect.apply(add, signal, ['abort', forward, { once: true }]);
		if (cancelled) forward();
	}
	let active = true;
	const authority = Object.freeze({ signal: stop.signal, assertActive() {
		if (!active) throw new Error('Photo library write authority is closed.');
		Reflect.apply(check, stop.signal, []);
	} });
	const acquire = async (index: number): Promise<Result> => {
		authority.assertActive();
		if (index === names.length) return operation(authority);
		return Reflect.apply(request, locks, [names[index], { mode: 'exclusive', ifAvailable: true },
			async (lock: Lock | null): Promise<Result> => {
				if (!lock) throw new Error('Another window is writing this photo library namespace.');
				try { return await acquire(index + 1); }
				finally { if (index === names.length - 1) active = false; }
			}]) as Promise<Result>;
	};
	try { return await acquire(0); }
	finally {
		active = false;
		if (signal !== undefined) Reflect.apply(remove, signal, ['abort', forward]);
	}
}
