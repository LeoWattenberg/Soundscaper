/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-limits.ts';
import { normalizeCubeLutProfileEffectV1, CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../cube-lut-reference-contract.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from './brush-mask-resource-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';

export const IMAGE_DEVELOP_RESOURCE_REACHABILITY_LIMITS_CURRENT_V1 = Object.freeze({
	maximumReferences: SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2, maximumIdentityBytes: 16_777_216,
});
export interface ImageDevelopResourceReferencesCurrentV1 {
	readonly luts: readonly Readonly<VideoCubeLutReferenceV1>[];
	readonly brushes: readonly Readonly<BrushMaskResourceReferenceV1>[];
}
export interface ImageDevelopResourceReachabilityCurrentV1 {
	addDevelop(value: unknown): void;
	/** Only a genuine finished scalar collector can be merged, atomically. */
	merge(finishedCollector: unknown): void;
	finish(): Readonly<ImageDevelopResourceReferencesCurrentV1>;
}
interface State {
	readonly luts: Map<string, Readonly<VideoCubeLutReferenceV1>>;
	readonly brushes: Map<string, Readonly<BrushMaskResourceReferenceV1>>;
	identityBytes: number;
	sealed: Readonly<ImageDevelopResourceReferencesCurrentV1> | null;
}
const states = new WeakMap<object, State>(), encoder = new TextEncoder();

/** Scalar identity integrity only. No bytes, body authentication, source
 * capability, installation or alpha Map is accepted or returned. Whole-document
 * owners admit all their recipes into a temporary collector before merging.
 * Disabled/unbound/unused declarations retain custody. Foreign source IDs are
 * not brush identities; a portable owner separately refuses unsupported inputs. */
export function createImageDevelopResourceReachabilityCurrentV1(): Readonly<ImageDevelopResourceReachabilityCurrentV1> {
	const state: State = { luts: new Map(), brushes: new Map(), identityBytes: 0, sealed: null };
	const collector = Object.freeze({ addDevelop(value: unknown): void {
		open();
		const develop = normalizeImageDevelopStateCurrentV1(value);
		const luts = new Map<string, Readonly<VideoCubeLutReferenceV1>>(), brushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
		for (const effect of develop.effects) {
			if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) continue;
			const reference = normalizeCubeLutProfileEffectV1(effect).params.lut;
			if (reference !== null) insert(luts, reference, 'LUT');
		}
		for (const graph of develop.masks) for (const input of graph.inputs) {
			if (!input.sourceRef.startsWith('brush-mask-')) continue;
			insert(brushes, normalizeBrushMaskResourceReferenceV1(input.sourceRef), 'brush');
		}
		mergeMaps(luts, brushes);
	}, merge(value: unknown): void {
		open();
		const packet = value !== null && typeof value === 'object' ? states.get(value) : undefined;
		if (!packet) throw new TypeError('Resource merge requires a genuine scalar collector.');
		if (packet.sealed === null) throw new TypeError('Resource merge requires a finished scalar collector.');
		mergeMaps(packet.luts, packet.brushes);
	}, finish(): Readonly<ImageDevelopResourceReferencesCurrentV1> {
		state.sealed ??= Object.freeze({
			luts: Object.freeze([...state.luts.values()].sort((a, b) => compare(a.sha256, b.sha256))),
			brushes: Object.freeze([...state.brushes.values()].sort((a, b) => compare(a.storageKey, b.storageKey))),
		});
		return state.sealed;
	} });
	states.set(collector, state); return collector;

	function open(): void { if (state.sealed !== null) throw new Error('The Current resource collector is sealed.'); }
	function mergeMaps(luts: ReadonlyMap<string, Readonly<VideoCubeLutReferenceV1>>, brushes: ReadonlyMap<string, Readonly<BrushMaskResourceReferenceV1>>): void {
		const incomingLuts = new Map<string, Readonly<VideoCubeLutReferenceV1>>(), incomingBrushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
		let charge = 0;
		for (const reference of luts.values()) {
			const previous = state.luts.get(reference.sha256);
			if (previous) { same(previous, reference, 'LUT'); continue; }
			charge += 64 + encoder.encode(JSON.stringify(reference)).byteLength + 8; incomingLuts.set(reference.sha256, reference);
		}
		for (const reference of brushes.values()) {
			const previous = state.brushes.get(reference.sha256);
			if (previous) { same(previous, reference, 'brush'); continue; }
			charge += reference.storageKey.length + encoder.encode(JSON.stringify(reference)).byteLength + 8; incomingBrushes.set(reference.sha256, reference);
		}
		if (state.luts.size + state.brushes.size + incomingLuts.size + incomingBrushes.size > IMAGE_DEVELOP_RESOURCE_REACHABILITY_LIMITS_CURRENT_V1.maximumReferences
			|| state.identityBytes + charge > IMAGE_DEVELOP_RESOURCE_REACHABILITY_LIMITS_CURRENT_V1.maximumIdentityBytes) throw new RangeError('Combined LUT and brush reachability exceeds its fixed identity capacity.');
		// A reentrant finish during owning normalization seals both ledgers.
		open();
		for (const [key, reference] of incomingLuts) state.luts.set(key, reference);
		for (const [key, reference] of incomingBrushes) state.brushes.set(key, reference);
		state.identityBytes += charge;
	}
}
function insert<Reference extends { readonly sha256: string }>(map: Map<string, Reference>, reference: Reference, kind: string): void {
	const previous = map.get(reference.sha256); if (previous) same(previous, reference, kind); else map.set(reference.sha256, reference);
}
function same(left: unknown, right: unknown, kind: string): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) throw new TypeError(`Conflicting ${kind} geometry or body identity for one SHA-256.`);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
