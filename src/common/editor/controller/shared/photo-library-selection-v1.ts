/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';

export interface PhotoLibrarySelectionSnapshotV1 {
	readonly photoIds: readonly string[];
	readonly selectedIds: readonly string[];
	readonly focusedId: string | null;
	readonly primaryId: string | null;
	readonly anchorId: string | null;
}
export interface PhotoLibrarySelectionContextV1 {
	readonly generation: unknown;
	readonly pageIdentity: unknown;
	readonly interactionRevision: number;
	readonly photoIds: readonly string[];
	readonly singleSelectedId: string | null;
}
export interface PhotoLibrarySelectionModifiersV1 {
	readonly toggle?: boolean;
	readonly range?: boolean;
}

/** Bounded presentation state; native focus never collapses a selected subset. */
export class PhotoLibrarySelectionV1 {
	#ids: readonly string[] = Object.freeze([]);
	#selected: readonly string[] = Object.freeze([]);
	#focused: string | null = null;
	#primary: string | null = null;
	#anchor: string | null = null;
	#context: Readonly<{ generation: unknown; pageIdentity: unknown }> | null = null;
	#interactionRevision = 0;
	#listener: ((snapshot: Readonly<PhotoLibrarySelectionSnapshotV1>) => void) | null = null;

	setPage(photoIds: readonly string[], context: Readonly<{ generation: unknown; pageIdentity: unknown }>): void {
		const ids = readPhotoLibrarySelectionIdsV1(photoIds);
		const input = record(context, 'photo selection context', ['generation', 'pageIdentity']);
		const generation = field(input, 'generation', 'photo selection context'), pageIdentity = field(input, 'pageIdentity', 'photo selection context');
		if (this.#context && Object.is(this.#context.generation, generation) && Object.is(this.#context.pageIdentity, pageIdentity)
			&& sameIds(this.#ids, ids)) return;
		if (!this.#context || !Object.is(this.#context.generation, generation)) {
			this.#selected = Object.freeze([]); this.#focused = null; this.#primary = null; this.#anchor = null;
		} else {
			this.#selected = Object.freeze(ids.filter(id => this.#selected.includes(id)));
			if (this.#focused !== null && !ids.includes(this.#focused)) this.#focused = null;
			if (this.#primary !== null && !this.#selected.includes(this.#primary)) this.#primary = this.#selected[0] ?? null;
			if (this.#anchor !== null && !ids.includes(this.#anchor)) this.#anchor = null;
		}
		this.#ids = ids; this.#context = Object.freeze({ generation, pageIdentity }); this.#notify();
	}

	select(photoId: string, modifiers: PhotoLibrarySelectionModifiersV1 = {}): void {
		const id = this.#member(photoId), { toggle, range } = readModifiers(modifiers);
		if (range) {
			const anchor = this.#anchor ?? id, first = this.#ids.indexOf(anchor), last = this.#ids.indexOf(id);
			const selected = this.#ids.slice(Math.min(first, last), Math.max(first, last) + 1);
			this.#selected = Object.freeze(toggle ? this.#ids.filter(value => this.#selected.includes(value) || selected.includes(value)) : selected);
			this.#anchor = anchor;
		} else {
			this.#selected = Object.freeze(toggle ? this.#ids.filter(value => value === id ? !this.#selected.includes(value) : this.#selected.includes(value)) : [id]);
			this.#anchor = id;
		}
		this.#focused = id; this.#primary = this.#selected.includes(id) ? id : this.#selected[0] ?? null;
		this.#interactionRevision++; this.#notify();
	}

	focus(photoId: string): void {
		const id = this.#member(photoId); if (this.#focused === id) return;
		this.#focused = id; this.#interactionRevision++; this.#notify();
	}

	navigate(photoId: string, key: string, modifiers: PhotoLibrarySelectionModifiersV1 = {}): string | null {
		const id = this.#member(photoId), index = this.#ids.indexOf(id), options = readModifiers(modifiers);
		const next = key === 'ArrowDown' || key === 'ArrowRight' ? Math.min(this.#ids.length - 1, index + 1)
			: key === 'ArrowUp' || key === 'ArrowLeft' ? Math.max(0, index - 1)
				: key === 'Home' ? 0 : key === 'End' ? this.#ids.length - 1 : null;
		if (next === null) return null;
		const target = this.#ids[next]!;
		if (options.toggle && !options.range) this.focus(target); else this.select(target, options);
		return target;
	}

	selectAll(): void {
		this.#selected = Object.freeze([...this.#ids]); this.#primary = this.#focused ?? this.#ids[0] ?? null;
		this.#focused ??= this.#primary; this.#anchor ??= this.#primary;
		this.#interactionRevision++; this.#notify();
	}
	clear(): void {
		this.#selected = Object.freeze([]); this.#primary = null; this.#anchor = null;
		this.#interactionRevision++; this.#notify();
	}

	snapshot(): Readonly<PhotoLibrarySelectionSnapshotV1> {
		return Object.freeze({ photoIds: this.#ids, selectedIds: this.#selected, focusedId: this.#focused, primaryId: this.#primary, anchorId: this.#anchor });
	}
	capture(): Readonly<PhotoLibrarySelectionContextV1> {
		return Object.freeze({ generation: this.#context?.generation, pageIdentity: this.#context?.pageIdentity,
			interactionRevision: this.#interactionRevision, photoIds: this.#ids,
			singleSelectedId: this.#selected.length === 1 ? this.#selected[0]! : null });
	}
	isCurrent(context: PhotoLibrarySelectionContextV1, acknowledgedPage?: unknown): boolean {
		return this.#context !== null && this.isSameInteraction(context)
			&& (Object.is(this.#context.pageIdentity, context.pageIdentity)
				|| (acknowledgedPage !== undefined && Object.is(this.#context.pageIdentity, acknowledgedPage)));
	}
	isSameInteraction(context: PhotoLibrarySelectionContextV1): boolean {
		return this.#context !== null && Object.is(this.#context.generation, context.generation)
			&& this.#interactionRevision === context.interactionRevision;
	}
	subscribe(listener: (snapshot: Readonly<PhotoLibrarySelectionSnapshotV1>) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('Photo selection requires a scalar observer.');
		this.#listener = listener; this.#notify();
		return () => { if (this.#listener === listener) this.#listener = null; };
	}
	#member(value: unknown): string {
		const id = readPhotoLibrarySelectionIdV1(value);
		if (!this.#ids.includes(id)) throw new RangeError('Photo selection must belong to the visible page.');
		return id;
	}
	#notify(): void {
		try { this.#listener?.(this.snapshot()); }
		catch { /* A UI observer cannot revoke already-published scalar state or a durable edit receipt. */ }
	}
}

export function readPhotoLibrarySelectionIdsV1(value: unknown): readonly string[] {
	const ids = array(value, 'visible selection IDs', 0, 64).map(readPhotoLibrarySelectionIdV1);
	if (new Set(ids).size !== ids.length) throw new RangeError('Visible selection IDs must be unique.');
	return Object.freeze(ids);
}
export function readPhotoLibrarySelectionIdV1(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256 || [...value].some(character => character.charCodeAt(0) < 32)) {
		throw new TypeError('Selection IDs require bounded inert strings.');
	}
	return value;
}
function readModifiers(value: PhotoLibrarySelectionModifiersV1): Readonly<{ toggle: boolean; range: boolean }> {
	const input = record(value, 'selection modifiers', ['toggle', 'range'], []);
	for (const key of ['toggle', 'range']) if (Object.hasOwn(input, key) && typeof field(input, key, 'selection modifiers') !== 'boolean') {
		throw new TypeError('Selection modifiers must be explicit booleans.');
	}
	return Object.freeze({ toggle: input.toggle === true, range: input.range === true });
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}
