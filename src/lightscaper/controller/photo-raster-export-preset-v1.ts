/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportPresetV1, PhotoExportPresetCommandV1 } from '../../common/editor/photo-library-export-presets-port-v1.ts';
import { formatImageExportFilenameV1 } from '../../common/editor/image-export-filename-v1.ts';
import { capturePhotoRasterExportOutput } from './photo-raster-export.ts';
import { field, id, integer, name, record, text } from '../catalog/value-validation.ts';

export const PHOTO_EXPORT_PRESETS_LIMITS_V1 = Object.freeze({ maximumPresets: 16, maximumRowBytes: 65_536 });
export function normalizePhotoRasterExportPresetV1(value: unknown): Readonly<PhotoRasterExportPresetV1> {
	const input = record(value, 'photo export preset', ['schemaVersion', 'id', 'name', 'format', 'filenameTemplate', 'output', 'sidecarEnabled']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported photo export preset version.');
	const format = field(input, 'format'), sidecarEnabled = field(input, 'sidecarEnabled');
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported photo export preset format.');
	if (typeof sidecarEnabled !== 'boolean') throw new TypeError('Photo export sidecar preference requires a boolean.');
	const filenameTemplate = text(field(input, 'filenameTemplate'), 'photo export filename template', 256, 1);
	// Validate the existing grammar; final source expansion/collision admission
	// still belongs to the actual selected export and its stable member index.
	formatImageExportFilenameV1({ template: filenameTemplate, sourceFileName: 'original.png', index: 1, format });
	const preset = Object.freeze({ schemaVersion: 1 as const, id: id(field(input, 'id'), 'export preset ID'), name: name(field(input, 'name'), 'export preset name'),
		format, filenameTemplate, output: capturePhotoRasterExportOutput(field(input, 'output')), sidecarEnabled });
	checkPhotoExportPresetBytesV1(preset); return preset;
}
export function normalizePhotoExportPresetCommandV1(value: unknown): PhotoExportPresetCommandV1 {
	const input = record(value, 'photo export preset command', ['type', 'expectedRevision', 'preset', 'presetId'], ['type', 'expectedRevision']);
	const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'export preset expected revision');
	if (field(input, 'type') === 'delete') {
		record(input, 'delete export preset', ['type', 'expectedRevision', 'presetId']);
		return Object.freeze({ type: 'delete', expectedRevision, presetId: id(field(input, 'presetId'), 'export preset ID') });
	}
	if (field(input, 'type') !== 'save') throw new RangeError('Unsupported photo export preset command.');
	return Object.freeze({ type: 'save', expectedRevision, preset: normalizePhotoRasterExportPresetV1(field(record(input, 'save export preset', ['type', 'expectedRevision', 'preset']), 'preset')) });
}
export function checkPhotoExportPresetBytesV1(value: unknown): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PHOTO_EXPORT_PRESETS_LIMITS_V1.maximumRowBytes) throw new RangeError('Photo export presets exceed their scalar byte bound.');
}
