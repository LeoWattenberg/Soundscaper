/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudiocomArchiveSnapshot, AudiocomProjectArchiveOptions, AudiocomProjectArchives } from '../audiocom-project-archives.ts';
import { createAudiocomProjectArchiveClient } from './audiocom-project-archive-client.ts';
import { AudiocomApiError } from './audiocom-api-client.ts';

const empty = (): AudiocomArchiveSnapshot => ({ supported: false, formats: [], maximumBytes: 100000000,
	results: [], page: 1, hasNext: false, status: 'idle' });

export function createProjectArchives(options: AudiocomProjectArchiveOptions): AudiocomProjectArchives {
	const client = options.client ?? createAudiocomProjectArchiveClient();
	const listeners = new Set<() => void>();
	let snapshot = empty(); let connected = false; let disposed = false;
	let generation = 0; let abort: AbortController | null = null;
	let initialized = false;
	const emit = (patch: Partial<AudiocomArchiveSnapshot>): void => {
		if (disposed) return; snapshot = Object.freeze({ ...snapshot, ...patch });
		for (const listener of listeners) listener();
	};
	const cancel = (): void => {
		++generation; abort?.abort(); abort = null;
		emit({ status: snapshot.supported ? 'ready' : 'idle', ...(snapshot.status === 'uploading'
			? { errorMessage: 'The upload was cancelled. The server may retain an unfinished project. Refresh the archive list before trying again.' } : {}) });
	};
	const operation = async (status: AudiocomArchiveSnapshot['status'], task: (signal: AbortSignal) => Promise<Partial<AudiocomArchiveSnapshot>>): Promise<void> => {
		if (!connected || disposed) return;
		cancel(); const current = generation; const selected = new AbortController(); abort = selected;
		emit({ status, errorMessage: undefined, completedFileName: undefined });
		try {
			const patch = await task(selected.signal);
			if (!disposed && connected && current === generation && !selected.signal.aborted) emit({ ...patch, status: 'ready' });
		} catch (error) {
			if (!disposed && connected && current === generation && !selected.signal.aborted) {
				if (error instanceof AudiocomApiError && error.status === 401) {
					connected = false; ++generation;
					emit({ ...empty(), provider: snapshot.provider, errorMessage: error.message, status: 'error' });
					options.onAuthenticationExpired?.();
				} else emit({ status: 'error', errorMessage: error instanceof Error ? error.message : 'The project archive request failed.' });
			}
		} finally { if (abort === selected) abort = null; }
	};
	return {
		getSnapshot: () => snapshot,
		subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async initialize() {
			if (disposed || initialized) return;
			initialized = true;
			const current = generation;
			try {
				const capabilities = await client.capabilities();
				if (!disposed && current === generation) emit({ ...capabilities, supported: capabilities.formats.length > 0 });
			} catch { /* Account actions show any configuration or connection error. */ }
		},
		async setConnected(value) {
			if (disposed || connected === value) return;
			connected = value; cancel();
			if (!value) { emit({ ...empty(), provider: snapshot.provider, formats: snapshot.formats, maximumBytes: snapshot.maximumBytes }); return; }
			await operation('loading', async signal => {
				const capabilities = await client.capabilities(signal);
				return { ...capabilities, supported: capabilities.formats.length > 0 };
			});
		},
		async refresh(page) {
			if (!snapshot.supported || !Number.isSafeInteger(page) || page < 1) return;
			await operation('loading', signal => client.list(page, signal));
		},
		async upload(file) {
			if (!snapshot.supported) return;
			await operation('uploading', async signal => {
				const format = file.name.toLowerCase().split('.').at(-1);
				if (!snapshot.formats.some(value => value === format)) throw new Error('Choose an AUP3 or AUP4 project file.');
				if (file.size < 16 || file.size > snapshot.maximumBytes) throw new Error('The project archive exceeds the server size limit.');
				if (new TextDecoder().decode(await file.slice(0, 16).arrayBuffer()) !== 'SQLite format 3\0') throw new Error('Choose a standalone SQLite AUP3 or AUP4 project file.');
				signal.throwIfAborted();
				const name = file.name.replace(/\.aup[34]$/iu, '').trim().slice(0, 256) || 'Project';
				try { await client.upload(file, name, signal); }
				catch (error) {
					if (signal.aborted || error instanceof AudiocomApiError && error.status === 401) throw error;
					throw new Error(`${error instanceof Error ? error.message : 'The project upload failed.'} The server may retain an unfinished project. Refresh the archive list before trying again.`, { cause: error });
				}
				return { ...await client.list(1, signal), completedFileName: file.name };
			});
		},
		async download(project) {
			if (!snapshot.supported) return;
			await operation('downloading', async signal => {
				if (!options.saveFile) throw new Error('Project file saving is unavailable.');
				const blob = await client.download(project, signal); signal.throwIfAborted();
				const name = [...project.name].map(character => character.charCodeAt(0) < 32 ? '-' : character).join('').replaceAll(/[\\/]+/gu, '-').slice(0, 160) || 'Project';
				await options.saveFile({ purpose: project.format, suggestedName: `${name}.${project.format}`, mimeType: 'application/octet-stream', blob, signal });
				return {};
			});
		},
		cancel,
		dispose() { if (disposed) return; cancel(); disposed = true; connected = false; listeners.clear(); },
	};
}
