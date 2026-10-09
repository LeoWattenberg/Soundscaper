/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV1 } from '../../common/editor/photo-library-develop-presets-port-v1.ts';
import type { ImageDevelopPresetV1 } from '../../common/editor/imaging/image-develop-preset-v1.ts';
import { mergeImageDevelopSettingsV1 } from '../../common/editor/imaging/image-develop-settings-v1.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1 } from '../catalog/photo-develop-workspace-v1.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { borrowPhotoDevelopPresetEntryReader } from '../storage/photo-develop-preset-read.ts';
import { readPhotoDevelopPresetV1, type PhotoDevelopPresetReadPortV1 } from '../storage/photo-develop-presets-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
type Apply = (photo: unknown) => PhotoDocumentV1;

/** Borrow the selected method and receiver before any initialization or writer await. */
export function borrowPhotoImportDevelopPresetReaderV1(repository: PhotoDevelopPresetReadPortV1 | undefined) {
	if (!repository) throw new TypeError('Develop preset import requires its selected settings capability.');
	return Object.freeze({ readEntry: borrowPhotoDevelopPresetEntryReader(repository) });
}

export function borrowPhotoImportDevelopPresetV1(repository: PhotoDevelopPresetReadPortV1 | undefined,
	choice: PhotoLibraryDevelopPresetReadV1): (catalogId: string, signal: AbortSignal) => Promise<Apply> {
	const reader = borrowPhotoImportDevelopPresetReaderV1(repository);
	return async (catalogId, signal) => {
		Reflect.apply(CHECK, signal, []);
		if (catalogId !== choice.catalogId) throw new RangeError('Import Develop preset belongs to another catalog.');
		const body = await readPhotoDevelopPresetV1(reader, catalogId, choice.presetId, choice.expectedRevision, { signal });
		Reflect.apply(CHECK, signal, []);
		// The apply closure owns one detached recipe, not the row's sixteen bodies.
		return captured(body.preset, catalogId);
	};
}

function captured(preset: ImageDevelopPresetV1, catalogId: string): Apply {
	return value => {
		const photo = normalizePhotoDocumentV1(value);
		if (photo.catalogId !== catalogId || photo.revision !== 0) throw new RangeError('Import presets require an unpublished photo in the current catalog.');
		const versions = photo.versions.map(version => {
			if (version.id !== photo.activeVersionId) return version;
			const develop = mergeImageDevelopSettingsV1({ schemaVersion: 1, target: version.develop, settings: preset.settings });
			const workspace = version.workspace ?? createPhotoDevelopWorkspaceV1(version.develop, { label: 'Imported', createdAt: version.createdAt });
			return { ...version, develop, workspace: commitPhotoDevelopWorkspaceV1(workspace, develop,
				{ label: preset.identity.name, createdAt: version.createdAt }) };
		});
		return normalizePhotoDocumentV1({ ...photo, versions });
	};
}
