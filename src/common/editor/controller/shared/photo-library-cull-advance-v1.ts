/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { readPhotoLibrarySelectionIdsV1 } from './photo-library-selection-v1.ts';

/** Ephemeral scalar navigation, never a stored cursor or durable edit receipt. */
export interface PhotoLibraryCullAdvanceRequestV1 {
	readonly successorIds: readonly string[];
	isCurrent(): boolean;
	captureNextPage(ids: readonly string[]): void;
}

/** Pin the exact callback receivers and detached IDs before acquiring a Session. */
export function capturePhotoLibraryCullAdvanceRequestV1(value: unknown): Readonly<PhotoLibraryCullAdvanceRequestV1> {
	const input = record(value, 'cull advance request', ['successorIds', 'isCurrent', 'captureNextPage']);
	const successorIds = readPhotoLibrarySelectionIdsV1(field(input, 'successorIds', 'cull advance request'));
	const current = field(input, 'isCurrent', 'cull advance request'), capture = field(input, 'captureNextPage', 'cull advance request');
	if (typeof current !== 'function' || typeof capture !== 'function') throw new TypeError('Cull advance requires synchronous navigation callbacks.');
	return Object.freeze({ successorIds,
		isCurrent: () => {
			const result: unknown = Reflect.apply(current, value, []);
			if (typeof result !== 'boolean') throw new TypeError('Cull advance currentness must be synchronous.');
			return result;
		},
		captureNextPage: (ids: readonly string[]) => {
			const result: unknown = Reflect.apply(capture, value, [ids]);
			if (result !== undefined) throw new TypeError('Cull advance capture must finish synchronously.');
		},
	});
}

/** One delivery, <=64 retained old-order successors, sealed when its save settles. */
export function createPhotoLibraryCullAdvanceV1(successorIds: readonly string[], isCurrent: () => boolean,
	currentPageIds: readonly string[]) {
	const initial = readPhotoLibrarySelectionIdsV1(successorIds), excluded = readPhotoLibrarySelectionIdsV1(currentPageIds);
	if (typeof isCurrent !== 'function') throw new TypeError('Cull advance requires its captured selection fence.');
	let retained = initial, captured = false, sealed = false;
	const current = (): boolean => !sealed && isCurrent();
	const request: Readonly<PhotoLibraryCullAdvanceRequestV1> = Object.freeze({ successorIds: initial, isCurrent: current,
		captureNextPage(ids: readonly string[]): void {
			if (sealed) throw new RangeError('Cull advance has settled and is sealed.');
			if (captured) throw new RangeError('Cull advance next page is already captured.');
			// Claim before currentness or caller-owned array reflection can reenter.
			captured = true;
			if (!current()) throw new RangeError('Cull advance belongs to a retired selection.');
			const next = readPhotoLibrarySelectionIdsV1(ids);
			if (next.some(id => excluded.includes(id))) throw new RangeError('Cull advance next page repeats a displayed photo.');
			if (!current()) throw new RangeError('Cull advance belongs to a retired selection.');
			retained = Object.freeze([...initial, ...next].slice(0, 64));
		},
	});
	return Object.freeze({ request, successors: () => retained, seal: () => { sealed = true; } });
}
