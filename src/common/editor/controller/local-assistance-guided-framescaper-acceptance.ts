/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed Guided adaptation for Framescaper Reframe and Make Highlights terminals. */

import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../assistance/owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedHighlightProposalsV1,
	AssistanceOwnedReframePathV1,
} from '../assistance/owned-video-highlight-transform-types-v1.ts';
import type {
	AssistanceWorkflowFenceV1,
	AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import { validateLocalAssistanceGuidedHighlightDraftV1 } from
	'./local-assistance-guided-highlight-edits.ts';
import { validateLocalAssistanceGuidedReframeDraftV1 } from
	'./local-assistance-guided-reframe-edits.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
export type LocalAssistanceGuidedFramescaperWorkflowId = 'reframe' | 'make-highlights';

interface ReviewedOutput {
	readonly semantic: unknown;
}

export interface LocalAssistanceGuidedReframeAcceptanceRequest {
	readonly fence: AssistanceWorkflowFenceV1;
	readonly result: AssistanceOwnedReframePathV1;
}

export interface LocalAssistanceGuidedHighlightAcceptanceRequest {
	readonly fence: AssistanceWorkflowFenceV1;
	readonly result: AssistanceOwnedHighlightProposalsV1;
	readonly selectedProposalIds: readonly string[];
}

export interface LocalAssistanceGuidedFramescaperAcceptancePorts {
	readonly acceptReframeResult?: (
		request: LocalAssistanceGuidedReframeAcceptanceRequest,
	) => Awaitable<void>;
	readonly acceptHighlightResult?: (
		request: LocalAssistanceGuidedHighlightAcceptanceRequest,
	) => Awaitable<void>;
	readonly retainReframeResult?: (request: Readonly<{
		readonly workflow: AssistanceWorkflowV1;
		readonly result: AssistanceOwnedReframePathV1;
	}>) => Awaitable<void>;
}

export function reviewLocalAssistanceGuidedFramescaperSemantics(
	workflowId: LocalAssistanceGuidedFramescaperWorkflowId,
	outputs: ReadonlyMap<string, ReviewedOutput>,
	highlightDraft?: unknown,
	reframeDraft?: unknown,
): ReadonlyMap<string, unknown> {
	const transformId = workflowId === 'reframe' ? 'plan-crops' : 'assemble-highlights';
	const values = Object.fromEntries([...outputs].map(([slotId, output]) => [
		slotId, output.semantic,
	]));
	const reviewed = reviewAssistanceOwnedVideoHighlightTransformResultV1({
		schemaVersion: 1, transformId, outputs: values,
	});
	if (workflowId === 'reframe' && reframeDraft !== undefined) {
		if (reviewed.transformId !== 'plan-crops') {
			throw new TypeError('The Guided Reframe review changed transform identity.');
		}
		return new Map([['reframe-path', validateLocalAssistanceGuidedReframeDraftV1(
			reviewed.outputs['reframe-path'], reframeDraft,
		)]]);
	}
	if (workflowId !== 'make-highlights' || highlightDraft === undefined) {
		return new Map(Object.entries(reviewed.outputs));
	}
	if (reviewed.transformId !== 'assemble-highlights') {
		throw new TypeError('The Guided highlight review changed transform identity.');
	}
	return new Map([['highlight-proposals', validateLocalAssistanceGuidedHighlightDraftV1(
		reviewed.outputs['highlight-proposals'], highlightDraft,
	)]]);
}

export function localAssistanceGuidedFramescaperChoices(
	workflowId: LocalAssistanceGuidedFramescaperWorkflowId,
	outputs: ReadonlyMap<string, ReviewedOutput>,
): readonly Readonly<{ id: string; kind: string }>[] {
	if (workflowId === 'reframe') return Object.freeze([{ id: 'reframe-path', kind: 'reframe' }]);
	const result = outputs.get('highlight-proposals')?.semantic as
		AssistanceOwnedHighlightProposalsV1 | undefined;
	if (!result) throw new TypeError('Guided Highlights lost its reviewed proposal terminal.');
	return Object.freeze(result.proposals.map(({ id }) => Object.freeze({ id, kind: 'highlight' })));
}

export async function publishLocalAssistanceGuidedFramescaperSelection(
	dependencies: LocalAssistanceGuidedFramescaperAcceptancePorts,
	workflow: AssistanceWorkflowV1,
	workflowId: LocalAssistanceGuidedFramescaperWorkflowId,
	outputs: ReadonlyMap<string, ReviewedOutput>,
	selectedIds: readonly string[],
): Promise<void> {
	if (workflowId === 'reframe') {
		const result = outputs.get('reframe-path')?.semantic as AssistanceOwnedReframePathV1 | undefined;
		if (!result || !dependencies.acceptReframeResult) {
			throw new TypeError('Guided Reframe has no authenticated publication port.');
		}
		await dependencies.acceptReframeResult({ fence: workflow.fence, result });
		await dependencies.retainReframeResult?.({ workflow, result });
		return;
	}
	const result = outputs.get('highlight-proposals')?.semantic as
		AssistanceOwnedHighlightProposalsV1 | undefined;
	if (!result || !dependencies.acceptHighlightResult) {
		throw new TypeError('Guided Highlights has no authenticated publication port.');
	}
	await dependencies.acceptHighlightResult({
		fence: workflow.fence, result, selectedProposalIds: selectedIds,
	});
}

export function hasLocalAssistanceGuidedFramescaperPort(
	workflowId: LocalAssistanceGuidedFramescaperWorkflowId,
	dependencies: LocalAssistanceGuidedFramescaperAcceptancePorts,
): boolean {
	return workflowId === 'reframe'
		? Boolean(dependencies.acceptReframeResult) : Boolean(dependencies.acceptHighlightResult);
}
