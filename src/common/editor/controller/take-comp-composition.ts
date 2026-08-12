/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { AudioEditorProjectV17 } from '../project-v17.ts';
import type { TakePromotionRequest } from '../take-comp-domain.ts';
import type { EngineChunkSourceInput, EngineSourceBufferInput } from '../engine/public-api.ts';
import type { EngineSourceResolver } from '../engine/types.ts';
import type { DerivedSourceService } from './derived-source-service.ts';
import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';
import {
	createTakeCompFlattenService,
	type TakeCompFlattenServiceDependencies,
} from './take-comp-flatten-service.ts';
import {
	createTakeCompPreviewService,
	type TakeCompPreviewEngine,
} from './take-comp-preview-service.ts';
import { createTakeCompService } from './take-comp-service.ts';

export interface TakeCompCompositionDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly sourceBuffers: EngineSourceBufferInput;
	readonly sourceChunkProviders: EngineChunkSourceInput;
	readonly sourceResolver?: EngineSourceResolver | null;
	readonly derivedSources: DerivedSourceService;
	getProject(): AudioEditorProjectV17;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	createId(prefix: string): string;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createPreviewEngine(options: Readonly<{ onState(state: string): void }>): TakeCompPreviewEngine;
	stopPlayback(): void;
	renderSnapshot: TakeCompFlattenServiceDependencies['renderSnapshot'];
	renderPublication?: TakeCompFlattenServiceDependencies['renderPublication'];
	setStatus?(message: string, state?: string): void;
}

/** Compose persistent take commands with isolated audition and exact flatten runtimes. */
export function createTakeCompControllerComposition(dependencies: TakeCompCompositionDependencies) {
	const service = createTakeCompService(dependencies);
	const preview = createTakeCompPreviewService({ ...dependencies, service });
	const flatten = createTakeCompFlattenService({ ...dependencies, service });

	return Object.freeze({
		createGroup: service.createGroup,
		updateGroup: service.updateGroup,
		removeGroup: service.removeGroup,
		auditionTake: preview.auditionTake,
		auditionLane: preview.auditionLane,
		promoteTake(groupId: string, request: Omit<TakePromotionRequest, 'regionId' | 'rightRemainderRegionId'>) {
			const group = requireGroup(dependencies.getProject(), groupId);
			const startSample = request.startSample ?? group.startSample;
			const endSample = request.endSample ?? group.endSample;
			const splitsRegion = group.compRegions.some((region) => (
				region.startSample < startSample && region.endSample > endSample
			));
			return service.promoteTake(groupId, {
				...request,
				regionId: dependencies.createId('comp-region'),
				...(splitsRegion ? { rightRemainderRegionId: dependencies.createId('comp-region') } : {}),
			});
		},
		editCompBoundary: service.editCompBoundary,
		editSharedCompBoundary: service.editSharedCompBoundary,
		flatten: flatten.flatten,
		stopAudition: preview.stop,
		dispose: preview.dispose,
	});
}

function requireGroup(project: AudioEditorProjectV17, groupId: string) {
	const group = project.takeGroups.find((candidate) => candidate.id === groupId);
	if (!group) throw new ReferenceError(`Unknown take group: ${groupId}.`);
	return group;
}
