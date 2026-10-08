/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord } from '../../closed-domain-value.ts';
import type { PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../../photo-library-session-port-v1.ts';

const METADATA_FIELDS = ['title', 'caption', 'creator', 'copyright', 'location'] as const;

/** Snapshot authored scalars before asynchronous acquisition; the product admits naming semantics. */
export function detachPhotoLibraryImportSettingsV1(value: unknown): PhotoLibraryImportSettingsV1 {
	const record = readClosedDomainRecord(value, 'Import settings', ['rename', 'metadata', 'keywordIds']);
	const rawRename = field(record, 'rename', 'Import settings');
	let rename: PhotoLibraryImportSettingsV1['rename'] = null;
	if (rawRename !== null) {
		const source = readClosedDomainRecord(rawRename, 'Import rename', ['template', 'sequenceStart', 'sequencePadding']);
		const sequenceStart = field(source, 'sequenceStart', 'Import rename'), sequencePadding = field(source, 'sequencePadding', 'Import rename');
		if (typeof sequenceStart !== 'number' || typeof sequencePadding !== 'number') throw new TypeError('Import sequence values must be numbers.');
		rename = Object.freeze({ template: text(field(source, 'template', 'Import rename'), 256), sequenceStart, sequencePadding });
	}
	const source = readClosedDomainRecord(field(record, 'metadata', 'Import settings'), 'Import metadata', METADATA_FIELDS, []);
	const metadata: Partial<Record<typeof METADATA_FIELDS[number], string>> = {};
	for (const key of METADATA_FIELDS) if (Object.hasOwn(source, key)) metadata[key] = text(field(source, key, 'Import metadata'), 16_384);
	const keywordIds = readClosedDomainArray(field(record, 'keywordIds', 'Import settings'), 'Import keywords', 0, 1_024)
		.map(value => text(value, 128));
	return Object.freeze({ rename, metadata: Object.freeze(metadata), keywordIds: Object.freeze(keywordIds) });
}

/** Holds at most 64 source names and detached receipts, never selected Files or bodies. */
export function createPhotoLibraryImportCollectorV1(sourceNames: readonly string[]) {
	const names = readClosedDomainArray(sourceNames, 'Import source names', 1, 64).map(value => text(value, 256));
	const items = new Map<number, PhotoLibraryImportItemV1>();
	const normalize = (value: unknown): PhotoLibraryImportItemV1 => {
		const source = readClosedDomainRecord(value, 'Import receipt', ['index', 'fileName', 'photoId', 'status', 'reusedOriginal', 'message', 'hasMetadataNotices']);
		const index = field(source, 'index', 'Import receipt'), fileName = field(source, 'fileName', 'Import receipt');
		if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= names.length || fileName !== names[index]) {
			throw new TypeError('Import receipt does not match its selected source.');
		}
		const status = field(source, 'status', 'Import receipt'), photoId = field(source, 'photoId', 'Import receipt');
		if ((status !== 'imported' && status !== 'failed') || (status === 'imported' ? typeof photoId !== 'string' || photoId.length === 0 || photoId.length > 128 : photoId !== null)) {
			throw new TypeError('Import receipt has an invalid publication identity.');
		}
		const reusedOriginal = field(source, 'reusedOriginal', 'Import receipt'), hasMetadataNotices = field(source, 'hasMetadataNotices', 'Import receipt');
		if (typeof reusedOriginal !== 'boolean' || typeof hasMetadataNotices !== 'boolean') throw new TypeError('Import notices must be booleans.');
		const rawMessage = field(source, 'message', 'Import receipt');
		return Object.freeze({ index, fileName: text(fileName, 256), photoId: status === 'imported' ? text(photoId, 128) : null, status, reusedOriginal,
			message: rawMessage === null ? null : text(rawMessage, 2_048), hasMetadataNotices });
	};
	const merge = (next: PhotoLibraryImportItemV1) => {
		const previous = items.get(next.index);
		if (previous?.status === 'imported') {
			if (next.status === 'failed') return;
			if (previous.photoId !== next.photoId) throw new TypeError('Import publication identity changed.');
		}
		items.set(next.index, next);
	};
	return Object.freeze({
		acknowledge(value: unknown): boolean {
			const next = normalize(value);
			if (next.status !== 'imported') throw new TypeError('Only durable imports acknowledge publication.');
			const previous = items.get(next.index);
			if (previous?.status === 'imported') {
				if (previous.photoId !== next.photoId) throw new TypeError('Import publication identity changed.');
				return false;
			}
			merge(next);
			return true;
		},
		finish(value: unknown): void {
			const next = readClosedDomainArray(value, 'Import final receipts', 0, names.length).map(normalize);
			if (new Set(next.map(item => item.index)).size !== next.length) throw new TypeError('Import final receipts repeat a selected index.');
			for (const item of next) {
				const previous = items.get(item.index);
				if (previous?.status === 'imported' && item.status === 'imported' && previous.photoId !== item.photoId) throw new TypeError('Import publication identity changed.');
			}
			for (const item of next) merge(item);
			if (next.length !== names.length) throw new TypeError('Import final receipts are incomplete.');
		},
		snapshot(): readonly PhotoLibraryImportItemV1[] { return Object.freeze([...items.values()].sort((left, right) => left.index - right.index)); },
		hasAcknowledgement(): boolean { return [...items.values()].some(item => item.status === 'imported'); },
	});
}

function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum) throw new TypeError('Import scalar text exceeds its bound.');
	return value;
}
