/* SPDX-License-Identifier: AGPL-3.0-only */

import { createImageDevelopResourceReachabilityCurrentV1, type ImageDevelopResourceReferencesCurrentV1 } from '../../common/editor/imaging/image-develop-resource-reachability-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../storage/photo-develop-preset-row-current-v1.ts';

export type PhotoResourceReferencesCurrentV1 = ImageDevelopResourceReferencesCurrentV1;
export interface PhotoResourceReachabilityCurrentV1 {
	addPhoto(value: unknown): void;
	addDevelop(value: unknown): void;
	addPresetRow(value: unknown, catalogId: string): void;
	finish(): Readonly<PhotoResourceReferencesCurrentV1>;
}
/** Whole Current Photo/row admission precedes every retained recipe walk.
 * The shared scalar ledger commits each complete packet atomically; body
 * authority and portable namespace admission remain independently owned. */
export function createPhotoResourceReachabilityCurrentV1(): Readonly<PhotoResourceReachabilityCurrentV1> {
	const closure = createImageDevelopResourceReachabilityCurrentV1(); let sealed = false;
	return Object.freeze({ addPhoto(value: unknown): void {
		open(); const photo = normalizePhotoDocumentCurrentV1(value), packet = createImageDevelopResourceReachabilityCurrentV1();
		for (const version of photo.versions) {
			packet.addDevelop(version.develop);
			for (const entry of version.workspace?.entries ?? []) packet.addDevelop(entry.develop);
			for (const snapshot of version.workspace?.snapshots ?? []) packet.addDevelop(snapshot.develop);
		}
		packet.finish(); closure.merge(packet);
	}, addDevelop(value: unknown): void { open(); closure.addDevelop(value); },
	addPresetRow(value: unknown, catalogId: string): void {
		open(); const row = normalizePhotoDevelopPresetRowCurrentV1(value, catalogId), packet = createImageDevelopResourceReachabilityCurrentV1();
		for (const preset of row.presets) packet.addDevelop(preset.settings.develop);
		packet.finish(); closure.merge(packet);
	}, finish(): Readonly<PhotoResourceReferencesCurrentV1> { sealed = true; return closure.finish(); } });
	function open(): void { if (sealed) throw new Error('The current Photo resource collector is sealed.'); }
}
