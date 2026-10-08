/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionSnapshotV1,
	PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipSnapshotV1, PhotoLibraryOrganizationPortV1 } from '../src/common/editor/photo-library-organization-port-v1.ts';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { usePhotoLibraryWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

// Fixture budget: one scalar photo and definition, <=2 membership IDs, one held
// read/save per owner. Real workflow generations run without media or product documents.
const ROW: PhotoLibraryRowV1 = Object.freeze({ id: 'photo', fileName: 'Photo.png', width: 1, height: 1,
	rating: 0, flag: 'unflagged', colorLabel: 'none' });
const MEMBERSHIPS: PhotoLibraryMembershipSnapshotV1 = Object.freeze({ photoId: ROW.id, revision: 4,
	folderId: 'folder', keywordIds: Object.freeze(['keyword']), collectionIds: Object.freeze(['manual']) });
const NEXT_MEMBERSHIPS: PhotoLibraryMembershipSnapshotV1 = Object.freeze({ ...MEMBERSHIPS, revision: 5,
	folderId: null, keywordIds: Object.freeze(['keyword', 'added']) });
const NEXT_ROW: PhotoLibraryRowV1 = Object.freeze({ ...ROW, flag: 'pick' });
const MEMBERSHIP_ACK: PhotoLibraryMembershipAcknowledgementV1 = Object.freeze({ snapshot: NEXT_MEMBERSHIPS, row: NEXT_ROW });
const DEFINITION: PhotoLibraryDefinitionSnapshotV1 = Object.freeze({ rootRevision: 7,
	row: Object.freeze({ kind: 'folder', id: 'folder', name: 'Folder', parentId: null }), queryJson: null });
const DEFINITION_ACK: PhotoLibraryDefinitionAcknowledgementV1 = Object.freeze({ rootRevision: 8,
	row: Object.freeze({ kind: 'folder', id: 'folder', name: 'Renamed', parentId: null }) });
const COMMAND: PhotoLibraryDefinitionCommandV1 = Object.freeze({ type: 'rename-node', nodeKind: 'folder', id: 'folder', name: 'Renamed' });
const PATCH = Object.freeze({ folderId: null, keywordIds: NEXT_MEMBERSHIPS.keywordIds });
const QUERY: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: Object.freeze({ kind: 'folder', id: 'folder' }),
	sort: Object.freeze({ field: 'photo-id', direction: 'ascending' }) });
const page = (catalogName = 'Library'): PhotoLibraryPageV1 => Object.freeze({ catalogName, totalCount: 1,
	rows: Object.freeze([ROW]), cursor: 'old-cursor' });

test('definition readers stay stable and independent of the foreground busy state while StrictMode opening remains inert', async () => {
	const session = owner(), result = deferred<PhotoLibraryPageV1>(), mounted = await mount(session.factory);
	session.port.readPage = async () => result.promise;
	let work: Promise<void> | undefined;
	try {
		assert.equal(session.opens(), 0); assert.equal(mounted.current.memberships, null);
		const readDefinition = mounted.current.readDefinition;
		work = (await mounted.start(() => mounted.current.readPage())).pending;
		assert.equal(mounted.current.busy, true);
		await act(async () => { assert.equal(await readDefinition({ kind: 'folder', id: 'folder' }), DEFINITION); });
		assert.equal(session.opens(), 1); assert.equal(mounted.current.busy, true);
		assert.equal(mounted.current.memberships, null); assert.equal(mounted.current.readDefinition, readDefinition);
		await mounted.render(session.factory); assert.equal(mounted.current.readDefinition, readDefinition);
		await act(async () => { result.resolve(page()); await work; });
		assert.equal(mounted.current.busy, false); assert.equal(mounted.current.readDefinition, readDefinition);
	} finally { result.resolve(page()); await work; await mounted.dispose(); }
	assert.equal(session.closes(), 1);
});

test('definition reads refuse pre-aborted demand before opening and external cancellation fences a late scalar result', async () => {
	const session = owner(), result = deferred<PhotoLibraryDefinitionSnapshotV1>(), mounted = await mount(session.factory);
	const controller = new AbortController(); let observed: AbortSignal | undefined, reads = 0;
	session.port.readDefinition = async request => { reads++; observed = request.signal; return result.promise; };
	let work: Promise<PhotoLibraryDefinitionSnapshotV1> | undefined;
	try {
		await assert.rejects(mounted.current.readDefinition({ kind: 'folder', id: 'folder', signal: AbortSignal.abort() }), { name: 'AbortError' });
		assert.equal(session.opens(), 0); assert.equal(reads, 0);
		work = (await mounted.start(() => mounted.current.readDefinition({ kind: 'folder', id: 'folder', signal: controller.signal }))).pending;
		assert.equal(observed?.aborted, false); assert.equal(mounted.current.busy, false);
		const rejected = assert.rejects(work, { name: 'AbortError' });
		await act(async () => { controller.abort(); result.resolve(DEFINITION); await rejected; });
		assert.equal(observed?.aborted, true); assert.equal(mounted.current.memberships, null); assert.equal(mounted.current.error, null);
	} finally { result.resolve(DEFINITION); await Promise.allSettled([work]); await mounted.dispose(); }
});

test('definition save admission rejects busy, canceled and failed pre-ack work without changing the displayed page', async () => {
	const session = owner(), result = deferred<PhotoLibraryDefinitionAcknowledgementV1>(), mounted = await mount(session.factory);
	let saves = 0, observed: AbortSignal | undefined, work: Promise<PhotoLibraryDefinitionAcknowledgementV1> | undefined;
	session.port.applyDefinition = async (revision, command, options) => {
		saves++; assert.equal(revision, 7); assert.deepEqual(command, COMMAND); observed = options?.signal; return result.promise;
	};
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		work = (await mounted.start(() => mounted.current.applyDefinition(7, COMMAND))).pending;
		assert.equal(mounted.current.busy, true); assert.equal(mounted.current.page, before);
		await act(async () => { await assert.rejects(mounted.current.applyDefinition(7, COMMAND), /busy|pending/iu); });
		assert.equal(saves, 1);
		const rejected = assert.rejects(work, { name: 'AbortError' });
		await act(async () => { mounted.current.cancel(); result.reject(new DOMException('Canceled before commit', 'AbortError')); await rejected; });
		assert.equal(observed?.aborted, true); assert.equal(mounted.current.page, before); assert.equal(mounted.current.error, null);
		session.port.applyDefinition = async () => { throw new Error('Catalog revision conflict'); };
		await act(async () => { await assert.rejects(mounted.current.applyDefinition(7, COMMAND), /Catalog revision conflict/u); });
		assert.equal(mounted.current.page, before); assert.equal(mounted.current.busy, false);
	} finally { result.resolve(DEFINITION_ACK); await Promise.allSettled([work]); await mounted.dispose(); }
});

test('an acknowledged definition returns its durable result despite active-query refresh failure and invalidates the old cursor', async () => {
	const session = owner(), mounted = await mount(session.factory); let queries = 0, saved = false;
	session.port.readQueryStep = async () => {
		if (++queries > 1) throw new Error('Definition query refresh failed'); return { ...page(), scanned: 1 };
	};
	session.port.applyDefinition = async () => { saved = true; return DEFINITION_ACK; };
	try {
		await act(async () => { await mounted.current.applyQuery(QUERY); });
		let ack: PhotoLibraryDefinitionAcknowledgementV1 | undefined;
		await act(async () => { ack = await mounted.current.applyDefinition(7, COMMAND); });
		assert.equal(saved, true); assert.equal(ack, DEFINITION_ACK); assert.equal(queries, 2);
		assert.equal(mounted.current.page?.cursor, null); assert.deepEqual(mounted.current.page?.rows, [ROW]);
		assert.deepEqual(mounted.current.query, QUERY); assert.equal(mounted.current.error, 'Definition query refresh failed');
		assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('retired definition readers and new writes reject while a late admitted durable acknowledgement remains truthful', async () => {
	const first = owner(), second = owner('Replacement'), result = deferred<PhotoLibraryDefinitionAcknowledgementV1>();
	const mounted = await mount(first.factory); let observed: AbortSignal | undefined, saves = 0, reads = 0;
	let work: Promise<PhotoLibraryDefinitionAcknowledgementV1> | undefined;
	first.port.applyDefinition = async (_revision, _command, options) => { saves++; observed = options?.signal; return result.promise; };
	first.port.readDefinition = async () => { reads++; return DEFINITION; };
	try {
		await act(async () => { await mounted.current.readPage(); }); const retired = mounted.current;
		work = (await mounted.start(() => retired.applyDefinition(7, COMMAND))).pending;
		await mounted.render(second.factory); assert.equal(observed?.aborted, true); assert.equal(first.closes(), 1);
		await assert.rejects(retired.readDefinition({ kind: 'folder', id: 'folder' }), { name: 'AbortError' });
		await assert.rejects(retired.applyDefinition(7, COMMAND), { name: 'AbortError' });
		assert.equal(reads, 0); assert.equal(saves, 1);
		await act(async () => { await mounted.current.readPage(); }); const replacement = mounted.current.page;
		await act(async () => { result.resolve(DEFINITION_ACK); assert.equal(await work, DEFINITION_ACK); });
		assert.equal(mounted.current.page, replacement); assert.equal(mounted.current.page?.catalogName, 'Replacement');
		assert.equal(mounted.current.memberships, null); assert.equal(mounted.current.busy, false);
	} finally { result.resolve(DEFINITION_ACK); await work; await mounted.dispose(); }
});

test('membership reads publish only the current generation and a late old snapshot cannot replace the new photo state', async () => {
	const first = owner(), second = owner('Replacement'), result = deferred<PhotoLibraryMembershipSnapshotV1>();
	const mounted = await mount(first.factory); let observed: AbortSignal | undefined, work: Promise<void> | undefined;
	first.port.readMemberships = async (_id, options) => { observed = options?.signal; return result.promise; };
	second.port.readMemberships = async () => NEXT_MEMBERSHIPS;
	try {
		work = (await mounted.start(() => mounted.current.readMemberships(ROW.id))).pending;
		assert.equal(mounted.current.memberships, null); assert.equal(mounted.current.busy, true);
		await mounted.render(second.factory); assert.equal(observed?.aborted, true); assert.equal(first.closes(), 1);
		await act(async () => { await mounted.current.readMemberships(ROW.id); }); assert.equal(mounted.current.memberships, NEXT_MEMBERSHIPS);
		await act(async () => { result.resolve(MEMBERSHIPS); await work; });
		assert.equal(mounted.current.memberships, NEXT_MEMBERSHIPS); assert.equal(mounted.current.busy, false);
	} finally { result.resolve(MEMBERSHIPS); await work; await mounted.dispose(); }
});

test('membership save keeps the prior snapshot and row until acknowledgement then publishes exact values and clears its cursor', async () => {
	const session = owner(), result = deferred<PhotoLibraryMembershipAcknowledgementV1>(), mounted = await mount(session.factory);
	let saves = 0, work: Promise<void> | undefined;
	session.port.applyMemberships = async (id, revision, patch) => {
		saves++; assert.equal(id, ROW.id); assert.equal(revision, 4); assert.deepEqual(patch, PATCH); return result.promise;
	};
	try {
		await act(async () => { await mounted.current.readPage(); await mounted.current.readMemberships(ROW.id); });
		const before = mounted.current.page;
		work = (await mounted.start(() => mounted.current.applyMemberships(ROW.id, 4, PATCH))).pending;
		assert.equal(mounted.current.memberships, MEMBERSHIPS); assert.equal(mounted.current.page, before); assert.equal(mounted.current.busy, true);
		await act(async () => { await mounted.current.applyMemberships(ROW.id, 4, PATCH); }); assert.equal(saves, 1);
		await act(async () => { result.resolve(MEMBERSHIP_ACK); await work; });
		assert.equal(mounted.current.memberships, NEXT_MEMBERSHIPS); assert.equal(mounted.current.page?.rows[0], NEXT_ROW);
		assert.equal(mounted.current.page?.cursor, null); assert.equal(mounted.current.busy, false);
		assert.deepEqual(MEMBERSHIPS.keywordIds, ['keyword']); assert.deepEqual(MEMBERSHIPS.collectionIds, ['manual']);
	} finally { result.resolve(MEMBERSHIP_ACK); await work; await mounted.dispose(); }
});

test('failed membership save leaves state intact, while failed refresh after acknowledgement retains the durable snapshot and row', async () => {
	const session = owner(), mounted = await mount(session.factory); let queries = 0;
	session.port.readQueryStep = async () => {
		if (++queries > 1) throw new Error('Membership query refresh failed'); return { ...page(), scanned: 1 };
	};
	try {
		await act(async () => { await mounted.current.applyQuery(QUERY); await mounted.current.readMemberships(ROW.id); });
		const before = mounted.current.page;
		session.port.applyMemberships = async () => { throw new Error('Photo revision conflict'); };
		await act(async () => { await mounted.current.applyMemberships(ROW.id, 4, PATCH); });
		assert.equal(mounted.current.memberships, MEMBERSHIPS); assert.equal(mounted.current.page, before); assert.equal(queries, 1);
		assert.equal(mounted.current.error, 'Photo revision conflict');
		session.port.applyMemberships = async () => MEMBERSHIP_ACK;
		await act(async () => { await mounted.current.applyMemberships(ROW.id, 4, PATCH); });
		assert.equal(mounted.current.memberships, NEXT_MEMBERSHIPS); assert.equal(mounted.current.page?.rows[0], NEXT_ROW);
		assert.equal(mounted.current.page?.cursor, null); assert.equal(queries, 2); assert.deepEqual(mounted.current.query, QUERY);
		assert.equal(mounted.current.error, 'Membership query refresh failed'); assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('an old admitted membership acknowledgement cannot publish into a replacement generation with the same photo ID', async () => {
	const first = owner(), second = owner('Replacement'), result = deferred<PhotoLibraryMembershipAcknowledgementV1>();
	const mounted = await mount(first.factory); let observed: AbortSignal | undefined, work: Promise<void> | undefined;
	first.port.applyMemberships = async (_id, _revision, _patch, options) => { observed = options?.signal; return result.promise; };
	try {
		await act(async () => { await mounted.current.readPage(); await mounted.current.readMemberships(ROW.id); });
		work = (await mounted.start(() => mounted.current.applyMemberships(ROW.id, 4, PATCH))).pending;
		await mounted.render(second.factory); assert.equal(observed?.aborted, true); assert.equal(mounted.current.memberships, null);
		await act(async () => { await mounted.current.readPage(); await mounted.current.readMemberships(ROW.id); });
		const replacement = mounted.current.page;
		await act(async () => { result.resolve(MEMBERSHIP_ACK); await work; });
		assert.equal(mounted.current.memberships, MEMBERSHIPS); assert.equal(mounted.current.page, replacement);
		assert.equal(mounted.current.page?.rows[0], ROW); assert.equal(mounted.current.error, null); assert.equal(first.closes(), 1);
	} finally { result.resolve(MEMBERSHIP_ACK); await work; await mounted.dispose(); }
});

function owner(catalogName = 'Library') {
	let opens = 0, closes = 0;
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected non-organization operation.'); };
	const port: PhotoLibrarySessionPortV1 & PhotoLibraryOrganizationPortV1 = {
		readBatchRenameSelection: unexpected,
		planBatchRename: (): never => { throw new Error('Unexpected batch rename plan in organization fixture.'); },
		renamePhotos: unexpected, undoBatchRename: unexpected,
		readImportPresets: unexpected, applyImportPreset: unexpected, backupCatalog: unexpected,
		readPage: async () => page(catalogName), readQueryStep: async () => ({ ...page(catalogName), scanned: 1 }),
		rebuildQueryStep: unexpected, readDefinitionPage: unexpected, readPreview: unexpected, importFiles: unexpected,
		setRating: unexpected, applyAttributes: unexpected, readMetadata: unexpected, applyMetadata: unexpected,
		readDefinition: async () => DEFINITION, applyDefinition: async () => DEFINITION_ACK,
		readMemberships: async () => MEMBERSHIPS, applyMemberships: async () => MEMBERSHIP_ACK,
		close: async () => { closes++; },
	};
	return { port, factory: async () => { opens++; return port; }, opens: () => opens, closes: () => closes };
}

async function mount(initialFactory: CreatePhotoLibrarySessionV1) {
	const dom = installReactTestDom(), global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = global.IS_REACT_ACT_ENVIRONMENT;
	global.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof usePhotoLibraryWorkflow> | null = null, unmounted = false;
	function Harness({ factory }: Readonly<{ factory: CreatePhotoLibrarySessionV1 }>) { state = usePhotoLibraryWorkflow(factory); return null; }
	const render = async (factory: CreatePhotoLibrarySessionV1) => { await act(async () => { root.render(<StrictMode><Harness factory={factory} /></StrictMode>); await settle(); }); };
	const unmount = async () => { if (unmounted) return; unmounted = true; await act(() => { root.unmount(); }); };
	const dispose = async () => { try { await unmount(); } finally { dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = previous; } };
	try { await render(initialFactory); } catch (error) { await dispose(); throw error; }
	return { render,
		get current() { if (!state) throw new Error('Organization workflow did not mount.'); return state; },
		async start<T>(action: () => Promise<T>) {
			let pending: Promise<T> | undefined;
			await act(async () => { pending = action(); await settle(); });
			if (!pending) throw new Error('Organization work did not start.'); return { pending };
		}, dispose,
	};
}
