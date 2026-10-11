/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { usePhotoDevelopV2 } from './use-photo-develop-v2.ts';
import PhotoDevelopEffectsV2 from './PhotoDevelopEffectsV2.tsx';
import PhotoDevelopPreviewV2, { type PhotoDevelopPreviewPropsV2 } from './PhotoDevelopPreviewV2.tsx';
import PhotoDevelopSettingsMenuV2 from './PhotoDevelopSettingsMenuV2.tsx';
import PhotoDevelopGradientDialogV1, { type PhotoDevelopGradientDialogPropsV1, type PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';
import PhotoDevelopRangeMaskDialogV1, { type PhotoDevelopRangeMaskDialogPropsV1 } from './PhotoDevelopRangeMaskDialogV1.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';
import type { usePhotoDevelopSettingsV2 } from './use-photo-develop-settings-v2.ts';
import { photoDevelopSettingsCopy } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../../photo-library-cube-lut-port-v1.ts';
import './photo-develop.css';

export interface PhotoDevelopWorkspacePropsV2 extends Omit<PhotoDevelopPreviewPropsV2, 'develop' | 'messages' | 'maskOverlay' | 'isCurrent'> {
	readonly generation: unknown;
	readonly label: string;
	readonly execute: ExecutePhotoDevelopV2;
	readonly onClose: () => void;
	readonly beforeOpen?: Promise<void>;
	readonly registerDemandRetirement?: (retire: () => Promise<void>) => () => void;
	readonly catalogId?: string;
	readonly selectedIds?: readonly string[];
	readonly settings?: ReturnType<typeof usePhotoDevelopSettingsV2>;
	readonly importCubeLut?: PhotoLibraryCubeLutPortV1['importFile'];
}
export default function PhotoDevelopWorkspaceV2(props: PhotoDevelopWorkspacePropsV2) {
	const { beforeOpen, photoId, readPreview, loadProxy, withOriginalFrame, importCubeLut: importMethod, registerRetirement, registerDemandRetirement } = props;
	const selectedGeneration = props.generation, settingsOwner = props.settings?.owner, settingsDrain = props.settings?.drain;
	const [lifecycle, setLifecycle] = useState(0);
	const generation = useMemo(() => ({ selectedGeneration, lifecycle, readPreview, loadProxy, withOriginalFrame, importMethod, registerRetirement, registerDemandRetirement, settingsOwner }),
		[selectedGeneration, lifecycle, readPreview, loadProxy, withOriginalFrame, importMethod, registerRetirement, registerDemandRetirement, settingsOwner]);
	const execution = useRef({ method: props.execute, invoke: pin(props.execute, props) });
	if (execution.current.method !== props.execute) execution.current = { method: props.execute, invoke: pin(props.execute, props) };
	const execute = execution.current.invoke;
	const { owner, drain, snapshot } = usePhotoDevelopV2({ generation, execute }), messages = photoDevelopCopy(props.locale);
	const [snapshotName, setSnapshotName] = useState(''), [copyName, setCopyName] = useState('');
	const predecessor = useRef<Promise<void>>(Promise.resolve());
	const [entryFailure, setEntryFailure] = useState(() => ({ owner, failed: false }));
	const [resolution, setResolution] = useState(() => ({ owner, photoId: props.photoId, value: 'proxy' as PhotoDevelopResolutionV1 }));
	const selectedResolution = resolution.owner === owner && resolution.photoId === props.photoId ? resolution : { owner, photoId: props.photoId, value: 'proxy' as const };
	const renderedResolution = useRef(selectedResolution); renderedResolution.current = selectedResolution;
	const live = useRef(true);
	const owned = useRef(owner); owned.current = owner;
	const rendered = useRef(snapshot); rendered.current = snapshot;
	const capabilityRef = useRef({ owner, readPreview, loadProxy, withOriginalFrame, importMethod, registerRetirement, registerDemandRetirement, receiver: props });
	const previous = capabilityRef.current;
	if (previous.owner !== owner || previous.readPreview !== readPreview || previous.loadProxy !== loadProxy || previous.withOriginalFrame !== withOriginalFrame
		|| previous.importMethod !== importMethod || previous.registerRetirement !== registerRetirement || previous.registerDemandRetirement !== registerDemandRetirement) {
		capabilityRef.current = { owner, readPreview, loadProxy, withOriginalFrame, importMethod, registerRetirement, registerDemandRetirement, receiver: props };
	}
	const capability = capabilityRef.current;
	const presentation = useMemo(() => ({ owner, capability, photoId }), [owner, capability, photoId]);
	const presented = useRef(presentation); presented.current = presentation;
	const tasks = useMemo(() => ({ owner, imports: new Set<() => Promise<void>>(), previews: new Set<() => Promise<void>>(),
		joined: Promise.resolve(), closing: null as Promise<void> | null, importing: false }), [owner]);
	const [importState, setImportState] = useState(() => ({ tasks, pending: false }));
	const registerImportRetirement = useCallback((retire: () => Promise<void>) => {
		tasks.imports.add(retire); return () => { tasks.joined = joinPhotoLibraryRetirementV1([tasks.joined, ...collect([retire])]);
			tasks.imports.delete(retire); void tasks.joined.catch(() => undefined); };
	}, [tasks]);
	const registerPreviewRetirement = useCallback((retire: () => Promise<void>) => {
		tasks.previews.add(retire); const unregister = Reflect.apply(capability.registerRetirement, capability.receiver, [retire]) as () => void;
		return () => { tasks.joined = joinPhotoLibraryRetirementV1([tasks.joined, ...collect([retire])]); tasks.previews.delete(retire);
			void tasks.joined.catch(() => undefined); unregister(); };
	}, [tasks, capability]);
	const onImportPending = useCallback((pending: boolean) => { if (owned.current === owner && live.current) setImportState({ tasks, pending }); }, [owner, tasks]);
	const previewSource = useMemo(() => ({ readPreview: pin(capability.readPreview, capability.receiver), loadProxy: pin(capability.loadProxy, capability.receiver),
		withOriginalFrame: capability.withOriginalFrame === undefined ? undefined : pin(capability.withOriginalFrame, capability.receiver) }), [capability]);
	const importCubeLut = useMemo(() => capability.importMethod ? ((file: Blob, options?: { signal?: AbortSignal }) => {
		if (!live.current || owned.current !== owner || tasks.importing || tasks.closing) return Promise.reject(new Error('A photo LUT import is unavailable or already pending.'));
		tasks.importing = true;
		return Promise.resolve().then(() => {
			if (options?.signal) Reflect.apply(AbortSignal.prototype.throwIfAborted, options.signal, []);
			if (!live.current || owned.current !== owner || tasks.closing) throw new Error('The photo LUT import presentation is retired.');
			return Reflect.apply(capability.importMethod!, capability.receiver, [file, options]) as ReturnType<PhotoLibraryCubeLutPortV1['importFile']>;
		})
			.finally(() => { tasks.importing = false; });
	}) : undefined, [owner, tasks, capability]);
	const retire = useCallback(() => {
		if (tasks.closing) return tasks.closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); tasks.closing = closing; void closing.catch(() => undefined);
		live.current = false;
		void joinPhotoLibraryRetirementV1([tasks.joined, ...collect(tasks.imports), ...collect(tasks.previews), owner.close(), settingsOwner?.dismiss() ?? null]).then(resolve, reject);
		return closing;
	}, [tasks, owner, settingsOwner]);
	useEffect(() => {
		if (!capability.registerDemandRetirement) return; return Reflect.apply(capability.registerDemandRetirement, capability.receiver, [retire]) as () => void;
	}, [capability, retire]);
	useEffect(() => {
		let current = true; live.current = true; setEntryFailure({ owner, failed: false });
		const closing = tasks.closing;
		void joinPhotoLibraryRetirementV1([predecessor.current, closing, drain(), settingsDrain?.() ?? null, beforeOpen ?? null]).then(() => {
			if (!current) return;
			// Registration cleanup permanently retires this owner. An active
			// effect replay receives a fresh owner only after its whole join.
			if (closing) { setLifecycle(value => value + 1); return; }
			return owner.open(photoId);
		}).catch(() => { if (current) setEntryFailure({ owner, failed: true }); });
		return () => {
			current = false; live.current = false;
			let resolve!: () => void, reject!: (error: unknown) => void;
			const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
			predecessor.current = joinPhotoLibraryRetirementV1([predecessor.current, pending]); void predecessor.current.catch(() => undefined);
			void joinPhotoLibraryRetirementV1([tasks.closing, tasks.joined, ...collect(tasks.imports), ...collect(tasks.previews)]).then(resolve, reject);
		};
	}, [owner, drain, settingsDrain, photoId, beforeOpen, tasks, retire]);
	const mounted = () => live.current && owned.current === owner && presented.current === presentation;
	const close = () => { if (!mounted()) return; void retire().catch(() => undefined); Reflect.apply(props.onClose, props, []); };
	const current = () => mounted() && rendered.current === snapshot;
	const importing = tasks.importing || (importState.tasks === tasks && importState.pending);
	const run = (action: () => Promise<unknown>) => { if (current() && !snapshot.busy && !props.settings?.snapshot.busy && !importing) void action(); };
	const document = snapshot.document, draft = snapshot.draft, busy = snapshot.busy || props.settings?.snapshot.busy === true || importing, disabled = busy || !document;
	type LocalKind = NonNullable<PhotoDevelopGradientDialogPropsV1['kind'] | PhotoDevelopRangeMaskDialogPropsV1['kind']>;
	type LocalEntry = Readonly<{ kind: LocalKind; owner: typeof owner; document: NonNullable<typeof document>; draft: NonNullable<typeof draft> }>;
	const [localEntry, setLocalEntry] = useState<LocalEntry | null>(null);
	const activeLocal = useRef(localEntry); activeLocal.current = localEntry;
	const [overlay, setOverlay] = useState<Readonly<{ entry: LocalEntry; recipe: string; selection: Readonly<PhotoDevelopMaskOverlaySelectionV1> }> | null>(null);
	const localCurrent = () => current() && !busy && localEntry !== null && activeLocal.current === localEntry
		&& localEntry.owner === owner && localEntry.document === document && localEntry.draft === draft;
	const openLocal = (kind: LocalKind) => { if (current() && !busy && document && draft) setLocalEntry({ kind, owner, document, draft }); };
	const applyLocal: PhotoDevelopRangeMaskDialogPropsV1['onApply'] = (value, selection) => {
		if (!localCurrent() || !localEntry || !document) return; owner.edit(value);
		const next = owner.snapshot().draft;
		if (next && selection) setOverlay({ entry: { kind: localEntry.kind, owner, document, draft: next }, recipe: JSON.stringify(next), selection }); else setOverlay(null);
		setLocalEntry(null);
	};
	const closeLocal = () => { if (mounted() && activeLocal.current === localEntry) setLocalEntry(null); };
	const recipe = useMemo(() => draft ? JSON.stringify(draft) : null, [draft]);
	const selectedOverlay = overlay?.entry.owner === owner && overlay.entry.document.photoId === document?.photoId
		&& overlay.entry.document.versionId === document?.versionId && overlay.recipe === recipe ? overlay.selection : undefined;
	useEffect(() => { if (overlay && !selectedOverlay) setOverlay(null); }, [overlay, selectedOverlay]);
	const catalogId = document?.catalogId ?? props.catalogId;
	const now = () => new Date().toISOString();
	return <AudioEditorDialogShell title={`${messages.title}: ${props.label}`} onClose={close} className="lightscaper-dialog lightscaper-develop-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-workspace><p>{messages.description}</p>
			{entryFailure.owner === owner && entryFailure.failed && <p role="alert">{messages.previewFailed}</p>}
			{busy && <p role="status">{messages.working}</p>}{snapshot.error && <p role="alert">{snapshot.error}</p>}
			{snapshot.dirty && <p role="status">{messages.dirty}</p>}
			{snapshot.receipt && <div role="status" data-photo-develop-ack><p>{messages.acknowledged}</p>
				{snapshot.receipt.notices.includes('cleanup-failed') && <p>{messages.cleanupFailed}</p>}
				{snapshot.notice === 'refresh-failed' && <p>{messages.refreshFailed}</p>}</div>}
			{document && draft && <>
				{props.settings && catalogId && <PhotoDevelopSettingsMenuV2 locale={props.locale} owner={props.settings.owner} snapshot={props.settings.snapshot}
					source={{ schemaVersion: 2, catalogId, photoId: document.photoId, versionId: document.versionId, revision: document.revision, develop: draft }}
					selectedIds={props.selectedIds ?? [document.photoId]} disabled={busy} dirty={snapshot.dirty}
					isCurrent={() => mounted() && owner.snapshot().document === document} onChanged={() => owner.reload()}
					resolution={{ value: selectedResolution.value, fullAvailable: props.withOriginalFrame !== undefined,
						onChange: value => { if (current() && renderedResolution.current === selectedResolution) setResolution({ owner, photoId: props.photoId, value }); } }}
					localAdjustments={{ onOpen: openLocal }} />}
				{!props.settings && <details className="lightscaper-develop-settings-menu"><summary>{photoDevelopSettingsCopy(props.locale).menu}</summary>
					{(['linear-gradient', 'radial-gradient', 'luminance-range', 'color-range'] as const).map(kind => <button key={kind} type="button" disabled={busy}
						onClick={() => { openLocal(kind); }}>{photoDevelopLocalAdjustmentsCopy(props.locale, kind).menu}</button>)}</details>}
				<label>{messages.version}<select value={document.versionId} disabled={busy || snapshot.dirty} onChange={event => {
					const id = event.currentTarget.value; run(() => owner.open(props.photoId, id));
				}}>{document.versions.map(version => <option key={version.id} value={version.id}>{version.name}</option>)}</select></label>
				<button type="button" disabled={busy || snapshot.dirty || document.activeVersionId === document.versionId}
					onClick={() => { run(() => owner.apply({ type: 'activate-version', versionId: document.versionId })); }}>{messages.useVersion}</button>
				<div className="lightscaper-develop-layout"><PhotoDevelopPreviewV2 {...props} {...previewSource} registerRetirement={registerPreviewRetirement} develop={draft} messages={messages} revision={document.revision} resolution={selectedResolution.value}
					maskOverlay={selectedOverlay} isCurrent={() => mounted() && owner.snapshot().document === document && owner.snapshot().draft === draft} />
					<PhotoDevelopEffectsV2 effects={draft.effects} owner={owner} messages={messages} disabled={busy}
						isCurrent={() => mounted() && owner.snapshot().document === document} importCubeLut={importCubeLut}
						onImportPending={onImportPending} registerImportRetirement={registerImportRetirement} /></div>
				<div className="lightscaper-develop-history"><section aria-label={messages.history}><h3>{messages.history}</h3>
					<label>{messages.history}<select value={document.history.cursor} disabled={busy || snapshot.dirty} onChange={event => {
						const cursor = Number(event.currentTarget.value); run(() => owner.apply({ type: 'select-develop-history', versionId: document.versionId, cursor }));
					}}>{document.history.entries.map(entry => <option key={entry.index} value={entry.index}>{entry.label}</option>)}</select></label>
				</section><section aria-label={messages.snapshots}><h3>{messages.snapshots}</h3>
					<label>{messages.snapshotName}<input value={snapshotName} maxLength={256} disabled={busy} onChange={event => { if (mounted()) setSnapshotName(event.currentTarget.value); }} /></label>
					<button type="button" disabled={busy || snapshot.dirty || !snapshotName.trim()} onClick={() => { run(() => owner.apply({ type: 'save-develop-snapshot', versionId: document.versionId,
						id: crypto.randomUUID(), name: snapshotName.trim(), createdAt: now() })); }}>{messages.saveSnapshot}</button>
					<ul>{document.snapshots.map(saved => <li key={saved.id}>{saved.name}
						<button type="button" disabled={busy || snapshot.dirty} aria-label={`${messages.restoreSnapshot}: ${saved.name}`} onClick={() => {
							run(() => owner.apply({ type: 'restore-develop-snapshot', versionId: document.versionId, snapshotId: saved.id, label: messages.restoreLabel, createdAt: now() }));
						}}>{messages.restoreSnapshot}</button>
						<button type="button" disabled={busy || snapshot.dirty} aria-label={`${messages.deleteSnapshot}: ${saved.name}`} onClick={() => {
							run(() => owner.apply({ type: 'delete-develop-snapshot', versionId: document.versionId, snapshotId: saved.id }));
						}}>{messages.deleteSnapshot}</button></li>)}</ul>
				</section><section><label>{messages.copyName}<input value={copyName} maxLength={256} disabled={busy} onChange={event => { if (mounted()) setCopyName(event.currentTarget.value); }} /></label>
					<button type="button" disabled={busy || snapshot.dirty || !copyName.trim()} onClick={() => { run(() => owner.apply({ type: 'create-virtual-copy', sourceVersionId: document.versionId,
						id: crypto.randomUUID(), name: copyName.trim(), createdAt: now() })); }}>{messages.createCopy}</button>
					<button type="button" disabled={busy || snapshot.dirty || !copyName.trim() || document.versions.find(version => version.id === document.versionId)?.kind !== 'virtual-copy'}
						onClick={() => { run(() => owner.apply({ type: 'rename-virtual-copy', versionId: document.versionId, name: copyName.trim() })); }}>{messages.renameCopy}</button>
					<button type="button" disabled={busy || snapshot.dirty || document.versions.find(version => version.id === document.versionId)?.kind !== 'virtual-copy'}
						onClick={() => { run(() => owner.apply({ type: 'delete-virtual-copy', versionId: document.versionId })); }}>{messages.deleteCopy}</button>
				</section></div>
			</>}
			{localEntry && document && draft && localEntry.owner === owner && localEntry.document === document && localEntry.draft === draft
				&& (localEntry.kind === 'luminance-range' || localEntry.kind === 'color-range'
					? <PhotoDevelopRangeMaskDialogV1 key={localEntry.kind} kind={localEntry.kind} develop={draft} locale={props.locale} disabled={busy} isCurrent={localCurrent}
						onApply={applyLocal} onClose={closeLocal} />
					: <PhotoDevelopGradientDialogV1 key={localEntry.kind} kind={localEntry.kind} develop={draft} locale={props.locale} disabled={busy} isCurrent={localCurrent}
						onApply={applyLocal} onClose={closeLocal} />)}
			<div className="lightscaper-develop-actions"><button type="button" disabled={disabled || !snapshot.dirty} onClick={() => { run(async () => {
				const receipt = await owner.save(messages.editLabel);
				if (receipt && mounted() && catalogId) await settingsOwner?.syncAcknowledged({ schemaVersion: 2, catalogId,
					photoId: receipt.snapshot.photoId, versionId: receipt.snapshot.versionId, revision: receipt.snapshot.revision, develop: receipt.snapshot.develop }, photoDevelopSettingsCopy(props.locale).autoLabel);
			}); }}>{messages.save}</button>
				<button type="button" disabled={disabled || !snapshot.dirty} onClick={() => { if (current()) owner.discard(); }}>{messages.discard}</button>
				<button type="button" disabled={busy || snapshot.dirty} onClick={() => { run(() => owner.open(props.photoId, document?.versionId)); }}>{messages.reload}</button>
				<button type="button" disabled={!busy} onClick={() => { if (current()) void joinPhotoLibraryRetirementV1([owner.cancel(), settingsOwner?.cancel() ?? null, ...collect(tasks.imports)]).catch(() => undefined); }}>{messages.cancel}</button>
				<button type="button" onClick={close}>{messages.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}

function pin<Method extends (...args: never[]) => unknown>(method: Method, receiver: PhotoDevelopWorkspacePropsV2): Method {
	return ((...args: unknown[]): unknown => Reflect.apply(method, receiver, args) as unknown) as unknown as Method;
}

function collect(callbacks: Iterable<() => Promise<void>>): Promise<void>[] {
	return [...callbacks].map(callback => { try { return callback(); } catch (error) { return Promise.reject(error); } });
}
