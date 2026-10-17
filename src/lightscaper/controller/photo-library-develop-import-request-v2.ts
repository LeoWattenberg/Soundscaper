/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportRequestV2 } from '../../common/editor/photo-library-develop-import-port-v2.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { admitPhotoLibraryImportRequestV1 } from './photo-library-import-request.ts';

/** Admit current scalar identities before initialization; recipes stay with selected storage. */
export function admitPhotoLibraryDevelopImportRequestV2(value: unknown): PhotoLibraryDevelopImportRequestV2 {
	const input = record(value, 'Develop preset import request', ['schemaVersion', 'developPreset', 'settings', 'signal', 'onAcknowledged'], ['schemaVersion', 'developPreset']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported Develop preset import request version.');
	const choice = record(field(input, 'developPreset'), 'Import Develop preset', ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	if (field(choice, 'schemaVersion') !== 2) throw new RangeError('Unsupported import Develop preset version.');
	const developPreset = Object.freeze({ schemaVersion: 2 as const, catalogId: id(field(choice, 'catalogId'), 'preset catalog ID'),
		presetId: id(field(choice, 'presetId'), 'preset ID'), expectedRevision: integer(field(choice, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'preset revision') });
	const options = Object.fromEntries(['settings', 'signal', 'onAcknowledged'].filter(key => Object.hasOwn(input, key)).map(key => [key, field(input, key)]));
	return Object.freeze({ ...admitPhotoLibraryImportRequestV1(options), schemaVersion: 2, developPreset });
}
