/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../common/editor/scape-blob-budget.ts';
import { field, integer, record } from '../catalog/value-validation.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

export interface PhotoLibraryAdmittedBackupRequestV1 {
	readonly signal?: AbortSignal;
	readonly writable?: WritableStream<Uint8Array>;
	readonly maximumBlobBytes: number;
}
const nativeLocked = Object.getOwnPropertyDescriptor(WritableStream.prototype, 'locked')!.get!;

/** Scalar admission borrows an unacquired destination; its caller still owns it. */
export function admitPhotoLibraryBackupRequestV1(value: unknown = {}): PhotoLibraryAdmittedBackupRequestV1 {
	const input = record(value, 'photo backup options', ['signal', 'writable', 'maximumBlobBytes'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	const cancellation = admitPhotoLibraryQueryBuildRequestV1({ signal });
	const writable = Object.hasOwn(input, 'writable') ? field(input, 'writable') : undefined;
	if (writable !== undefined) {
		if (!(writable instanceof WritableStream) || Object.getPrototypeOf(writable) !== WritableStream.prototype
			|| ['getWriter', 'locked', 'abort', 'close'].some(key => Object.hasOwn(writable, key))) {
			throw new TypeError('Photo backup requires an unmodified native writable stream.');
		}
		if ((Reflect.apply(nativeLocked, writable, []) as unknown) !== false) throw new TypeError('Photo backup destination is already locked.');
	}
	const maximumBlobBytes = Object.hasOwn(input, 'maximumBlobBytes')
		? integer(field(input, 'maximumBlobBytes'), 1, SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES, 'photo backup Blob maximum') : SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES;
	return Object.freeze({ ...cancellation, writable: writable as WritableStream<Uint8Array> | undefined, maximumBlobBytes });
}
