/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, type RefObject } from 'react';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../closed-domain-value.ts';
import { acquirePhotoLibraryWorkflowSlotV2, type PhotoLibraryWorkflowSlotV2 } from '../../controller/shared/photo-library-workflow-slot-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { CreatePhotoLibrarySessionV3, PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';
import { acquirePhotoLibraryWorkflowSlotCurrentV1, type PhotoLibraryWorkflowSlotCurrentV1 } from '../../controller/shared/photo-library-workflow-slot-current-v1.ts';
import type { CreatePhotoLibrarySessionCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDefinitionPageV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibrarySavedCollectionPageV1, PhotoLibrarySavedCollectionPortV1 } from '../../photo-library-saved-collection-port-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV1, PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from '../../photo-library-collection-handoff-port-v1.ts';
import type { PhotoFramescaperCollectionHandoffTargetSelectedV1 } from '../../../../lightscaper/controller/photo-framescaper-collection-handoff-download-current-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV2, PhotoLibraryCollectionHandoffViewV2 } from '../../photo-library-collection-handoff-port-v2.ts';
import { capturedCollectionFactsForProfileV1 } from './internal/photo-library-workflow-collection-facts-kernel-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../../../lightscaper/storage/photo-develop-preset-read-v2.ts';

export interface CapturedPhotoCollectionHandoff {
	readCatalogPage(request?: Readonly<{ cursor?: string | null; selectedId?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryDefinitionPageV1>;
	readSavedPage(request?: Readonly<{ cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibrarySavedCollectionPageV1>;
	prepare(selection: Readonly<{ scope: 'catalog' | 'saved-query'; collectionId: string }>, signal: AbortSignal):
		Promise<Readonly<{ fileName: string; target: Readonly<PhotoFramescaperCollectionHandoffTargetSelectedV1> }>>;
}
type SessionSlot = PhotoLibraryWorkflowSlotV2 | PhotoLibraryWorkflowSlotCurrentV1;
type SessionFactory = CreatePhotoLibrarySessionV3 | CreatePhotoLibrarySessionCurrentV1;
type RendererFactory = CreatePhotoLibraryDevelopProxyRuntimeV2 | CreatePhotoLibraryDevelopProxyRuntimeV3;
interface Owners {
	readonly slot: RefObject<SessionSlot | null>; readonly factory: RefObject<SessionFactory | undefined>;
	readonly loader: RefObject<LoadPhotoLibraryBackupSaveRuntimeV1 | undefined>; readonly renderer: RefObject<RendererFactory | undefined>;
	readonly createSession: SessionFactory | undefined; readonly loadBackupSaveRuntime: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	readonly createDevelopProxyRuntime: RendererFactory | undefined;
}
interface Ports {
	readonly readCatalog: PhotoLibrarySessionPortV2['readDefinitionPage']; readonly readDefinition: PhotoLibrarySessionPortV2['readDefinition'];
	readonly readSaved: PhotoLibrarySavedCollectionPortV1['readPage']; readonly readSnapshot: PhotoLibrarySavedCollectionPortV1['readSnapshot'];
	readonly withCapture: PhotoLibraryCollectionHandoffPortV1['withCapture'] | PhotoLibraryCollectionHandoffPortV2['withCapture'];
}
const CHECK = AbortSignal.prototype.throwIfAborted, ANY = AbortSignal.any;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Collection handoff requires a stable selected identity.'); return value;
}
function data(value: unknown, key: string, inherited = false): unknown {
	if (!value || typeof value !== 'object') throw new TypeError('Collection handoff capability is unavailable.');
	let receiver: object | null = value;
	for (let depth = 0; receiver && depth < 8; depth++) {
		const property = Object.getOwnPropertyDescriptor(receiver, key);
		if (property) { if (!Object.hasOwn(property, 'value')) throw new TypeError('Collection handoff requires an inert capability.'); return property.value as unknown; }
		if (!inherited) break; receiver = Object.getPrototypeOf(receiver) as object | null;
	}
	throw new TypeError('Collection handoff capability is unavailable.');
}
function pin<Method>(receiver: unknown, key: string, inherited = false): Method {
	const method = data(receiver, key, inherited);
	if (typeof method !== 'function') throw new TypeError('Collection handoff capability must be callable.');
	return ((...args: unknown[]) => Reflect.apply(method, receiver, args) as unknown) as Method;
}
function paging(value: unknown, catalog: boolean) {
	const label = 'Collection chooser page', input = record(value, label, catalog ? ['cursor', 'selectedId', 'signal'] : ['cursor', 'signal'], []);
	const options = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const cursor = Object.hasOwn(input, 'cursor') ? field(input, 'cursor', label) : undefined;
	if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length > 4_096)) throw new TypeError('Collection chooser requires a bounded cursor.');
	const selected = Object.hasOwn(input, 'selectedId') ? field(input, 'selectedId', label) : undefined;
	return Object.freeze({ ...options, ...(cursor !== undefined ? { cursor: cursor as string | null } : {}),
		...(selected !== undefined ? { selectedId: selected === null ? null : id(selected) } : {}) });
}

/** Menu-gesture generation capture. Every demand borrows the actual selected
 * Session operation; no mutation queue or lease is held around a returned UI. */
export function usePhotoLibraryWorkflowCollectionHandoff({ slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime }: Owners, profile: 'legacy2' | 'current3' = 'legacy2') {
	const captureCollectionHandoff = useCallback((): Readonly<CapturedPhotoCollectionHandoff> => {
		const captured = slot.current; let pending: Promise<Readonly<Ports>> | null = null;
		const isCurrent = () => captured?.live && slot.current === captured && captured.factory === createSession && captured.factory === factory.current
			&& captured.proxyFactory === createDevelopProxyRuntime && captured.proxyFactory === renderer.current
			&& captured.backupLoader === loadBackupSaveRuntime && captured.backupLoader === loader.current;
		const checked = (signal: AbortSignal) => { check(signal); if (!captured || !isCurrent()) throw new DOMException('Collection handoff generation is closed.', 'AbortError'); };
		const joined = (caller?: AbortSignal) => {
			if (caller) readPhotoDevelopSignalOptionsV2({ signal: caller });
			if (!captured || !isCurrent()) throw new DOMException('Collection handoff generation is closed.', 'AbortError');
			const signal = caller ? Reflect.apply(ANY, AbortSignal, [[caller, captured.lifetime.signal]]) as AbortSignal : captured.lifetime.signal;
			checked(signal); return signal;
		};
		const ports = async (signal: AbortSignal) => {
			checked(signal);
			if (!pending) {
				const work = (async () => {
					const owner = await (profile === 'current3' ? acquirePhotoLibraryWorkflowSlotCurrentV1(captured as PhotoLibraryWorkflowSlotCurrentV1) : acquirePhotoLibraryWorkflowSlotV2(captured as PhotoLibraryWorkflowSlotV2)); checked(signal);
					const saved = data(owner, 'savedCollections'), handoff = data(owner, profile === 'current3' ? 'collectionHandoffCurrent' : 'collectionHandoff');
					return Object.freeze({ readCatalog: pin<Ports['readCatalog']>(owner, 'readDefinitionPage', true), readDefinition: pin<Ports['readDefinition']>(owner, 'readDefinition', true),
						readSaved: pin<Ports['readSaved']>(saved, 'readPage'), readSnapshot: pin<Ports['readSnapshot']>(saved, 'readSnapshot'), withCapture: pin<Ports['withCapture']>(handoff, 'withCapture') });
				})();
				pending = work; void work.catch(() => { if (pending === work) pending = null; });
			}
			const result = await pending; checked(signal); return result;
		};
		return Object.freeze({
			async readCatalogPage(request = {}) {
				const input = paging(request, true), signal = joined(input.signal), native = await ports(signal);
				const result = await native.readCatalog({ kind: 'collection', ...input, signal }); checked(signal); return result;
			},
			async readSavedPage(request = {}) {
				const input = paging(request, false), signal = joined(input.signal), native = await ports(signal);
				const result = await native.readSaved({ ...(input.cursor !== undefined ? { cursor: input.cursor } : {}), signal }); checked(signal); return result;
			},
			async prepare(selection: Parameters<CapturedPhotoCollectionHandoff['prepare']>[0], caller: AbortSignal) {
				const label = 'Collection handoff selection', input = record(selection, label, ['scope', 'collectionId']);
				const scope = field(input, 'scope', label), collectionId = id(field(input, 'collectionId', label));
				if (scope !== 'catalog' && scope !== 'saved-query') throw new TypeError('Collection handoff requires an explicit scope.');
				readPhotoDevelopSignalOptionsV2({ signal: caller }); const signal = joined(caller), native = await ports(signal);
				const readSelection = async (operationSignal: AbortSignal) => {
					const snapshot = await native.readSnapshot({ collectionId: scope === 'saved-query' ? collectionId : null, signal: operationSignal }); checked(operationSignal);
					if (snapshot.collectionId !== (scope === 'saved-query' ? collectionId : null)) throw new Error('Collection selection changed.');
					if (scope === 'saved-query') {
						if (!snapshot.definition || snapshot.definition.id !== collectionId) throw new Error('Saved collection is unavailable.');
						return { binding: Object.freeze({ catalogId: snapshot.context.catalogId, collectionId, scope, expectedCatalogRevision: snapshot.context.catalogRevision,
							expectedDefinitionRevision: snapshot.definition.revision }), name: snapshot.definition.name, definition: snapshot.definition.queryJson };
					}
					const definition = await native.readDefinition({ kind: 'collection', id: collectionId, signal: operationSignal }); checked(operationSignal);
					if (definition.rootRevision !== snapshot.context.catalogRevision || definition.row.kind !== 'collection' || definition.row.id !== collectionId) throw new Error('Collection selection changed.');
					return { binding: Object.freeze({ catalogId: snapshot.context.catalogId, collectionId, scope, expectedCatalogRevision: snapshot.context.catalogRevision }),
						name: definition.row.name, definition: JSON.stringify(definition) };
				};
				const selected = await readSelection(signal), proof = JSON.stringify(selected); let archiveFacts: string | null = null;
				const operationSignal = (external?: AbortSignal) => { const result = external ? Reflect.apply(ANY, AbortSignal, [[signal, joined(external)]]) as AbortSignal : signal; checked(result); return result; };
				const invoke = async <Result>(request: Readonly<PhotoLibraryCollectionHandoffRequestV1>,
						consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2>) => Result | Promise<Result>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result> => {
					const readOptions = readPhotoDevelopSignalOptionsV2(options), current = operationSignal(readOptions.signal);
					const detached = record(request, label, ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision', 'expectedDefinitionRevision'], ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision']);
					if (Object.keys(detached).length !== Object.keys(selected.binding).length || Object.keys(selected.binding).some(key => field(detached, key, label) !== data(selected.binding, key))) throw new Error('Collection capture binding changed.');
					if (typeof consume !== 'function') throw new TypeError('Collection capture requires its callable consumer.');
					const result = await deliverJoined<Readonly<PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2>, Result>(receive => Reflect.apply(native.withCapture, native, [selected.binding, receive, { signal: current }]) as Promise<unknown>, async view => {
						checked(current); const facts = capturedCollectionFactsForProfileV1(profile, view);
						if (archiveFacts !== null && facts !== archiveFacts) throw new Error('Captured collection saved facts changed.');
						archiveFacts = facts; const delivered = await consume(view); checked(current); return delivered;
					});
					checked(current); return result;
				};
				const legacyCapture = Object.freeze<PhotoLibraryCollectionHandoffPortV1>({ withCapture(request, consume, options) {
					if (typeof consume !== 'function') return Promise.reject(new TypeError('Collection capture requires its callable consumer.'));
					return invoke(request, view => { if (view.schemaVersion !== 1) throw new TypeError('Legacy collection view changed.'); return consume(view); }, options);
				} });
				const currentCapture = Object.freeze<PhotoLibraryCollectionHandoffPortV2>({ withCapture(request, consume, options) {
					if (typeof consume !== 'function') return Promise.reject(new TypeError('Collection capture requires its callable consumer.'));
					return invoke(request, view => { if (view.schemaVersion !== 2) throw new TypeError('Current collection view changed.'); return consume(view); }, options);
				} });
				const checkCurrent = async (external: AbortSignal) => {
					const current = operationSignal(external);
					if (archiveFacts === null) {
						if (JSON.stringify(await readSelection(current)) !== proof) throw new Error('Saved collection changed.');
					} else {
						// The archive's scoped body authority has ended. A new actual Session
						// capture reauthenticates resources and the whole ordered scalar witness.
						await deliverJoined<Readonly<PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2>, void>(receive => Reflect.apply(native.withCapture, native, [selected.binding, receive, { signal: current }]) as Promise<unknown>, view => {
							checked(current); if (capturedCollectionFactsForProfileV1(profile, view) !== archiveFacts) throw new Error('Captured collection saved facts changed.');
						});
					}
					checked(current);
				};
				const target = profile === 'current3' ? Object.freeze({ schemaVersion: 2 as const, binding: selected.binding, capture: currentCapture, checkCurrent })
					: Object.freeze({ binding: selected.binding, capture: legacyCapture, checkCurrent });
				return Object.freeze({ fileName: `${selected.name}.fscape`, target });
			},
		});
	}, [profile, slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime]);
	return { captureCollectionHandoff };
}

/** Join an admitted callback even if its transport ignores the returned work.
 * Preserve distinct opaque transport/consumer errors without reflecting them. */
async function deliverJoined<Input, Result>(invoke: (consume: (input: Input) => Promise<Result>) => Promise<unknown>,
	consume: (input: Input) => Result | Promise<Result>): Promise<Result> {
	type Outcome = { ok: true; value: Result } | { ok: false; reason: unknown };
	let accepting = true, entered = false, outcome: Promise<Outcome> | null = null, failed = false, primary: unknown;
	try { await invoke(input => {
		if (!accepting || entered) throw new Error('Collection capture requires one admitted callback.'); entered = true;
		const work = (async () => consume(input))(); outcome = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason })); return work;
	}); } catch (error) { failed = true; primary = error; }
	accepting = false;
	const observed = outcome as Promise<Outcome> | null, result = observed ? await observed : null;
	if (failed) {
		if (result && !result.ok && result.reason !== primary) throw new AggregateError([primary, result.reason], 'Collection capture and consumer failed.', { cause: primary });
		throw primary;
	}
	if (!result) throw new Error('Collection capture omitted its admitted view.');
	if (!result.ok) throw result.reason; return result.value;
}
