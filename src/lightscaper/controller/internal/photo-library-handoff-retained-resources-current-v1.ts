/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBrushMaskResourceReferenceV1 } from '../../../common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1, type PhotoResourceReferencesCurrentV1 } from '../../catalog/photo-resource-reachability-current-v1.ts';

/** Portable handoff admits the whole saved Photo before walking every retained
 * declaration. Scalar references confer no body or publication authority. */
export function preparePhotoLibraryHandoffRetainedResourcesCurrentV1(value: unknown): Readonly<{
	photo: Readonly<PhotoDocumentCurrentV1>; references: Readonly<PhotoResourceReferencesCurrentV1>;
}> {
	const photo = normalizePhotoDocumentCurrentV1(value);
	for (const version of photo.versions) {
		for (const develop of [version.develop, ...(version.workspace?.entries.map(entry => entry.develop) ?? []),
			...(version.workspace?.snapshots.map(snapshot => snapshot.develop) ?? [])]) {
			for (const graph of develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
		}
	}
	const collector = createPhotoResourceReachabilityCurrentV1(); collector.addPhoto(photo);
	return Object.freeze({ photo, references: collector.finish() });
}
