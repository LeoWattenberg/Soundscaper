/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, normalizeCubeLutProfileEffectV1 } from '../../common/editor/video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../../common/editor/scape-archive-limits.ts';

export const PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1 = Object.freeze({ maximumReferences: SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2,
	maximumIdentityBytes: 16_777_216 });
export interface PhotoCubeLutClosureV1 {
	addDevelop(value: unknown): void;
	finish(): readonly Readonly<VideoCubeLutReferenceV1>[];
}

/** Intermediate scalar collector, not a complete photo/preset traversal or
 * body proof. A later owning walker must deliver EVERY version, history entry
 * (including redo), snapshot and full/partial preset state. Disabled references
 * retain custody. Only the explicit owning V1-or-V2 dispatcher admits states;
 * old process1 never silently acquires resource-valued effect parameters.
 * One normalized state is temporary; the retained ledger owns scalar refs only.
 * The archive's total pack+resource and document bounds still apply afterward. */
export function createPhotoCubeLutClosureV1(): Readonly<PhotoCubeLutClosureV1> {
	const refs = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	let identityBytes = 0, sealed: readonly Readonly<VideoCubeLutReferenceV1>[] | null = null;
	return Object.freeze({ addDevelop, finish });

	function addDevelop(value: unknown): void {
		if (sealed !== null) throw new Error('The LUT closure collector is sealed.');
		const state = normalizeImageDevelopStateV1OrV2(value), incoming = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
		let charge = 0;
		for (const effect of state.effects) {
			if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) continue;
			const reference = normalizeCubeLutProfileEffectV1(effect).params.lut;
			if (reference === null) continue;
			const previous = incoming.get(reference.sha256) ?? refs.get(reference.sha256);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(reference)) throw new TypeError('Conflicting LUT geometry or body identity for one SHA-256.');
				continue;
			}
			// Declared logical framing: digest key ASCII bytes plus exact canonical
			// UTF8 reference JSON and an eight-byte length prefix. No heap estimate.
			charge += 64 + new TextEncoder().encode(JSON.stringify(reference)).byteLength + 8;
			incoming.set(reference.sha256, reference);
		}
		if (refs.size + incoming.size > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumReferences
			|| identityBytes + charge > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumIdentityBytes) throw new RangeError('LUT closure exceeds its fixed identity capacity.');
		// Owning normalization may reflect caller data. A reentrant finish is
		// authoritative: refuse this delivery before mutating its sealed ledger.
		if (sealed !== null) throw new Error('The LUT closure collector is sealed.');
		for (const [digest, reference] of incoming) refs.set(digest, reference);
		identityBytes += charge;
	}
	function finish(): readonly Readonly<VideoCubeLutReferenceV1>[] {
		sealed ??= Object.freeze([...refs.values()].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0));
		return sealed;
	}
}
