/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperImageSourceV2, framescaperImageSourceResourceReferencesV2, type FramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { planImageGeometryV1 } from '../../common/editor/imaging/image-geometry-plan-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../common/editor/video-image-geometry-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../catalog/catalog-root.ts';
import { defaultPhotoDevelopV1 } from '../catalog/develop-state.ts';
import { validatePhotoCatalogReferencesV1 } from '../catalog/photo-document.ts';
import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { field, id, record, unique, utcTimestamp } from '../catalog/value-validation.ts';
import { assertPhotoDevelopHandoffMasksV1 } from './photo-develop-handoff-masks-v1.ts';

/** Pure destination record composition, without original/LUT body authority.
 * The publication allocator must also prove these identities are unused in its
 * selected repository; a catalog root does not enumerate existing photo rows. */
export function createPhotoFramescaperHandoffPhotoV1(value: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	const input = record(value, 'photo handoff composition', ['source', 'catalog', 'ownership', 'createdAt', 'metadata', 'extractedMetadata']);
	const source = normalizeFramescaperImageSourceV2(field(input, 'source'));
	const catalog = normalizePhotoCatalogRootV1(field(input, 'catalog'));
	const createdAt = utcTimestamp(field(input, 'createdAt'), 'destination photo creation time');
	validateNaturalGeometry(source);
	const resources = framescaperImageSourceResourceReferencesV2(source), origin = source.provenance.origin;
	const virtual = origin.schemaFamily === 'lightscaper' && origin.versionKind === 'virtual-copy';
	const keys = ['photoId', 'originalId', 'storageKey', 'masterVersionId', ...(virtual ? ['selectedVersionId'] : [])];
	const owner = record(field(input, 'ownership'), 'photo handoff ownership', keys);
	const ids = keys.map(key => id(field(owner, key), `destination ${key}`));
	unique(ids, 'fresh destination identities');
	const incoming = origin.schemaFamily === 'lightscaper' ? [origin.catalogId, origin.photoId, origin.versionId]
		: [origin.projectId, origin.sourceId, origin.sequenceId, origin.clipId];
	const retained = new Set([source.id, source.storageKey, catalog.id, ...incoming, ...resources.map(resource => resource.storageKey)]);
	if (ids.some(identity => retained.has(identity))) throw new RangeError('Fresh destination identities collide with retained handoff identities.');
	const [photoId, originalId, storageKey, masterVersionId, selectedVersionId] = ids;
	const selected = { id: virtual ? selectedVersionId : masterVersionId, kind: virtual ? 'virtual-copy' : 'master',
		name: origin.schemaFamily === 'lightscaper' ? origin.versionName : frameMasterName(source.name),
		createdAt: origin.schemaFamily === 'lightscaper' ? origin.versionCreatedAt : createdAt, develop: source.develop };
	const versions = virtual ? [{ id: masterVersionId, kind: 'master', name: 'Original', createdAt, develop: defaultPhotoDevelopV1() }, selected] : [selected];
	const photo = normalizePhotoDocumentV1OrV2({ schemaFamily: 'lightscaper', schemaVersion: source.develop.processVersion, kind: 'photo',
		id: photoId, catalogId: catalog.id, revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: originalId, name: source.provenance.original.exactName,
			mimeType: source.original.mimeType, storageKey, contentSha256: source.original.sha256, byteLength: source.original.byteLength,
			width: source.canonical.width, height: source.canonical.height, hasAlpha: source.canonical.hasAlpha, retention: 'managed' },
		metadata: field(input, 'metadata'), extractedMetadata: field(input, 'extractedMetadata'), folderId: null, collectionIds: [], keywordIds: [],
		rating: 0, flag: 'unflagged', colorLabel: 'none', versions, activeVersionId: selected.id });
	validatePhotoCatalogReferencesV1(photo, catalog);
	return photo;
}

function validateNaturalGeometry(source: Readonly<FramescaperImageSourceV2>): void {
	const develop = source.develop;
	assertPhotoDevelopHandoffMasksV1(develop, source.canonical.width, source.canonical.height);
	let plan = planImageGeometryV1({ schemaVersion: 1, ...develop.geometry, perspective: null }, source.canonical.width, source.canonical.height);
	for (const effect of develop.effects) {
		if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
			plan = planImageGeometryV1(imageGeometryForVideoEffectV1(effect, plan.width, plan.height), plan.width, plan.height);
		}
	}
	if (plan.width !== source.developed.width || plan.height !== source.developed.height) throw new RangeError('Editable photo handoff natural geometry differs from its saved recipe.');
}

/** A Frame display label may be longer than a Photo version label; this never
 * changes the separately retained exact original filename or saved recipe. */
function frameMasterName(value: string): string {
	let result = '';
	for (const character of value) {
		if (result.length + character.length > 256) break;
		result += character;
	}
	return result.trim() ? result : 'Imported image';
}
