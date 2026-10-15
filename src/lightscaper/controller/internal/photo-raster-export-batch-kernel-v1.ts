/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { formatImageExportFilenameV1 } from '../../../common/editor/image-export-filename-v1.ts';
import { capturePhotoRasterExportOutput, type PhotoRasterExportProfileV1 } from '../photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1 } from '../photo-raster-export-output-current-v1.ts';
import { normalizePhotoRasterBatchGraphicIntentV1 } from '../photo-raster-export-batch-graphic-v1.ts';
import type { PhotoRasterExportBatchCurrentV1 } from '../photo-raster-export-batch-current-v1.ts';

export const PHOTO_RASTER_EXPORT_BATCH_MAXIMUM_MEMBERS_V1 = 256;

/** Bounded, detached in-session work description. It grants no destination,
 * original or LUT authority and declares no persisted recovery protocol. */
export function capturePhotoRasterExportBatchForProfileV1(profile: PhotoRasterExportProfileV1, value: unknown): Readonly<PhotoRasterExportBatchCurrentV1> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo export batch profile.');
	const name = 'Photo raster batch', input = record(value, name,
		['schemaVersion', 'batchId', 'format', 'filenameTemplate', 'members', 'output', 'sidecarEnabled', 'graphicWatermark'],
		['schemaVersion', 'batchId', 'format', 'filenameTemplate', 'members']);
	if (field(input, 'schemaVersion', name) !== 1) throw new RangeError('Unsupported photo raster batch version.');
	const batchId = text(field(input, 'batchId', name), 64), format = field(input, 'format', name);
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported photo raster batch format.');
	const template = text(field(input, 'filenameTemplate', name), 256);
	const sidecar = Object.hasOwn(input, 'sidecarEnabled') ? field(input, 'sidecarEnabled', name) : false;
	if (typeof sidecar !== 'boolean') throw new TypeError('Photo raster batch sidecar selection must be explicit.');
	const output = Object.hasOwn(input, 'output') ? profile === 'current3' ? capturePhotoRasterExportOutputCurrentV1(field(input, 'output', name), format)
		: capturePhotoRasterExportOutput(field(input, 'output', name)) : undefined;
	const graphicWatermark = Object.hasOwn(input, 'graphicWatermark') ? normalizePhotoRasterBatchGraphicIntentV1(field(input, 'graphicWatermark', name)) : undefined;
	const identities = new Set<string>(), names = new Set<string>();
	const members = array(field(input, 'members', name), name, 1, PHOTO_RASTER_EXPORT_BATCH_MAXIMUM_MEMBERS_V1).map((value, offset) => {
		const member = record(value, 'Photo raster batch member', ['photoId', 'versionId', 'expectedRevision', 'sourceFileName']);
		const photoId = stableId(field(member, 'photoId', name)), versionId = stableId(field(member, 'versionId', name));
		const revision = field(member, 'expectedRevision', name), sourceFileName = text(field(member, 'sourceFileName', name), 512);
		if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new RangeError('Photo raster batch revision requires a nonnegative integer.');
		const identity = JSON.stringify([photoId, versionId]);
		if (identities.has(identity)) throw new RangeError('Photo raster batch repeats a photo version.');
		identities.add(identity);
		const index = offset + 1, fileName = formatImageExportFilenameV1({ template, sourceFileName, format, index });
		// Conservatively refuse aliases on normalizing/case-insensitive destinations.
		const key = fileName.normalize('NFC').toLowerCase();
		if (names.has(key)) throw new RangeError('Photo raster batch filenames collide.');
		names.add(key);
		return Object.freeze({ jobId: `${batchId}:${index}`, index, photoId, versionId, expectedRevision: revision, sourceFileName, fileName });
	});
	return Object.freeze({ schemaVersion: 1, batchId, format, members: Object.freeze(members), ...(output ? { output } : {}), ...(sidecar ? { sidecarEnabled: true } : {}), ...(graphicWatermark ? { graphicWatermark } : {}) });
}

function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError('Photo raster batch text exceeds its scalar bound.');
	return value;
}

function stableId(value: unknown): string {
	const id = text(value, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new TypeError('Photo raster batch requires stable photo/version identity.');
	return id;
}
