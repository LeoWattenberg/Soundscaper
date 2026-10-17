/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV2, PhotoLibraryDevelopPresetV2 } from '../../common/editor/photo-library-develop-presets-port-v2.ts';
import { mergeImageDevelopSettingsV2 } from '../../common/editor/imaging/image-develop-settings-v2.ts';
import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1 } from '../catalog/photo-develop-workspace-v1.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, upgradePhotoDevelopWorkspaceV2 } from '../catalog/photo-develop-workspace-v2.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { borrowPhotoDevelopPresetEntryReaderV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { readPhotoDevelopPresetV2 } from '../storage/photo-develop-presets-v2.ts';
import type { PhotoDevelopPresetReadPortV1 } from '../storage/photo-develop-presets-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
type Apply = (photo: unknown) => PhotoDocumentV1 | PhotoDocumentV2;
export function borrowPhotoImportDevelopPresetReaderV2(repository: PhotoDevelopPresetReadPortV1 | undefined) {
	if (!repository) throw new TypeError('Develop preset import requires its selected settings capability.');
	return Object.freeze({ readEntry: borrowPhotoDevelopPresetEntryReaderV2(repository) });
}
export function borrowPhotoImportDevelopPresetV2(repository: PhotoDevelopPresetReadPortV1 | undefined,
	choice: PhotoLibraryDevelopPresetReadV2): (catalogId: string, signal: AbortSignal) => Promise<Apply> {
	const input = record(choice, 'Import Develop preset', ['schemaVersion', 'catalogId', 'presetId', 'expectedRevision']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported import Develop preset version.');
	const selected = Object.freeze({ catalogId: id(field(input, 'catalogId'), 'preset catalog ID'),
		presetId: id(field(input, 'presetId'), 'preset ID'), expectedRevision: integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'preset revision') });
	const reader = borrowPhotoImportDevelopPresetReaderV2(repository);
	return async (catalogId, signal) => {
		Reflect.apply(CHECK, signal, []);
		if (catalogId !== selected.catalogId) throw new RangeError('Import Develop preset belongs to another catalog.');
		const body = await readPhotoDevelopPresetV2(reader, catalogId, selected.presetId, selected.expectedRevision, { signal });
		Reflect.apply(CHECK, signal, []); return captured(body.preset, catalogId);
	};
}
function captured(preset: PhotoLibraryDevelopPresetV2, catalogId: string): Apply {
	return value => {
		const photo = normalizePhotoDocumentV1OrV2(value);
		if (photo.catalogId !== catalogId || photo.revision !== 0) throw new RangeError('Import presets require an unpublished photo in the current catalog.');
		let successor = photo.schemaVersion === 2;
		const versions = photo.versions.map(version => {
			if (version.id !== photo.activeVersionId) return version;
			const develop = mergeImageDevelopSettingsV2({ schemaVersion: 2, target: version.develop, settings: preset.settings });
			const step = { label: preset.identity.name, createdAt: version.createdAt };
			if (develop.processVersion === 2 || version.workspace?.schemaVersion === 2) {
				successor = true;
				const workspace = version.workspace ? upgradePhotoDevelopWorkspaceV2(version.workspace)
					: createPhotoDevelopWorkspaceV2(version.develop, { label: 'Imported', createdAt: version.createdAt });
				return { ...version, develop, workspace: commitPhotoDevelopWorkspaceV2(workspace, develop, step) };
			}
			const workspace = version.workspace ?? createPhotoDevelopWorkspaceV1(version.develop, { label: 'Imported', createdAt: version.createdAt });
			return { ...version, develop, workspace: commitPhotoDevelopWorkspaceV1(workspace, develop, step) };
		});
		return normalizePhotoDocumentV1OrV2({ ...photo, schemaVersion: successor ? 2 : 1, versions });
	};
}
