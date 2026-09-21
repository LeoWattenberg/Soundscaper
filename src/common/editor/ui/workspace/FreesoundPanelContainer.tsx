/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { freesoundAttributionCopy } from '../../../i18n/freesound-attribution-copy.js';
import FreesoundPanel, {
	type FreesoundPanelState,
	type FreesoundResultPresentation,
	type FreesoundSearchRequest,
} from './FreesoundPanel.tsx';

interface ServiceSearchRequest extends FreesoundSearchRequest {
	readonly signal?: AbortSignal;
}

interface FreesoundSearchPage {
	readonly query: string;
	readonly page: number;
	readonly totalCount: number;
	readonly totalPages: number;
	readonly results: readonly FreesoundSound[];
}

interface FreesoundSound {
	readonly id: number;
	readonly name: string;
	readonly creator: Readonly<{ readonly username: string; readonly pageUrl: string }>;
	readonly pageUrl: string;
	readonly license: Readonly<{ readonly name: string; readonly url: string }>;
	readonly durationSeconds: number;
	readonly preview: Readonly<{ readonly available: boolean }>;
}

interface FreesoundImportRequest {
	readonly soundId: number;
	readonly destination: 'timeline' | 'project-bin';
	readonly trackId?: string;
	readonly timelineStartFrame?: number;
}

interface FreesoundActions {
	search(request: ServiceSearchRequest): Promise<FreesoundSearchPage>;
	importSound(request: FreesoundImportRequest): Promise<unknown>;
	previewUrl(soundId: number): string;
}

interface FreesoundPanelController {
	readonly actions: Readonly<{ readonly freesound?: FreesoundActions }>;
	readonly engine?: Readonly<{ getPositionFrames?: () => number }>;
}

interface FreesoundPanelContainerProps {
	readonly controller: FreesoundPanelController;
	readonly snapshot: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	readonly panelActive?: boolean;
}

const INITIAL_STATE: FreesoundPanelState = Object.freeze({
	query: '', license: 'all', sort: 'relevance', page: 1, pageCount: 0,
	totalResults: 0, status: 'idle', previewingSoundId: null, results: Object.freeze([]),
});

export function FreesoundPanelContainer({
	controller,
	snapshot,
	copy,
	disabled = false,
	panelActive = true,
}: FreesoundPanelContainerProps) {
	const actions = controller.actions.freesound;
	const localizedCopy = useMemo(() => Object.freeze({
		...copy,
		...freesoundAttributionCopy(snapshot.locale, copy),
	}), [copy, snapshot.locale]);
	const [state, setState] = useState<FreesoundPanelState>(INITIAL_STATE);
	const [pendingSoundId, setPendingSoundId] = useState<number | null>(null);
	const searchSequence = useRef(0);
	const searchAbort = useRef<AbortController | null>(null);
	const preview = useRef<HTMLAudioElement | null>(null);

	const stopPreview = useCallback(() => {
		const audio = preview.current;
		preview.current = null;
		if (audio) {
			audio.pause();
			audio.src = '';
			audio.load();
		}
		setState((current) => ({ ...current, previewingSoundId: null }));
	}, []);

	useEffect(() => {
		if (!panelActive) stopPreview();
	}, [panelActive, stopPreview]);

	useEffect(() => () => {
		searchAbort.current?.abort();
		const audio = preview.current;
		preview.current = null;
		if (audio) {
			audio.pause();
			audio.src = '';
		}
	}, []);

	const search = useCallback((request: FreesoundSearchRequest) => {
		if (!actions) return;
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
				results: page.results.map(toFreesoundPanelResult),
			});
		}).catch((error: unknown) => {
			if (searchSequence.current !== sequence || abort.signal.aborted) return;
			setState((current) => ({
				...current, status: 'error', errorMessage: errorMessage(error, localizedCopy.searchError),
			}));
		});
	}, [actions, localizedCopy.searchError, stopPreview]);

	const startPreview = useCallback((soundId: number) => {
		if (!panelActive || !actions || typeof Audio !== 'function') return;
		stopPreview();
		const audio = new Audio(actions.previewUrl(soundId));
		preview.current = audio;
		const finish = () => { if (preview.current === audio) stopPreview(); };
		audio.preload = 'metadata';
		audio.addEventListener('ended', finish, { once: true });
		audio.addEventListener('error', finish, { once: true });
		setState((current) => ({ ...current, previewingSoundId: soundId }));
		void audio.play().catch(finish);
	}, [actions, panelActive, stopPreview]);

	const importSound = useCallback((soundId: number, destination: 'timeline' | 'project-bin') => {
		if (!actions || pendingSoundId !== null) return;
		setPendingSoundId(soundId);
		const request: FreesoundImportRequest = {
			soundId,
			destination,
			...(destination === 'timeline' ? {
				timelineStartFrame: currentPlayheadFrame(controller),
				...selectedAudioTrack(snapshot),
			} : {}),
		};
		void actions.importSound(request).catch((error: unknown) => {
			setState((current) => ({
				...current, status: 'error', errorMessage: errorMessage(error, localizedCopy.importError),
			}));
		}).finally(() => setPendingSoundId(null));
	}, [actions, controller, localizedCopy.importError, pendingSoundId, snapshot]);

	const presentationState = useMemo<FreesoundPanelState>(() => ({
		...state,
		results: state.results.map((result) => ({
			...result, actionPending: pendingSoundId === result.soundId,
		})),
	}), [pendingSoundId, state]);

	if (!actions) return <p className="kw-audio-editor__panel-empty">{localizedCopy.unavailable}</p>;
	return <FreesoundPanel
		copy={localizedCopy}
		state={presentationState}
		disabled={disabled || pendingSoundId !== null}
		onSearch={search}
		onPreview={startPreview}
		onStopPreview={stopPreview}
		onInsertAtPlayhead={(soundId) => importSound(soundId, 'timeline')}
		onAddToProjectBin={(soundId) => importSound(soundId, 'project-bin')}
	/>;
}

export function toFreesoundPanelResult(sound: FreesoundSound): FreesoundResultPresentation {
	return Object.freeze({
		soundId: sound.id,
		name: sound.name,
		username: sound.creator.username,
		userUrl: sound.creator.pageUrl,
		soundUrl: sound.pageUrl,
		licenseName: sound.license.name,
		licenseUrl: sound.license.url,
		durationLabel: durationLabel(sound.durationSeconds),
		previewAvailable: sound.preview.available,
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

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export default FreesoundPanelContainer;
