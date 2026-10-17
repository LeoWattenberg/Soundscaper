/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1, type PhotoResourceReferencesCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../storage/photo-develop-preset-row-current-v1.ts';

export interface PhotoCatalogArchiveReachabilityCurrentV1 {
	addPhoto(value: unknown): void;
	addPresetRow(value: unknown, catalogId: string): void;
	finish(): Readonly<PhotoResourceReferencesCurrentV1>;
}

/** Portable input admission is separate from the generic metadata ledger.
 * Every declaration is checked, including disabled, unbound and unused ones.
 * Neither this scalar closure nor preset metadata grants body authority. */
export function createPhotoCatalogArchiveReachabilityCurrentV1(): Readonly<PhotoCatalogArchiveReachabilityCurrentV1> {
	const closure = createPhotoResourceReachabilityCurrentV1();
	let sealed = false;
	return Object.freeze({ addPhoto(value: unknown) {
		if (sealed) throw new Error('The archive resource collector is sealed.');
		const photo = normalizePhotoDocumentCurrentV1(value);
		for (const version of photo.versions) {
			admitInputs(version.develop);
			for (const entry of version.workspace?.entries ?? []) admitInputs(entry.develop);
			for (const snapshot of version.workspace?.snapshots ?? []) admitInputs(snapshot.develop);
		}
		closure.addPhoto(photo);
	}, addPresetRow(value: unknown, catalogId: string) {
		if (sealed) throw new Error('The archive resource collector is sealed.');
		const row = normalizePhotoDevelopPresetRowCurrentV1(value, catalogId);
		for (const preset of row.presets) admitInputs(preset.settings.develop);
		closure.addPresetRow(row, catalogId);
	}, finish() { sealed = true; return closure.finish(); } });
}
function admitInputs(develop: ImageDevelopStateThroughV4): void {
	for (const mask of develop.masks) for (const input of mask.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
}
