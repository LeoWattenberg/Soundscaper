/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { usePhotoDevelop } from './use-photo-develop.ts';
import PhotoDevelopEffects from './PhotoDevelopEffects.tsx';
import PhotoDevelopPreview, { type PhotoDevelopPreviewPropsV1 } from './PhotoDevelopPreview.tsx';
import PhotoDevelopSettingsMenu from './PhotoDevelopSettingsMenu.tsx';
import type { usePhotoDevelopSettings } from './use-photo-develop-settings.ts';
import { photoDevelopSettingsCopy } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { ExecutePhotoDevelopV1 } from '../../controller/shared/photo-library-develop-workflow-v1.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import './photo-develop.css';

export interface PhotoDevelopWorkspacePropsV1 extends Omit<PhotoDevelopPreviewPropsV1, 'develop' | 'messages'> {
	readonly generation: unknown;
	readonly label: string;
	readonly execute: ExecutePhotoDevelopV1;
	readonly onClose: () => void;
	readonly beforeOpen?: Promise<void>;
	readonly registerDemandRetirement?: (retire: () => Promise<void>) => () => void;
	readonly catalogId?: string;
	readonly selectedIds?: readonly string[];
	readonly settings?: ReturnType<typeof usePhotoDevelopSettings>;
}
export default function PhotoDevelopWorkspace(props: PhotoDevelopWorkspacePropsV1) {
	const { owner, drain, snapshot } = usePhotoDevelop(props), messages = photoDevelopCopy(props.locale);
	const [snapshotName, setSnapshotName] = useState(''), [copyName, setCopyName] = useState('');
	const [resolution, setResolution] = useState(() => ({ owner, photoId: props.photoId, value: 'proxy' as PhotoDevelopResolutionV1 }));
	const selectedResolution = resolution.owner === owner && resolution.photoId === props.photoId ? resolution : { owner, photoId: props.photoId, value: 'proxy' as const };
	const renderedResolution = useRef(selectedResolution); renderedResolution.current = selectedResolution;
	const live = useRef(true);
	const owned = useRef(owner); owned.current = owner;
	const rendered = useRef(snapshot); rendered.current = snapshot;
	const { beforeOpen, registerDemandRetirement } = props;
	const settingsOwner = props.settings?.owner, settingsDrain = props.settings?.drain;
	useEffect(() => registerDemandRetirement?.(() => joinPhotoLibraryRetirementV1([owner.retire(), settingsOwner?.dismiss() ?? null])), [owner, settingsOwner, registerDemandRetirement]);
	useEffect(() => {
		let current = true; live.current = true;
		void Promise.all([drain(), settingsDrain?.(), beforeOpen]).then(() => { if (current) return owner.open(props.photoId); }).catch(() => undefined);
		return () => { current = false; live.current = false; };
	}, [owner, drain, settingsDrain, props.photoId, beforeOpen]);
	const mounted = () => live.current && owned.current === owner;
	const close = () => { if (!mounted()) return; live.current = false; void joinPhotoLibraryRetirementV1([owner.close(), settingsOwner?.dismiss() ?? null]).catch(() => undefined); props.onClose(); };
	const current = () => mounted() && rendered.current === snapshot;
	const run = (action: () => Promise<unknown>) => { if (current() && !snapshot.busy && !props.settings?.snapshot.busy) void action(); };
	const document = snapshot.document, draft = snapshot.draft, busy = snapshot.busy || props.settings?.snapshot.busy === true, disabled = busy || !document;
	const catalogId = document?.catalogId ?? props.catalogId;
	const now = () => new Date().toISOString();
	return <AudioEditorDialogShell title={`${messages.title}: ${props.label}`} onClose={close} className="lightscaper-dialog lightscaper-develop-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-workspace><p>{messages.description}</p>
			{busy && <p role="status">{messages.working}</p>}{snapshot.error && <p role="alert">{snapshot.error}</p>}
			{snapshot.dirty && <p role="status">{messages.dirty}</p>}
			{snapshot.receipt && <div role="status" data-photo-develop-ack><p>{messages.acknowledged}</p>
				{snapshot.receipt.notices.includes('cleanup-failed') && <p>{messages.cleanupFailed}</p>}
				{snapshot.notice === 'refresh-failed' && <p>{messages.refreshFailed}</p>}</div>}
			{document && draft && <>
				{props.settings && catalogId && <PhotoDevelopSettingsMenu locale={props.locale} owner={props.settings.owner} snapshot={props.settings.snapshot}
					source={{ catalogId, photoId: document.photoId, versionId: document.versionId, revision: document.revision, develop: draft }}
					selectedIds={props.selectedIds ?? [document.photoId]} disabled={busy} dirty={snapshot.dirty}
					isCurrent={() => mounted() && owner.snapshot().document === document} onChanged={() => owner.reload()}
					resolution={{ value: selectedResolution.value, fullAvailable: props.withOriginalFrame !== undefined,
						onChange: value => { if (current() && renderedResolution.current === selectedResolution) setResolution({ owner, photoId: props.photoId, value }); } }} />}
				<label>{messages.version}<select value={document.versionId} disabled={busy || snapshot.dirty} onChange={event => {
					const id = event.currentTarget.value; run(() => owner.open(props.photoId, id));
				}}>{document.versions.map(version => <option key={version.id} value={version.id}>{version.name}</option>)}</select></label>
				<button type="button" disabled={busy || snapshot.dirty || document.activeVersionId === document.versionId}
					onClick={() => { run(() => owner.apply({ type: 'activate-version', versionId: document.versionId })); }}>{messages.useVersion}</button>
				<div className="lightscaper-develop-layout"><PhotoDevelopPreview {...props} develop={draft} messages={messages} revision={document.revision} resolution={selectedResolution.value} />
					<PhotoDevelopEffects effects={draft.effects} owner={owner} messages={messages} disabled={busy}
						isCurrent={() => mounted() && owner.snapshot().document === document} /></div>
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
			<div className="lightscaper-develop-actions"><button type="button" disabled={disabled || !snapshot.dirty} onClick={() => { run(async () => {
				const receipt = await owner.save(messages.editLabel);
				if (receipt && mounted() && catalogId) await settingsOwner?.syncAcknowledged({ catalogId,
					photoId: receipt.snapshot.photoId, versionId: receipt.snapshot.versionId, revision: receipt.snapshot.revision, develop: receipt.snapshot.develop }, photoDevelopSettingsCopy(props.locale).autoLabel);
			}); }}>{messages.save}</button>
				<button type="button" disabled={disabled || !snapshot.dirty} onClick={() => { if (current()) owner.discard(); }}>{messages.discard}</button>
				<button type="button" disabled={busy || snapshot.dirty} onClick={() => { run(() => owner.open(props.photoId, document?.versionId)); }}>{messages.reload}</button>
				<button type="button" disabled={!busy} onClick={() => { if (current()) void joinPhotoLibraryRetirementV1([owner.cancel(), settingsOwner?.cancel() ?? null]); }}>{messages.cancel}</button>
				<button type="button" onClick={close}>{messages.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
