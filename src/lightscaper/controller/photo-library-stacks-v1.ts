/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryStackContextV1, PhotoLibraryStackV1, PhotoLibraryStackBindingV1, PhotoLibraryStackCommandV1,
	PhotoLibraryStackAcknowledgementV1, PhotoLibraryStackMembershipsV1, PhotoLibraryStackSnapshotV1, PhotoLibraryStackMembersV1,
	PhotoLibraryStackSummaryPageV1 } from '../../common/editor/photo-library-stack-port-v1.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { normalizePhotoStackV1, normalizePhotoStackStateV1 } from '../catalog/photo-stack-v1.ts';
import { readPhotoStackPageOptionsV1, readPhotoStackSignalOptionsV1, PhotoStackRevisionConflictError,
	type PhotoStackContinuationV1 } from '../catalog/photo-stack-repository-v1.ts';
import { array, field, id, integer, name, oneOf, record, unique } from '../catalog/value-validation.ts';

export type PhotoLibraryStackRepositoryV1 = Pick<PhotoCatalogRepositoryV1, 'readSnapshot' | 'readStackState' | 'loadStack' |
	'readStackMembershipPage' | 'readStackMemberPage' | 'readStackPage' | 'saveStack' | 'dissolveStack'>;
const BASE = ['schemaVersion', 'type', 'catalogId', 'expectedCatalogRevision', 'expectedStateRevision'] as const;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;

export function admitPhotoLibraryStackCommandV1(value: unknown): PhotoLibraryStackCommandV1 {
	const base = record(value, 'stack command', [...BASE, 'id', 'expectedStackRevision', 'photoIds', 'coverPhotoId'], BASE);
	requireVersion(base);
	const type = oneOf(field(base, 'type'), ['create', 'update', 'dissolve'] as const, 'stack command');
	const input = record(value, 'stack command', [...BASE, ...(type === 'create' ? [] : ['id', 'expectedStackRevision']),
		...(type === 'dissolve' ? [] : ['photoIds', 'coverPhotoId'])]);
	const common = { schemaVersion: 1 as const, catalogId: id(field(input, 'catalogId'), 'stack catalog ID'),
		expectedCatalogRevision: nextable(field(input, 'expectedCatalogRevision')), expectedStateRevision: nextable(field(input, 'expectedStateRevision')) };
	const identity = type === 'create' ? null : { id: id(field(input, 'id'), 'stack ID'), expectedStackRevision: nextable(field(input, 'expectedStackRevision')) };
	if (type === 'dissolve') return Object.freeze({ ...common, type, ...identity! });
	const selected = array(field(input, 'photoIds'), 'stack command photos', 2, type === 'create' ? 64 : 1024);
	const stack = normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: common.catalogId, id: identity?.id ?? 'admission',
		revision: identity?.expectedStackRevision ?? 0, photoIds: selected, coverPhotoId: field(input, 'coverPhotoId') });
	return type === 'create' ? Object.freeze({ ...common, type, photoIds: stack.photoIds, coverPhotoId: stack.coverPhotoId })
		: Object.freeze({ ...common, type, ...identity!, photoIds: stack.photoIds, coverPhotoId: stack.coverPhotoId });
}
export function admitPhotoLibraryStackReadV1(photoIds: unknown, options: unknown = {}) {
	const ids = array(photoIds, 'stack read photos', 0, 64).map(entry => id(entry, 'stack read photo ID'));
	unique(ids, 'stack read photos'); return Object.freeze({ photoIds: Object.freeze(ids), ...readPhotoStackSignalOptionsV1(options) });
}
export function admitPhotoLibraryStackMembersV1(value: unknown, photoIds: unknown, options: unknown = {}) {
	const input = record(value, 'stack member binding', ['schemaVersion', 'catalogId', 'catalogRevision', 'indexRevision', 'stateRevision', 'stackId', 'stackRevision']);
	requireVersion(input);
	const binding: PhotoLibraryStackBindingV1 = Object.freeze({ schemaVersion: 1, catalogId: id(field(input, 'catalogId'), 'binding catalog ID'),
		catalogRevision: revision(field(input, 'catalogRevision')), indexRevision: revision(field(input, 'indexRevision')), stateRevision: revision(field(input, 'stateRevision')),
		stackId: id(field(input, 'stackId'), 'binding stack ID'), stackRevision: revision(field(input, 'stackRevision')) });
	const selected = admitPhotoLibraryStackReadV1(photoIds, options);
	if (!selected.photoIds.length) throw new RangeError('Stack member lookup requires at least one photo.');
	return Object.freeze({ binding, ...selected });
}
export function admitPhotoLibraryStackSummaryV1(value: unknown = {}) {
	const input = record(value, 'stack summary request', ['cursor', 'signal'], []);
	const raw = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	let continuation: PhotoStackContinuationV1 | null = null;
	if (raw !== null && raw !== undefined) {
		if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > 2048) throw new RangeError('Stack cursor exceeds its scalar budget.');
		const parsed: unknown = JSON.parse(raw);
		const cursor = record(parsed, 'stack summary cursor', ['catalogId', 'scope', 'catalogRevision', 'indexRevision', 'stateRevision', 'afterKey']);
		continuation = readPhotoStackPageOptionsV1({ continuation: parsed }, id(field(cursor, 'catalogId'), 'cursor catalog ID'), 'stacks').continuation ?? null;
	}
	return Object.freeze({ continuation, ...readPhotoStackSignalOptionsV1(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {}) });
}

export async function readPhotoLibraryStackMembershipsV1(repository: PhotoLibraryStackRepositoryV1, catalogId: string, photoIds: readonly string[], signal: AbortSignal): Promise<PhotoLibraryStackMembershipsV1> {
	const context = await capture(repository, catalogId, signal);
	const raw = record(await repository.readStackMembershipPage(catalogId, { photoIds, signal }), 'stack memberships page', ['items', 'continuation']);
	if (field(raw, 'continuation') !== null) throw new TypeError('Point memberships cannot carry a cursor.');
	const memberships = array(field(raw, 'items'), 'stack memberships', 0, 64).map(value => {
		const row = record(value, 'stack membership', ['catalogId', 'photoId', 'stackId']); const photoId = id(field(row, 'photoId'), 'member photo ID');
		if (field(row, 'catalogId') !== catalogId || !photoIds.includes(photoId)) throw new TypeError('Stack membership belongs to another request.');
		return Object.freeze({ photoId, stackId: id(field(row, 'stackId'), 'member stack ID') });
	});
	unique(memberships.map(row => row.photoId), 'stack membership photos');
	await assertStable(repository, catalogId, context, signal);
	return Object.freeze({ context, memberships: Object.freeze(photoIds.map(photoId => Object.freeze({ photoId,
		stackId: memberships.find(row => row.photoId === photoId)?.stackId ?? null }))) });
}
export async function readPhotoLibraryStackSnapshotV1(repository: PhotoLibraryStackRepositoryV1, catalogId: string, photoId: string, signal: AbortSignal): Promise<PhotoLibraryStackSnapshotV1> {
	const membership = await readPhotoLibraryStackMembershipsV1(repository, catalogId, [photoId], signal);
	const stackId = membership.memberships[0]!.stackId;
	const raw = stackId === null ? null : await repository.loadStack(catalogId, stackId, { signal });
	const stack = raw === null ? null : normalizePhotoStackV1(raw);
	if (stackId !== null && (!stack || stack.catalogId !== catalogId || stack.id !== stackId || !stack.photoIds.includes(photoId))) throw new TypeError('Selected photo disagrees with its stack.');
	await assertStable(repository, catalogId, membership.context, signal);
	return Object.freeze({ context: membership.context, stack: stack === null ? null : presentStack(stack) });
}
export async function readPhotoLibraryStackMembersV1(repository: PhotoLibraryStackRepositoryV1, catalogId: string, binding: PhotoLibraryStackBindingV1, photoIds: readonly string[], signal: AbortSignal): Promise<PhotoLibraryStackMembersV1> {
	if (binding.catalogId !== catalogId) throw new TypeError('Stack member binding belongs to another catalog.');
	const context = await capture(repository, catalogId, signal);
	if (binding.catalogRevision !== context.catalogRevision || binding.indexRevision !== context.indexRevision
		|| binding.stateRevision !== context.stateRevision) throw new PhotoStackRevisionConflictError();
	const rows = array(await repository.readStackMemberPage(catalogId, binding.stackId, binding.stackRevision, photoIds, { signal }), 'stack member rows', 1, 64).map(value => {
		const row = record(value, 'stack member row', ['photoId', 'fileName', 'photoRevision']);
		return Object.freeze({ photoId: id(field(row, 'photoId'), 'member photo ID'), fileName: name(field(row, 'fileName'), 'member file name'), photoRevision: revision(field(row, 'photoRevision')) });
	});
	if (rows.length !== photoIds.length || rows.some((row, index) => row.photoId !== photoIds[index])) throw new TypeError('Stack member rows disagree with requested order.');
	await assertStable(repository, catalogId, context, signal); return Object.freeze({ context, rows: Object.freeze(rows) });
}
export async function readPhotoLibraryStackSummaryPageV1(repository: PhotoLibraryStackRepositoryV1, catalogId: string, continuation: PhotoStackContinuationV1 | null, signal: AbortSignal): Promise<PhotoLibraryStackSummaryPageV1> {
	const context = await capture(repository, catalogId, signal);
	const page = record(await repository.readStackPage(catalogId, { continuation, signal }), 'stack summary page', ['items', 'continuation']);
	const rows = array(field(page, 'items'), 'stack summaries', 0, 64).map(value => {
		const row = record(value, 'stack summary', ['catalogId', 'id', 'revision', 'photoCount', 'coverPhotoId']);
		if (field(row, 'catalogId') !== catalogId) throw new TypeError('Stack summary belongs to another catalog.');
		return Object.freeze({ id: id(field(row, 'id'), 'stack ID'), revision: revision(field(row, 'revision')),
			photoCount: integer(field(row, 'photoCount'), 2, 1024, 'stack photo count'), coverPhotoId: id(field(row, 'coverPhotoId'), 'stack cover ID') });
	});
	unique(rows.map(row => row.id), 'stack summaries');
	const next = readPhotoStackPageOptionsV1({ continuation: field(page, 'continuation') }, catalogId, 'stacks').continuation;
	if (next && (next.catalogRevision !== context.catalogRevision || next.indexRevision !== context.indexRevision || next.stateRevision !== context.stateRevision)) throw new PhotoStackRevisionConflictError();
	await assertStable(repository, catalogId, context, signal);
	return Object.freeze({ context, rows: Object.freeze(rows), cursor: next ? JSON.stringify(next) : null });
}
export async function applyPhotoLibraryStackV1(repository: PhotoLibraryStackRepositoryV1, catalogId: string, command: PhotoLibraryStackCommandV1,
	createId: () => string, signal: AbortSignal): Promise<PhotoLibraryStackAcknowledgementV1> {
	checkAbort(signal);
	if (command.catalogId !== catalogId) throw new TypeError('Stack command belongs to another catalog.');
	const options = { expectedCatalogRevision: command.expectedCatalogRevision, expectedStateRevision: command.expectedStateRevision, signal };
	let stack: PhotoLibraryStackV1 | null = null;
	if (command.type === 'dissolve') {
		const state = normalizePhotoStackStateV1(await repository.dissolveStack(catalogId, command.id, command.expectedStackRevision, options));
		if (state.catalogId !== catalogId || state.revision !== command.expectedStateRevision + 1) throw new TypeError('Stack dissolve acknowledgment disagrees with its command.');
	} else {
		const stackId = command.type === 'create' ? id(createId(), 'new stack ID') : command.id;
		const expected = command.type === 'create' ? null : command.expectedStackRevision;
		const saved = normalizePhotoStackV1(await repository.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId, id: stackId,
			revision: expected ?? 0, photoIds: command.photoIds, coverPhotoId: command.coverPhotoId }, expected, options));
		if (saved.catalogId !== catalogId || saved.id !== stackId || saved.revision !== (expected === null ? 0 : expected + 1)
			|| saved.coverPhotoId !== command.coverPhotoId || saved.photoIds.length !== command.photoIds.length
			|| saved.photoIds.some((photoId, index) => photoId !== command.photoIds[index])) throw new TypeError('Stack save acknowledgment disagrees with its command.');
		stack = presentStack(saved);
	}
	// The committed repository result remains a fact after cancellation/lease cleanup.
	return Object.freeze({ schemaVersion: 1, catalogId, catalogRevision: command.expectedCatalogRevision + 1,
		stateRevision: command.expectedStateRevision + 1, action: command.type === 'create' ? 'created' : command.type === 'update' ? 'updated' : 'dissolved',
		stack, notices: Object.freeze([]) });
}

async function capture(repository: PhotoLibraryStackRepositoryV1, catalogId: string, signal: AbortSignal): Promise<PhotoLibraryStackContextV1> {
	checkAbort(signal);
	const raw = await repository.readSnapshot(catalogId, { signal });
	if (raw === null) throw new ReferenceError('Photo catalog is missing.');
	const input = record(raw, 'stack catalog snapshot', ['catalog', 'indexRevision']);
	const root = validateLightscaperDocumentV1(field(input, 'catalog'));
	if (root.kind !== 'photo-catalog' || root.id !== catalogId) throw new TypeError('Stack catalog snapshot disagrees with requested catalog.');
	const state = normalizePhotoStackStateV1(await repository.readStackState(catalogId, { signal }));
	if (state.catalogId !== catalogId || state.stackCount > Math.floor(root.photoCount / 2)) throw new TypeError('Stack state disagrees with catalog.');
	checkAbort(signal);
	return Object.freeze({ schemaVersion: 1, catalogId, catalogRevision: root.revision, indexRevision: revision(field(input, 'indexRevision')),
		stateRevision: state.revision, stackCount: state.stackCount });
}
async function assertStable(repository: PhotoLibraryStackRepositoryV1, catalogId: string, before: PhotoLibraryStackContextV1, signal: AbortSignal): Promise<void> {
	const after = await capture(repository, catalogId, signal);
	if (before.catalogRevision !== after.catalogRevision || before.indexRevision !== after.indexRevision
		|| before.stateRevision !== after.stateRevision || before.stackCount !== after.stackCount) throw new PhotoStackRevisionConflictError();
}
function presentStack(stack: ReturnType<typeof normalizePhotoStackV1>): PhotoLibraryStackV1 {
	return Object.freeze({ id: stack.id, revision: stack.revision, photoIds: stack.photoIds, coverPhotoId: stack.coverPhotoId });
}
function requireVersion(input: Readonly<Record<string, unknown>>): void { if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported stack presentation version.'); }
function revision(value: unknown): number { return integer(value, 0, Number.MAX_SAFE_INTEGER, 'stack revision'); }
function nextable(value: unknown): number { return integer(value, 0, Number.MAX_SAFE_INTEGER - 1, 'stack writable revision'); }
function checkAbort(signal: AbortSignal): void { Reflect.apply(throwIfAborted, signal, []); }
