/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { formatImageExportFilenameV1 } from '../../common/editor/image-export-filename-v1.ts';
import { capturePhotoRasterExportOutput, type PhotoRasterExportOutput } from './photo-raster-export.ts';

export const PHOTO_RASTER_EXPORT_BATCH_MAXIMUM_MEMBERS_V1 = 256;
export interface PhotoRasterExportBatchMemberV1 {
	readonly jobId: string;
	readonly index: number;
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
	readonly sourceFileName: string;
	readonly fileName: string;
}
export interface PhotoRasterExportBatchV1 {
	readonly schemaVersion: 1;
	readonly batchId: string;
	readonly format: 'png' | 'jpeg';
	readonly members: readonly Readonly<PhotoRasterExportBatchMemberV1>[];
	readonly output?: Readonly<PhotoRasterExportOutput>;
	readonly sidecarEnabled?: true;
}

/** Bounded, detached in-session work description. It grants no destination,
 * original or LUT authority and declares no persisted recovery protocol. */
export function capturePhotoRasterExportBatchV1(value: unknown): Readonly<PhotoRasterExportBatchV1> {
	const name = 'Photo raster batch', input = record(value, name,
		['schemaVersion', 'batchId', 'format', 'filenameTemplate', 'members', 'output', 'sidecarEnabled'],
		['schemaVersion', 'batchId', 'format', 'filenameTemplate', 'members']);
	if (field(input, 'schemaVersion', name) !== 1) throw new RangeError('Unsupported photo raster batch version.');
	const batchId = text(field(input, 'batchId', name), 64), format = field(input, 'format', name);
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported photo raster batch format.');
	const template = text(field(input, 'filenameTemplate', name), 256);
	const sidecar = Object.hasOwn(input, 'sidecarEnabled') ? field(input, 'sidecarEnabled', name) : false;
	if (typeof sidecar !== 'boolean') throw new TypeError('Photo raster batch sidecar selection must be explicit.');
	const output = Object.hasOwn(input, 'output') ? capturePhotoRasterExportOutput(field(input, 'output', name)) : undefined;
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
	return Object.freeze({ schemaVersion: 1, batchId, format, members: Object.freeze(members), ...(output ? { output } : {}), ...(sidecar ? { sidecarEnabled: true } : {}) });
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
