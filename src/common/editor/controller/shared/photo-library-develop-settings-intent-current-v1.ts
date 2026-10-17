/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../closed-domain-value.ts';
import type { PhotoLibraryDevelopSettingsCurrentV1 } from '../../photo-library-develop-port-current-v1.ts';
import { detachPhotoLibraryDevelopSettingsCurrentV1 } from './photo-library-develop-command-current-v1.ts';
import { developSettingsId, developSettingsRevision } from './photo-library-develop-settings-intent-v2.ts';

export interface PhotoDevelopSettingsSourceCurrentV1 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly photoId: string;
	readonly versionId: string;
	readonly revision: number;
	readonly develop: PhotoLibraryDevelopSettingsCurrentV1;
}

/** Capture the complete dirty draft and selected native authority before waits. */
export function detachPhotoDevelopSettingsSourceCurrentV1(value: unknown): Readonly<PhotoDevelopSettingsSourceCurrentV1> {
	const input = record(value, 'Current Develop settings source', ['schemaVersion', 'catalogId', 'photoId', 'versionId', 'revision', 'develop']);
	const read = (key: string) => field(input, key, 'Current Develop settings source');
	if (read('schemaVersion') !== 3) throw new RangeError('Unsupported Current Develop settings source.');
	return Object.freeze({ schemaVersion: 3, catalogId: developSettingsId(read('catalogId')), photoId: developSettingsId(read('photoId')),
		versionId: developSettingsId(read('versionId')), revision: developSettingsRevision(read('revision')),
		develop: detachPhotoLibraryDevelopSettingsCurrentV1(read('develop')) });
}
