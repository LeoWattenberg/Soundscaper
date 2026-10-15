/* SPDX-License-Identifier: AGPL-3.0-only */
import { createProjectArchives } from './internal/audiocom-project-archives.ts';

export interface AudiocomProjectArchive {
	readonly id: string;
	readonly name: string;
	readonly format: 'aup3' | 'aup4';
	readonly size: number;
	readonly snapshotId: string | null;
}
export interface AudiocomArchivePage {
	readonly results: readonly AudiocomProjectArchive[];
	readonly page: number;
	readonly hasNext: boolean;
}
export interface AudiocomArchiveCapabilities {
	readonly formats: readonly ('aup3' | 'aup4')[];
	readonly maximumBytes: number;
	readonly provider?: Readonly<{ kind: 'audiocom' | 'audiocity'; webOrigin: string }>;
}
export interface AudiocomProjectArchiveClient {
	capabilities(signal?: AbortSignal): Promise<AudiocomArchiveCapabilities>;
	list(page: number, signal?: AbortSignal): Promise<AudiocomArchivePage>;
	upload(file: File, name: string, signal?: AbortSignal): Promise<AudiocomProjectArchive>;
	download(project: AudiocomProjectArchive, signal?: AbortSignal): Promise<Blob>;
}
export interface AudiocomArchiveSaveRequest {
	readonly purpose: 'aup3' | 'aup4';
	readonly suggestedName: string;
	readonly mimeType: string;
	readonly blob: Blob;
	readonly signal: AbortSignal;
}
export interface AudiocomArchiveSnapshot extends AudiocomArchivePage, AudiocomArchiveCapabilities {
	readonly supported: boolean;
	readonly status: 'idle' | 'loading' | 'ready' | 'uploading' | 'downloading' | 'error';
	readonly errorMessage?: string;
	readonly completedFileName?: string;
}
export interface AudiocomProjectArchives {
	getSnapshot(): AudiocomArchiveSnapshot;
	subscribe(listener: () => void): () => void;
	initialize(): Promise<void>;
	setConnected(connected: boolean): Promise<void>;
	refresh(page: number): Promise<void>;
	upload(file: File): Promise<void>;
	download(project: AudiocomProjectArchive): Promise<void>;
	cancel(): void;
	dispose(): void;
}
export interface AudiocomProjectArchiveOptions {
	readonly client?: AudiocomProjectArchiveClient;
	readonly saveFile?: (request: AudiocomArchiveSaveRequest) => Promise<unknown>;
	readonly onAuthenticationExpired?: () => void;
}

/** Optional whole-file archives never replace or serialize the open editor project. */
export function createAudiocomProjectArchives(options: AudiocomProjectArchiveOptions = {}): AudiocomProjectArchives {
	return createProjectArchives(options);
}
