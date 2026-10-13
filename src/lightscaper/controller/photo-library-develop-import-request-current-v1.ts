/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportRequestCurrentV1 } from '../../common/editor/photo-library-develop-import-port-current-v1.ts';
import { readClosedDomainArray } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { admitPhotoLibraryImportRequestV1 } from './photo-library-import-request.ts';

const FILE_NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const FILE_MODIFIED = Object.getOwnPropertyDescriptor(File.prototype, 'lastModified')!.get!;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** Only inert scalar choice and authored options cross this boundary. The
 * native row remains the sole authority for Current recipes and brush bodies. */
export function admitPhotoLibraryDevelopImportRequestCurrentV1(value: unknown): Readonly<PhotoLibraryDevelopImportRequestCurrentV1> {
	const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	const signal: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const input = record(value, 'Current Develop preset import request', ['schemaVersion', 'developPreset', 'settings', 'signal', 'onAcknowledged'], ['schemaVersion', 'developPreset']);
	if (field(input, 'schemaVersion') !== 3) throw new RangeError('Unsupported Current Develop preset import request version.');
	const choice = record(field(input, 'developPreset'), 'Current import Develop preset', ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	if (field(choice, 'schemaVersion') !== 3) throw new RangeError('Unsupported Current import Develop preset version.');
	const developPreset = Object.freeze({ schemaVersion: 3 as const, catalogId: id(field(choice, 'catalogId'), 'preset catalog ID'),
		presetId: id(field(choice, 'presetId'), 'preset ID'), expectedRevision: integer(field(choice, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'preset revision') });
	const options = Object.fromEntries(['settings', 'signal', 'onAcknowledged'].filter(key => Object.hasOwn(input, key)).map(key => [key, field(input, key)]));
	return Object.freeze({ ...admitPhotoLibraryImportRequestV1(options), schemaVersion: 3 as const, developPreset });
}

/** Snapshot dense File identities before any lazy initialization. Intrinsics
 * brand genuine immutable File slots without evaluating borrower shadows. */
export function admitPhotoLibraryDevelopImportFilesCurrentV1(value: unknown): readonly File[] {
	const files = readClosedDomainArray(value, 'selected Current photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture);
	for (const file of files) {
		const name: unknown = Reflect.apply(FILE_NAME, file, []), modified: unknown = Reflect.apply(FILE_MODIFIED, file, []), size: unknown = Reflect.apply(BLOB_SIZE, file, []);
		if (typeof name !== 'string' || typeof modified !== 'number' || typeof size !== 'number') throw new TypeError('Current import requires genuine selected Files.');
	}
	return files as readonly File[];
}
