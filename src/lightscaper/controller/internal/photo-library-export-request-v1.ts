/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryExportSidecarRequest } from '../../../common/editor/photo-library-session-port-v2.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, record } from '../../catalog/value-validation.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

/** The pending Session admission owns the detached scalar binding before readiness. */
export function admitPhotoLibraryExportSidecarBindingV1(value: unknown): Readonly<PhotoLibraryExportSidecarRequest> {
	const request = record(value, 'photo sidecar request', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
	return Object.freeze({ catalogId: id(field(request, 'catalogId'), 'sidecar catalog ID'), photoId: id(field(request, 'photoId'), 'sidecar photo ID'),
		versionId: id(field(request, 'versionId'), 'sidecar version ID'), expectedRevision: integer(field(request, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'sidecar revision') });
}
export function readPhotoLibraryExportSignalOptionsV1(value: unknown): Readonly<{ signal?: AbortSignal }> {
	if (value !== null && typeof value === 'object') {
		const signal = Object.getOwnPropertyDescriptor(value, 'signal');
		if (signal && Object.hasOwn(signal, 'value') && signal.value !== undefined) Reflect.apply(CHECK, signal.value, []);
	}
	return readPhotoDevelopSignalOptionsV2(value);
}
