/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportSettingsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { emptyPhotoMetadataV1, normalizePhotoMetadataV1 } from '../catalog/photo-metadata.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDocumentV1 } from '../catalog/types.ts';
import { array, field, integer, record, uniqueIds } from '../catalog/value-validation.ts';
import { expandPhotoImportNameV1, normalizePhotoImportRenameV1 } from './photo-import-name-template-v1.ts';

const authoredFields = ['title', 'caption', 'creator', 'copyright', 'location'] as const;
const getFileName = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const plans = new WeakSet<object>();

export interface PhotoImportSettingsPlanV1 {
	readonly catalogId: string;
	readonly rootRevision: number;
	readonly settings: PhotoLibraryImportSettingsV1;
	readonly names: readonly Readonly<{ sourceName: string; outputName: string }>[];
}

export function normalizePhotoImportSettingsV1(value: unknown = undefined): PhotoLibraryImportSettingsV1 {
	if (value === undefined) return Object.freeze({ rename: null, metadata: Object.freeze({}), keywordIds: Object.freeze([]) });
	const input = record(value, 'photo import settings', ['rename', 'metadata', 'keywordIds']);
	const metadata = record(field(input, 'metadata'), 'import authored metadata', authoredFields, []);
	const present = authoredFields.filter(key => Object.hasOwn(metadata, key));
	const authored = Object.fromEntries(present.map(key => [key, field(metadata, key)]));
	const normalized = normalizePhotoMetadataV1({ ...emptyPhotoMetadataV1('Photo'), ...authored });
	return Object.freeze({ rename: normalizePhotoImportRenameV1(field(input, 'rename')),
		metadata: Object.freeze(Object.fromEntries(present.map(key => [key, normalized[key]]))),
		keywordIds: uniqueIds(field(input, 'keywordIds'), 'import keyword IDs', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships) });
}

/** Fresh catalog and every selected name are admitted without reading original bodies. */
export function planPhotoImportSettingsV1(files: unknown, catalog: unknown, value: unknown = undefined): Readonly<PhotoImportSettingsPlanV1> {
	const settings = normalizePhotoImportSettingsV1(value);
	const root = validateLightscaperDocumentV1(catalog);
	if (root.kind !== 'photo-catalog') throw new TypeError('Photo import settings require the current catalog root.');
	const available = new Set(root.keywords.map(keyword => keyword.id));
	for (const key of settings.keywordIds) if (!available.has(key)) throw new ReferenceError('Import references a missing keyword.');
	const selected = array(files, 'selected photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture);
	const names = selected.map((file, index) => {
		const sourceName: unknown = Reflect.apply(getFileName, file, []);
		if (typeof sourceName !== 'string') throw new TypeError('Photo import requires genuine File names.');
		return Object.freeze({ sourceName, outputName: expandPhotoImportNameV1(sourceName, index, settings.rename) });
	});
	const plan = Object.freeze({ catalogId: root.id, rootRevision: root.revision, settings, names: Object.freeze(names) });
	plans.add(plan); return plan;
}

/** Apply authored choices after extraction; source facts and original bindings stay intact. */
export function applyPhotoImportSettingsV1(value: unknown, plan: Readonly<PhotoImportSettingsPlanV1>, selectedIndex: number): PhotoDocumentV1 {
	if (!plan || !plans.has(plan)) throw new TypeError('Photo import requires its admitted transient settings plan.');
	const index = integer(selectedIndex, 0, plan.names.length - 1, 'selected photo index');
	const selected = plan.names[index]!;
	const photo = validateLightscaperDocumentV1(value);
	if (photo.kind !== 'photo' || photo.catalogId !== plan.catalogId || photo.revision !== 0
		|| photo.original.name !== selected.sourceName || photo.metadata.fileName !== selected.sourceName) {
		throw new TypeError('Prepared photo differs from its selected source name or catalog.');
	}
	const updated = validateLightscaperDocumentV1({ ...photo,
		metadata: { ...photo.metadata, ...plan.settings.metadata, fileName: selected.outputName },
		keywordIds: [...new Set([...photo.keywordIds, ...plan.settings.keywordIds])] });
	if (updated.kind !== 'photo') throw new TypeError('Import settings require a photo document.');
	return updated;
}
