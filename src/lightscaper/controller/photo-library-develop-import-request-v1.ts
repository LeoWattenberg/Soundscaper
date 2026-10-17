/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportRequestV1 } from '../../common/editor/photo-library-develop-import-port-v1.ts';
import { detachPhotoLibraryImportDevelopPresetV1 } from '../../common/editor/controller/shared/photo-library-import-gesture-v1.ts';
import { field, record } from '../catalog/value-validation.ts';
import { admitPhotoLibraryImportRequestV1 } from './photo-library-import-request.ts';

/** Versioned optional capability leaves the old closed import-request family intact. */
export function admitPhotoLibraryDevelopImportRequestV1(value: unknown): PhotoLibraryDevelopImportRequestV1 {
	const input = record(value, 'Develop preset import request', ['schemaVersion', 'developPreset', 'settings', 'signal', 'onAcknowledged'], ['schemaVersion', 'developPreset']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported Develop preset import request version.');
	const developPreset = detachPhotoLibraryImportDevelopPresetV1(field(input, 'developPreset'));
	const options = Object.fromEntries(['settings', 'signal', 'onAcknowledged'].filter(key => Object.hasOwn(input, key)).map(key => [key, field(input, key)]));
	return Object.freeze({ ...admitPhotoLibraryImportRequestV1(options), schemaVersion: 1, developPreset });
}
