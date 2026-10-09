/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field, readClosedDomainArray as array } from '../../closed-domain-value.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import { detachPhotoLibraryDevelopSettingsV2 } from './photo-library-develop-command-v2.ts';

export interface PhotoDevelopSettingsSourceV2 {
	readonly schemaVersion: 2;
	readonly catalogId: string;
	readonly photoId: string;
	readonly versionId: string;
	readonly revision: number;
	readonly develop: PhotoLibraryDevelopSettingsV2;
}

/** Capture authored settings and authority before the borrowed host can initialize. */
export function detachPhotoDevelopSettingsSourceV2(value: unknown): PhotoDevelopSettingsSourceV2 {
	const input = record(value, 'Develop settings source', ['schemaVersion', 'catalogId', 'photoId', 'versionId', 'revision', 'develop']);
	const read = (key: string) => field(input, key, 'Develop settings source');
	if (read('schemaVersion') !== 2) throw new RangeError('Unsupported current Develop settings source.');
	return Object.freeze({ schemaVersion: 2, catalogId: developSettingsId(read('catalogId')), photoId: developSettingsId(read('photoId')),
		versionId: developSettingsId(read('versionId')), revision: developSettingsRevision(read('revision')),
		develop: detachPhotoLibraryDevelopSettingsV2(read('develop')) });
}

export function developSettingsIds(value: unknown): readonly string[] {
	const entries = array(value, 'Develop selected photos', 1, 64).map(developSettingsId);
	if (new Set(entries).size !== entries.length) throw new RangeError('Develop selected photos must be unique.');
	return Object.freeze(entries);
}
export function developSettingsId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Develop settings require a stable identity.'); return value;
}
export function developSettingsRevision(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new RangeError('Develop settings require a canonical revision.'); return value;
}
export function developSettingsName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError('Develop settings require a name.'); return value.trim();
}
