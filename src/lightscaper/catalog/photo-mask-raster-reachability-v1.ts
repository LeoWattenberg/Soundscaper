/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopPresetV1OrV2 } from '../../common/editor/imaging/image-develop-preset-v2.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { normalizePhotoDocumentV1OrV2 } from './photo-document-v2.ts';
import { createPhotoCubeLutClosureV1, PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1 } from './photo-cube-lut-closure-v1.ts';

export interface PhotoMaskRasterReachabilityV1 {
	addDevelop(value: unknown): void;
	addPhoto(value: unknown): void;
	addPreset(value: unknown): void;
	finish(): readonly Readonly<BrushMaskResourceReferenceV1>[];
}

/** Complete owning Photo/preset traversal, including inactive versions, redo,
 * snapshots and every declared input of disabled, unbound or unused graphs.
 * The reserved brush namespace is parsed by its resource owner; unrelated
 * source IDs acquire no brush identity or authenticated rendering authority.
 * Only detached scalar references survive a call. Bodies remain independently
 * authenticated by their selected owner. LUT and brush identities share the
 * existing count/UTF8 identity budget; archive pack/body limits still apply.
 * Each complete add is atomic across both ledgers, including caller reflection. */
export function createPhotoMaskRasterReachabilityV1(): Readonly<PhotoMaskRasterReachabilityV1> {
	const brushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
	const luts = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	const encoder = new TextEncoder();
	let identityBytes = 0, sealed: readonly Readonly<BrushMaskResourceReferenceV1>[] | null = null;
	return Object.freeze({ addDevelop, addPhoto, addPreset, finish });

	function addDevelop(value: unknown): void { collect(add => { add(value); }); }
	function addPhoto(value: unknown): void {
		collect(add => {
			const photo = normalizePhotoDocumentV1OrV2(value);
			for (const version of photo.versions) {
				add(version.develop);
				if (!version.workspace) continue;
				for (const entry of version.workspace.entries) add(entry.develop);
				for (const snapshot of version.workspace.snapshots) add(snapshot.develop);
			}
		});
	}
	function addPreset(value: unknown): void {
		collect(add => { add(normalizeImageDevelopPresetV1OrV2(value).settings.develop); });
	}
	function collect(admit: (add: (value: unknown) => void) => void): void {
		if (sealed !== null) throw new Error('The mask raster reachability collector is sealed.');
		const packetBrushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
		const packetLuts = createPhotoCubeLutClosureV1();
		admit(value => {
			const state = normalizeImageDevelopStateV1OrV2(value);
			packetLuts.addDevelop(state);
			for (const graph of state.masks) for (const input of graph.inputs) {
				if (!input.sourceRef.startsWith('brush-mask-')) continue;
				const reference = normalizeBrushMaskResourceReferenceV1(input.sourceRef);
				const previous = packetBrushes.get(reference.sha256) ?? brushes.get(reference.sha256);
				if (previous && JSON.stringify(previous) !== JSON.stringify(reference)) {
					throw new TypeError('Conflicting brush dimensions or body identity for one SHA-256.');
				}
				packetBrushes.set(reference.sha256, reference);
			}
		});
		const incomingLuts = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
		let charge = 0, addedBrushes = 0;
		for (const reference of packetLuts.finish()) {
			const previous = luts.get(reference.sha256);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(reference)) throw new TypeError('Conflicting LUT geometry or body identity for one SHA-256.');
				continue;
			}
			// Preserve the LUT owner's logical framing exactly: ASCII digest key,
			// canonical UTF8 reference JSON and an eight-byte length prefix.
			charge += 64 + encoder.encode(JSON.stringify(reference)).byteLength + 8;
			incomingLuts.set(reference.sha256, reference);
		}
		for (const reference of packetBrushes.values()) {
			if (brushes.has(reference.sha256)) continue;
			// Brush keys are canonical ASCII and include their dimension header.
			charge += reference.storageKey.length + encoder.encode(JSON.stringify(reference)).byteLength + 8;
			addedBrushes++;
		}
		if (brushes.size + luts.size + addedBrushes + incomingLuts.size > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumReferences
			|| identityBytes + charge > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumIdentityBytes) {
			throw new RangeError('Combined LUT and brush reachability exceeds its fixed identity capacity.');
		}
		// An owning normalizer may reflect caller data. A reentrant finish owns
		// its immutable snapshot before either retained ledger can be changed.
		if (sealed !== null) throw new Error('The mask raster reachability collector is sealed.');
		for (const [digest, reference] of packetBrushes) brushes.set(digest, reference);
		for (const [digest, reference] of incomingLuts) luts.set(digest, reference);
		identityBytes += charge;
	}
	function finish(): readonly Readonly<BrushMaskResourceReferenceV1>[] {
		sealed ??= Object.freeze([...brushes.values()].sort((left, right) => left.storageKey < right.storageKey ? -1 : left.storageKey > right.storageKey ? 1 : 0));
		return sealed;
	}
}
