/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportRequestOptionsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import { normalizePhotoImportSettingsV1 } from '../import/photo-import-settings-v1.ts';
import { field, record } from '../catalog/value-validation.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

/** Snapshot authored settings and observer behavior before lazy session ownership. */
export function admitPhotoLibraryImportRequestV1(value: unknown = {}): PhotoLibraryImportRequestOptionsV1 {
	const input = record(value, 'photo library import request', ['settings', 'signal', 'onAcknowledged'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	const cancellation = admitPhotoLibraryQueryBuildRequestV1({ signal });
	const settings = Object.hasOwn(input, 'settings') ? field(input, 'settings') : undefined;
	const observer = Object.hasOwn(input, 'onAcknowledged') ? field(input, 'onAcknowledged') : undefined;
	if (observer !== undefined && typeof observer !== 'function') throw new TypeError('Photo import requires an acknowledgment observer function.');
	return Object.freeze({ ...cancellation, ...(settings === undefined ? {} : { settings: normalizePhotoImportSettingsV1(settings) }),
		onAcknowledged: observer as PhotoLibraryImportRequestOptionsV1['onAcknowledged'] });
}
