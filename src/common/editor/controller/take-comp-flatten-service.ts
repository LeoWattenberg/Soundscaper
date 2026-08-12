/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CommandObject } from '../commands/protocol.ts';
import {
	createAudioClipV6,
	createAudioEditorProjectV6,
	createAudioTrackV6,
} from '../project-v6.ts';
import { createAudioClipV10, createAudioSourceV10 } from '../project-v10.ts';
import type { AudioEditorProjectV17 } from '../project-v17.ts';
import type { TakeCompDocumentGroup, TakeCompDocumentTake } from '../take-comp-document-v17.ts';
import type { TakeCompFlattenTakeSegment } from '../take-comp-domain.ts';
import type { EngineChunkSourceInput, EngineSourceBufferInput } from '../engine/public-api.ts';
import type { EngineProject } from '../engine/types.ts';
import type { DerivedSourceService } from './derived-source-service.ts';
import type { AudioBufferLike } from './source-audio.ts';
import type { DerivedSourceRecord } from './track-domain-types.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import type {
	PreparedTakeCompFlatten,
	TakeCompFlattenPublication,
	TakeCompService,
} from './take-comp-service.ts';

const TAKE_COMP_FLATTEN_TASK = 'take-comp-flatten';

export interface TakeCompFlattenServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly service: Pick<TakeCompService, 'prepareFlatten' | 'publishFlatten'>;
	readonly derivedSources: Pick<DerivedSourceService, 'persistRenderedMixSource' | 'rollbackDerivedSources'>;
	readonly sourceBuffers: EngineSourceBufferInput;
	readonly sourceChunkProviders: EngineChunkSourceInput;
	getProject(): AudioEditorProjectV17;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createId(prefix: string): string;
	renderSnapshot(
		project: EngineProject,
		options: Readonly<Record<string, unknown>>,
		sourceBuffers: EngineSourceBufferInput,
		signal: AbortSignal,
		chunkSources: EngineChunkSourceInput,
		prepareTimePitchCaches?: boolean,
	): Promise<AudioBufferLike>;
	renderPublication?(
		preparation: PreparedTakeCompFlatten,
		context: Readonly<{ readonly project: AudioEditorProjectV17; readonly signal: AbortSignal }>,
	): Promise<TakeCompFlattenPublication>;
	setStatus?(message: string, state?: string): void;
}

export interface TakeCompFlattenResult {
	readonly preparation: PreparedTakeCompFlatten;
	readonly publication: TakeCompFlattenPublication;
	readonly commitResult: unknown;
}

/** Exact two-phase take flattening with stale-publication rollback. */
export function createTakeCompFlattenService(dependencies: TakeCompFlattenServiceDependencies) {
	return Object.freeze({ flatten });

	async function flatten(groupId: string): Promise<Readonly<TakeCompFlattenResult>> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const project = dependencies.getProject();
		const group = requireWritableGroup(project, groupId);
		const operationId = dependencies.createId('take-flatten-operation');
		const outputId = dependencies.createId('take-flatten-clip');
		const preparation = dependencies.service.prepareFlatten(group.id, operationId, outputId);
		const ownership = Object.freeze({
			project: dependencies.captureProject(),
			task: dependencies.lifetime.startTask(TAKE_COMP_FLATTEN_TASK),
		});
		let derived: DerivedSourceRecord | null = null;
		try {
			dependencies.setStatus?.('Rendering take comp');
			const publication = dependencies.renderPublication
				? await dependencies.renderPublication(preparation, { project, signal: ownership.task.signal })
				: await renderPublication(project, group, preparation, ownership);
			assertOwned(ownership);
			if (!dependencies.renderPublication) {
				derived = publicationRecord(publication);
			}
			const commitResult = dependencies.service.publishFlatten(preparation, publication);
			dependencies.setStatus?.('Take comp flattened', 'success');
			return Object.freeze({ preparation, publication, commitResult });
		} catch (error) {
			if (derived) await dependencies.derivedSources.rollbackDerivedSources([derived]);
			throw error;
		} finally {
			ownership.task.finish();
		}
	}

	async function renderPublication(
		project: AudioEditorProjectV17,
		group: TakeCompDocumentGroup,
		preparation: PreparedTakeCompFlatten,
		ownership: Readonly<{ project: EditorProjectToken; task: EditorTaskScope }>,
	): Promise<TakeCompFlattenPublication> {
		const renderProject = flattenRenderProject(project, group, preparation, dependencies.createId);
		const rendered = await dependencies.renderSnapshot(renderProject, {
			startFrame: preparation.renderPlan.startSample,
			endFrame: preparation.renderPlan.endSample,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
		}, dependencies.sourceBuffers, ownership.task.signal, dependencies.sourceChunkProviders, false);
		assertOwned(ownership);
		const duration = preparation.renderPlan.endSample - preparation.renderPlan.startSample;
		if (rendered.length !== duration || rendered.sampleRate !== project.sampleRate) {
			throw new RangeError('Flatten renderer returned an inexact take group extent.');
		}
		const record = await dependencies.derivedSources.persistRenderedMixSource(
			rendered,
			`${group.id} — flattened take.wav`,
		);
		try {
			assertOwned(ownership);
			return Object.freeze({
				source: commandObject(createAudioSourceV10(record.source)),
				clip: commandObject(createAudioClipV10({
					id: preparation.renderPlan.outputId,
					sourceId: record.source.id,
					title: `${group.id} — flattened take`,
					anchor: 'sample',
					timelineStartFrame: preparation.renderPlan.startSample,
					durationFrames: duration,
					sourceStartFrame: 0,
					sourceDurationFrames: duration,
				})),
			});
		} catch (error) {
			await dependencies.derivedSources.rollbackDerivedSources([record]);
			throw error;
		}
	}

	function assertOwned(ownership: Readonly<{ project: EditorProjectToken; task: EditorTaskScope }>): void {
		ownership.task.assertCurrent();
		dependencies.assertProject(ownership.project);
	}
}

function flattenRenderProject(
	project: AudioEditorProjectV17,
	group: TakeCompDocumentGroup,
	preparation: PreparedTakeCompFlatten,
	createId: (prefix: string) => string,
): EngineProject {
	const takeById = new Map(group.takes.map((take) => [take.id, take]));
	const takeSegments = preparation.renderPlan.segments.filter(
		(segment): segment is TakeCompFlattenTakeSegment => segment.kind === 'take',
	);
	const clips = takeSegments.map((segment) => flattenSegmentClip(
		segment,
		requireTake(takeById, segment.takeId),
		createId('take-flatten-render-clip'),
	));
	const sourceIds = new Set(takeSegments.map(({ takeId }) => requireTake(takeById, takeId).sourceId));
	const track = createAudioTrackV6({
		id: createId('take-flatten-render-track'),
		name: 'Take comp render',
		clipIds: clips.map(({ id }) => id),
		armed: false,
		effects: [],
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
	});
	return createAudioEditorProjectV6({
		title: 'Take comp render',
		sampleRate: project.sampleRate,
		sources: project.sources.filter(({ id }) => sourceIds.has(String(id))),
		clips,
		tracks: [track],
		projectBin: { clips: [] },
	}) as EngineProject;
}

function flattenSegmentClip(
	segment: TakeCompFlattenTakeSegment,
	take: TakeCompDocumentTake,
	id: string,
): Readonly<Record<string, unknown>> {
	const duration = segment.endSample - segment.startSample;
	return createAudioClipV6({
		id,
		sourceId: take.sourceId,
		title: take.id,
		timelineStartFrame: segment.startSample,
		durationFrames: duration,
		sourceStartFrame: take.sourceStartSample + segment.startSample - take.startSample,
		sourceDurationFrames: duration,
		groupId: null,
		avLinkId: null,
		binItemId: null,
	});
}

function requireWritableGroup(project: AudioEditorProjectV17, groupId: string): TakeCompDocumentGroup {
	const group = project.takeGroups.find((candidate) => candidate.id === groupId);
	if (!group) throw new ReferenceError(`Unknown take group: ${groupId}.`);
	const track = project.tracks.find((candidate) => candidate.id === group.trackId);
	if (!track) throw new ReferenceError(`Unknown take group track: ${group.trackId}.`);
	if (track.locked === true) throw new RangeError(`Track ${track.id} is locked.`);
	return group;
}

function requireTake(
	takeById: ReadonlyMap<string, TakeCompDocumentTake>,
	takeId: string,
): TakeCompDocumentTake {
	const take = takeById.get(takeId);
	if (!take) throw new ReferenceError(`Unknown take: ${takeId}.`);
	return take;
}

function commandObject(value: object): CommandObject {
	return value as unknown as CommandObject;
}

function publicationRecord(publication: TakeCompFlattenPublication): DerivedSourceRecord {
	return {
		source: publication.source as unknown as DerivedSourceRecord['source'],
		buffer: null,
		channels: null,
	};
}
