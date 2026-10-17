/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportPresetCurrentV1, PhotoExportPresetCommandCurrentV1 } from '../../../common/editor/photo-library-export-presets-port-current-v1.ts';
import { formatImageExportFilenameV1 } from '../../../common/editor/image-export-filename-v1.ts';
import { capturePhotoRasterExportOutput } from '../photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1 } from '../photo-raster-export-output-current-v1.ts';
import { field, id, integer, name, record, text } from '../../catalog/value-validation.ts';

export type PhotoExportPresetProfileV1 = 'legacy1' | 'current1';
export const PHOTO_EXPORT_PRESETS_LIMITS_V1 = Object.freeze({ maximumPresets: 16, maximumRowBytes: 65_536 });
export function normalizePhotoRasterExportPresetForProfileV1(profile: PhotoExportPresetProfileV1, value: unknown): Readonly<PhotoRasterExportPresetCurrentV1> {
	if (profile !== 'legacy1' && profile !== 'current1') throw new TypeError('Unsupported fixed export preset profile.');
	const input = record(value, 'photo export preset', ['schemaVersion', 'id', 'name', 'format', 'filenameTemplate', 'output', 'sidecarEnabled']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported photo export preset version.');
	const format = field(input, 'format'), sidecarEnabled = field(input, 'sidecarEnabled');
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported photo export preset format.');
	if (typeof sidecarEnabled !== 'boolean') throw new TypeError('Photo export sidecar preference requires a boolean.');
	const filenameTemplate = text(field(input, 'filenameTemplate'), 'photo export filename template', 256, 1);
	formatImageExportFilenameV1({ template: filenameTemplate, sourceFileName: 'original.png', index: 1, format });
	const presetId = id(field(input, 'id'), 'export preset ID'), label = name(field(input, 'name'), 'export preset name');
	const output = profile === 'current1' ? capturePhotoRasterExportOutputCurrentV1(field(input, 'output'), format) : capturePhotoRasterExportOutput(field(input, 'output'));
	const preset = Object.freeze({ schemaVersion: 1 as const, id: presetId, name: label,
		format, filenameTemplate, output, sidecarEnabled });
	checkPhotoExportPresetBytesV1(preset); return preset;
}
export function normalizePhotoExportPresetCommandForProfileV1(profile: PhotoExportPresetProfileV1, value: unknown): PhotoExportPresetCommandCurrentV1 {
	const input = record(value, 'photo export preset command', ['type', 'expectedRevision', 'preset', 'presetId'], ['type', 'expectedRevision']);
	const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'export preset expected revision');
	if (field(input, 'type') === 'delete') {
		record(input, 'delete export preset', ['type', 'expectedRevision', 'presetId']);
		return Object.freeze({ type: 'delete', expectedRevision, presetId: id(field(input, 'presetId'), 'export preset ID') });
	}
	if (field(input, 'type') !== 'save') throw new RangeError('Unsupported photo export preset command.');
	return Object.freeze({ type: 'save', expectedRevision, preset: normalizePhotoRasterExportPresetForProfileV1(profile,
		field(record(input, 'save export preset', ['type', 'expectedRevision', 'preset']), 'preset')) });
}
export function checkPhotoExportPresetBytesV1(value: unknown): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PHOTO_EXPORT_PRESETS_LIMITS_V1.maximumRowBytes) throw new RangeError('Photo export presets exceed their scalar byte bound.');
}
