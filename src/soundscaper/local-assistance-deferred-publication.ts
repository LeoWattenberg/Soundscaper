/* SPDX-License-Identifier: AGPL-3.0-only */

import type * as Guided from '../common/editor/controller/local-assistance-guided-framescaper-acceptance.ts';
import type * as Reframe from '../framescaper/editor-local-assistance-reframe-publication.ts';
import type * as Highlight from '../framescaper/editor-local-assistance-highlight-publication.ts';

export type LocalAssistanceGuidedReframeAcceptanceRequest = Guided.LocalAssistanceGuidedReframeAcceptanceRequest;
export type LocalAssistanceGuidedHighlightAcceptanceRequest = Guided.LocalAssistanceGuidedHighlightAcceptanceRequest;
export type LocalAssistanceGuidedFramescaperAcceptancePorts = Guided.LocalAssistanceGuidedFramescaperAcceptancePorts;

export const hasLocalAssistanceGuidedFramescaperPort: typeof Guided.hasLocalAssistanceGuidedFramescaperPort = () => false;
export const localAssistanceGuidedFramescaperChoices: typeof Guided.localAssistanceGuidedFramescaperChoices = () => { throw unavailable(); };
export const publishLocalAssistanceGuidedFramescaperSelection: typeof Guided.publishLocalAssistanceGuidedFramescaperSelection = async () => { throw unavailable(); };
export const reviewLocalAssistanceGuidedFramescaperSemantics: typeof Guided.reviewLocalAssistanceGuidedFramescaperSemantics = () => { throw unavailable(); };

export const createFramescaperAssistanceReframePublication: typeof Reframe.createFramescaperAssistanceReframePublication = () => Object.freeze({
	acceptReviewed: async () => { throw unavailable(); },
});
export const createFramescaperAssistanceHighlightPublication: typeof Highlight.createFramescaperAssistanceHighlightPublication = () => Object.freeze({
	acceptReviewed: async () => { throw unavailable(); },
});

function unavailable(): Error {
	return new Error('Framescaper M7B publication is unavailable in Soundscaper.');
}
