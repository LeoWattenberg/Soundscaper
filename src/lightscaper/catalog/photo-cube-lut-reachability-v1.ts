/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopPresetV1OrV2 } from '../../common/editor/imaging/image-develop-preset-v2.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { normalizePhotoDocumentV1OrV2 } from './photo-document-v2.ts';
import { createPhotoCubeLutClosureV1, PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1, type PhotoCubeLutClosureV1 } from './photo-cube-lut-closure-v1.ts';

export interface PhotoCubeLutReachabilityV1 {
	addPhoto(value: unknown): void;
	addPreset(value: unknown): void;
	finish(): readonly Readonly<VideoCubeLutReferenceV1>[];
}

/** Complete traversal of each delivered owning Photo1/2 or shared preset1/2.
 * Inactive versions, every history entry (including redo), immutable snapshots,
 * full/partial preset bodies and disabled references all retain custody.
 * Admission precedes traversal; one temporary packet ledger makes each add
 * atomic. Only detached scalar references survive a call, never documents,
 * recipes or raw bodies. Callers must independently prove bodies and deliver
 * their complete catalog/preset inventories. Combined archive pack/resource
 * counts and document bounds still apply; logical framing is not a heap bound. */
export function createPhotoCubeLutReachabilityV1(): Readonly<PhotoCubeLutReachabilityV1> {
	const refs = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	let identityBytes = 0, sealed: readonly Readonly<VideoCubeLutReferenceV1>[] | null = null;
	return Object.freeze({ addPhoto, addPreset, finish });

	function addPhoto(value: unknown): void {
		collect(packet => {
			const photo = normalizePhotoDocumentV1OrV2(value);
			for (const version of photo.versions) {
				packet.addDevelop(version.develop);
				if (!version.workspace) continue;
				for (const entry of version.workspace.entries) packet.addDevelop(entry.develop);
				for (const snapshot of version.workspace.snapshots) packet.addDevelop(snapshot.develop);
			}
		});
	}
	function addPreset(value: unknown): void {
		collect(packet => { packet.addDevelop(normalizeImageDevelopPresetV1OrV2(value).settings.develop); });
	}
	function collect(admit: (packet: Readonly<PhotoCubeLutClosureV1>) => void): void {
		if (sealed !== null) throw new Error('The LUT reachability collector is sealed.');
		const packet = createPhotoCubeLutClosureV1(); admit(packet);
		const incoming = new Map<string, Readonly<VideoCubeLutReferenceV1>>(); let charge = 0;
		for (const reference of packet.finish()) {
			const previous = refs.get(reference.sha256);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(reference)) throw new TypeError('Conflicting LUT geometry or body identity for one SHA-256.');
				continue;
			}
			// Same declared logical framing as the per-state ledger: digest ASCII,
			// canonical UTF8 reference JSON and an eight-byte length prefix.
			charge += 64 + new TextEncoder().encode(JSON.stringify(reference)).byteLength + 8;
			incoming.set(reference.sha256, reference);
		}
		if (refs.size + incoming.size > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumReferences
			|| identityBytes + charge > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumIdentityBytes) throw new RangeError('LUT reachability exceeds its fixed identity capacity.');
		// Reflection during either owning admission may finish this collector.
		// Its immutable snapshot is authoritative before any global mutation.
		if (sealed !== null) throw new Error('The LUT reachability collector is sealed.');
		for (const [digest, reference] of incoming) refs.set(digest, reference);
		identityBytes += charge;
	}
	function finish(): readonly Readonly<VideoCubeLutReferenceV1>[] {
		sealed ??= Object.freeze([...refs.values()].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0));
		return sealed;
	}
}
