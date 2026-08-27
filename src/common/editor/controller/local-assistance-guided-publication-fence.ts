/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reconstruct live aggregate authority before publishing any workflow output. */

import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowFenceV1,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { serializeAssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import { createLocalAssistanceGuidedAggregateFenceV1 } from './local-assistance-guided-fence.ts';
import { prepareLocalAssistanceGuidedTranscriptInput } from
	'./local-assistance-guided-transcript-context.ts';

interface SelectedPublicationAuthorityPort {
	listSelectedMedia(): Promise<unknown>;
	prepareSelectedMedia(request: Readonly<{
		readonly sourceId: string;
		readonly operation: 'voice-activity-detection' | 'shot-detection';
		readonly shotDetectionMode?: 'fast' | 'accurate';
		readonly signal: AbortSignal;
	}>): Promise<unknown>;
}

export interface LocalAssistanceGuidedPublicationFenceDependencies {
	readonly getProject: () => unknown;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly currentSelectionFence: () => unknown;
	readonly currentVideoSelectionFence?: () => unknown;
	readonly loadTranscriptBody?: (
		storageKey: string,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
	readonly selected: SelectedPublicationAuthorityPort;
}

export function createLocalAssistanceGuidedPublicationFenceResolver(
	dependencies: LocalAssistanceGuidedPublicationFenceDependencies,
): Readonly<{
	resolveCurrentFence(workflow: AssistanceWorkflowV1, signal: AbortSignal):
		Promise<AssistanceWorkflowFenceV1>;
	assertCurrentFence(workflow: AssistanceWorkflowV1, signal: AbortSignal): Promise<void>;
}> {
	assertDependencies(dependencies);
	return Object.freeze({ resolveCurrentFence, assertCurrentFence });

	async function assertCurrentFence(
		workflowValue: AssistanceWorkflowV1,
		signal: AbortSignal,
	): Promise<void> {
		const workflow = validateAssistanceWorkflow(workflowValue);
		const current = await resolveCurrentFence(workflow, signal);
		if (JSON.stringify(current) !== JSON.stringify(workflow.fence)) {
			throw new DOMException('The assistance workflow aggregate fence is stale.', 'AbortError');
		}
	}

	async function resolveCurrentFence(
		workflowValue: AssistanceWorkflowV1,
		signal: AbortSignal,
	): Promise<AssistanceWorkflowFenceV1> {
		if (!(signal instanceof AbortSignal)) {
			throw new TypeError('Guided publication fence resolution requires one cancellation signal.');
		}
		const workflow = validateAssistanceWorkflow(workflowValue);
		const token = dependencies.captureProject();
		signal.throwIfAborted();
		const project = dataRecord(dependencies.getProject(), 'current publication project');
		const primitiveFences = await resolveWorkflowFences(workflow, signal);
		if (workflow.fence.transcriptBodySha256 !== null) {
			await assertTranscriptBodies(project, primitiveFences,
				workflow.fence.transcriptBodySha256, signal);
		}
		dependencies.assertProject(token);
		signal.throwIfAborted();
		const selectedStages = new Set(workflow.stageIds);
		const stages = assistanceWorkflowStageGraph(workflow.workflowId)
			.filter(({ stageId }) => selectedStages.has(stageId));
		const fence = createLocalAssistanceGuidedAggregateFenceV1({ project,
			primitiveFences, stages,
			settingsBody: serializeAssistanceWorkflowSettingsV1(workflow.settings),
			models: workflow.models });
		dependencies.assertProject(token);
		signal.throwIfAborted();
		return fence;
	}

	async function assertTranscriptBodies(
		project: Record<string, unknown>,
		primitiveFences: readonly AssistanceSelectionFence[],
		digest: string,
		signal: AbortSignal,
	): Promise<void> {
		const inventory = inventorySources(await dependencies.selected.listSelectedMedia());
		const sourceIds = transcriptSourceIds(project, digest);
		if (sourceIds.size < 1) {
			throw new Error('The current assistance transcript body authority is unavailable.');
		}
		for (const fence of primitiveFences.filter(({ sourceId }) => sourceIds.has(sourceId))) {
			const prepared = await prepareLocalAssistanceGuidedTranscriptInput({ project, inventory,
				fence, loadTranscriptBody: dependencies.loadTranscriptBody, signal });
			if (prepared === null) {
				throw new Error('The current assistance transcript source or body is unavailable.');
			}
			sourceIds.delete(fence.sourceId);
		}
		if (sourceIds.size > 0) {
			throw new Error('The current assistance transcript source authority is unavailable.');
		}
	}

	async function resolveWorkflowFences(
		workflow: AssistanceWorkflowV1,
		signal: AbortSignal,
	): Promise<readonly AssistanceSelectionFence[]> {
		const result: AssistanceSelectionFence[] = [];
		for (const range of workflow.fence.sourceRanges) {
			const operation = range.mediaKind === 'audio'
				? 'voice-activity-detection' as const : 'shot-detection' as const;
			const mode = range.mediaKind === 'video' ? videoMode(workflow) : null;
			const prepared = dataRecord(await dependencies.selected.prepareSelectedMedia({
				sourceId: range.sourceId, operation,
				...(mode === null ? {} : { shotDetectionMode: mode }), signal,
			}), 'current workflow source preparation');
			if (prepared.sourceId !== range.sourceId || prepared.operation !== operation
				|| (mode !== null && prepared.shotDetectionMode !== mode)) {
				throw new Error('The current workflow preparation changed source or mode authority.');
			}
			const fence = validateAssistanceSelectionFence(prepared.selectionFence);
			assertSelectedFence(fence, range.mediaKind);
			result.push(fence);
			signal.throwIfAborted();
		}
		return Object.freeze(result);
	}

	function assertSelectedFence(
		prepared: AssistanceSelectionFence,
		mediaKind: 'audio' | 'video',
	): void {
		const value = mediaKind === 'video' && dependencies.currentVideoSelectionFence
			? dependencies.currentVideoSelectionFence() : dependencies.currentSelectionFence();
		const selected = validateAssistanceSelectionFence(value);
		if (selected.sourceId === prepared.sourceId
			&& JSON.stringify(selected) !== JSON.stringify(prepared)) {
			throw new DOMException('The current assistance source authority is stale.', 'AbortError');
		}
	}
}

function videoMode(workflow: AssistanceWorkflowV1): 'fast' | 'accurate' {
	if (workflow.workflowId === 'index-video' && workflow.settings.workflowId === 'index-video') {
		return workflow.settings.shotMode;
	}
	if (workflow.workflowId === 'mark-cuts' && workflow.settings.workflowId === 'mark-cuts') {
		return workflow.settings.mode;
	}
	if (workflow.workflowId === 'advanced:shot-detection') {
		return workflow.models.length === 0 ? 'fast' : 'accurate';
	}
	return 'fast';
}

function transcriptSourceIds(project: Record<string, unknown>, digest: string): Set<string> {
	const result = new Set<string>();
	for (const asset of recordArray(project.assistanceAssets)) {
		const body = recordValue(asset.body);
		if (asset.kind === 'transcript-v1' && typeof asset.sourceId === 'string'
			&& body?.sha256 === digest) result.add(asset.sourceId);
	}
	return result;
}

function inventorySources(value: unknown): readonly Readonly<{
	readonly sourceId: string;
	readonly mediaKind: string;
}>[] {
	const row = dataRecord(value, 'current selected-media inventory');
	if (!Array.isArray(row.sources) || row.sources.length > 64) {
		throw new RangeError('The current selected-media inventory exceeds its bound.');
	}
	return Object.freeze(row.sources.map((candidate) => {
		const source = dataRecord(candidate, 'current selected-media source');
		if (typeof source.sourceId !== 'string' || source.sourceId.length < 1
			|| typeof source.mediaKind !== 'string') {
			throw new TypeError('The current selected-media inventory is invalid.');
		}
		return Object.freeze({ sourceId: source.sourceId, mediaKind: source.mediaKind });
	}));
}

function assertDependencies(value: LocalAssistanceGuidedPublicationFenceDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.getProject !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.currentSelectionFence !== 'function'
		|| (value.currentVideoSelectionFence !== undefined
			&& typeof value.currentVideoSelectionFence !== 'function')
		|| (value.loadTranscriptBody !== undefined && typeof value.loadTranscriptBody !== 'function')
		|| !value.selected || typeof value.selected.listSelectedMedia !== 'function'
		|| typeof value.selected.prepareSelectedMedia !== 'function') {
		throw new TypeError('Guided publication fence resolution requires exact live authority ports.');
	}
}

function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)
		? value as Record<string, unknown> : null;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be one record.`);
	}
	return value as Record<string, unknown>;
}
