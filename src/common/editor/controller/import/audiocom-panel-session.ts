/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPanelSession } from './internal/audiocom-panel-session.ts';

export interface AudiocomSearchResult {
	readonly id: string;
	readonly title: string;
	readonly authorName: string;
	readonly username: string;
	readonly url: string;
	readonly description: string;
	readonly license: string;
	readonly isDownloadable: boolean;
	readonly durationSeconds: number;
	readonly previewUrl?: string;
	readonly waveformUrl?: string;
}

export interface AudiocomUploadDraft {
	readonly title: string;
	readonly description: string;
	readonly category: string;
	readonly license: string;
	readonly visibility: 'listed' | 'unlisted';
	readonly downloadable: boolean;
	readonly rightsConfirmed: boolean;
}

export interface AudiocomUploadItem {
	readonly id: string;
	readonly fileName: string;
	readonly title: string;
	readonly status: 'draft' | 'queued' | 'uploading' | 'processing' | 'complete' | 'error' | 'cancelled';
	readonly progress?: number;
	readonly errorMessage?: string;
	readonly url?: string;
	readonly draft?: AudiocomUploadDraft;
}

export interface AudiocomAccount {
	readonly connected: boolean;
	readonly user?: Readonly<{ username: string }>;
}

export interface AudiocomSearchPage {
	readonly results: readonly AudiocomSearchResult[];
	readonly page: number;
	readonly hasNext: boolean;
}

export interface AudiocomAuthorizationReservation {
	open(url: string): Promise<void> | void;
	close(): void;
}

export interface AudiocomApiClient {
	session(signal?: AbortSignal): Promise<AudiocomAccount>;
	startOAuth(signal?: AbortSignal): Promise<Readonly<{
		attemptId: string; handoffToken: string; authorizeUrl: string; expiresAt: string;
	}>>;
	pollOAuth(attemptId: string, handoffToken: string, signal?: AbortSignal): Promise<AudiocomAccount | null>;
	disconnect(signal?: AbortSignal): Promise<void>;
	reserveAuthorization(): AudiocomAuthorizationReservation;
	search(request: Readonly<{ query: string; page: number }>, signal?: AbortSignal): Promise<AudiocomSearchPage>;
	upload(file: File, draft: AudiocomUploadDraft, signal?: AbortSignal): Promise<Readonly<{
		audio: AudiocomSearchResult; processing: boolean;
	}>>;
}

export interface AudiocomPanelSnapshot {
	readonly auth: Readonly<{
		status: 'loading' | 'connecting' | 'connected' | 'disconnected';
		user?: Readonly<{ username: string }>;
		errorMessage?: string;
	}>;
	readonly search: AudiocomSearchPage & Readonly<{
		query: string;
		status: 'idle' | 'loading' | 'ready' | 'error';
		errorMessage?: string;
	}>;
	readonly uploadQueue: Readonly<{ items: readonly AudiocomUploadItem[]; active: boolean }>;
	readonly previewingId: string | null;
	readonly previewError?: string;
}

export interface AudiocomPreviewAudio {
	src: string;
	volume: number;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	addEventListener(type: 'ended' | 'error', listener: () => void): void;
	removeEventListener(type: 'ended' | 'error', listener: () => void): void;
	setSinkId?(deviceId: string): Promise<void>;
}

export interface AudiocomPanelSessionOptions {
	readonly client?: AudiocomApiClient;
	readonly createAudio?: () => AudiocomPreviewAudio;
	readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly now?: () => number;
}

export interface AudiocomPanelSession {
	getSnapshot(): AudiocomPanelSnapshot;
	subscribe(listener: () => void): () => void;
	initialize(): Promise<void>;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	search(request: Readonly<{ query: string; page: number }>): Promise<void>;
	preview(id: string): Promise<void>;
	stopPreview(): void;
	enqueueFiles(files: readonly File[]): readonly string[];
	publish(id: string, draft: AudiocomUploadDraft): Promise<void>;
	retry(id: string): void;
	cancel(id: string): void;
	remove(id: string): void;
	setActive(active: boolean): void;
	setListeningPreferences(gain: number, outputDeviceId: string): void;
	dispose(): void;
}

/** Optional browsing/publishing lifecycle; it never mutates the open project. */
export function createAudiocomPanelSession(options: AudiocomPanelSessionOptions = {}): AudiocomPanelSession {
	return createPanelSession(options);
}

const ownerSessions = new WeakMap<object, AudiocomPanelSession>();

/** Keep queued uploads and search results through panel docking and closing. */
export function audiocomPanelSession(owner: object, options: AudiocomPanelSessionOptions = {}): AudiocomPanelSession {
	const existing = ownerSessions.get(owner);
	if (existing) return existing;
	const session = createPanelSession(options);
	ownerSessions.set(owner, session);
	const lifecycle = owner as { getSnapshot?: () => unknown; subscribe?: (listener: () => void) => () => void };
	if (typeof lifecycle.getSnapshot === 'function' && typeof lifecycle.subscribe === 'function') {
		const subscription: { unsubscribe?: () => void } = {};
		const check = (): void => {
			const value = lifecycle.getSnapshot?.();
			if (value && typeof value === 'object' && 'disposed' in value && value.disposed === true) {
				session.dispose(); ownerSessions.delete(owner); subscription.unsubscribe?.();
			}
		};
		subscription.unsubscribe = lifecycle.subscribe(check);
		check();
	}
	return session;
}
