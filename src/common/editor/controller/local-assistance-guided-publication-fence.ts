/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reconstruct live aggregate authority before publishing reusable Guided output. */

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
		readonly operation: 'shot-detection';
		readonly shotDetectionMode: 'fast' | 'accurate';
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
}> {
	assertDependencies(dependencies);
	return Object.freeze({ resolveCurrentFence });

	async function resolveCurrentFence(
		workflowValue: AssistanceWorkflowV1,
		signal: AbortSignal,
	): Promise<AssistanceWorkflowFenceV1> {
		if (!(signal instanceof AbortSignal)) {
			throw new TypeError('Guided publication fence resolution requires one cancellation signal.');
		}
		const workflow = validateAssistanceWorkflow(workflowValue);
		if (workflow.workflowId !== 'index-transcript' && workflow.workflowId !== 'index-video'
			&& workflow.workflowId !== 'mark-cuts' && workflow.workflowId !== 'reframe'
			&& workflow.workflowId !== 'make-highlights') {
			throw new RangeError('This Guided workflow has no reusable publication fence.');
		}
		const token = dependencies.captureProject();
		signal.throwIfAborted();
		const project = dataRecord(dependencies.getProject(), 'current publication project');
		const primitiveFences = workflow.workflowId === 'index-transcript'
			? [await resolveTranscriptFence(project, signal)]
			: await resolveVideoWorkflowFences(workflow, signal);
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

	async function resolveTranscriptFence(
		project: Record<string, unknown>,
		signal: AbortSignal,
	) {
		const fence = validateAssistanceSelectionFence(dependencies.currentSelectionFence());
		const inventory = inventorySources(await dependencies.selected.listSelectedMedia());
		const prepared = await prepareLocalAssistanceGuidedTranscriptInput({ project, inventory,
			fence, loadTranscriptBody: dependencies.loadTranscriptBody, signal });
		if (prepared === null) {
			throw new Error('The current Guided transcript index source or body is unavailable.');
		}
		return prepared.fence;
	}

	async function resolveVideoWorkflowFences(
		workflow: AssistanceWorkflowV1,
		signal: AbortSignal,
	): Promise<readonly AssistanceSelectionFence[]> {
		const ranges = workflow.fence.sourceRanges.filter(({ mediaKind }) => mediaKind === 'video');
		if (ranges.length !== 1 || dependencies.currentVideoSelectionFence === undefined) {
			throw new TypeError('Guided publication has no sole live video authority.');
		}
		const mode = workflow.workflowId === 'index-video'
			&& workflow.settings.workflowId === 'index-video' ? workflow.settings.shotMode
			: workflow.workflowId === 'mark-cuts' && workflow.settings.workflowId === 'mark-cuts'
				? workflow.settings.mode : 'fast';
		const prepared = dataRecord(await dependencies.selected.prepareSelectedMedia({
			sourceId: ranges[0]!.sourceId, operation: 'shot-detection',
			shotDetectionMode: mode, signal,
		}), 'current video publication preparation');
		if (prepared.sourceId !== ranges[0]!.sourceId || prepared.operation !== 'shot-detection'
			|| prepared.shotDetectionMode !== mode) {
			throw new Error('The current Guided video preparation changed source or mode authority.');
		}
		const preparedFence = validateAssistanceSelectionFence(prepared.selectionFence);
		const videoFence = validateAssistanceSelectionFence(
			dependencies.currentVideoSelectionFence(),
		);
		if (JSON.stringify(preparedFence) !== JSON.stringify(videoFence)) {
			throw new DOMException('The current Guided video source authority is stale.', 'AbortError');
		}
		if (workflow.workflowId !== 'make-highlights') return Object.freeze([videoFence]);
		const selected = validateAssistanceSelectionFence(dependencies.currentSelectionFence());
		return Object.freeze(selected.sourceId === videoFence.sourceId
			? [videoFence] : [selected, videoFence]);
	}
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

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be one record.`);
	}
	return value as Record<string, unknown>;
}
