/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioTrackFreezeCoordinatorV21,
	type AudioTrackFreezeCoordinatorCommandV21,
} from '../common/editor/audio-track-freeze-coordinator-v21.ts';
import {
	assertCurrentSoundscaperFreezeProject,
	soundscaperFreezeRenderFingerprint,
} from './editor-audio-track-freeze-currency.ts';
import { createAudioEditorEngine } from '../common/editor/engine/runtime-class.ts';
import { createAudioClip } from '../common/editor/project-media-factory.ts';
import { validateSoundscaperProject, type SoundscaperProject } from './editor-project-validation.ts';
import {
	hashFreezeBody, planFreezeRange, renderFreezeBody, stageFreezeSource,
	type FreezeBody, type FreezeStage, type FreezeStore, type SoundscaperAudioFreezeRenderEngine,
} from './editor-audio-track-freeze-render.ts';
import {
	dataArray, dataRecord, exactRecordById, nonNegativeInteger, positiveInteger,
	stableId, throwIfAborted, type DataRecord,
} from './editor-audio-track-freeze-values.ts';
export type { SoundscaperAudioFreezeRenderEngine } from './editor-audio-track-freeze-render.ts';
import type {
	SoundscaperAudioTrackFreezePlaybackService,
	SoundscaperAudioTrackFreezeStatus,
} from './editor-audio-track-freeze-playback.ts';

export interface SoundscaperAudioFreezeEnvironment {
	readonly store: FreezeStore;
	readonly playback: SoundscaperAudioTrackFreezePlaybackService;
}

export interface SoundscaperAudioFreezeController {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{
			readonly commit: (command: AudioTrackFreezeCoordinatorCommandV21) => unknown;
		}>;
	}>;
}

export interface SoundscaperAudioFreezeActions {
	readonly freeze: (trackId: string) => Promise<unknown>;
	readonly refresh: (trackId: string) => Promise<unknown>;
	readonly unfreeze: (trackId: string) => Promise<unknown>;
	readonly commit: (trackId: string) => Promise<unknown>;
	readonly getStatus: (trackId: string) => SoundscaperAudioTrackFreezeStatus | 'verifying';
}

export interface SoundscaperAudioFreezeActionBinding {
	readonly actions: Readonly<SoundscaperAudioFreezeActions>;
	readonly dispose: () => Promise<void>;
}

export interface SoundscaperAudioFreezeActionsOptions {
	/**
	 * The document validator for the revision these actions serve. Later
	 * production revisions inherit this file unchanged, so the revision is a
	 * parameter rather than something the file names.
	 */
	readonly validateProject?: (project: unknown) => unknown;
	/** Lower-only deterministic test seam. */
	readonly createId?: (kind: 'source' | 'clip') => string;
	/** Lower-only renderer test seam. */
	readonly createRenderEngine?: () => SoundscaperAudioFreezeRenderEngine;
	/** Product-owned live state must be captured before the immutable freeze ticket. */
	readonly prepareProject?: () => PromiseLike<void> | void;
}

interface ProjectTicket {
	readonly project: SoundscaperProject;
	readonly trackId: string;
	/** What the render reads, so an unrelated edit does not discard the freeze. */
	readonly fingerprint: string;
}

/** Bind the generic freeze transaction to browser rendering, PCM storage, and controller CAS. */
export function createSoundscaperAudioFreezeActions(
	environment: SoundscaperAudioFreezeEnvironment,
	controller: SoundscaperAudioFreezeController,
	options: SoundscaperAudioFreezeActionsOptions = {},
): Readonly<SoundscaperAudioFreezeActionBinding> {
	assertDependencies(environment, controller, options);
	const validateProject = options.validateProject ?? validateSoundscaperProject;
	const createId = options.createId ?? defaultId;
	const createRenderEngine = options.createRenderEngine ?? createAudioEditorEngine;
	const coordinator = createAudioTrackFreezeCoordinatorV21<
		SoundscaperProject, ProjectTicket, FreezeBody, FreezeStage
	>({
		controller: {
			capture: ({ trackId, signal }) => {
				throwIfAborted(signal);
				const project = exactCurrentProject(controller, validateProject);
				const track = exactRecordById(project.tracks, trackId, 'audio freeze track');
				if (track.type !== 'audio') throw new RangeError(`Track ${trackId} is not audio.`);
				if (track.locked === true) throw new Error(`Audio track ${trackId} is locked.`);
				assertNoSidechainIntoRack(project, track, trackId);
				return Object.freeze({
					project,
					ticket: Object.freeze({
						project, trackId, fingerprint: soundscaperFreezeRenderFingerprint(project, trackId),
					}),
				});
			},
			assertCurrent: (ticket) => assertCurrent(controller, ticket),
			executeIfCurrent: (ticket, command, { signal }) => {
				throwIfAborted(signal);
			assertCurrent(controller, ticket);
			const result = controller.actions.edit.commit(command);
			const current = exactCurrentProject(controller, validateProject);
			if (result !== current) throw new Error('Audio freeze command did not publish the current project.');
			return current;
			},
		},
		planRenderRange: ({ project, trackId }) => planFreezeRange(project, trackId),
		allocateDerivedSourceId: () => stableId(createId('source'), 'audio freeze derived source'),
		hashSourceContent: ({ project, source, signal }) => environment.playback.hashSourceContent(
			project.id, source, signal,
		),
		render: async (request) => renderFreezeBody(
			environment.store, controller, createRenderEngine, request,
		),
		hashRenderedBody: ({ body, signal }) => Promise.resolve(hashFreezeBody(body, signal)),
		stageDerivedSource: async (request) => stageFreezeSource(environment.store, request),
		verifyStagedSource: async ({ stage, sourceId, contentSha256, signal }) => {
			throwIfAborted(signal);
			if (stage.sourceId !== sourceId || stage.contentSha256 !== contentSha256
				|| stage.writer.framesWritten !== Number(stage.descriptor.frameCount)) {
				throw new Error('The staged freeze source failed exact geometry verification.');
			}
			return stage.descriptor;
		},
		admitVerifiedFreeze: (request) => environment.playback.admitVerifiedFreeze(request),
		publishStagedSource: async ({ stage, signal }) => {
			const authority = await stage.writer.commit({
				contentSha256: stage.contentSha256,
				frameCount: stage.descriptor.frameCount,
				channelCount: stage.descriptor.channelCount,
				sampleRate: stage.descriptor.sampleRate,
				chunkFrames: stage.descriptor.chunkFrames,
			}, { signal, ifAbsent: true });
			stage.authority = authority;
			const actual = await environment.playback.hashSourceContent(
				`freeze-stage:${stage.sourceId}`, stage.descriptor, signal,
			);
			if (actual !== stage.contentSha256) throw new Error('Published freeze PCM failed content verification.');
		},
		rollbackStagedSource: async ({ stage }) => {
			if (stage.authority === null) {
				await stage.writer.abort();
				return;
			}
			if (!await environment.store.discardSourceIfCurrent(stage.authority)) {
				throw new Error(`Published freeze source ${stage.sourceId} changed before rollback.`);
			}
		},
	});
	let active: Readonly<{ trackId: string; abort: AbortController; promise: Promise<unknown> }> | null = null;
	let disposed = false;
	const run = (trackId: string, operation: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> => {
		if (disposed) return Promise.reject(new Error('Soundscaper audio freeze actions are disposed.'));
		const previous = active;
		previous?.abort.abort(new DOMException('A newer audio freeze operation replaced this task.', 'AbortError'));
		const abort = new AbortController();
		const promise = (async () => {
			if (previous) await previous.promise.catch(() => undefined);
			throwIfAborted(abort.signal);
			return operation(abort.signal);
		})();
		const entry = Object.freeze({ trackId, abort, promise });
		active = entry;
		void promise.finally(() => { if (active === entry) active = null; }).catch(() => undefined);
		return promise;
	};
	const freeze = (trackId: string) => run(trackId, async (signal) => {
		await options.prepareProject?.();
		throwIfAborted(signal);
		return coordinator.freeze({ trackId, signal });
	});
	const actions = Object.freeze({
		freeze,
		refresh: freeze,
		unfreeze: (trackId: string) => run(trackId, (signal) => coordinator.unfreeze({ trackId, signal })),
		commit: (trackId: string) => run(trackId, (signal) => {
			const project = exactCurrentProject(controller, validateProject);
			const track = exactRecordById(project.tracks, trackId, 'committed frozen track');
			const freezeValue = dataRecord(track.audioFreeze, 'committed audio freeze');
			return coordinator.commit({
				trackId,
				derivedClip: committedFreezeClip(
					stableId(createId('clip'), 'committed freeze clip'), freezeValue,
				),
				signal,
			});
		}),
		getStatus: (trackId: string): SoundscaperAudioTrackFreezeStatus | 'verifying' => {
			if (active?.trackId === trackId) return 'verifying';
			if (disposed || !controller.project || typeof controller.project !== 'object') return 'unknown';
			return environment.playback.getFreezeStatus(controller.project, trackId);
		},
	});
	return Object.freeze({
		actions,
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			const pending = active;
			pending?.abort.abort(new DOMException('Audio freeze actions were disposed.', 'AbortError'));
			await pending?.promise.catch((error: unknown) => { if (!(error instanceof Error) || error.name !== 'AbortError') throw error; });
		},
	});
}

/**
 * Refuse to bake a rack another strip is keying.
 *
 * The freeze renders the track alone, through a graph built for it, so an
 * authored sidechain edge feeding an effect in its rack does not exist during
 * that render. The dynamics worklet then keys itself from its own input, and
 * what gets baked is a self-keyed limiter or gate — audibly not what plays.
 * Rendering the key track alongside would mean pulling its media, its identity,
 * and its own staleness into the freeze, so until that exists this refuses
 * rather than committing a render that disagrees with playback.
 */
function assertNoSidechainIntoRack(
	project: SoundscaperProject,
	track: DataRecord,
	trackId: string,
): void {
	const effectIds = new Set(dataArray(track.effects, 'audio freeze track.effects').map(({ id }) => String(id)));
	if (effectIds.size === 0) return;
	const edges = dataArray(
		dataRecord((project as unknown as DataRecord).mixer, 'project.mixer').edges,
		'project.mixer.edges',
	);
	for (const edge of edges) {
		if (edge.enabled === false) continue;
		const destination = edge.destination as DataRecord | undefined;
		if (destination?.kind !== 'effect-sidechain') continue;
		const strip = destination.strip as DataRecord | undefined;
		if (strip?.kind !== 'track' || String(strip.id) !== trackId) continue;
		if (!effectIds.has(String(destination.effectId))) continue;
		throw new Error(
			`Audio track ${trackId} has an effect keyed by a sidechain, which a freeze cannot render.`,
		);
	}
}

function committedFreezeClip(id: string, freeze: DataRecord): DataRecord {
	const sourceId = stableId(freeze.derivedSourceId, 'committed freeze source');
	const start = nonNegativeInteger(freeze.renderStartFrame, 'committed freeze start');
	const frames = positiveInteger(freeze.renderFrameCount, 'committed freeze frame count');
	return Object.freeze(createAudioClip({
		id, sourceId, title: 'Committed frozen track', anchor: 'sample',
		timelineStartFrame: start, durationFrames: frames,
		sourceStartFrame: 0, sourceDurationFrames: frames,
		trimStartFrames: 0, trimEndFrames: 0, gain: 1,
		fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], pitchCents: 0, speedRatio: 1,
	}));
}

function exactCurrentProject(
	controller: SoundscaperAudioFreezeController,
	validateProject: (project: unknown) => unknown = validateSoundscaperProject,
): SoundscaperProject {
	// Injected for the same reason as the automation target resolver: later
	// production revisions inherit this file, and only the validator differs.
	if (!validateProject(controller.project)) throw new TypeError('An exact Soundscaper production project must be open.');
	return controller.project as SoundscaperProject;
}

function assertCurrent(controller: SoundscaperAudioFreezeController, ticket: ProjectTicket): void {
	assertCurrentSoundscaperFreezeProject(controller, ticket);
}

function assertDependencies(
	environment: SoundscaperAudioFreezeEnvironment,
	controller: SoundscaperAudioFreezeController,
	options: SoundscaperAudioFreezeActionsOptions,
): void {
	if (!environment?.store || typeof environment.store.beginSourceWrite !== 'function'
		|| typeof environment.store.discardSourceIfCurrent !== 'function'
		|| typeof environment.playback?.hashSourceContent !== 'function'
		|| typeof environment.playback.admitVerifiedFreeze !== 'function') {
		throw new TypeError('The exact Soundscaper freeze environment is required.');
	}
	if (!controller?.actions?.edit || typeof controller.actions.edit.commit !== 'function') {
		throw new TypeError('The exact Soundscaper freeze controller is required.');
	}
	if (options.createId !== undefined && typeof options.createId !== 'function') throw new TypeError('Freeze createId must be a function.');
	if (options.createRenderEngine !== undefined && typeof options.createRenderEngine !== 'function') {
		throw new TypeError('Freeze createRenderEngine must be a function.');
	}
}

function defaultId(kind: 'source' | 'clip'): string {
	if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Secure freeze ID allocation is unavailable.');
	return `soundscaper-audio-freeze-${kind}-${globalThis.crypto.randomUUID()}`;
}
