/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibraryImportPresetSnapshotV1, PhotoLibraryImportSettingsV1, PhotoLibraryImportSettingsPortV1 } from '../../photo-library-import-settings-port-v1.ts';

export interface PhotoImportPresetCopyV1 {
	readonly photoImportPreset: string;
	readonly photoImportPresetNew: string;
	readonly photoImportPresetName: string;
	readonly photoImportPresetLoad: string;
	readonly photoImportPresetSave: string;
	readonly photoImportPresetDelete: string;
	readonly photoImportPresetReload: string;
	readonly photoImportPresetFailed: string;
	readonly photoWorking: string;
}

export interface PhotoImportPresetControlsPropsV1 {
	readonly value: PhotoLibraryImportSettingsV1;
	readonly onChange: (next: PhotoLibraryImportSettingsV1) => void;
	readonly busy: boolean;
	readonly copy: PhotoImportPresetCopyV1;
	readonly readPresets: PhotoLibraryImportSettingsPortV1['readImportPresets'];
	readonly applyPreset: PhotoLibraryImportSettingsPortV1['applyImportPreset'];
	readonly createId: () => string;
	readonly draft?: PhotoImportPresetDraftV1;
	readonly onDraftChange?: (next: PhotoImportPresetDraftV1) => void;
}

export interface PhotoImportPresetDraftV1 {
	readonly id: string;
	readonly name: string;
	readonly allocatedId: string | null;
}
const PLAIN_PRESET_DRAFT: PhotoImportPresetDraftV1 = Object.freeze({ id: '', name: '', allocatedId: null });
interface Scope { live: boolean; readonly read: PhotoImportPresetControlsPropsV1['readPresets']; readonly apply: PhotoImportPresetControlsPropsV1['applyPreset'] }
interface Demand { readonly scope: Scope; readonly controller: AbortController }

/** Observes controller-owned scalar operations; an acknowledgement never loads or clears the working recipe. */
export default function PhotoImportPresetControls({ value, onChange, busy, copy, readPresets, applyPreset, createId, draft, onDraftChange }: PhotoImportPresetControlsPropsV1) {
	const [snapshot, setSnapshot] = useState<PhotoLibraryImportPresetSnapshotV1 | null>(null);
	const [selectedId, setSelectedId] = useState(''), [name, setName] = useState('');
	const [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null);
	const scope = useRef<Scope | null>(null), active = useRef<Demand | null>(null), allocated = useRef<string | null>(null);
	const inventory = useRef<PhotoLibraryImportPresetSnapshotV1 | null>(null), selection = useRef({ id: '', name: '' });
	const copyRef = useRef(copy); copyRef.current = copy;
	const initialDraft = useRef(draft ?? PLAIN_PRESET_DRAFT), initialized = useRef(false);
	const draftObserver = useRef(onDraftChange); draftObserver.current = onDraftChange;
	const remember = () => { draftObserver.current?.(Object.freeze({ ...selection.current, allocatedId: allocated.current })); };
	const observe = useCallback((run: (signal: AbortSignal) => Promise<PhotoLibraryImportPresetSnapshotV1>,
		current: Scope, acknowledge?: (next: PhotoLibraryImportPresetSnapshotV1) => void) => {
		if (!current.live || active.current) return;
		const job: Demand = { scope: current, controller: new AbortController() };
		active.current = job; setPending(true); setFailure(null);
		const live = () => current.live && scope.current === current && active.current === job;
		void Promise.resolve().then(() => {
			job.controller.signal.throwIfAborted(); return run(job.controller.signal);
		}).then(result => {
			if (!live()) return;
			const next = detachSnapshot(result); inventory.current = next; setSnapshot(next); acknowledge?.(next);
		}).catch(error => {
			if (live() && !job.controller.signal.aborted) setFailure(message(error, copyRef.current.photoImportPresetFailed));
		}).finally(() => {
			if (active.current === job) { active.current = null; if (current.live) setPending(false); }
		});
	}, []);
	useEffect(() => {
		const current = { live: true, read: readPresets, apply: applyPreset }; scope.current = current;
		const seed = initialized.current ? PLAIN_PRESET_DRAFT : initialDraft.current; initialized.current = true;
		inventory.current = null; selection.current = { id: seed.id, name: seed.name };
		setSnapshot(null); setSelectedId(seed.id); setName(seed.name); allocated.current = seed.allocatedId;
		draftObserver.current?.(seed);
		observe(signal => readPresets({ signal }), current);
		return () => {
			current.live = false;
			if (active.current?.scope === current) { active.current.controller.abort(); active.current = null; }
		};
	}, [readPresets, applyPreset, observe]);
	const selected = snapshot?.presets.find(preset => preset.id === selectedId);
	const locked = busy || pending;
	const currentScope = () => {
		const current = scope.current;
		return current?.live && current.read === readPresets && current.apply === applyPreset ? current : null;
	};
	const reload = () => { const current = currentScope(); if (!busy && current) observe(signal => readPresets({ signal }), current); };
	const save = () => {
		const current = currentScope(), currentSnapshot = inventory.current, draft = selection.current;
		if (busy || active.current || !currentSnapshot || !draft.name.trim() || !current) return;
		try {
			const id = draft.id || (allocated.current ??= createId());
			remember();
			const command = Object.freeze({ type: 'save' as const, expectedRevision: currentSnapshot.revision, id, name: draft.name, settings: detachSettings(value) });
			observe(signal => applyPreset(command, { signal }), current, () => { selection.current = { ...draft, id }; setSelectedId(id); allocated.current = null; remember(); });
		} catch (error) { setFailure(message(error, copy.photoImportPresetFailed)); }
	};
	const remove = () => {
		const current = currentScope(), currentSnapshot = inventory.current, id = selection.current.id;
		if (busy || active.current || !currentSnapshot || !id || !current) return;
		const command = Object.freeze({ type: 'delete' as const, expectedRevision: currentSnapshot.revision, id });
		observe(signal => applyPreset(command, { signal }), current, () => { selection.current = { id: '', name: '' }; setSelectedId(''); setName(''); allocated.current = null; remember(); });
	};
	return <section data-import-preset-controls aria-busy={pending}>
		{failure && <p role="alert">{failure}</p>}{pending && <p role="status">{copy.photoWorking}</p>}
		<label>{copy.photoImportPreset}<select data-import-preset value={selectedId} disabled={locked || snapshot === null}
			onChange={event => {
				if (busy || active.current || !currentScope()) return;
				const id = event.currentTarget.value, preset = snapshot?.presets.find(candidate => candidate.id === id);
				if (id && !preset) return;
				selection.current = { id, name: preset?.name ?? '' };
				setSelectedId(id); setName(preset?.name ?? ''); allocated.current = null; remember();
			}}>
			<option value="">{copy.photoImportPresetNew}</option>
			{selectedId && !selected && <option value={selectedId}>{name}</option>}
			{snapshot?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
		</select></label>
		<label>{copy.photoImportPresetName}<input data-import-preset-name value={name} maxLength={256} disabled={locked}
			onChange={event => { if (!busy && !active.current && currentScope()) {
				selection.current = { ...selection.current, name: event.currentTarget.value }; setName(event.currentTarget.value); remember();
			} }} /></label>
		<div className="lightscaper-dialog-actions">
			<button type="button" data-import-preset-load disabled={locked || !selected} onClick={() => {
				const currentSelected = inventory.current?.presets.find(preset => preset.id === selection.current.id);
				if (busy || active.current || !currentScope() || !currentSelected) return;
				try { onChange(detachSettings(currentSelected.settings)); } catch (error) { setFailure(message(error, copy.photoImportPresetFailed)); }
			}}>{copy.photoImportPresetLoad}</button>
			<button type="button" data-import-preset-save disabled={locked || snapshot === null || !name.trim()} onClick={save}>{copy.photoImportPresetSave}</button>
			<button type="button" data-import-preset-delete disabled={locked || snapshot === null || !selectedId} onClick={remove}>{copy.photoImportPresetDelete}</button>
			<button type="button" data-import-preset-reload disabled={locked} onClick={reload}>{copy.photoImportPresetReload}</button>
		</div>
	</section>;
}

/** These are already admitted scalar DTOs; detachment keeps UI drafts out of borrowed controller snapshots. */
function detachSettings(value: PhotoLibraryImportSettingsV1): PhotoLibraryImportSettingsV1 {
	if (value.keywordIds.length > 1_024 || Object.values(value.metadata).some(text => text.length > 16_384)) throw new RangeError('Import preset recipe exceeds its display bound.');
	return Object.freeze({ rename: value.rename === null ? null : Object.freeze({ ...value.rename }),
		metadata: Object.freeze({ ...value.metadata }), keywordIds: Object.freeze([...value.keywordIds]) });
}
function detachSnapshot(value: PhotoLibraryImportPresetSnapshotV1): PhotoLibraryImportPresetSnapshotV1 {
	if (!Number.isSafeInteger(value.revision) || value.revision < 0 || value.presets.length > 16
		|| new Set(value.presets.map(preset => preset.id)).size !== value.presets.length) throw new RangeError('Import presets exceed their inventory bound.');
	return Object.freeze({ revision: value.revision, presets: Object.freeze(value.presets.map(preset => {
		if (!preset.name.trim() || preset.name.length > 256) throw new RangeError('Import preset name exceeds its display bound.');
		return Object.freeze({ id: preset.id, name: preset.name, settings: detachSettings(preset.settings) });
	})) });
}
function message(error: unknown, fallback: string): string {
	const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : fallback;
}
