/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioClipV6,
	createAudioEditorProjectV6,
	createAudioTrackV6,
} from '../project-v6.ts';
import type { AudioEditorProjectV17 } from '../project-v17.ts';
import type { TakeCompDocumentGroup, TakeCompDocumentTake } from '../take-comp-document-v17.ts';
import type { EngineChunkSourceInput, EngineSourceBufferInput } from '../engine/public-api.ts';
import type { EngineProject, EngineSourceResolver } from '../engine/types.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
} from './lifecycle.ts';
import type {
	TakeCompService,
	TakeLaneAuditionPlan,
} from './take-comp-service.ts';

const TAKE_COMP_PREVIEW_TASK = 'take-comp-preview';

export interface TakeCompPreviewEngine {
	loadProject(
		project: EngineProject,
		sourceBuffers?: EngineSourceBufferInput,
		options?: Readonly<{ readonly chunkSources?: EngineChunkSourceInput }>,
	): unknown;
	setSourceResolver?(resolver?: EngineSourceResolver | null): unknown;
	play(): Promise<void>;
	pause(): void;
	stop?(): void;
	dispose?(): Promise<void> | void;
}

export interface TakeCompPreviewDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly service: Pick<TakeCompService, 'auditionTake' | 'auditionLane'>;
	readonly sourceBuffers: EngineSourceBufferInput;
	readonly sourceChunkProviders: EngineChunkSourceInput;
	readonly sourceResolver?: EngineSourceResolver | null;
	createPreviewEngine(options: Readonly<{ onState(state: string): void }>): TakeCompPreviewEngine;
	createId(prefix: string): string;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getProject(): AudioEditorProjectV17;
	stopPlayback(): void;
}

export interface TakeCompPreviewService {
	auditionTake(groupId: string, takeId: string): Promise<Readonly<TakeCompPreviewState>>;
	auditionLane(groupId: string, laneId: string): Promise<Readonly<TakeCompPreviewState>>;
	stop(): Promise<boolean>;
	dispose(): Promise<void>;
}

export interface TakeCompPreviewState {
	readonly key: string;
	readonly groupId: string;
	readonly laneId: string;
	readonly takeIds: readonly string[];
	readonly state: 'playing' | 'paused' | 'stopped';
}

/** Audition take media through an isolated engine without mutating the document. */
export function createTakeCompPreviewService(
	dependencies: TakeCompPreviewDependencies,
): Readonly<TakeCompPreviewService> {
	let engine: TakeCompPreviewEngine | null = null;
	let active: Readonly<TakeCompPreviewState> | null = null;

	return Object.freeze({ auditionTake, auditionLane, stop, dispose });

	async function auditionTake(groupId: string, takeId: string): Promise<Readonly<TakeCompPreviewState>> {
		const plan = dependencies.service.auditionTake(groupId, takeId);
		return startPreview(plan.groupId, plan.laneId, [plan.takeId], `take:${plan.groupId}:${plan.takeId}`);
	}

	async function auditionLane(groupId: string, laneId: string): Promise<Readonly<TakeCompPreviewState>> {
		const plan: TakeLaneAuditionPlan = dependencies.service.auditionLane(groupId, laneId);
		return startPreview(
			plan.groupId,
			plan.laneId,
			plan.takes.map(({ takeId }) => takeId),
			`lane:${plan.groupId}:${plan.laneId}`,
		);
	}

	async function startPreview(
		groupId: string,
		laneId: string,
		takeIds: readonly string[],
		key: string,
	): Promise<Readonly<TakeCompPreviewState>> {
		dependencies.lifetime.assertActive();
		if (active?.key === key && active.state !== 'stopped') return toggleActive();
		await stop();
		const token = dependencies.captureProject();
		const project = dependencies.getProject();
		const group = requireGroup(project, groupId);
		const selectedTakes = takeIds.map((takeId) => requireTake(group, takeId));
		const task = dependencies.lifetime.startTask(TAKE_COMP_PREVIEW_TASK);
		try {
			dependencies.stopPlayback();
			engine ??= dependencies.createPreviewEngine({ onState: handleEngineState });
			engine.setSourceResolver?.(dependencies.sourceResolver);
			engine.loadProject(previewProject(project, group, selectedTakes, dependencies.createId), dependencies.sourceBuffers, {
				chunkSources: dependencies.sourceChunkProviders,
			});
			active = Object.freeze({
				key, groupId, laneId,
				takeIds: Object.freeze([...takeIds]),
				state: 'playing' as const,
			});
			await engine.play();
			task.assertCurrent();
			dependencies.assertProject(token);
			return active;
		} finally {
			task.finish();
		}
	}

	async function toggleActive(): Promise<Readonly<TakeCompPreviewState>> {
		const current = active!;
		if (current.state === 'playing') {
			engine?.pause();
			active = Object.freeze({ ...current, state: 'paused' as const });
			return active;
		}
		const token = dependencies.captureProject();
		const task = dependencies.lifetime.startTask(TAKE_COMP_PREVIEW_TASK);
		try {
			await engine?.play();
			task.assertCurrent();
			dependencies.assertProject(token);
			active = Object.freeze({ ...current, state: 'playing' as const });
			return active;
		} finally {
			task.finish();
		}
	}

	async function stop(): Promise<boolean> {
		dependencies.lifetime.cancelTask(TAKE_COMP_PREVIEW_TASK);
		const changed = active !== null;
		active = active ? Object.freeze({ ...active, state: 'stopped' as const }) : null;
		engine?.stop?.();
		return changed;
	}

	async function dispose(): Promise<void> {
		await stop();
		const owned = engine;
		engine = null;
		await owned?.dispose?.();
	}

	function handleEngineState(state: string): void {
		if (!active || state === 'playing') return;
		active = Object.freeze({
			...active,
			state: state === 'paused' ? 'paused' : 'stopped',
		});
	}
}

function previewProject(
	project: AudioEditorProjectV17,
	group: TakeCompDocumentGroup,
	takes: readonly TakeCompDocumentTake[],
	createId: (prefix: string) => string,
): EngineProject {
	const sourceIds = new Set(takes.map(({ sourceId }) => sourceId));
	const sources = project.sources.filter(({ id }) => sourceIds.has(String(id)));
	const clips = takes.map((take) => createAudioClipV6({
		id: createId('take-preview-clip'),
		sourceId: take.sourceId,
		title: String(project.sources.find(({ id }) => id === take.sourceId)?.name ?? take.id),
		timelineStartFrame: take.startSample - group.startSample,
		sourceStartFrame: take.sourceStartSample,
		sourceDurationFrames: take.endSample - take.startSample,
		durationFrames: take.endSample - take.startSample,
		groupId: null,
		avLinkId: null,
		binItemId: null,
	}));
	const track = createAudioTrackV6({
		id: createId('take-preview-track'),
		name: 'Take preview',
		clipIds: clips.map(({ id }) => id),
		armed: false,
		effects: [],
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
	});
	return createAudioEditorProjectV6({
		title: 'Take preview',
		sampleRate: project.sampleRate,
		sources,
		clips,
		tracks: [track],
		projectBin: { clips: [] },
	}) as EngineProject;
}

function requireGroup(project: AudioEditorProjectV17, groupId: string): TakeCompDocumentGroup {
	const group = project.takeGroups.find((candidate) => candidate.id === groupId);
	if (!group) throw new ReferenceError(`Unknown take group: ${groupId}.`);
	return group;
}

function requireTake(group: TakeCompDocumentGroup, takeId: string): TakeCompDocumentTake {
	const take = group.takes.find((candidate) => candidate.id === takeId);
	if (!take) throw new ReferenceError(`Unknown take: ${takeId}.`);
	return take;
}
