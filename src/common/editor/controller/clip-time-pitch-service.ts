/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	clipNeedsTimePitchRender as legacyClipNeedsTimePitchRender,
} from '../clip-time-pitch-cache.js';
import { throwIfAborted } from './app-helpers.ts';
import type { AudioBufferLike } from './source-audio.ts';
import type {
	ClipTransformClip,
	ClipTransformProject,
	ClipTransformSource,
} from './clip-domain-types.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
} from './lifecycle.ts';

export interface ClipTimePitchCacheEntry extends Readonly<Record<string, unknown>> {
	readonly cacheKey: string;
	readonly sampleRate: number;
	readonly channels?: Float32Array[];
	readonly audioBuffer?: AudioBufferLike;
	readonly stale?: boolean;
	readonly pending?: Promise<ClipTimePitchCacheEntry>;
}

export interface ClipTimePitchCachePort {
	retainClipIds?(clipIds: readonly string[]): void;
	prepareCommittedOutput(
		clip: ClipTransformClip,
		source: ClipTransformSource,
		options?: Readonly<{ signal?: AbortSignal | null }>,
	): Promise<ClipTimePitchCacheEntry>;
	resolveForPlayback(
		clip: ClipTransformClip,
		source: ClipTransformSource,
		options?: Readonly<{ signal?: AbortSignal | null }>,
	): Promise<ClipTimePitchCacheEntry>;
	getCommitted?(cacheKey: string): ClipTimePitchCacheEntry | undefined;
	loadCommittedChannels(
		entry: ClipTimePitchCacheEntry,
		options?: Readonly<{ signal?: AbortSignal | null }>,
	): Promise<Float32Array[]>;
	attachAudioBuffer?(cacheKey: string, buffer: AudioBufferLike): void;
}

export interface ClipTimePitchPlaybackState {
	playbackCacheGeneration: number;
	playbackCacheAbort: AbortController | null;
	recordingStarting: boolean;
	recorder: unknown;
}

export interface ClipTimePitchRenderEngine {
	setSourceResolver?(resolver: unknown): void;
	setChunkSources?(sources: ReadonlyMap<string, unknown>): void;
	dispose(): PromiseLike<void> | void;
}

export interface ClipTimePitchPair {
	readonly clip: ClipTransformClip;
	readonly source: ClipTransformSource;
}

export interface ClipTimePitchCacheServiceDependencies<
	RenderEngine extends ClipTimePitchRenderEngine = ClipTimePitchRenderEngine,
> {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly state: ClipTimePitchPlaybackState;
	readonly cache: ClipTimePitchCachePort;
	readonly sourceResolver: unknown;
	readonly sourceChunkProviders: ReadonlyMap<string, unknown>;
	getProject(): ClipTransformProject;
	captureProject(projectId: string): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createBufferFromChannels(
		channels: readonly Float32Array[],
		sampleRate: number,
	): Promise<AudioBufferLike>;
	createRenderEngine(options: Readonly<{ sourceResolver: unknown }>): RenderEngine;
	applyProjectToPlaybackEngine(project: ClipTransformProject): Promise<unknown>;
	getPlaybackState(): string;
	handleError(error: unknown): void;
}

export interface ClipTimePitchCacheService<
	RenderEngine extends ClipTimePitchRenderEngine = ClipTimePitchRenderEngine,
> {
	projectTimePitchPairs(project: ClipTransformProject | null | undefined): readonly ClipTimePitchPair[];
	projectHasTimePitchClips(project: ClipTransformProject | null | undefined): boolean;
	createCacheAwareRenderEngine(): RenderEngine;
	disposeRenderEngines(): Promise<void>;
	materializeTimePitchCacheEntry(
		entry: ClipTimePitchCacheEntry,
		signal?: AbortSignal | null,
	): Promise<ClipTimePitchCacheEntry>;
	prepareCommittedTimePitchCaches(
		project: ClipTransformProject,
		signal?: AbortSignal | null,
	): Promise<readonly ClipTimePitchCacheEntry[]>;
	preparePlaybackTimePitchCaches(
		project: ClipTransformProject,
		signal: AbortSignal,
	): Promise<readonly Promise<ClipTimePitchCacheEntry>[]>;
	beginPlaybackCachePreparation(
		project: ClipTransformProject,
		options?: Readonly<{ abortController?: AbortController | null }>,
	): Promise<readonly Promise<ClipTimePitchCacheEntry>[]>;
	cancelPlaybackCachePreparation(): boolean;
}

export function createClipTimePitchCacheService<
	RenderEngine extends ClipTimePitchRenderEngine = ClipTimePitchRenderEngine,
>(
	dependencies: ClipTimePitchCacheServiceDependencies<RenderEngine>,
): Readonly<ClipTimePitchCacheService<RenderEngine>> {
	const renderEngines = new Set<RenderEngine>();
	return Object.freeze({
		projectTimePitchPairs,
		projectHasTimePitchClips,
		createCacheAwareRenderEngine,
		disposeRenderEngines,
		materializeTimePitchCacheEntry,
		prepareCommittedTimePitchCaches,
		preparePlaybackTimePitchCaches,
		beginPlaybackCachePreparation,
		cancelPlaybackCachePreparation,
	});

	function projectTimePitchPairs(
		snapshot: ClipTransformProject | null | undefined,
	): readonly ClipTimePitchPair[] {
		if (!snapshot || snapshot.schemaVersion < 2) return Object.freeze([]);
		const pairs: ClipTimePitchPair[] = [];
		for (const clip of snapshot.clips) {
			if (clip.kind === 'video' || !clipNeedsTimePitchRender(clip)) continue;
			const source = findSource(snapshot, clip.sourceId);
			if (source) pairs.push(Object.freeze({ clip, source }));
		}
		return Object.freeze(pairs);
	}

	function projectHasTimePitchClips(
		snapshot: ClipTransformProject | null | undefined,
	): boolean {
		return projectTimePitchPairs(snapshot).length > 0;
	}

	function createCacheAwareRenderEngine(): RenderEngine {
		dependencies.lifetime.assertActive();
		const renderEngine = dependencies.createRenderEngine({
			sourceResolver: dependencies.sourceResolver,
		});
		const disposeEngine = renderEngine.dispose.bind(renderEngine);
		let disposal: Promise<void> | null = null;
		renderEngine.dispose = () => {
			if (!disposal) {
				try {
					disposal = Promise.resolve(disposeEngine());
				} catch (error) {
					disposal = Promise.reject(error);
				}
				void disposal.then(
					() => { renderEngines.delete(renderEngine); },
					() => {},
				);
			}
			return disposal;
		};
		renderEngines.add(renderEngine);
		renderEngine.setSourceResolver?.(dependencies.sourceResolver);
		renderEngine.setChunkSources?.(dependencies.sourceChunkProviders);
		return renderEngine;
	}

	async function disposeRenderEngines(): Promise<void> {
		const results = await Promise.allSettled(
			Array.from(renderEngines, async (renderEngine) => {
				await renderEngine.dispose();
			}),
		);
		const failures = results.flatMap((result) => (
			result.status === 'rejected' ? [result.reason as unknown] : []
		));
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Render-engine cleanup failed');
		}
	}

	async function materializeTimePitchCacheEntry(
		entry: ClipTimePitchCacheEntry,
		signal: AbortSignal | null = null,
	): Promise<ClipTimePitchCacheEntry> {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const projectToken = dependencies.captureProject(project.id);
		return materializeOwned(entry, signal, projectToken);
	}

	async function materializeOwned(
		entry: ClipTimePitchCacheEntry,
		signal: AbortSignal | null,
		projectToken: EditorProjectToken,
	): Promise<ClipTimePitchCacheEntry> {
		assertOwned(projectToken, signal);
		const committed = dependencies.cache.getCommitted?.(entry.cacheKey) ?? entry;
		if (committed.audioBuffer) return committed;
		const channels = committed.channels ?? await dependencies.cache.loadCommittedChannels(
			committed,
			{ signal },
		);
		assertOwned(projectToken, signal);
		const buffer = await dependencies.createBufferFromChannels(channels, committed.sampleRate);
		assertOwned(projectToken, signal);
		dependencies.cache.attachAudioBuffer?.(committed.cacheKey, buffer);
		return dependencies.cache.getCommitted?.(committed.cacheKey) ?? {
			...committed,
			audioBuffer: buffer,
		};
	}

	async function prepareCommittedTimePitchCaches(
		snapshot: ClipTransformProject,
		signal: AbortSignal | null = null,
	): Promise<readonly ClipTimePitchCacheEntry[]> {
		dependencies.lifetime.assertActive();
		const projectToken = dependencies.captureProject(snapshot.id);
		dependencies.cache.retainClipIds?.(snapshot.clips.map((clip) => clip.id));
		const entries: ClipTimePitchCacheEntry[] = [];
		for (const { clip, source } of projectTimePitchPairs(snapshot)) {
			assertOwned(projectToken, signal);
			const entry = await dependencies.cache.prepareCommittedOutput(clip, source, { signal });
			assertOwned(projectToken, signal);
			entries.push(await materializeOwned(entry, signal, projectToken));
		}
		return Object.freeze(entries);
	}

	async function preparePlaybackTimePitchCaches(
		snapshot: ClipTransformProject,
		signal: AbortSignal,
	): Promise<readonly Promise<ClipTimePitchCacheEntry>[]> {
		dependencies.lifetime.assertActive();
		const projectToken = dependencies.captureProject(snapshot.id);
		return preparePlaybackOwned(snapshot, signal, projectToken);
	}

	async function preparePlaybackOwned(
		snapshot: ClipTransformProject,
		signal: AbortSignal,
		projectToken: EditorProjectToken,
	): Promise<readonly Promise<ClipTimePitchCacheEntry>[]> {
		dependencies.cache.retainClipIds?.(snapshot.clips.map((clip) => clip.id));
		const refreshes: Promise<ClipTimePitchCacheEntry>[] = [];
		for (const { clip, source } of projectTimePitchPairs(snapshot)) {
			assertOwned(projectToken, signal);
			const resolved = await dependencies.cache.resolveForPlayback(clip, source, { signal });
			assertOwned(projectToken, signal);
			await materializeOwned(resolved, signal, projectToken);
			if (resolved.stale && resolved.pending) {
				refreshes.push(resolved.pending.then((entry) => (
					materializeOwned(entry, signal, projectToken)
				)));
			}
		}
		return Object.freeze(refreshes);
	}

	async function beginPlaybackCachePreparation(
		snapshot: ClipTransformProject,
		options: Readonly<{ abortController?: AbortController | null }> = {},
	): Promise<readonly Promise<ClipTimePitchCacheEntry>[]> {
		dependencies.lifetime.assertActive();
		cancelPlaybackCachePreparation();
		const abort = options.abortController ?? new AbortController();
		const generation = ++dependencies.state.playbackCacheGeneration;
		const projectToken = dependencies.captureProject(snapshot.id);
		dependencies.state.playbackCacheAbort = abort;
		let refreshes: readonly Promise<ClipTimePitchCacheEntry>[] = [];
		let background = false;
		try {
			refreshes = await preparePlaybackOwned(snapshot, abort.signal, projectToken);
			assertOwned(projectToken, abort.signal);
			if (refreshes.length) {
				background = true;
				void Promise.all(refreshes)
					.then(async () => {
						assertPreparationOwned(snapshot, projectToken, generation, abort.signal);
						if (!dependencies.state.recorder
							&& !dependencies.state.recordingStarting
							&& dependencies.getPlaybackState() === 'playing') {
							await dependencies.applyProjectToPlaybackEngine(dependencies.getProject());
							assertPreparationOwned(snapshot, projectToken, generation, abort.signal);
						}
					})
					.catch(handlePlaybackCacheError)
					.finally(() => {
						if (generation === dependencies.state.playbackCacheGeneration) {
							dependencies.state.playbackCacheAbort = null;
						}
					});
			}
			return refreshes;
		} finally {
			if (!background && generation === dependencies.state.playbackCacheGeneration) {
				dependencies.state.playbackCacheAbort = null;
			}
		}
	}

	function cancelPlaybackCachePreparation(): boolean {
		dependencies.state.playbackCacheGeneration += 1;
		const active = dependencies.state.playbackCacheAbort;
		active?.abort(new DOMException('Playback cache preparation was cancelled.', 'AbortError'));
		dependencies.state.playbackCacheAbort = null;
		return active !== null;
	}

	function assertOwned(projectToken: EditorProjectToken, signal: AbortSignal | null): void {
		throwIfAborted(signal);
		dependencies.lifetime.assertActive();
		dependencies.assertProject(projectToken);
	}

	function assertPreparationOwned(
		snapshot: ClipTransformProject,
		projectToken: EditorProjectToken,
		generation: number,
		signal: AbortSignal,
	): void {
		assertOwned(projectToken, signal);
		if (generation !== dependencies.state.playbackCacheGeneration
			|| dependencies.getProject() !== snapshot) {
			throw new DOMException('Playback cache preparation was superseded.', 'AbortError');
		}
	}

	function handlePlaybackCacheError(error: unknown): void {
		if (!isAbortError(error)) dependencies.handleError(error);
	}
}

function findSource(project: ClipTransformProject, sourceId: string): ClipTransformSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}

function clipNeedsTimePitchRender(clip: ClipTransformClip): boolean {
	return (legacyClipNeedsTimePitchRender as (clip: ClipTransformClip) => boolean)(clip);
}

function isAbortError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
