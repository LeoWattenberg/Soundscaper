/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ASSISTANCE_OPERATIONS } from '../src/common/editor/assistance/operation.ts';
import {
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	type AssistanceGuidedWorkflowId,
} from '../src/common/editor/assistance/workflow-recipes.ts';
import {
	defaultAssistanceWorkflowSettingsV1,
	serializeAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { LocalAssistanceDialogView } from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import LocalAssistanceGuidedReview from
	'../src/common/editor/ui/dialogs/LocalAssistanceGuidedReview.tsx';
import {
	createLocalAssistanceGuidedSessionStore,
	localAssistanceGuidedConfigurationLocked,
	type LocalAssistanceGuidedSnapshot,
} from '../src/common/editor/ui/local-assistance-guided-session-store.ts';
import type {
	LocalAssistanceGuidedReviewedResult,
} from '../src/common/editor/ui/local-assistance-guided-result-review.ts';
import type { LocalAssistanceWorkflowBridge } from '../src/common/editor/ui/local-assistance-workflow-bridge.ts';
import type { LocalAssistanceBridge } from '../src/common/editor/ui/local-assistance-bridge.ts';
import type {
	LocalAssistanceSelectedMediaPreparationPort,
} from '../src/common/editor/ui/local-assistance-preparation.ts';
import type { LocalAssistanceSnapshot } from '../src/common/editor/ui/local-assistance-session-store.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('the menu dialog opens Guided and exposes all 13 recipes before explicit Advanced opt-in', () => {
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: null, preparation: null });
	assert.equal(guided.getSnapshot().surface, 'guided');
	assert.deepEqual(guided.getSnapshot().workflowIds, ASSISTANCE_GUIDED_WORKFLOW_IDS);
	const initial = renderDialog(guided.getSnapshot());
	assert.match(initial, /role="tab" aria-selected="true"[^>]*>Guided<\/button>/u);
	assert.match(initial, /role="tabpanel"[^>]*aria-label="Guided"/u);
	assert.match(initial, /<label[^>]*>Workflow/u);
	for (const workflowId of ASSISTANCE_GUIDED_WORKFLOW_IDS) {
		assert.match(initial, new RegExp(`value="${workflowId}"`, 'u'));
	}
	assert.match(initial, /<button type="button" disabled="">Accept selected<\/button>/u);
	assert.doesNotMatch(initial, />Operation<\/label>/u);

	guided.selectSurface('advanced');
	const advanced = renderDialog(guided.getSnapshot());
	assert.match(advanced, /role="tab" aria-selected="true"[^>]*>Advanced<\/button>/u);
	assert.match(advanced, /role="tabpanel"[^>]*aria-label="Advanced"/u);
	for (const operation of ASSISTANCE_OPERATIONS) {
		assert.match(advanced, new RegExp(`value="${operation}"`, 'u'));
	}
	assert.doesNotMatch(advanced, /<label[^>]*>Workflow/u);
});

test('each Guided recipe selects one frozen, strictly validated default settings body', () => {
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: null, preparation: null });
	for (const workflowId of ASSISTANCE_GUIDED_WORKFLOW_IDS) {
		guided.selectWorkflow(workflowId);
		const settings = guided.getSnapshot().settings;
		assert.ok(settings);
		assert.equal(settings.workflowId, workflowId);
		assert.equal(Object.isFrozen(settings), true);
		assert.equal(serializeAssistanceWorkflowSettingsV1(settings),
			serializeAssistanceWorkflowSettingsV1(defaultAssistanceWorkflowSettingsV1(workflowId)));
	}
	assert.throws(() => guided.selectWorkflow('unknown-workflow' as AssistanceGuidedWorkflowId),
		/unsupported|workflow/iu);
	guided.selectWorkflow('make-highlights');
	assert.deepEqual(guided.getSnapshot().settings, {
		settingsVersion: 1, workflowId: 'make-highlights', resultCount: 5,
		minimumDurationSeconds: 15, maximumDurationSeconds: 60,
		targetAspectWidth: 9, targetAspectHeight: 16, editorialRerank: false,
	});
	const markup = renderDialog(guided.getSnapshot());
	assert.match(markup, /Exact settings/u);
	assert.match(markup, /&quot;resultCount&quot;:5/u);
});

test('Guided workflow settings are editable only through their exact validated body', () => {
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: null, preparation: null });
	guided.selectWorkflow('mark-cuts');
	guided.setSettings({ settingsVersion: 1, workflowId: 'mark-cuts', mode: 'accurate' });
	assert.deepEqual(guided.getSnapshot().settings,
		{ settingsVersion: 1, workflowId: 'mark-cuts', mode: 'accurate' });
	assert.equal(Object.isFrozen(guided.getSnapshot().settings), true);
	assert.throws(() => guided.setSettings({
		settingsVersion: 1, workflowId: 'mark-reactions', threshold: 0.5,
	}), /another workflow/iu);
	assert.throws(() => guided.setSettings({
		settingsVersion: 1, workflowId: 'mark-cuts', mode: 'accurate', surprise: true,
	} as never), /schema fields/iu);
	const cutsMarkup = renderDialog(guided.getSnapshot());
	assert.match(cutsMarkup, /Mark Cuts mode/u);
	assert.match(cutsMarkup, /value="fast"/u);
	assert.match(cutsMarkup, /checked="" value="accurate"/u);

	guided.selectWorkflow('make-highlights');
	guided.setSettings({ settingsVersion: 1, workflowId: 'make-highlights',
		resultCount: 20, minimumDurationSeconds: 15, maximumDurationSeconds: 180,
		targetAspectWidth: 9, targetAspectHeight: 16, editorialRerank: true });
	const highlightsMarkup = renderDialog(guided.getSnapshot());
	assert.match(highlightsMarkup, /Highlight proposals/u);
	assert.match(highlightsMarkup, /min="1" max="20" step="1" value="20"/u);
	assert.match(highlightsMarkup, /min="15" max="180" step="1" value="180"/u);
	assert.match(highlightsMarkup, /Use installed Qwen to rerank known candidates/u);
	assert.match(highlightsMarkup, /type="checkbox" checked=""/u);
});

test('Guided never calls the workflow bridge without an aggregate preparation seam', async () => {
	const fixture = workflowBridge();
	const guided = createLocalAssistanceGuidedSessionStore({
		bridge: fixture.localBridge,
		preparation: primitivePreparation(),
	});
	guided.selectWorkflow('transcribe-captions');
	assert.equal(guided.getSnapshot().phase, 'unavailable');
	assert.equal(guided.getSnapshot().unavailableReason, 'aggregate-preparation-unavailable');
	assert.equal(guided.getSnapshot().canRun, false);
	await assert.rejects(guided.run(), /not ready|unavailable/iu);
	assert.equal(fixture.createCalls, 0);
	assert.deepEqual(fixture.requests, []);
});

test('Guided uses the optional bridge only after preparation returns one exact aggregate request', async () => {
	const fixture = workflowBridge();
	const preparationRequests: unknown[] = [];
	const preparation = primitivePreparation({
		prepareGuidedWorkflow: async (request) => {
			preparationRequests.push(request);
			return { outcome: 'prepared', workflow: assistanceWorkflowFixture({ jobId: request.jobId,
				workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion }),
				reviewAuthority: { reviewAuthorityVersion: 1, audioWave: null,
					editorialCandidateIds: null, highlightVideoSignals: null,
					media: { audio: null, video: null } } };
		},
	});
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: fixture.localBridge, preparation });
	guided.selectWorkflow('transcribe-captions');
	guided.setSettings({ settingsVersion: 1, workflowId: 'transcribe-captions',
		recognizer: 'whisper', language: 'en', englishWhisperAlignment: 'when-installed' });
	assert.equal(guided.getSnapshot().phase, 'ready');
	assert.equal(guided.getSnapshot().canRun, true);
	await guided.run();
	assert.equal(fixture.createCalls, 1);
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0]?.workflowId, 'transcribe-captions');
	assert.equal(preparationRequests.length, 1);
	assert.deepEqual((preparationRequests[0] as Readonly<Record<string, unknown>>).settings, {
		settingsVersion: 1, workflowId: 'transcribe-captions', recognizer: 'whisper', language: 'en',
		englishWhisperAlignment: 'when-installed',
	});
	assert.equal(guided.getSnapshot().phase, 'unavailable');
	assert.equal(guided.getSnapshot().unavailableReason, 'workflow-runner-unavailable');
});

test('completed Guided output remains unchecked until its terminal claim passes semantic review', async () => {
	const audition = new Blob(['authenticated audition'], { type: 'audio/wav' });
	const auditionSha256 = await digestMediaContent(audition);
	const captions = new Blob([JSON.stringify({
		schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000,
		alignmentApplied: false,
		cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 24_000,
			text: 'Hello', words: [] }],
	})], { type: 'application/vnd.soundscaper.captions+json' });
	const fixture = workflowBridge({ completedBody: captions });
	const preparation = primitivePreparation({
		prepareGuidedWorkflow: async (request) => ({ outcome: 'prepared',
			workflow: assistanceWorkflowFixture({ jobId: request.jobId,
				workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion }),
			reviewAuthority: { reviewAuthorityVersion: 1, audioWave: null,
				editorialCandidateIds: null, highlightVideoSignals: null, media: { audio: {
					stageId: 'detect-speech', slotId: 'audio', claimId: '0'.repeat(39) + '1',
					mediaType: 'audio/wav',
					byteLength: audition.size, sha256: auditionSha256, body: audition,
				}, video: null } } }),
	});
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: fixture.localBridge, preparation });
	guided.selectWorkflow('transcribe-captions');
	await guided.run();
	assert.equal(guided.getSnapshot().phase, 'completed');
	assert.equal(guided.getSnapshot().canReview, true);
	await guided.review();
	assert.equal(guided.getSnapshot().phase, 'review-ready');
	assert.equal(guided.getSnapshot().auditionAudio, audition);
	assert.equal(guided.getSnapshot().auditionSourceStartFrame, 0);
	assert.equal(guided.getSnapshot().auditionSourceSampleRate, 48_000);
	assert.deepEqual(guided.getSnapshot().selectedChoiceIds, []);
	assert.deepEqual(guided.getSnapshot().review?.choices.map(({ id, selected }) => ({ id, selected })), [
		{ id: 'captions', selected: false },
	]);
	guided.setReviewChoiceSelected('captions', true);
	assert.deepEqual(guided.getSnapshot().selectedChoiceIds, ['captions']);
	assert.match(renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={guided.getSnapshot().review!} selectedChoiceIds={guided.getSnapshot().selectedChoiceIds}
		onChoiceChange={() => undefined} auditionAudio={guided.getSnapshot().auditionAudio} />),
	/type="checkbox" checked=""/u);
	await guided.dispose();
});

test('forged Guided review media is refused before native workflow execution', async () => {
	const audition = new Blob(['authenticated audition'], { type: 'audio/wav' });
	const fixture = workflowBridge();
	const preparation = primitivePreparation({
		prepareGuidedWorkflow: async (request) => ({ outcome: 'prepared',
			workflow: assistanceWorkflowFixture({ jobId: request.jobId,
				workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion }),
			reviewAuthority: { reviewAuthorityVersion: 1, audioWave: null,
				editorialCandidateIds: null, highlightVideoSignals: null, media: { audio: {
					stageId: 'detect-speech', slotId: 'audio', claimId: '0'.repeat(39) + '1',
					mediaType: 'audio/wav',
					byteLength: audition.size, sha256: 'ff'.repeat(32), body: audition,
				}, video: null } } }),
	});
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: fixture.localBridge, preparation });
	guided.selectWorkflow('transcribe-captions');
	await guided.run();
	assert.equal(guided.getSnapshot().phase, 'error');
	assert.match(guided.getSnapshot().error ?? '', /review media changed/iu);
	assert.deepEqual(fixture.requests, []);
	assert.equal(fixture.releases, 1);
	await guided.dispose();
});

test('Guided editorial review renders admitted text as inert, transient content', () => {
	const candidateId = 'selection:abababababababababababab';
	const review: LocalAssistanceGuidedReviewedResult = {
		reviewVersion: 1,
		jobId: WORKFLOW_JOB_ID,
		workflowId: 'generate-editorial-text',
		outputs: [{
			stageId: 'generate-editorial-text',
			slotId: 'editorial-proposal',
			claim: {
				claimVersion: 1,
				claimId: '03'.repeat(20),
				jobId: WORKFLOW_JOB_ID,
				stageId: 'generate-editorial-text',
				direction: 'output',
				slotId: 'editorial-proposal',
			},
			mediaType: 'application/vnd.soundscaper.editorial-proposal+json',
			byteLength: 128,
			sha256: '04'.repeat(32),
			body: new Blob(['{}'], { type: 'application/vnd.soundscaper.editorial-proposal+json' }),
			semantic: {
				schemaVersion: 1,
				candidates: [{ candidateId, title: 'A bounded title', hook: 'A bounded hook',
					chapters: ['Opening', 'Payoff'], explanation: 'Why this works' }],
			},
		}],
		choices: [{ id: candidateId, kind: 'editorial', label: 'Editorial text 1',
			selected: false, enabled: true }],
	};
	const markup = renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={review} selectedChoiceIds={[]} onChoiceChange={() => undefined} />);
	assert.match(markup, /A bounded title/u);
	assert.match(markup, /A bounded hook/u);
	assert.match(markup, /Opening/u);
	assert.match(markup, /Payoff/u);
	assert.match(markup, /Why this works/u);
	assert.doesNotMatch(markup, /contenteditable/iu);
});

test('Guided Reframe review exposes each authenticated crop keyframe for bounded positioning', () => {
	const draft = { schemaVersion: 1 as const, kind: 'reframe-path' as const,
		authority: { width: 1_920, height: 1_080, timescale: 24,
			frames: [{ sourceFrame: 0, presentationTick: '0' },
				{ sourceFrame: 23, presentationTick: '23' }] },
		fallbackChain: ['subject', 'saliency', 'center'] as const,
		path: { schemaVersion: 1 as const, targetAspect: { width: 9, height: 16 },
			keyframes: [crop(0), crop(23)] },
	};
	const output = { stageId: 'plan-crops', slotId: 'reframe-path',
		claim: { claimVersion: 1 as const, direction: 'output' as const,
			claimId: '03'.repeat(20), jobId: WORKFLOW_JOB_ID,
			stageId: 'plan-crops', slotId: 'reframe-path' },
		mediaType: 'application/vnd.soundscaper.reframe-path+json', byteLength: 2,
		sha256: '04'.repeat(32), body: new Blob(['{}'], {
			type: 'application/vnd.soundscaper.reframe-path+json',
		}), semantic: draft };
	const review: LocalAssistanceGuidedReviewedResult = { reviewVersion: 1,
		jobId: WORKFLOW_JOB_ID, workflowId: 'reframe', outputs: [output],
		choices: [{ id: 'reframe-path', kind: 'reframe', label: '9:16 crop path',
			selected: false, enabled: true }] };
	const markup = renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={review} selectedChoiceIds={[]} onChoiceChange={() => undefined}
		reframeDraft={draft} />);
	assert.match(markup, /Target aspect.*9:16/u);
	assert.equal((markup.match(/Draggable crop overlay/gu) ?? []).length, 1);
	assert.equal((markup.match(/type="range"/gu) ?? []).length, 2);
	assert.match(markup, /1 \/ 2/u);
	assert.match(markup, /Next keyframe/u);
});

test('Guided Reframe review bounds interactive DOM for a large admitted path', () => {
	const keyframes = Array.from({ length: 10_000 }, (_, sourceFrame) => crop(sourceFrame));
	const draft = { schemaVersion: 1 as const, kind: 'reframe-path' as const,
		authority: { width: 1_920, height: 1_080, timescale: 24,
			frames: keyframes.map(({ sourceFrame }) => ({ sourceFrame,
				presentationTick: String(sourceFrame) })) },
		fallbackChain: ['subject', 'saliency', 'center'] as const,
		path: { schemaVersion: 1 as const, targetAspect: { width: 9, height: 16 }, keyframes },
	};
	const review = reframeReview(draft);
	const markup = renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={review} selectedChoiceIds={[]} onChoiceChange={() => undefined}
		reframeDraft={draft} />);
	assert.equal((markup.match(/Draggable crop overlay/gu) ?? []).length, 1);
	assert.equal((markup.match(/type="range"/gu) ?? []).length, 2);
	assert.ok(markup.length < 10_000);
});

test('Guided highlight review exposes bounded title, trim, transcript, and crop controls', () => {
	const draft = { schemaVersion: 1 as const, kind: 'highlight-proposals' as const,
		workflowId: 'make-highlights' as const, targetAspect: { width: 9 as const, height: 16 as const },
		proposals: [{ id: 'highlight-a', startFrame: 0, endFrame: 48_000,
			sourceStartFrame: 0, sourceEndFrame: 24, score: 0.8,
			evidenceMode: 'transcript' as const, transcriptExcerpt: 'Exact transcript cue.',
			visualSummary: 'Exact visual evidence.', selected: false as const,
			videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
			title: 'Editable title', hook: 'Open with this exact insight.',
			chapters: ['Opening', 'Payoff'], explanation: 'The evidence resolves cleanly.',
			cropKeyframes: [crop(0), crop(23)] }],
	};
	const output = { stageId: 'assemble-highlights', slotId: 'highlight-proposals',
		claim: { claimVersion: 1 as const, direction: 'output' as const,
			claimId: '03'.repeat(20), jobId: WORKFLOW_JOB_ID,
			stageId: 'assemble-highlights', slotId: 'highlight-proposals' },
		mediaType: 'application/vnd.soundscaper.highlight-proposals+json', byteLength: 2,
		sha256: '04'.repeat(32), body: new Blob(['{}'], {
			type: 'application/vnd.soundscaper.highlight-proposals+json',
		}), semantic: draft };
	const review: LocalAssistanceGuidedReviewedResult = { reviewVersion: 1,
		jobId: WORKFLOW_JOB_ID, workflowId: 'make-highlights', outputs: [output],
		choices: [{ id: 'highlight-a', kind: 'highlight', label: 'Highlight 1',
			selected: false, enabled: true }] };
	const markup = renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={review} selectedChoiceIds={[]} onChoiceChange={() => undefined}
		highlightDraft={draft}
		highlightSourceTimeAuthority={{ descriptorVersion: 1,
			kind: 'selected-video-source-time-authority', projectId: 'project-a', projectRevision: 1,
			schemaFamily: 'framescaper', schemaVersion: 1,
			sequenceId: 'sequence-a', videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
			sourceSha256: '11'.repeat(32), timingAuthoritySha256: '22'.repeat(32),
			sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 24,
			sampleRate: 48_000, timescale: 24, selectionStartFrame: 0, selectionEndFrame: 48_000,
			frames: [{ sourceFrame: 0, presentationTick: '0', timelineFrame: 0 },
				{ sourceFrame: 24, presentationTick: '24', timelineFrame: 48_000 }] }}
		previewVideo={new Blob([Uint8Array.of(0, 1, 2)], { type: 'video/mp4' })} />);
	assert.match(markup, /Editable title/u);
	assert.match(markup, /Start frame/u);
	assert.match(markup, /End frame/u);
	assert.match(markup, /Exact transcript cue/u);
	assert.match(markup, /Open with this exact insight/u);
	assert.match(markup, /Opening/u);
	assert.match(markup, /The evidence resolves cleanly/u);
	assert.match(markup, /Draggable crop overlay/u);
	assert.match(markup, /type="range"/u);
	assert.match(markup, /Preview Highlight 1/u);
	assert.match(markup, /Choose a highlight proposal to preview its exact source interval/u);
	assert.doesNotMatch(markup, /<video controls=""/u);
});

test('Guided enhancement review exposes the authenticated original beside its result', () => {
	const output = { stageId: 'enhance-dialogue', slotId: 'enhanced-audio',
		claim: { claimVersion: 1 as const, direction: 'output' as const,
			claimId: '03'.repeat(20), jobId: WORKFLOW_JOB_ID,
			stageId: 'enhance-dialogue', slotId: 'enhanced-audio' },
		mediaType: 'audio/wav', byteLength: 2, sha256: '04'.repeat(32),
		body: new Blob(['xx'], { type: 'audio/wav' }), semantic: {
			kind: 'audio-wave', role: 'enhanced-audio', sampleRate: 48_000,
			channelCount: 1, frameCount: 1, sampleFormat: 'float32',
		} };
	const review: LocalAssistanceGuidedReviewedResult = { reviewVersion: 1,
		jobId: WORKFLOW_JOB_ID, workflowId: 'enhance-dialogue', outputs: [output],
		choices: [{ id: 'enhanced-audio', kind: 'audio', label: 'Enhanced Dialogue',
			selected: false, enabled: true }] };
	const markup = renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={review} selectedChoiceIds={[]} onChoiceChange={() => undefined}
		auditionAudio={new Blob(['original'], { type: 'audio/wav' })} />);
	assert.match(markup, /Original selection/u);
	assert.match(markup, /enhanced-audio/u);
	assert.equal((markup.match(/<audio controls=""/gu) ?? []).length, 2);
});

test('Guided cleanup audition skips checked ranges without mutating its audio body', () => {
	const semantic = { schemaVersion: 1 as const, kind: 'cleanup-proposals' as const,
		preset: 'balanced' as const, proposals: [{ id: 'silence:1', kind: 'silence' as const,
			startFrame: 48_000, endFrame: 72_000, text: '', selected: false as const }] };
	const output = { stageId: 'propose-cleanup', slotId: 'cleanup-proposals',
		claim: { claimVersion: 1 as const, direction: 'output' as const,
			claimId: '03'.repeat(20), jobId: WORKFLOW_JOB_ID,
			stageId: 'propose-cleanup', slotId: 'cleanup-proposals' },
		mediaType: 'application/vnd.soundscaper.cleanup-proposals+json', byteLength: 2,
		sha256: '04'.repeat(32), body: new Blob(['{}'], {
			type: 'application/vnd.soundscaper.cleanup-proposals+json',
		}), semantic };
	const review: LocalAssistanceGuidedReviewedResult = { reviewVersion: 1,
		jobId: WORKFLOW_JOB_ID, workflowId: 'clean-filler-silence', outputs: [output],
		choices: [{ id: 'silence:1', kind: 'cleanup', label: 'Measured silence',
			selected: false, enabled: true }] };
	const body = new Blob(['immutable original'], { type: 'audio/wav' });
	const markup = renderToStaticMarkup(<LocalAssistanceGuidedReview copy={ENGLISH_COPY}
		review={review} selectedChoiceIds={['silence:1']} onChoiceChange={() => undefined}
		auditionAudio={body} auditionSourceStartFrame={24_000}
		auditionSourceSampleRate={48_000} />);
	assert.match(markup, /Audition skips checked ranges without changing the project/u);
	assert.match(markup, /data-skip-range-count="1"/u);
	assert.equal(body.size, 18);
});

test('changing a completed Guided workflow releases discarded native and media custody', async () => {
	const body = new Blob([JSON.stringify({ schemaVersion: 1, kind: 'captions',
		sourceId: 'source-a', sampleRate: 48_000, alignmentApplied: false, cues: [],
	})], { type: 'application/vnd.soundscaper.captions+json' });
	const fixture = workflowBridge({ completedBody: body });
	const preparation = primitivePreparation({
		prepareGuidedWorkflow: async (request) => ({ outcome: 'prepared',
			workflow: assistanceWorkflowFixture({ jobId: request.jobId,
				workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion }),
			reviewAuthority: { reviewAuthorityVersion: 1, audioWave: null,
				editorialCandidateIds: null, highlightVideoSignals: null,
				media: { audio: null, video: null } } }),
	});
	const guided = createLocalAssistanceGuidedSessionStore({
		bridge: fixture.localBridge, preparation,
	});
	guided.selectWorkflow('transcribe-captions');
	await guided.run();
	assert.equal(fixture.releases, 0);
	guided.selectWorkflow('clean-filler-silence');
	await Promise.resolve();
	assert.equal(fixture.releases, 1);
	await guided.dispose();
});

test('Guided acceptance publishes only checked choices and retries failed native custody release', async () => {
	const captions = new Blob([JSON.stringify({
		schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000,
		alignmentApplied: false,
		cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 24_000,
			text: 'Hello', words: [] }],
	})], { type: 'application/vnd.soundscaper.captions+json' });
	const fixture = workflowBridge({ completedBody: captions, releaseResults: [false, true] });
	const accepted: unknown[] = [];
	const acceptance = deferred<void>();
	const preparation = primitivePreparation({
		prepareGuidedWorkflow: async (request) => ({ outcome: 'prepared',
			workflow: assistanceWorkflowFixture({ jobId: request.jobId,
				workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion }),
			reviewAuthority: { reviewAuthorityVersion: 1, audioWave: null,
				editorialCandidateIds: null, highlightVideoSignals: null,
				media: { audio: null, video: null } } }),
		acceptGuidedWorkflowResult: async (request) => {
			accepted.push(request);
			await acceptance.promise;
			return { outcome: 'accepted', selectedIds: request.selectedChoiceIds };
		},
	});
	const guided = createLocalAssistanceGuidedSessionStore({ bridge: fixture.localBridge, preparation });
	guided.selectWorkflow('transcribe-captions');
	await guided.run();
	await guided.review();
	assert.equal(guided.getSnapshot().canAccept, false);
	guided.setReviewChoiceSelected('captions', true);
	assert.equal(guided.getSnapshot().canAccept, true);
	const accepting = guided.accept();
	await Promise.resolve();
	assert.equal(guided.getSnapshot().phase, 'accepting');
	assert.equal(localAssistanceGuidedConfigurationLocked('accepting'), true);
	assert.equal(localAssistanceGuidedConfigurationLocked('reviewing'), true);
	assert.throws(() => guided.selectWorkflow('clean-filler-silence'), /immutable/iu);
	assert.throws(() => guided.setSettings(defaultAssistanceWorkflowSettingsV1('transcribe-captions')),
		/immutable/iu);
	assert.match(renderDialog(guided.getSnapshot()),
		/<select id="local-assistance-guided-workflow"[^>]*disabled=""/u);
	acceptance.resolve(undefined);
	await accepting;
	assert.equal(guided.getSnapshot().phase, 'accepted');
	assert.equal(guided.getSnapshot().canAccept, false);
	assert.equal(accepted.length, 1);
	assert.deepEqual((accepted[0] as Readonly<Record<string, unknown>>).selectedChoiceIds, ['captions']);
	assert.equal(typeof (accepted[0] as Readonly<Record<string, unknown>>).readOutput, 'function');
	assert.equal(fixture.releases, 1);
	assert.match(guided.getSnapshot().error ?? '', /custody.*retry/iu);
	await guided.dispose();
	assert.equal(fixture.releases, 2, 'accepted output custody retries exactly once during disposal');
});

function deferred<Value>(): Readonly<{ readonly promise: Promise<Value>; readonly resolve: (value: Value) => void }> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}

function primitivePreparation(
	extra: Partial<LocalAssistanceSelectedMediaPreparationPort> = {},
): LocalAssistanceSelectedMediaPreparationPort {
	return Object.freeze({
		listSelectedMedia: async () => ({ sources: [] }),
		prepareSelectedMedia: async () => { throw new Error('Primitive preparation is not used.'); },
		...extra,
	});
}

function crop(sourceFrame: number) {
	return { sourceFrame, authority: 'center' as const, trackIds: [],
		crop: { left: 0.341796875, top: 0, right: 0.341796875, bottom: 0 } };
}

function reframeReview(semantic: unknown): LocalAssistanceGuidedReviewedResult {
	return { reviewVersion: 1, jobId: WORKFLOW_JOB_ID, workflowId: 'reframe', outputs: [{
		stageId: 'plan-crops', slotId: 'reframe-path', claim: { claimVersion: 1,
			direction: 'output', claimId: '03'.repeat(20), jobId: WORKFLOW_JOB_ID,
			stageId: 'plan-crops', slotId: 'reframe-path' },
		mediaType: 'application/vnd.soundscaper.reframe-path+json', byteLength: 2,
		sha256: '04'.repeat(32), body: new Blob(['{}'], {
			type: 'application/vnd.soundscaper.reframe-path+json',
		}), semantic,
	}], choices: [{ id: 'reframe-path', kind: 'reframe', label: '9:16 crop path',
		selected: false, enabled: true }] };
}

function workflowBridge(options: Readonly<{
	completedBody?: Blob; releaseResults?: readonly boolean[];
}> = {}) {
	let createCalls = 0;
	let releases = 0;
	const requests: Parameters<LocalAssistanceWorkflowBridge['run']>[0][] = [];
	const bridge: LocalAssistanceWorkflowBridge = Object.freeze({
		custody: Object.freeze({
			stageInput: async () => { throw new Error('Preparation fixture owns staging.'); },
			reserveOutput: async () => { throw new Error('Preparation fixture owns reservations.'); },
			bindProducer: async () => { throw new Error('Preparation fixture owns producer binding.'); },
			release: async () => {
				releases += 1;
				return options.releaseResults?.[releases - 1] ?? true;
			},
		}),
		createJob: async () => {
			createCalls += 1;
			return Object.freeze({ contractVersion: 1 as const, jobId: WORKFLOW_JOB_ID });
		},
		run: async (request: Parameters<LocalAssistanceWorkflowBridge['run']>[0]) => {
			requests.push(request);
			if (options.completedBody) return Object.freeze({ contractVersion: 1 as const,
				jobId: request.jobId, workflowId: request.workflowId, outcome: 'completed' as const,
				result: Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
					workflowId: request.workflowId, stageIds: request.stageIds, outputs: request.outputs }) });
			return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
				workflowId: request.workflowId, outcome: 'unavailable' as const,
				reason: 'workflow-runner-unavailable' as const });
		},
		cancel: async (jobId: string) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'cancelled' as const,
		}),
		readOutput: async () => {
			if (!options.completedBody) throw new Error('No completed output fixture.');
			return options.completedBody;
		},
		onProgress: () => () => undefined,
	});
	const localBridge = Object.freeze({ workflow: bridge,
		models: async () => Object.freeze([]) }) satisfies Pick<LocalAssistanceBridge, 'models' | 'workflow'>;
	return { bridge, localBridge, requests,
		get createCalls() { return createCalls; },
		get releases() { return releases; } };
}

function renderDialog(guided: LocalAssistanceGuidedSnapshot): string {
	return renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={primitiveSnapshot()} guided={guided}
		onClose={() => undefined} onSurfaceChange={() => undefined}
		onSelectWorkflow={() => undefined} onGuidedSettingsChange={() => undefined}
		onRunGuided={() => undefined}
		onCancelGuided={() => undefined} onSelectSource={() => undefined}
		onSelectOperation={() => undefined} onSelectModel={() => undefined}
		onConsentChange={() => undefined} onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
}

function primitiveSnapshot(): LocalAssistanceSnapshot {
	return Object.freeze({
		phase: 'ready', sources: Object.freeze([]), models: Object.freeze([]),
		selectedSourceId: null, selectedOperation: null, shotDetectionMode: 'fast',
		selectedModelIds: Object.freeze([]), consent: false, progress: null, result: null,
		unavailableReason: null, error: null, cleanup: null,
		canRun: false, canCancel: false, canReview: false, canAccept: false,
		canPrepareTranscriptCleanup: false,
	});
}
