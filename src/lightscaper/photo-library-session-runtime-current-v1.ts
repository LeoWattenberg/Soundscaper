/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibrarySessionForProfileV1, type PhotoLibrarySessionRuntimeOptionsV3 } from './photo-library-session-runtime-kernel-v3.ts';
import { assertPhotoStackQuerySignalV1 } from './catalog/photo-stack-query-signal-v1.ts';
import type { PhotoLibrarySessionCurrentV1 } from './controller/photo-library-session-current-v1.ts';
export type PhotoLibrarySessionRuntimeOptionsCurrentV1 = PhotoLibrarySessionRuntimeOptionsV3;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** The explicit Current frontdoor observes an inert native signal before any
 * option enumeration; the legacy V3 frontdoor retains its previous ordering. */
export async function createPhotoLibrarySessionCurrentV1(options: PhotoLibrarySessionRuntimeOptionsCurrentV1): Promise<PhotoLibrarySessionCurrentV1> {
	const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
	const signal = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as AbortSignal | undefined : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	try { return await createPhotoLibrarySessionForProfileV1('current3', options) as PhotoLibrarySessionCurrentV1; }
	catch (error) { if (signal !== undefined) Reflect.apply(CHECK, signal, []); throw error; }
}
