/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import type { AssistanceOwnedHighlightProposalsV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import LocalAssistanceGuidedReview from
	'../src/common/editor/ui/dialogs/LocalAssistanceGuidedReview.tsx';
import type { LocalAssistanceGuidedReviewedResult } from
	'../src/common/editor/ui/local-assistance-guided-result-review.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const CROP = Object.freeze({ left: 0.2, top: 0, right: 0.2, bottom: 0 });
const DRAFT = Object.freeze({
	schemaVersion: 1 as const,
	kind: 'highlight-proposals' as const,
	workflowId: 'make-highlights' as const,
	targetAspect: Object.freeze({ width: 9 as const, height: 16 as const }),
	proposals: Object.freeze([Object.freeze({
		id: 'highlight-a', startFrame: 0, endFrame: 48_000,
		sourceStartFrame: 0, sourceEndFrame: 24, score: 0.8,
		evidenceMode: 'transcript' as const, transcriptExcerpt: 'Exact transcript cue.',
		visualSummary: 'Exact visual evidence.', selected: false as const,
		videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
		title: 'Editable title', hook: null, chapters: Object.freeze([]), explanation: null,
		cropKeyframes: Object.freeze([
			Object.freeze({ sourceFrame: 0, authority: 'center' as const,
				trackIds: Object.freeze([]), crop: CROP }),
			Object.freeze({ sourceFrame: 23, authority: 'center' as const,
				trackIds: Object.freeze([]), crop: CROP }),
		]),
	})]),
}) satisfies AssistanceOwnedHighlightProposalsV1;
const AUTHORITY = Object.freeze({
	descriptorVersion: 1 as const,
	kind: 'selected-video-source-time-authority' as const,
	projectId: 'project-a', projectRevision: 1,
	schemaFamily: 'framescaper', schemaVersion: 1,
	sequenceId: 'sequence-a', videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
	sourceSha256: '11'.repeat(32), timingAuthoritySha256: '22'.repeat(32),
	sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 24,
	sampleRate: 48_000, timescale: 24, selectionStartFrame: 0, selectionEndFrame: 48_000,
	frames: Object.freeze(Array.from({ length: 25 }, (_, sourceFrame) => Object.freeze({
		sourceFrame, presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 2_000,
	}))),
});
const REVIEW = Object.freeze({
	reviewVersion: 1 as const,
	jobId: 'job-a', workflowId: 'make-highlights' as const,
	outputs: Object.freeze([]),
	choices: Object.freeze([{ id: 'highlight-a', kind: 'highlight' as const,
		label: 'Highlight 1', selected: false as const, enabled: true }]),
}) satisfies LocalAssistanceGuidedReviewedResult;

test('Guided highlight trim refusal restores the authored value and reports the error', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let calls = 0;
	try {
		await act(async () => root.render(<LocalAssistanceGuidedReview
			copy={{}}
			review={REVIEW}
			selectedChoiceIds={[]}
			onChoiceChange={() => undefined}
			previewVideo={new Blob(['video'], { type: 'video/mp4' })}
			highlightDraft={DRAFT}
			highlightSourceTimeAuthority={AUTHORITY}
			onHighlightTrimChange={() => {
				calls += 1;
				throw new Error('trim refused');
			}}
		/>));
		const start = dom.container.querySelectorAll('input').find((input) => (
			input.type === 'number'
		));
		assert.ok(start);
		start.value = '46000';
		await act(async () => {
			void reactProps(start).onBlur({ currentTarget: start });
			await Promise.resolve();
		});
		assert.equal(calls, 1);
		assert.equal(start.value, '0');
		assert.match(dom.container.textContent, /trim refused/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
