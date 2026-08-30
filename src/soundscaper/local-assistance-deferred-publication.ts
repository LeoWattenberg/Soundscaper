/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceWorkflowV1 } from
	'../common/editor/assistance/workflow.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type ReviewedOutput = Readonly<{ readonly semantic: unknown }>;

export interface LocalAssistanceGuidedReframeAcceptanceRequest {
	readonly fence: unknown;
	readonly result: unknown;
}

export interface LocalAssistanceGuidedHighlightAcceptanceRequest {
	readonly fence: unknown;
	readonly result: unknown;
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
		readonly result: unknown;
	}>) => Awaitable<void>;
}

export function hasLocalAssistanceGuidedFramescaperPort(): false {
	return false;
}

export function localAssistanceGuidedFramescaperChoices(): never {
	throw unavailable();
}

export async function publishLocalAssistanceGuidedFramescaperSelection(): Promise<never> {
	throw unavailable();
}

export function reviewLocalAssistanceGuidedFramescaperSemantics(
	_workflowId: 'reframe' | 'make-highlights',
	_outputs: ReadonlyMap<string, ReviewedOutput>,
): never {
	throw unavailable();
}

export function createFramescaperAssistanceReframePublication(): Readonly<{
	acceptReviewed(): Promise<never>;
}> {
	return Object.freeze({ acceptReviewed: async () => Promise.reject(unavailable()) });
}

export function createFramescaperAssistanceHighlightPublication(): Readonly<{
	acceptReviewed(): Promise<never>;
}> {
	return Object.freeze({ acceptReviewed: async () => Promise.reject(unavailable()) });
}

function unavailable(): Error {
	return new Error('Framescaper M7B publication is unavailable in Soundscaper.');
}
