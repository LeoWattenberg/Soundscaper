/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { usePhotoDevelop } from './use-photo-develop.ts';
import PhotoDevelopEffects from './PhotoDevelopEffects.tsx';
import PhotoDevelopPreview, { type PhotoDevelopPreviewPropsV1 } from './PhotoDevelopPreview.tsx';
import type { ExecutePhotoDevelopV1 } from '../../controller/shared/photo-library-develop-workflow-v1.ts';
import './photo-develop.css';

export interface PhotoDevelopWorkspacePropsV1 extends Omit<PhotoDevelopPreviewPropsV1, 'develop' | 'messages'> {
	readonly generation: unknown;
	readonly label: string;
	readonly execute: ExecutePhotoDevelopV1;
	readonly onClose: () => void;
	readonly beforeOpen?: Promise<void>;
	readonly registerDemandRetirement?: (retire: () => Promise<void>) => () => void;
}
export default function PhotoDevelopWorkspace(props: PhotoDevelopWorkspacePropsV1) {
	const { owner, drain, snapshot } = usePhotoDevelop(props), messages = photoDevelopCopy(props.locale);
	const [snapshotName, setSnapshotName] = useState(''), [copyName, setCopyName] = useState('');
	const live = useRef(true);
	const owned = useRef(owner); owned.current = owner;
	const rendered = useRef(snapshot); rendered.current = snapshot;
	const { beforeOpen, registerDemandRetirement } = props;
	useEffect(() => registerDemandRetirement?.(() => owner.retire()), [owner, registerDemandRetirement]);
	useEffect(() => {
		let current = true; live.current = true;
		void Promise.all([drain(), beforeOpen]).then(() => { if (current) return owner.open(props.photoId); }).catch(() => undefined);
		return () => { current = false; live.current = false; };
	}, [owner, drain, props.photoId, beforeOpen]);
	const mounted = () => live.current && owned.current === owner;
	const close = () => { if (!mounted()) return; live.current = false; void owner.close().catch(() => undefined); props.onClose(); };
	const current = () => mounted() && rendered.current === snapshot;
	const run = (action: () => Promise<unknown>) => { if (current() && !snapshot.busy) void action(); };
	const document = snapshot.document, draft = snapshot.draft, disabled = snapshot.busy || !document;
	const now = () => new Date().toISOString();
	return <AudioEditorDialogShell title={`${messages.title}: ${props.label}`} onClose={close} className="lightscaper-dialog lightscaper-develop-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-develop-workspace><p>{messages.description}</p>
			{snapshot.busy && <p role="status">{messages.working}</p>}{snapshot.error && <p role="alert">{snapshot.error}</p>}
			{snapshot.dirty && <p role="status">{messages.dirty}</p>}
			{snapshot.receipt && <div role="status" data-photo-develop-ack><p>{messages.acknowledged}</p>
				{snapshot.receipt.notices.includes('cleanup-failed') && <p>{messages.cleanupFailed}</p>}
				{snapshot.notice === 'refresh-failed' && <p>{messages.refreshFailed}</p>}</div>}
			{document && draft && <>
				<label>{messages.version}<select value={document.versionId} disabled={snapshot.busy || snapshot.dirty} onChange={event => {
					const id = event.currentTarget.value; run(() => owner.open(props.photoId, id));
				}}>{document.versions.map(version => <option key={version.id} value={version.id}>{version.name}</option>)}</select></label>
				<button type="button" disabled={snapshot.busy || snapshot.dirty || document.activeVersionId === document.versionId}
					onClick={() => { run(() => owner.apply({ type: 'activate-version', versionId: document.versionId })); }}>{messages.useVersion}</button>
				<div className="lightscaper-develop-layout"><PhotoDevelopPreview {...props} develop={draft} messages={messages} />
					<PhotoDevelopEffects effects={draft.effects} owner={owner} messages={messages} disabled={snapshot.busy}
						isCurrent={() => mounted() && owner.snapshot().document === document} /></div>
				<div className="lightscaper-develop-history"><section aria-label={messages.history}><h3>{messages.history}</h3>
					<label>{messages.history}<select value={document.history.cursor} disabled={snapshot.busy || snapshot.dirty} onChange={event => {
						const cursor = Number(event.currentTarget.value); run(() => owner.apply({ type: 'select-develop-history', versionId: document.versionId, cursor }));
					}}>{document.history.entries.map(entry => <option key={entry.index} value={entry.index}>{entry.label}</option>)}</select></label>
				</section><section aria-label={messages.snapshots}><h3>{messages.snapshots}</h3>
					<label>{messages.snapshotName}<input value={snapshotName} maxLength={256} disabled={snapshot.busy} onChange={event => { if (mounted()) setSnapshotName(event.currentTarget.value); }} /></label>
					<button type="button" disabled={snapshot.busy || snapshot.dirty || !snapshotName.trim()} onClick={() => { run(() => owner.apply({ type: 'save-develop-snapshot', versionId: document.versionId,
						id: crypto.randomUUID(), name: snapshotName.trim(), createdAt: now() })); }}>{messages.saveSnapshot}</button>
					<ul>{document.snapshots.map(saved => <li key={saved.id}>{saved.name}
						<button type="button" disabled={snapshot.busy || snapshot.dirty} aria-label={`${messages.restoreSnapshot}: ${saved.name}`} onClick={() => {
							run(() => owner.apply({ type: 'restore-develop-snapshot', versionId: document.versionId, snapshotId: saved.id, label: messages.restoreLabel, createdAt: now() }));
						}}>{messages.restoreSnapshot}</button>
						<button type="button" disabled={snapshot.busy || snapshot.dirty} aria-label={`${messages.deleteSnapshot}: ${saved.name}`} onClick={() => {
							run(() => owner.apply({ type: 'delete-develop-snapshot', versionId: document.versionId, snapshotId: saved.id }));
						}}>{messages.deleteSnapshot}</button></li>)}</ul>
				</section><section><label>{messages.copyName}<input value={copyName} maxLength={256} disabled={snapshot.busy} onChange={event => { if (mounted()) setCopyName(event.currentTarget.value); }} /></label>
					<button type="button" disabled={snapshot.busy || snapshot.dirty || !copyName.trim()} onClick={() => { run(() => owner.apply({ type: 'create-virtual-copy', sourceVersionId: document.versionId,
						id: crypto.randomUUID(), name: copyName.trim(), createdAt: now() })); }}>{messages.createCopy}</button>
					<button type="button" disabled={snapshot.busy || snapshot.dirty || !copyName.trim() || document.versions.find(version => version.id === document.versionId)?.kind !== 'virtual-copy'}
						onClick={() => { run(() => owner.apply({ type: 'rename-virtual-copy', versionId: document.versionId, name: copyName.trim() })); }}>{messages.renameCopy}</button>
					<button type="button" disabled={snapshot.busy || snapshot.dirty || document.versions.find(version => version.id === document.versionId)?.kind !== 'virtual-copy'}
						onClick={() => { run(() => owner.apply({ type: 'delete-virtual-copy', versionId: document.versionId })); }}>{messages.deleteCopy}</button>
				</section></div>
			</>}
			<div className="lightscaper-develop-actions"><button type="button" disabled={disabled || !snapshot.dirty} onClick={() => { run(() => owner.save(messages.editLabel)); }}>{messages.save}</button>
				<button type="button" disabled={disabled || !snapshot.dirty} onClick={() => { if (current()) owner.discard(); }}>{messages.discard}</button>
				<button type="button" disabled={snapshot.busy || snapshot.dirty} onClick={() => { run(() => owner.open(props.photoId, document?.versionId)); }}>{messages.reload}</button>
				<button type="button" disabled={!snapshot.busy} onClick={() => { if (current()) void owner.cancel(); }}>{messages.cancel}</button>
				<button type="button" onClick={close}>{messages.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
