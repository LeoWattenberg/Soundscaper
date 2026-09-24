/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { freesoundAttributionCopy } from '../../../i18n/freesound-attribution-copy.js';
import FreesoundPanel, {
	type FreesoundPanelState,
	type FreesoundResultPresentation,
	type FreesoundSearchRequest,
} from './FreesoundPanel.tsx';
import {
	freesoundWorkspaceActions,
	type FreesoundWorkspaceController,
} from './freesound-workspace-service.ts';
import { freesoundPreviewUrl, freesoundWaveformUrl } from './freesound-media-url.ts';
import {
	createFreesoundApiClient,
	createFreesoundClientTransport,
	type FreesoundClientTransport,
} from './freesound-auth-upload-client.ts';
import { freesoundPanelSession } from './freesound-panel-session.ts';
import type { FreesoundMaterializedClip } from './freesound-upload-queue.ts';
import { prepareFreesoundUploadFile } from './freesound-upload-file-preparation.ts';
import FreesoundOriginalFallbackDialog from './FreesoundOriginalFallbackDialog.tsx';
import {
	FreesoundOriginalTooLargeError,
	type FreesoundImportRequest,
} from '../../controller/import/freesound-import-service.ts';

export { freesoundPreviewUrl, freesoundWaveformUrl } from './freesound-media-url.ts';

interface FreesoundSound {
	readonly id: number;
	readonly name: string;
	readonly creator: Readonly<{ readonly username: string; readonly pageUrl: string }>;
	readonly pageUrl: string;
	readonly license: Readonly<{
		readonly code: FreesoundResultPresentation['licenseCode'];
		readonly name: string;
		readonly url: string;
	}>;
	readonly durationSeconds: number;
	readonly preview: Readonly<{ readonly available: boolean }>;
	readonly waveform: Readonly<{ readonly available: boolean; readonly url: string | null }>;
}

interface FreesoundPanelController extends FreesoundWorkspaceController {
	readonly engine?: Readonly<{ getPositionFrames?: () => number }>;
}

interface ActiveFreesoundPreview {
	readonly soundId: number;
	readonly audio: HTMLAudioElement;
	playing: boolean;
	metadataLoaded: boolean;
	pendingSeekSeconds: number | null;
}

interface FreesoundPanelContainerProps {
	readonly controller: FreesoundPanelController;
	readonly snapshot: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	readonly projectBinVisible?: boolean;
	readonly panelActive?: boolean;
	readonly freesoundTransport?: FreesoundClientTransport;
	readonly materializeClip?: (request: Readonly<{
		projectId: string;
		clipId: string;
		signal?: AbortSignal;
	}>) => Promise<FreesoundMaterializedClip>;
	readonly prepareUploadFile?: (file: File, signal?: AbortSignal) => Promise<File>;
}

const INITIAL_STATE: FreesoundPanelState = Object.freeze({
	query: '', license: 'all', sort: 'relevance', page: 1, pageCount: 0,
	totalResults: 0, status: 'idle', previewingSoundId: null, previewPaused: false,
	previewPositionSeconds: 0,
	results: Object.freeze([]),
});

export function FreesoundPanelContainer({
	controller,
	snapshot,
	copy,
	disabled = false,
	projectBinVisible = true,
	panelActive = true,
	freesoundTransport,
	materializeClip,
	prepareUploadFile,
}: FreesoundPanelContainerProps) {
	const clipMaterializer = materializeClip ?? controller.actions.clip?.materializeFreesoundUpload;
	const transport = useMemo(
		() => freesoundTransport ?? createFreesoundClientTransport(),
		[freesoundTransport],
	);
	const apiClient = useMemo(() => createFreesoundApiClient(transport), [transport]);
	const account = useMemo(() => freesoundPanelSession(controller, apiClient, {
		...(clipMaterializer ? { materializeClip: clipMaterializer } : {}),
		prepareFile: prepareUploadFile ?? prepareFreesoundUploadFile,
	}), [apiClient, clipMaterializer, controller, prepareUploadFile]);
	const accountSnapshot = useSyncExternalStore(account.subscribe, account.getSnapshot, account.getSnapshot);
	const actions = freesoundWorkspaceActions(controller, {
		authenticated: () => account.getSnapshot().auth.status === 'connected',
		authenticatedRequest: async (path, init) => {
			const response = await transport.request(path, init);
			if (response.status === 401) account.expireAuthentication();
			return response;
		},
	});
	const localizedCopy = useMemo(() => Object.freeze({
		...copy,
		...freesoundAttributionCopy(snapshot.locale, copy),
	}), [copy, snapshot.locale]);
	const [state, setState] = useState<FreesoundPanelState>(INITIAL_STATE);
	const [pendingSoundId, setPendingSoundId] = useState<number | null>(null);
	const [fallbackImport, setFallbackImport] = useState<FreesoundImportRequest | null>(null);
	const searchSequence = useRef(0);
	const searchAbort = useRef<AbortController | null>(null);
	const preview = useRef<ActiveFreesoundPreview | null>(null);

	useEffect(() => { void account.initialize(); }, [account]);

	const stopPreview = useCallback(() => {
		const active = preview.current;
		preview.current = null;
		if (active) {
			active.audio.pause();
			active.audio.src = '';
			active.audio.load();
		}
		setState((current) => ({ ...current, previewingSoundId: null, previewPaused: false, previewPositionSeconds: 0 }));
	}, []);

	useEffect(() => {
		if (!panelActive) stopPreview();
	}, [panelActive, stopPreview]);

	useEffect(() => () => {
		searchAbort.current?.abort();
		const active = preview.current;
		preview.current = null;
		if (active) {
			active.audio.pause();
			active.audio.src = '';
		}
	}, []);

	const search = useCallback((request: FreesoundSearchRequest) => {
		stopPreview();
		searchAbort.current?.abort();
		const abort = new AbortController();
		searchAbort.current = abort;
		const sequence = searchSequence.current + 1;
		searchSequence.current = sequence;
		setState((current) => ({
			...current, ...request, status: 'loading', errorMessage: undefined,
		}));
		void actions.search({ ...request, signal: abort.signal }).then((page) => {
			if (searchSequence.current !== sequence || abort.signal.aborted) return;
			setState({
				query: page.query,
				license: request.license,
				sort: request.sort,
				page: page.page,
				pageCount: page.totalPages,
				totalResults: page.totalCount,
				status: 'ready',
				previewingSoundId: null,
				previewPaused: false,
				previewPositionSeconds: 0,
				results: page.results.map(toFreesoundPanelResult),
			});
		}).catch((error: unknown) => {
			if (searchSequence.current !== sequence || abort.signal.aborted) return;
			setState((current) => ({
				...current, status: 'error', errorMessage: errorMessage(error, localizedCopy.searchError),
			}));
		});
	}, [actions, localizedCopy.searchError, stopPreview]);

	const startPreview = useCallback((soundId: number, seekSeconds = 0) => {
		if (!panelActive || typeof Audio !== 'function') return;
		stopPreview();
		const audio = new Audio(freesoundPreviewUrl(soundId));
		const active: ActiveFreesoundPreview = {
			soundId, audio, playing: true, metadataLoaded: false, pendingSeekSeconds: null,
		};
		preview.current = active;
		const finish = () => { if (preview.current === active) stopPreview(); };
		audio.preload = 'metadata';
		audio.addEventListener('loadedmetadata', () => {
			active.metadataLoaded = true;
			if (preview.current !== active || active.pendingSeekSeconds === null) return;
			if (setPreviewTime(audio, active.pendingSeekSeconds)) active.pendingSeekSeconds = null;
		}, { once: true });
		audio.addEventListener('ended', finish, { once: true });
		audio.addEventListener('error', finish, { once: true });
		audio.addEventListener('timeupdate', () => {
			if (preview.current !== active) return;
			const position = audio.currentTime;
			if (Number.isFinite(position)) {
				setState((current) => ({ ...current, previewPositionSeconds: position }));
			}
		});
		if (seekSeconds > 0) seekPreviewTime(active, seekSeconds);
		setState((current) => ({ ...current, previewingSoundId: soundId, previewPaused: false,
			previewPositionSeconds: seekSeconds }));
		void audio.play().catch(finish);
	}, [panelActive, stopPreview]);

	const pausePreview = useCallback(() => {
		const active = preview.current;
		if (!active) return;
		active.playing = false;
		active.audio.pause();
		setState((current) => ({ ...current, previewPaused: true }));
	}, []);

	const resumePreview = useCallback(() => {
		const active = preview.current;
		if (!panelActive || !active) return;
		active.playing = true;
		setState((current) => ({ ...current, previewPaused: false }));
		void active.audio.play().catch(() => { if (preview.current === active) stopPreview(); });
	}, [panelActive, stopPreview]);

	const seekPreview = useCallback((soundId: number, seconds: number) => {
		if (!panelActive || typeof Audio !== 'function') return;
		const active = preview.current;
		if (active?.soundId !== soundId) {
			startPreview(soundId, seconds);
			return;
		}
		seekPreviewTime(active, seconds);
		setState((current) => ({ ...current, previewPositionSeconds: seconds }));
		if (active.playing) return;
		active.playing = true;
		setState((current) => ({ ...current, previewPaused: false }));
		void active.audio.play().catch(() => { if (preview.current === active) stopPreview(); });
	}, [panelActive, startPreview, stopPreview]);

	const executeImport = useCallback((request: FreesoundImportRequest) => {
		setPendingSoundId(request.soundId);
		void actions.importSound(request).catch((error: unknown) => {
			if (error instanceof FreesoundOriginalTooLargeError && request.variant === 'original') {
				setFallbackImport(request);
				return;
			}
			setState((current) => ({
				...current, status: 'error', errorMessage: errorMessage(error, localizedCopy.importError),
			}));
		}).finally(() => setPendingSoundId(null));
	}, [actions, localizedCopy.importError]);

	const importSound = useCallback((soundId: number, destination: 'timeline' | 'project-bin') => {
		if (pendingSoundId !== null) return;
		const request: FreesoundImportRequest = {
			soundId,
			destination,
			variant: accountSnapshot.auth.status === 'connected' ? 'original' as const : 'preview-hq-ogg' as const,
			...(destination === 'timeline' ? {
				timelineStartFrame: currentPlayheadFrame(controller),
				...selectedAudioTrack(snapshot),
			} : {}),
		};
		executeImport(request);
	}, [accountSnapshot.auth.status, controller, executeImport, pendingSoundId, snapshot]);

	const presentationState = useMemo<FreesoundPanelState>(() => ({
		...state,
		results: state.results.map((result) => ({
			...result, actionPending: pendingSoundId === result.soundId,
		})),
	}), [pendingSoundId, state]);

	return <><FreesoundPanel
		copy={localizedCopy}
		state={presentationState}
		disabled={disabled || pendingSoundId !== null}
		projectBinVisible={projectBinVisible}
		onSearch={search}
		onPreview={startPreview}
		onPausePreview={pausePreview}
		onResumePreview={resumePreview}
		onSeekPreview={seekPreview}
		onInsertAtPlayhead={(soundId) => importSound(soundId, 'timeline')}
		onAddToProjectBin={(soundId) => importSound(soundId, 'project-bin')}
		auth={accountSnapshot.auth}
		uploadQueue={accountSnapshot.uploadQueue}
		uploadRevealRevision={accountSnapshot.uploadRevealRevision}
		onConnect={() => { void account.connect(); }}
		onDisconnect={() => { void account.disconnect(); }}
		onUploadFiles={account.enqueueFiles}
		onUploadProjectClip={(reference) => account.enqueueClip({
			...reference,
			clipTitle: projectClipTitle(snapshot, reference.clipId),
		})}
		onPublishUpload={account.publish}
		onRetryUpload={account.retry}
		onCancelUpload={account.cancel}
		onRemoveUpload={account.remove}
	/>
	{fallbackImport ? <FreesoundOriginalFallbackDialog
		copy={localizedCopy}
		onCancel={() => setFallbackImport(null)}
		onConfirm={() => {
			const request = fallbackImport;
			setFallbackImport(null);
			executeImport({ ...request, variant: 'preview-hq-ogg' });
		}}
	/> : null}</>;
}

export function toFreesoundPanelResult(sound: FreesoundSound): FreesoundResultPresentation {
	return Object.freeze({
		soundId: sound.id,
		name: sound.name,
		username: sound.creator.username,
		userUrl: sound.creator.pageUrl,
		soundUrl: sound.pageUrl,
		licenseName: sound.license.name,
		licenseCode: sound.license.code,
		licenseUrl: sound.license.url,
		durationSeconds: sound.durationSeconds,
		durationLabel: durationLabel(sound.durationSeconds),
		previewAvailable: sound.preview.available,
		waveformUrl: sound.waveform.available && sound.waveform.url
			? freesoundWaveformUrl(sound.id, sound.waveform.url) : null,
	});
}

function selectedAudioTrack(snapshot: Readonly<Record<string, unknown>>): Readonly<{ trackId?: string }> {
	const selectedTrackId = typeof snapshot.selectedTrackId === 'string' ? snapshot.selectedTrackId : null;
	const project = dataRecord(snapshot.project);
	const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
	return tracks.some((track) => {
		const candidate = dataRecord(track);
		return candidate?.id === selectedTrackId && candidate.type === 'audio';
	}) && selectedTrackId ? { trackId: selectedTrackId } : {};
}

function currentPlayheadFrame(controller: FreesoundPanelController): number {
	const value = controller.engine?.getPositionFrames?.() ?? 0;
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function durationLabel(value: number): string {
	const seconds = Math.max(0, Math.round(value));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function projectClipTitle(snapshot: Readonly<Record<string, unknown>>, clipId: string): string | undefined {
	const project = dataRecord(snapshot.project);
	const clips = Array.isArray(project?.clips) ? project.clips : [];
	const clip = clips.map(dataRecord).find((candidate) => candidate?.id === clipId);
	return typeof clip?.title === 'string' && clip.title.trim() ? clip.title : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function seekPreviewTime(active: ActiveFreesoundPreview, seconds: number): void {
	const normalized = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
	active.pendingSeekSeconds = normalized;
	if (setPreviewTime(active.audio, normalized) && active.metadataLoaded) active.pendingSeekSeconds = null;
}

function setPreviewTime(audio: HTMLAudioElement, seconds: number): boolean {
	try {
		audio.currentTime = seconds;
		return true;
	} catch {
		return false;
	}
}

export default FreesoundPanelContainer;
