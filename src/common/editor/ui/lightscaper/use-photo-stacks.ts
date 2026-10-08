/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibraryStackAcknowledgementV1, PhotoLibraryStackBindingV1, PhotoLibraryStackCommandV1,
	PhotoLibraryStackMembersV1, PhotoLibraryStackPortV1, PhotoLibraryStackSnapshotV1 } from '../../photo-library-stack-port-v1.ts';
import type { PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';

export interface PhotoStackExecutionContextV1 {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<PhotoLibraryStackPortV1>;
	readonly refresh: () => Promise<unknown>;
	readonly isCurrent: () => boolean;
}
export type ExecutePhotoStackV1 = (action: (context: PhotoStackExecutionContextV1) => Promise<void>, signal?: AbortSignal) => Promise<unknown>;
interface Options {
	readonly generation: unknown;
	readonly queryIdentity: unknown;
	readonly pageIdentity: unknown;
	readonly rows: readonly PhotoLibraryRowV1[];
	readonly execute: ExecutePhotoStackV1;
}
interface View {
	readonly generation: unknown;
	readonly queryIdentity: unknown;
	readonly pageIdentity: unknown;
	readonly visible: boolean;
	readonly mode: 'create' | 'edit';
	readonly selectedIds: readonly string[];
	readonly snapshot: PhotoLibraryStackSnapshotV1 | null;
	readonly members: readonly Readonly<{ photoId: string; fileName: string }>[];
	readonly receipt: PhotoLibraryStackAcknowledgementV1 | null;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}

/** One menu demand borrows the existing workflow's native settlement and writer. */
export function usePhotoStacks(options: Options) {
	const latest = useRef(options); latest.current = options;
	const live = useRef(true), active = useRef<'read' | 'write' | null>(null);
	const [pending, setPending] = useState(false), [view, setView] = useState<View>(() => empty(options));
	const owner = useRef(view); owner.current = view;
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const matches = useCallback((allowOwnPage = false) => live.current && Object.is(latest.current.generation, options.generation)
		&& latest.current.queryIdentity === options.queryIdentity && (allowOwnPage || latest.current.pageIdentity === options.pageIdentity),
	[options.generation, options.queryIdentity, options.pageIdentity]);
	const publish = (next: View) => { if (live.current) { owner.current = next; setView(next); } };
	const run = useCallback(async (action: (context: PhotoStackExecutionContextV1) => Promise<void>, signal?: AbortSignal) => {
		const result: { failure?: Readonly<{ value: unknown }> } = {};
		await options.execute(async context => {
			try { await action(context); } catch (failure) {
				if (!context.signal.aborted || failure !== context.signal.reason) result.failure = { value: failure };
				throw failure;
			}
		}, signal);
		if (result.failure) throw result.failure.value;
	}, [options.execute]);
	const open = useCallback(async (mode: 'create' | 'edit', values: readonly string[], reloading = false): Promise<void> => {
		if (!matches() || active.current) return;
		if (values.length < (mode === 'create' ? 2 : 1) || values.length > (mode === 'create' ? 64 : 1)
			|| new Set(values).size !== values.length || (!reloading && values.some(id => !options.rows.some(row => row.id === id)))) return;
		const ids = Object.freeze([...values]), admitted = { ...empty(options), visible: true, mode, selectedIds: ids };
		active.current = 'read'; setPending(true); publish(admitted);
		try {
			await run(async context => {
				const current = () => matches() && context.isCurrent();
				const port = await context.acquire(); context.signal.throwIfAborted(); if (!current()) return;
				if (mode === 'create') {
					const result = await port.readStackMemberships(ids, { signal: context.signal }); context.signal.throwIfAborted();
					if (result.memberships.length !== ids.length || result.memberships.some((row, index) => row.photoId !== ids[index])) throw new Error('Stack membership response does not match the selected photos.');
					if (result.memberships.some(row => row.stackId !== null)) throw new Error('A selected photo already belongs to a stack.');
					if (current()) publish({ ...owner.current, snapshot: { context: result.context, stack: null },
						members: ids.map(id => ({ photoId: id, fileName: options.rows.find(row => row.id === id)!.fileName })) });
				} else {
					const snapshot = await port.readStackSnapshot(ids[0]!, { signal: context.signal }); context.signal.throwIfAborted();
					if (!snapshot.stack) throw new Error('The selected photo does not belong to a stack.');
					const members = await port.readStackMembers(binding(snapshot), snapshot.stack.photoIds.slice(0, 64), { signal: context.signal });
					context.signal.throwIfAborted(); if (current()) publish({ ...owner.current, snapshot, members: members.rows });
				}
			});
		} catch (failure) { if (matches()) publish({ ...owner.current, error: message(failure) }); }
		finally { active.current = null; if (live.current) setPending(false); }
	}, [matches, options, run]);
	const openCreate = useCallback((ids: readonly string[]) => open('create', ids), [open]);
	const openEdit = useCallback((id: string) => open('edit', [id]), [open]);
	const readMembers = useCallback(async (request: PhotoLibraryStackBindingV1, ids: readonly string[], signal: AbortSignal): Promise<PhotoLibraryStackMembersV1> => {
		if (!matches() || active.current || !owner.current.visible || owner.current.receipt !== null || !owner.current.snapshot?.stack
			|| !sameBinding(request, binding(owner.current.snapshot)) || ids.length < 1 || ids.length > 64
			|| new Set(ids).size !== ids.length || ids.some(id => !owner.current.snapshot!.stack!.photoIds.includes(id))) throw new DOMException('Stack member page is unavailable.', 'AbortError');
		active.current = 'read'; setPending(true); const loaded: { result?: PhotoLibraryStackMembersV1 } = {};
		try {
			await run(async context => {
				const port = await context.acquire(); context.signal.throwIfAborted();
				loaded.result = await port.readStackMembers(request, ids, { signal: context.signal }); context.signal.throwIfAborted();
			}, signal);
			const result = loaded.result;
			if (!result || !matches() || signal.aborted) throw signal.reason ?? new DOMException('Stack member page was cancelled.', 'AbortError');
			publish({ ...owner.current, members: result.rows });
			return result;
		} finally { active.current = null; if (live.current) setPending(false); }
	}, [matches, options, run]);
	const apply = useCallback(async (command: PhotoLibraryStackCommandV1): Promise<PhotoLibraryStackAcknowledgementV1 | null> => {
		if (!matches() || active.current || !owner.current.visible || !owner.current.snapshot || owner.current.receipt
			|| !commandMatches(command, owner.current)) return null;
		active.current = 'write'; setPending(true); let receipt: PhotoLibraryStackAcknowledgementV1 | null = null;
		try {
			await run(async context => {
				const current = () => matches(true) && context.isCurrent();
				const port = await context.acquire(); context.signal.throwIfAborted(); if (!current()) return;
				receipt = await port.applyStack(command, { signal: context.signal });
				if (!current()) return;
				publish({ ...owner.current, receipt, error: null, notice: null });
				try {
					context.signal.throwIfAborted(); const page = await context.refresh();
					if (current() && page !== undefined) publish({ ...owner.current, pageIdentity: page });
					context.signal.throwIfAborted();
				} catch (failure) {
					if (current()) publish({ ...owner.current, pageIdentity: latest.current.pageIdentity, receipt, notice: 'refresh-failed', error: message(failure) });
				}
			});
		} catch (failure) { if (matches(true)) publish({ ...owner.current, error: message(failure) }); }
		finally { active.current = null; if (live.current) setPending(false); }
		return receipt;
	}, [matches, options, run]);
	const current = Object.is(view.generation, options.generation) && view.queryIdentity === options.queryIdentity
		// A paused historical ACK is scalar truth, not authority to edit the old snapshot.
		&& (view.pageIdentity === options.pageIdentity || active.current === 'write' || (view.receipt !== null && view.notice === 'refresh-failed'));
	return { visible: current && view.visible, mode: view.mode, snapshot: current ? view.snapshot : null,
		selectedIds: current ? view.selectedIds : [], members: current ? view.members : [],
		receipt: current ? view.receipt : null, notice: current ? view.notice : null, error: current ? view.error : null, busy: pending,
		openCreate, openEdit, apply, readMembers,
		reload: () => { const previous = owner.current; if (!matches() || active.current) return;
			void open(previous.receipt?.stack ? 'edit' : previous.mode, [ ...(previous.receipt?.stack ? [previous.receipt.stack.coverPhotoId] : previous.selectedIds) ], true); },
		close: () => { if (matches(true)) publish({ ...owner.current, visible: false }); },
	};
}
function empty(options: Options): View {
	return { generation: options.generation, queryIdentity: options.queryIdentity, pageIdentity: options.pageIdentity,
		visible: false, mode: 'create', selectedIds: [], snapshot: null, members: [], receipt: null, notice: null, error: null };
}
function binding(snapshot: PhotoLibraryStackSnapshotV1): PhotoLibraryStackBindingV1 {
	if (!snapshot.stack) throw new Error('A stack snapshot is required.');
	return { schemaVersion: 1, catalogId: snapshot.context.catalogId, catalogRevision: snapshot.context.catalogRevision,
		indexRevision: snapshot.context.indexRevision, stateRevision: snapshot.context.stateRevision, stackId: snapshot.stack.id, stackRevision: snapshot.stack.revision };
}
function message(value: unknown): string {
	try { const field = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
		if (field && Object.hasOwn(field, 'value') && typeof field.value === 'string') return field.value.slice(0, 2048);
	} catch { /* Errors cannot abandon owned native work or known acknowledgments. */ }
	return 'The stack action failed.';
}

function sameBinding(left: PhotoLibraryStackBindingV1, right: PhotoLibraryStackBindingV1): boolean {
	return left.schemaVersion === right.schemaVersion && left.catalogId === right.catalogId && left.catalogRevision === right.catalogRevision
		&& left.indexRevision === right.indexRevision && left.stateRevision === right.stateRevision
		&& left.stackId === right.stackId && left.stackRevision === right.stackRevision;
}
function commandMatches(command: PhotoLibraryStackCommandV1, view: View): boolean {
	const snapshot = view.snapshot;
	if (!snapshot || command.schemaVersion !== 1 || command.catalogId !== snapshot.context.catalogId
		|| command.expectedCatalogRevision !== snapshot.context.catalogRevision || command.expectedStateRevision !== snapshot.context.stateRevision) return false;
	if (command.type === 'create') {
		if (snapshot.stack || view.mode !== 'create') return false;
	} else if (!snapshot.stack || command.id !== snapshot.stack.id || command.expectedStackRevision !== snapshot.stack.revision) return false;
	if (command.type === 'dissolve') return true;
	const ids = snapshot.stack?.photoIds ?? view.selectedIds;
	return command.photoIds.length === ids.length && command.photoIds.length <= (command.type === 'create' ? 64 : 1024)
		&& new Set(command.photoIds).size === ids.length && command.photoIds.every(id => ids.includes(id)) && command.photoIds.includes(command.coverPhotoId);
}
