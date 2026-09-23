/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { createPortal } from 'react-dom';
import {
	type ChangeEvent,
	type DragEvent,
	useEffect,
	useRef,
	useState,
} from 'react';

import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE,
	getActiveProjectBinDragPayload,
	getActiveTimelineClipDragPayload,
	parseProjectBinDragPayload,
	parseTimelineClipDragPayload,
} from '../../project-bin-dnd.js';
import FreesoundPublishDialog from './FreesoundPublishDialog.tsx';
import type {
	FreesoundClipUploadReference,
	FreesoundPublishDraft,
	FreesoundUploadItem,
	FreesoundUploadQueueSnapshot,
} from './freesound-upload-queue.ts';

export interface FreesoundUploadAreaProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	readonly queue: FreesoundUploadQueueSnapshot;
	readonly revealRevision?: number;
	readonly onFiles?: (files: readonly File[]) => void;
	readonly onProjectClip?: (reference: FreesoundClipUploadReference) => void;
	readonly onPublish?: (id: string, draft: FreesoundPublishDraft) => Promise<void> | void;
	readonly onRetry?: (id: string) => void;
	readonly onCancel?: (id: string) => void;
	readonly onRemove?: (id: string) => void;
}

export default function FreesoundUploadArea({
	copy,
	disabled = false,
	queue,
	revealRevision = 0,
	onFiles,
	onProjectClip,
	onPublish,
	onRetry,
	onCancel,
	onRemove,
}: FreesoundUploadAreaProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const detailsRef = useRef<HTMLDetailsElement | null>(null);
	const rowRefs = useRef(new Map<string, HTMLLIElement>());
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState('');
	const [publishItem, setPublishItem] = useState<FreesoundUploadItem | null>(null);
	const closePublishDialog = () => {
		const itemId = publishItem?.id;
		setPublishItem(null);
		if (!itemId) return;
		const restoreFocus = () => {
			const row = rowRefs.current.get(itemId);
			(row?.querySelector<HTMLButtonElement>('button') ?? row)?.focus({ preventScroll: true });
		};
		setTimeout(restoreFocus, 0);
	};
	useEffect(() => {
		if (revealRevision < 1 || !detailsRef.current) return;
		detailsRef.current.open = true;
		detailsRef.current.querySelector<HTMLElement>('summary')?.focus({ preventScroll: false });
	}, [revealRevision]);

	const submitFiles = (files: readonly File[]) => {
		if (!files.length || disabled) return;
		setError('');
		try { onFiles?.(files); }
		catch (reason) { setError(errorMessage(reason, copy.uploadError)); }
	};
	const fileChange = (event: ChangeEvent<HTMLInputElement>) => {
		submitFiles(Array.from(event.currentTarget.files ?? []));
		event.currentTarget.value = '';
	};
	const dragOver = (event: DragEvent<HTMLElement>) => {
		if (disabled || !acceptedTransfer(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setDragging(true);
	};
	const drop = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(false);
		if (disabled) return;
		const files = Array.from(event.dataTransfer.files ?? []);
		if (files.length) {
			submitFiles(files);
			return;
		}
		const timelinePayload = parseTimelineClipDragPayload(
			event.dataTransfer.getData(AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE),
		) ?? getActiveTimelineClipDragPayload();
		const serialized = event.dataTransfer.getData(AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const payload = timelinePayload
			?? parseProjectBinDragPayload(serialized)
			?? getActiveProjectBinDragPayload();
		if (!payload) return;
		setError('');
		try { onProjectClip?.(payload); }
		catch (reason) { setError(errorMessage(reason, copy.uploadError)); }
	};

	return <>
		<details ref={detailsRef} className="kw-audio-editor__freesound-uploads" data-freesound-uploads="true">
			<summary>{copy.uploads}</summary>
			<div className="kw-audio-editor__freesound-upload-content">
				<div
					className={`kw-audio-editor__freesound-upload-drop${dragging ? ' is-dragging' : ''}`}
					data-freesound-upload-drop="true"
					onDragEnter={dragOver}
					onDragOver={dragOver}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
					}}
					onDrop={drop}
				>
					<p>{copy.uploadDropPrompt}</p>
					<input ref={inputRef} className="kw-audio-editor-sr-only" type="file" multiple
						accept="audio/*,video/mp4,video/webm,.aac,.aif,.aiff,.bw64,.flac,.m4a,.m4v,.mp2,.mp3,.mp4,.oga,.ogg,.opus,.rf64,.wav,.wave,.wavpack,.webm,.wv"
						disabled={disabled} onChange={fileChange} />
					<Button size="small" disabled={disabled} onClick={() => inputRef.current?.click()}>
						{copy.chooseAudioFiles}
					</Button>
				</div>
				{error ? <p className="kw-audio-editor__freesound-inline-error" role="alert">{error}</p> : null}
				{queue.items.length ? <ol className="kw-audio-editor__freesound-upload-list">
					{queue.items.map((item) => <UploadRow
						key={item.id}
						copy={copy}
						item={item}
						disabled={disabled}
						onPublish={() => setPublishItem(item)}
						onRetry={() => onRetry?.(item.id)}
						onCancel={() => onCancel?.(item.id)}
						onRemove={() => onRemove?.(item.id)}
						rowRef={(node) => {
							if (node) rowRefs.current.set(item.id, node);
							else rowRefs.current.delete(item.id);
						}}
					/>)}
				</ol> : <p className="kw-audio-editor__freesound-upload-empty">{copy.uploadQueueEmpty}</p>}
			</div>
		</details>
		{publishItem && onPublish ? createPortal(<FreesoundPublishDialog
			copy={copy}
			item={publishItem}
			onClose={closePublishDialog}
			onPublish={onPublish}
		/>, detailsRef.current?.closest<HTMLElement>('[data-audio-editor]') ?? document.body) : null}
	</>;
}

function UploadRow({
	copy,
	item,
	disabled,
	onPublish,
	onRetry,
	onCancel,
	onRemove,
	rowRef,
}: Readonly<{
	copy: Readonly<Record<string, string>>;
	item: FreesoundUploadItem;
	disabled: boolean;
	onPublish: () => void;
	onRetry: () => void;
	onCancel: () => void;
	onRemove: () => void;
	rowRef: (node: HTMLLIElement | null) => void;
}>) {
	const active = ['preparing', 'uploading', 'publishing'].includes(item.status);
	return <li ref={rowRef} tabIndex={-1} className="kw-audio-editor__freesound-upload-item"
		data-upload-status={item.status}>
		<div>
			<strong title={item.fileName}>{item.fileName}</strong>
			<span role="status" aria-live="polite" aria-atomic="true">
				<span className="kw-audio-editor-sr-only">{item.fileName}: </span>{statusLabel(copy, item)}
			</span>
		</div>
		{item.errorMessage ? <p role="alert">{item.errorMessage}</p> : null}
		<div className="kw-audio-editor__freesound-upload-actions">
			{item.status === 'ready-to-publish' ? <Button size="small" disabled={disabled} onClick={onPublish}>
				{copy.readyToPublish}<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button> : null}
			{['failed', 'cancelled'].includes(item.status) ? <Button size="small" disabled={disabled} onClick={onRetry}>
				{copy.retryUpload}<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button> : null}
			{active ? <Button size="small" onClick={onCancel}>{copy.cancelUpload}
				<span className="kw-audio-editor-sr-only">: {item.fileName}</span></Button> : null}
			{!active && item.status !== 'ready-to-publish' ? <Button size="small" onClick={onRemove}>
				{copy.removeUpload}<span className="kw-audio-editor-sr-only">: {item.fileName}</span>
			</Button> : null}
		</div>
	</li>;
}

function acceptedTransfer(transfer: DataTransfer): boolean {
	return transfer.types.includes('Files')
		|| transfer.types.includes(AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE)
		|| transfer.types.includes(AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE);
}

function statusLabel(copy: Readonly<Record<string, string>>, item: FreesoundUploadItem): string {
	if (item.status === 'submitted' && item.remoteStatus) {
		return `${copy.uploadSubmitted}: ${item.remoteStatus.replaceAll('_', ' ')}`;
	}
	return {
		queued: copy.uploadQueued,
		preparing: copy.uploadPreparing,
		uploading: copy.uploadUploading,
		'ready-to-publish': copy.readyToPublish,
		publishing: copy.publishing,
		submitted: copy.uploadSubmitted,
		failed: copy.uploadFailed,
		cancelled: copy.uploadCancelled,
	}[item.status];
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
