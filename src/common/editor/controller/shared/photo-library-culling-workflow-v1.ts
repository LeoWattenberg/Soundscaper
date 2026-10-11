/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { capturePhotoLibraryCullAdvanceRequestV1, type PhotoLibraryCullAdvanceRequestV1 } from './photo-library-cull-advance-v1.ts';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V2, readVisiblePage, type PhotoLibraryQueryNavigationPort } from './photo-library-query-navigation.ts';
import { readPhotoLibrarySelectionIdsV1 } from './photo-library-selection-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from './photo-library-culling-v1.ts';
import type { PhotoLibraryWorkflowSlotV2 as SessionSlot } from './photo-library-workflow-slot-v2.ts';
import type { PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';
import type { PhotoLibraryAttributePatchV1, PhotoLibraryPageV1, PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1, PhotoLibraryCullingNavigationPortV1 } from '../../photo-library-culling-navigation-port-v1.ts';

export interface PhotoLibraryCullEditOptionsV1 { readonly signal?: AbortSignal; readonly advance?: Readonly<PhotoLibraryCullAdvanceRequestV1> }
type ActionStatus = 'completed' | 'failed' | 'cancelled' | 'busy';
type ScalarSession = Omit<PhotoLibrarySessionPortV2, 'develop'>;
type ScalarSlot = Pick<SessionSlot, 'live' | 'page' | 'query' | 'savedCollectionId' | 'stackCollapsed'>;
type Action<Slot extends ScalarSlot> = (owner: ScalarSession, signal: AbortSignal, current: Slot) => Promise<void>;
interface Owners<Slot extends ScalarSlot> {
	readonly perform: (action: Action<Slot>, signal?: AbortSignal) => Promise<ActionStatus>;
	readonly publishPage: (current: Slot, next: PhotoLibraryPageV1 | null) => PhotoLibraryPageV1 | null;
	readonly getCurrent: () => Slot | null;
	readonly isCurrent: (current: Slot) => boolean;
}
const CHECK = AbortSignal.prototype.throwIfAborted, SIGNAL = AbortSignal.prototype, ABORTED = Object.getOwnPropertyDescriptor(SIGNAL, 'aborted')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function data(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object') throw new TypeError('Photo culling capability is unavailable.');
	let current: object | null = value;
	for (let depth = 0; current && depth < 8; depth++) {
		const property = Object.getOwnPropertyDescriptor(current, key);
		if (property) { if (!Object.hasOwn(property, 'value')) throw new TypeError('Photo culling requires an inert capability.'); return property.value as unknown; }
		current = Object.getPrototypeOf(current) as object | null;
	}
	return undefined;
}
function pin<Method>(receiver: unknown, key: string): Method {
	const method = data(receiver, key);
	if (typeof method !== 'function') throw new TypeError('Photo culling capability must be callable.');
	return ((...args: unknown[]) => Reflect.apply(method, receiver, args) as unknown) as Method;
}
/** Detach scalar query/definition state without invoking JSON hooks or getters. */
function snapshot<Value>(value: Value): Readonly<{ value: Value; text: string }> {
	let nodes = 0, stringBytes = 0;
	const encoder = new TextEncoder(), string = (value: string) => {
		stringBytes += encoder.encode(value).byteLength;
		if (stringBytes > 524_288) throw new RangeError('Photo culling context exceeds its scalar byte bound.');
		return value;
	};
	const copy = (input: unknown, depth: number): unknown => {
		if (++nodes > 8_192 || depth > 64) throw new RangeError('Photo culling context exceeds its scalar bound.');
		if (typeof input === 'string') return string(input);
		if (input === null || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return input;
		if (Array.isArray(input)) return Object.freeze(array(input, 'photo culling context', 0, 8_192).map(item => copy(item, depth + 1)));
		if (!input || typeof input !== 'object') throw new TypeError('Photo culling context requires inert JSON data.');
		const keys = Reflect.ownKeys(input);
		if (keys.some(key => typeof key !== 'string')) throw new TypeError('Photo culling context contains unsupported state.');
		const allowed = keys as string[], source = record(input, 'photo culling context', allowed);
		return Object.freeze(Object.fromEntries(allowed.sort().map(key => [string(key), copy(field(source, key, 'photo culling context'), depth + 1)])));
	};
	const detached = copy(value, 0) as Value, text = JSON.stringify(detached);
	if (new TextEncoder().encode(text).byteLength > 524_288) throw new RangeError('Photo culling context exceeds its scalar byte bound.');
	return Object.freeze({ value: detached, text });
}
function options(value: Readonly<PhotoLibraryCullEditOptionsV1>) {
	const input = record(value, 'photo culling options', ['signal', 'advance'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo culling options') : undefined;
	if (signal !== undefined) {
		if (!signal || typeof signal !== 'object') throw new TypeError('Photo culling requires a native cancellation signal.');
		Reflect.apply(ABORTED, signal, []);
		if (Object.getPrototypeOf(signal) !== SIGNAL || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Photo culling requires a native cancellation signal.');
	}
	const requested = Object.hasOwn(input, 'advance') ? field(input, 'advance', 'photo culling options') : undefined;
	const advance = requested === undefined ? undefined : capturePhotoLibraryCullAdvanceRequestV1(requested);
	return Object.freeze({ signal: signal as AbortSignal | undefined, advance });
}
function ids(page: PhotoLibraryPageV1): readonly string[] {
	const source = record(page, 'photo culling page', ['catalogName', 'totalCount', 'rows', 'cursor']);
	return readPhotoLibrarySelectionIdsV1(array(field(source, 'rows', 'photo culling page'), 'photo culling rows', 0, 64).map(value => {
		const row = record(value, 'photo culling row', ['id', 'fileName', 'width', 'height', 'rating', 'flag', 'colorLabel']);
		return field(row, 'id', 'photo culling row');
	}));
}
function readPorts(owner: ScalarSession): PhotoLibraryQueryNavigationPort {
	const saved = data(owner, 'savedCollections');
	return { readPage: pin(owner, 'readPage'), readQueryStep: pin(owner, 'readQueryStep'), readStackQueryStep: pin(owner, 'readStackQueryStep'),
		readQueryStepV2: pin(owner, 'readQueryStepV2'), readStackQueryStepV2: pin(owner, 'readStackQueryStepV2'),
		...(saved ? { savedCollections: { readPage: pin(saved, 'readPage'), readSnapshot: pin(saved, 'readSnapshot'), apply: pin(saved, 'apply'), readQueryStep: pin(saved, 'readQueryStep') } } : {}) };
}

/** Coordinate an existing foreground action; no additional Session or read queue. */
export function createPhotoLibraryCullingWorkflowV1<Slot extends ScalarSlot>({ perform, publishPage, getCurrent, isCurrent }: Owners<Slot>) {
	const refreshQuery = async (owner: ScalarSession, signal: AbortSignal, current: Slot) => {
		if (!current.query && !current.stackCollapsed && current.savedCollectionId === null) return current.live ? current.page : null;
		const next = await readVisiblePage(owner, current, null, signal); check(signal);
		return publishPage(current, next);
	};
	const updateRow = (updated: PhotoLibraryRowV1, current: Slot) => {
		const previous = current.page;
		return publishPage(current, previous ? Object.freeze({ ...previous, cursor: null,
			rows: Object.freeze(previous.rows.map(row => row.id === updated.id ? updated : row)) }) : null);
	};
	const editAttributes = async (method: 'setRating' | 'applyAttributes', args: readonly unknown[],
		optionsValue: Readonly<PhotoLibraryCullEditOptionsV1> = {}): Promise<PhotoLibraryCullReceiptV1> => {
		const input = options(optionsValue), captured = getCurrent();
		const previous = captured?.page ?? null, query = snapshot(captured?.query ?? null), savedCollectionId = captured?.savedCollectionId ?? null,
			stackCollapsed = captured?.stackCollapsed ?? false;
		const visible = () => captured !== null && isCurrent(captured) && captured.page === previous && captured.savedCollectionId === savedCollectionId
			&& captured.stackCollapsed === stackCollapsed && snapshot(captured.query).text === query.text;
		let receipt: PhotoLibraryCullReceiptV1 | null = null;
		const status = await perform(async (owner, signal, current) => {
			if (current !== captured || !visible()) throw new DOMException('Photo culling context is closed.', 'AbortError');
			const write = pin<(...args: unknown[]) => Promise<PhotoLibraryRowV1>>(owner, method), capability = data(owner, 'cullingNavigation');
			const destination = capability ? pin<PhotoLibraryCullingNavigationPortV1['readDestinationPage']>(capability, 'readDestinationPage') : null;
			const context: PhotoLibraryCullingNavigationContextV1 = savedCollectionId !== null ? Object.freeze({ kind: 'saved', collectionId: savedCollectionId, collapsed: stackCollapsed })
				: query.value || stackCollapsed ? Object.freeze({ kind: 'query', query: query.value ?? DEFAULT_PHOTO_LIBRARY_QUERY_V2, collapsed: stackCollapsed }) : Object.freeze({ kind: 'plain' });
			const readers = destination ? readPorts(owner) : null, saved = destination && savedCollectionId !== null ? data(owner, 'savedCollections') : null;
			const readSaved = saved ? pin<NonNullable<PhotoLibrarySessionPortV2['savedCollections']>['readSnapshot']>(saved, 'readSnapshot') : null;
			const readStack = destination && stackCollapsed ? pin<PhotoLibrarySessionPortV2['readStackSnapshot']>(owner, 'readStackSnapshot') : null;
			const filter = query.value?.filter, readDefinition = destination && filter?.kind === 'collection' ? pin<PhotoLibrarySessionPortV2['readDefinition']>(owner, 'readDefinition') : null;
			const originalIds = previous ? ids(previous) : Object.freeze([] as string[]);
			const fence = async (): Promise<string> => {
				const proof: unknown[] = [];
				if (readSaved) { const value = snapshot(await readSaved({ collectionId: savedCollectionId, signal })).value; check(signal);
					if (value.collectionId !== savedCollectionId || !value.definition) throw new Error('Saved photo query is unavailable.');
					proof.push({ catalogId: value.context.catalogId, catalogRevision: value.context.catalogRevision, stateRevision: value.context.collectionStateRevision, definition: value.definition }); }
				if (readStack && originalIds[0]) { const value = snapshot(await readStack(originalIds[0], { signal })).value; check(signal);
					proof.push({ catalogId: value.context.catalogId, stateRevision: value.context.stateRevision }); }
				if (readDefinition && filter?.kind === 'collection') { const value = snapshot(await readDefinition({ kind: 'collection', id: filter.id, signal })).value; check(signal);
					proof.push({ rootRevision: value.rootRevision, row: value.row, queryJson: value.queryJson }); }
				return snapshot(proof).text;
			};
			let successors = input.advance?.successorIds ?? Object.freeze([] as string[]), before = '', preparationFailure: Readonly<{ value: unknown }> | null = null;
			try {
				before = await fence(); check(signal);
				if (readers && input.advance && successors.length === 0 && previous?.cursor !== null && previous?.cursor !== undefined && visible() && input.advance.isCurrent()) {
					const next = await readVisiblePage(readers, { query: query.value, savedCollectionId, stackCollapsed }, previous.cursor, signal); check(signal);
					if (!visible() || !input.advance.isCurrent()) throw new Error('Photo culling selection changed.');
					successors = ids(next); input.advance.captureNextPage(successors);
				}
			} catch (failure) { check(signal); preparationFailure = { value: failure }; }
			const updated = await write(...args, { signal });
			// Once the native write acknowledges, refresh/cancellation cannot erase it.
			receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: null, notice: 'refresh-failed' });
			try {
				check(signal); if (preparationFailure) throw preparationFailure.value;
				if (!visible() || (input.advance && !input.advance.isCurrent())) throw new Error('Photo culling selection changed.');
				if (await fence() !== before) throw new Error('Photo culling query definition changed.');
				let next: PhotoLibraryPageV1 | null = null;
				if (destination) {
					const anchors = !input.advance && context.kind !== 'plain' ? [...originalIds.filter(photoId => photoId !== updated.id),
						...(originalIds.includes(updated.id) ? [updated.id] : [])] : originalIds;
					const candidates = [...new Set([...successors, ...anchors])];
					let target: string | null = null;
					for (const photoId of candidates) { next = await destination(context, { photoId, signal }); check(signal); if (next && ids(next).includes(photoId)) { target = photoId; break; } next = null; }
					if (!next) throw new Error('Photo culling destination is unavailable.');
					// Keep the existing window for an in-page successor; only publish
					// its own destination window when a fresh anchor cannot contain it.
					if (target && successors.includes(target) && originalIds.includes(target)) {
						for (const anchor of originalIds) {
							if (anchor === target) break;
							const window = await destination(context, { photoId: anchor, signal }); check(signal);
							if (!window) continue;
							if (ids(window).includes(target)) next = window;
							break;
						}
					}
					// With auto-advance off, retain the edited selection when its
					// new sort position is outside the surviving original window.
					if (!input.advance && originalIds.includes(updated.id) && !ids(next).includes(updated.id)) {
						const edited = await destination(context, { photoId: updated.id, signal }); check(signal);
						if (edited && ids(edited).includes(updated.id)) next = edited;
					}
					if (await fence() !== before) throw new Error('Photo culling query definition changed.');
					if (!visible() || (input.advance && !input.advance.isCurrent())) throw new Error('Photo culling selection changed.');
					next = publishPage(current, next);
				} else next = current.query || current.stackCollapsed || current.savedCollectionId !== null ? await refreshQuery(owner, signal, current) : updateRow(updated, current);
				if (next) receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: next, notice: null });
			} catch (failure) { if (visible()) updateRow(updated, current); throw failure; }
		}, input.signal);
		return receipt ?? Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	};
	return Object.freeze({ refreshQuery, updateRow,
		setRating(photoId: string, rating: number, options?: Readonly<PhotoLibraryCullEditOptionsV1>) {
			readPhotoLibrarySelectionIdsV1([photoId]);
			if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new RangeError('Photo culling rating must be zero through five.');
			return editAttributes('setRating', Object.freeze([photoId, rating]), options);
		},
		applyAttributes(photoId: string, changes: PhotoLibraryAttributePatchV1, options?: Readonly<PhotoLibraryCullEditOptionsV1>) {
			readPhotoLibrarySelectionIdsV1([photoId]);
			const input = record(changes, 'photo culling attributes', ['rating', 'flag', 'colorLabel'], []), detached = snapshot(input).value;
			if (Object.keys(input).length === 0) throw new TypeError('Photo culling requires an authored attribute.');
			if (Object.hasOwn(input, 'rating') && (typeof detached.rating !== 'number' || !Number.isInteger(detached.rating) || detached.rating < 0 || detached.rating > 5)) throw new RangeError('Photo culling rating must be zero through five.');
			if (Object.hasOwn(input, 'flag') && (typeof detached.flag !== 'string' || !['unflagged', 'pick', 'reject'].includes(detached.flag))) throw new TypeError('Photo culling flag is unsupported.');
			if (Object.hasOwn(input, 'colorLabel') && (typeof detached.colorLabel !== 'string' || !['none', 'red', 'yellow', 'green', 'blue', 'purple'].includes(detached.colorLabel))) throw new TypeError('Photo culling color label is unsupported.');
			return editAttributes('applyAttributes', Object.freeze([photoId, detached]), options);
		} });
}
