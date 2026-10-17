/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from '../../photo-library-develop-port-v2.ts';
import { capturePhotoLibraryDevelopPortV2 } from './photo-library-workflow-develop.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

/** Capture the selected Session's separately admitted, whole-photo legacy capability. */
export function capturePhotoLibraryLegacyDevelopCurrentV1(session: Readonly<PhotoLibrarySessionPortCurrentV1>,
	signal?: AbortSignal): Readonly<PhotoLibraryDevelopPortV2> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	try {
		const owner = session.legacyDevelop;
		if (owner === undefined) throw new Error('Selected Current Session has no legacy Develop capability.');
		const captured = capturePhotoLibraryDevelopPortV2(owner, signal);
		check(); return captured;
	} catch (error) { check(); throw error; }
}
