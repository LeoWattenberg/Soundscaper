/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudiocomApiClient, AudiocomUploadDraft, AudiocomUploadItem } from '../audiocom-panel-session.ts';

const MAXIMUM_BYTES = 100_000_000;
const CATEGORIES = new Set(['music', 'podcast', 'voice-over', 'sound-design', 'cover', 'beats', 'audiobook', 'recording', 'other']);
const LICENSES = new Set(['none', 'arr', 'cc-0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd']);

interface QueueEntry {
	readonly file: File;
	item: AudiocomUploadItem;
	abort?: AbortController;
}

/** One bounded queue retains Files, never full decoded audio or copied upload bodies. */
export function createAudiocomUploadQueue(
	client: AudiocomApiClient,
	connected: () => boolean,
	changed: () => void,
	authenticationFailed: (error: unknown) => void,
) {
	const entries = new Map<string, QueueEntry>();
	let running = false;
	let disposed = false;
	const snapshot = () => Object.freeze({
		items: Object.freeze([...entries.values()].map(entry => entry.item)),
		active: [...entries.values()].some(entry => entry.item.status === 'uploading' || entry.item.status === 'queued'),
	});
	const cancel = (id: string): void => {
		const entry = entries.get(id);
		if (!entry || ['processing', 'complete', 'cancelled'].includes(entry.item.status)) return;
		entry.abort?.abort();
		entry.abort = undefined;
		entry.item = Object.freeze({ ...entry.item, status: 'cancelled', errorMessage: undefined });
		changed();
	};
	async function pump(): Promise<void> {
		if (running || disposed) return;
		running = true;
		try {
			for (;;) {
				const entry = [...entries.values()].find(value => value.item.status === 'queued');
				if (!entry || !connected() || disposed) break;
				const abort = new AbortController();
				entry.abort = abort;
				entry.item = Object.freeze({ ...entry.item, status: 'uploading' });
				changed();
				try {
					if (!entry.item.draft) throw new Error('Review the audio.com upload settings first.');
					const result = await client.upload(entry.file, entry.item.draft, abort.signal);
					if (!abort.signal.aborted && entry.abort === abort && entries.get(entry.item.id) === entry && !disposed) {
						entry.item = Object.freeze({ ...entry.item, status: result.processing ? 'processing' : 'complete', url: result.audio.url });
					}
				} catch (error) {
					if (!abort.signal.aborted && entries.get(entry.item.id) === entry && !disposed) {
						entry.item = Object.freeze({ ...entry.item, status: 'error', errorMessage: message(error) });
						authenticationFailed(error);
					}
				} finally {
					if (entry.abort === abort) entry.abort = undefined;
					changed();
				}
			}
		} finally { running = false; }
	}
	const publish = async (id: string, draft: AudiocomUploadDraft): Promise<void> => {
		if (disposed) throw new Error('The audio.com upload queue is closed.');
		if (!connected()) throw new Error('Connect to audio.com before uploading.');
		const entry = entries.get(id);
		if (!entry || !['draft', 'error', 'cancelled'].includes(entry.item.status)) throw new Error('This audio.com upload cannot be submitted.');
		const valid = validateDraft(draft);
		entry.item = Object.freeze({ ...entry.item, title: valid.title, draft: valid, status: 'queued', errorMessage: undefined });
		changed();
		void pump();
	};
	const reset = (): void => {
		for (const entry of entries.values()) entry.abort?.abort();
		entries.clear(); changed();
	};
	return {
		snapshot,
		enqueueFiles(files: readonly File[]): readonly string[] {
			if (disposed || !connected()) throw new Error('Connect to audio.com before adding files.');
			if (entries.size + files.length > 50) throw new Error('The audio.com upload queue holds at most 50 files.');
			for (const file of files) {
				if (!(file instanceof File) || !/\.(?:wav|mp3|flac|wv|aif|aiff|ogg|oga|m4a)$/iu.test(file.name)) {
					throw new Error('Choose a supported audio file. Use Project archives for project files when your server supports them.');
				}
				if (file.size < 1 || file.size > MAXIMUM_BYTES) throw new Error('audio.com uploads in Soundscaper must be between 1 byte and 100 MB.');
			}
			const ids = files.map(file => {
				const id = crypto.randomUUID();
				entries.set(id, { file, item: Object.freeze({ id, fileName: file.name, title: file.name.replace(/\.[^.]+$/u, ''), status: 'draft' }) });
				return id;
			});
			changed(); return ids;
		},
		publish,
		retry(id: string): void {
			const entry = entries.get(id);
			if (!entry?.item.draft || !['error', 'cancelled'].includes(entry.item.status)) return;
			void publish(id, entry.item.draft).catch(error => {
				entry.item = Object.freeze({ ...entry.item, status: 'error', errorMessage: message(error) }); changed();
			});
		},
		cancel,
		remove(id: string): void { cancel(id); entries.delete(id); changed(); },
		reset,
		dispose(): void { if (disposed) return; disposed = true; reset(); },
	};
}

function validateDraft(draft: AudiocomUploadDraft): AudiocomUploadDraft {
	if (!draft.rightsConfirmed) throw new Error('Confirm that you have the rights to publish this audio.');
	if (!draft.title.trim() || draft.title.length > 200 || draft.description.length > 500
		|| !CATEGORIES.has(draft.category) || !LICENSES.has(draft.license)
		|| !['listed', 'unlisted'].includes(draft.visibility) || typeof draft.downloadable !== 'boolean') {
		throw new Error('Review the audio.com title, description, category, license and visibility.');
	}
	return Object.freeze({ ...draft, title: draft.title.trim() });
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'The audio.com upload failed.'; }
