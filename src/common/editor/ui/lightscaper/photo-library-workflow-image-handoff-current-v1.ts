/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { PhotoLibraryImageHandoffPortV2 } from '../../photo-library-image-handoff-port-v2.ts';
import type { PhotoFramescaperHandoffTargetCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-download-current-v1.ts';
import { capturePhotoLibraryDevelopPortCurrentV1 } from './photo-library-workflow-develop-current-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../../../lightscaper/storage/photo-develop-preset-read-v2.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Capture the actual Current child before saved reads yield. Rechecks stay
 * within the selected generation and never borrow a legacy Develop projection. */
export async function preparePhotoLibraryImageHandoffCurrentV1(owner: PhotoLibrarySessionPortCurrentV1, photoId: string,
	signal: AbortSignal, checked: () => void): Promise<Readonly<PhotoFramescaperHandoffTargetCurrentV1>> {
	checked();
	const handoff = owner.imageHandoffCurrent;
	const method = handoff && Object.getOwnPropertyDescriptor(handoff, 'withCapture')?.value as unknown;
	if (!handoff || typeof method !== 'function') throw new Error('Current editable photo handoff is unavailable.');
	const develop = capturePhotoLibraryDevelopPortCurrentV1(owner.develop, signal);
	const snapshot = await develop.read({ schemaVersion: 3, photoId }, { signal }); checked();
	if (snapshot.photoId !== photoId || snapshot.versionId !== snapshot.activeVersionId) throw new Error('The active photo selection changed.');
	const binding = Object.freeze({ catalogId: snapshot.catalogId, photoId, versionId: snapshot.activeVersionId, expectedRevision: snapshot.revision });
	const checkCurrent = async (caller: AbortSignal) => {
		check(caller); checked(); const joined = AbortSignal.any([caller, signal]);
		const latest = await develop.read({ schemaVersion: 3, photoId }, { signal: joined }); checked(); check(joined);
		if (latest.catalogId !== binding.catalogId || latest.photoId !== binding.photoId || latest.activeVersionId !== binding.versionId
			|| latest.versionId !== binding.versionId || latest.revision !== binding.expectedRevision) throw new Error('The active saved photo changed.');
	};
	const capture = Object.freeze<PhotoLibraryImageHandoffPortV2>({ async withCapture(request, consume, options = {}) {
		checked(); const { signal: caller } = readPhotoDevelopSignalOptionsV2(options);
		const joined = caller ? AbortSignal.any([caller, signal]) : signal;
		const result = await Reflect.apply(method, handoff, [request, consume, { signal: joined }]) as Awaited<ReturnType<typeof consume>>;
		checked(); check(joined); return result;
	} });
	return Object.freeze({ schemaVersion: 2, binding, capture, checkCurrent });
}
