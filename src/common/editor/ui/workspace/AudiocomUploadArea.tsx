/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@soundscaper/design-system/Button';

import type {
	AudiocomPanelSnapshot,
	AudiocomUploadDraft,
	AudiocomUploadItem,
} from '../../controller/import/audiocom-panel-session.ts';
import AudiocomPublishDialog from './AudiocomPublishDialog.tsx';
import AudiocomLink from './AudiocomLink.tsx';

interface AudiocomUploadAreaProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly queue: AudiocomPanelSnapshot['uploadQueue'];
	readonly onFiles: (files: readonly File[]) => void;
	readonly onPublish: (id: string, draft: AudiocomUploadDraft) => Promise<void> | void;
	readonly onRetry: (id: string) => void;
	readonly onCancel: (id: string) => void;
	readonly onRemove: (id: string) => void;
	readonly onOpenLink?: (url: string) => void;
}

export default function AudiocomUploadArea({
	copy, disabled, queue, onFiles, onPublish, onRetry, onCancel, onRemove, onOpenLink,
}: AudiocomUploadAreaProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const detailsRef = useRef<HTMLDetailsElement | null>(null);
	const rows = useRef(new Map<string, HTMLLIElement>());
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState('');
	const [publishItem, setPublishItem] = useState<AudiocomUploadItem | null>(null);
	const files = (selected: readonly File[]) => {
		if (disabled || !selected.length) return;
		setError('');
		try { onFiles(selected); }
		catch (reason) { setError(reason instanceof Error ? reason.message : copy.uploadError); }
	};
	const dragOver = (event: DragEvent<HTMLElement>) => {
		if (disabled || !event.dataTransfer.types.includes('Files')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setDragging(true);
	};
	const closeDialog = () => {
		const itemId = publishItem?.id;
		setPublishItem(null);
		if (itemId) setTimeout(() => rows.current.get(itemId)?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
	};
	return <>
		<details ref={detailsRef} className="kw-audio-editor__audiocom-uploads" data-audiocom-uploads="true">
			<summary>{copy.uploadHeading}</summary>
			<div className="kw-audio-editor__audiocom-upload-content">
				<div className={`kw-audio-editor__audiocom-upload-drop${dragging ? ' is-dragging' : ''}`}
					data-audiocom-upload-drop="true" onDragEnter={dragOver} onDragOver={dragOver}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
					}}
					onDrop={(event) => {
						event.preventDefault();
						setDragging(false);
						files(Array.from(event.dataTransfer.files));
					}}>
					<p>{copy.uploadDrop}</p>
					<input ref={inputRef} className="kw-audio-editor-sr-only" type="file" multiple disabled={disabled}
						aria-label={copy.chooseFiles} accept="audio/wav,audio/mpeg,audio/flac,audio/x-wavpack,audio/aiff,audio/ogg,audio/mp4,.wav,.mp3,.flac,.wv,.aif,.aiff,.ogg,.oga,.m4a"
						onChange={(event) => {
							files(Array.from(event.currentTarget.files ?? []));
							event.currentTarget.value = '';
						}} />
					<Button size="small" disabled={disabled} onClick={() => inputRef.current?.click()}>{copy.chooseFiles}</Button>
					<small>{copy.uploadFileTypes}</small>
				</div>
				<p className="kw-audio-editor__audiocom-note">{copy.unlistedNotice}</p>
				{error ? <p role="alert">{error}</p> : null}
				{queue.items.length ? <ol className="kw-audio-editor__audiocom-upload-list" aria-label={copy.uploadQueue}>
					{queue.items.map((item) => <UploadRow key={item.id} copy={copy} item={item} disabled={disabled}
						onPublish={() => setPublishItem(item)} onRetry={() => onRetry(item.id)}
						onCancel={() => onCancel(item.id)} onRemove={() => onRemove(item.id)} onOpenLink={onOpenLink} rowRef={(element) => {
							if (element) rows.current.set(item.id, element);
							else rows.current.delete(item.id);
						}} />)}
				</ol> : null}
			</div>
		</details>
		{publishItem ? createPortal(<AudiocomPublishDialog copy={copy} item={publishItem}
			onClose={closeDialog} onPublish={onPublish} />,
			detailsRef.current?.closest<HTMLElement>('[data-audio-editor]') ?? document.body) : null}
	</>;
}

function UploadRow({ copy, item, disabled, onPublish, onRetry, onCancel, onRemove, onOpenLink, rowRef }: Readonly<{
	copy: Readonly<Record<string, string>>;
	item: AudiocomUploadItem;
	disabled: boolean;
	onPublish: () => void;
	onRetry: () => void;
	onCancel: () => void;
	onRemove: () => void;
	onOpenLink?: (url: string) => void;
	rowRef: (element: HTMLLIElement | null) => void;
}>) {
	const active = item.status === 'queued' || item.status === 'uploading';
	const retryable = item.status === 'error' || item.status === 'cancelled';
	const statusKey = {
		draft: 'statusDraft', queued: 'statusQueued', uploading: 'statusUploading', processing: 'statusProcessing',
		complete: 'statusComplete', error: 'statusError', cancelled: 'statusCancelled',
	}[item.status];
	return <li ref={rowRef} className="kw-audio-editor__audiocom-upload-item" data-upload-status={item.status}>
		<div><strong title={item.fileName}>{item.fileName}</strong>
			<span role="status" aria-live="polite" aria-atomic="true">
				<span className="kw-audio-editor-sr-only">{item.fileName}: </span>{copy[statusKey]}
			</span>
		</div>
		{item.errorMessage ? <p role="alert">{item.errorMessage}</p> : null}
		<div className="kw-audio-editor__audiocom-upload-actions">
			{item.status === 'draft' ? <Button size="small" disabled={disabled} onClick={onPublish}>
				{copy.publish}<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button> : null}
			{retryable ? <Button size="small" disabled={disabled} onClick={onRetry}>
				{copy.retry}<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button> : null}
			{active ? <Button size="small" onClick={onCancel}>{copy.cancel}
				<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button> : <Button size="small" onClick={onRemove}>{copy.remove}
				<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button>}
			{item.url ? <AudiocomLink href={item.url} onOpen={onOpenLink}>{copy.openAudio}</AudiocomLink> : null}
		</div>
	</li>;
}
