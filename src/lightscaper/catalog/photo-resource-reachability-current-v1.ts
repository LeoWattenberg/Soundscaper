/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import { createPhotoCubeLutClosureV1, PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1 } from './photo-cube-lut-closure-v1.ts';
import { createPhotoMaskRasterReachabilityV1 } from './photo-mask-raster-reachability-v1.ts';

export interface PhotoResourceReferencesCurrentV1 {
	readonly luts: readonly Readonly<VideoCubeLutReferenceV1>[];
	readonly brushes: readonly Readonly<BrushMaskResourceReferenceV1>[];
}
export interface PhotoResourceReachabilityCurrentV1 {
	addPhoto(value: unknown): void;
	finish(): Readonly<PhotoResourceReferencesCurrentV1>;
}

/** Full current Photo admission precedes every retained recipe walk. Only
 * detached resource identities survive; repairs confer no body authority.
 * Each complete Photo packet is atomic across the combined existing ledger. */
export function createPhotoResourceReachabilityCurrentV1(): Readonly<PhotoResourceReachabilityCurrentV1> {
	const luts = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	const brushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
	const encoder = new TextEncoder();
	let identityBytes = 0, sealed: Readonly<PhotoResourceReferencesCurrentV1> | null = null;
	return Object.freeze({ addPhoto, finish });

	function addPhoto(value: unknown): void {
		if (sealed !== null) throw new Error('The current Photo resource collector is sealed.');
		const photo = normalizePhotoDocumentCurrentV1(value);
		const packetLuts = createPhotoCubeLutClosureV1(), packetBrushes = createPhotoMaskRasterReachabilityV1();
		const add = (develop: ImageDevelopStateCurrentV1): void => {
			// Private computation view only: the full owning Photo and strict3
			// recipe were admitted above. Never persist or publish this view.
			const computation = develop.processVersion === 3 ? normalizeImageDevelopStateV1OrV2({ processVersion: 2,
				effects: develop.effects, geometry: develop.geometry, masks: develop.masks, maskBindings: develop.maskBindings }) : develop;
			packetLuts.addDevelop(computation); packetBrushes.addDevelop(computation);
		};
		for (const version of photo.versions) {
			add(version.develop);
			if (!version.workspace) continue;
			for (const entry of version.workspace.entries) add(entry.develop);
			for (const snapshot of version.workspace.snapshots) add(snapshot.develop);
		}
		const incomingLuts = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
		const incomingBrushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
		let charge = 0;
		for (const reference of packetLuts.finish()) {
			const previous = luts.get(reference.sha256);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(reference)) throw new TypeError('Conflicting LUT geometry or body identity for one SHA-256.');
				continue;
			}
			charge += 64 + encoder.encode(JSON.stringify(reference)).byteLength + 8;
			incomingLuts.set(reference.sha256, reference);
		}
		for (const reference of packetBrushes.finish()) {
			const previous = brushes.get(reference.sha256);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(reference)) throw new TypeError('Conflicting brush dimensions or body identity for one SHA-256.');
				continue;
			}
			charge += reference.storageKey.length + encoder.encode(JSON.stringify(reference)).byteLength + 8;
			incomingBrushes.set(reference.sha256, reference);
		}
		if (luts.size + brushes.size + incomingLuts.size + incomingBrushes.size > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumReferences
			|| identityBytes + charge > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumIdentityBytes) {
			throw new RangeError('Combined LUT and brush reachability exceeds its fixed identity capacity.');
		}
		// Reentrant finish during caller reflection owns the immutable result.
		if (sealed !== null) throw new Error('The current Photo resource collector is sealed.');
		for (const [digest, reference] of incomingLuts) luts.set(digest, reference);
		for (const [digest, reference] of incomingBrushes) brushes.set(digest, reference);
		identityBytes += charge;
	}
	function finish(): Readonly<PhotoResourceReferencesCurrentV1> {
		sealed ??= Object.freeze({
			luts: Object.freeze([...luts.values()].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0)),
			brushes: Object.freeze([...brushes.values()].sort((left, right) => left.storageKey < right.storageKey ? -1 : left.storageKey > right.storageKey ? 1 : 0)),
		});
		return sealed;
	}
}
