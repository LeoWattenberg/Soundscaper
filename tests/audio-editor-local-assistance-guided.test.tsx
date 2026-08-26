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
import {
	createLocalAssistanceGuidedSessionStore,
	type LocalAssistanceGuidedSnapshot,
} from '../src/common/editor/ui/local-assistance-guided-session-store.ts';
import type { LocalAssistanceWorkflowBridge } from '../src/common/editor/ui/local-assistance-workflow-bridge.ts';
import type {
	LocalAssistanceSelectedMediaPreparationPort,
} from '../src/common/editor/ui/local-assistance-preparation.ts';
import type { LocalAssistanceSnapshot } from '../src/common/editor/ui/local-assistance-session-store.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('the menu dialog opens Guided and exposes all 13 recipes before explicit Advanced opt-in', () => {
	const guided = createLocalAssistanceGuidedSessionStore({ workflow: null, preparation: null });
	assert.equal(guided.getSnapshot().surface, 'guided');
	assert.deepEqual(guided.getSnapshot().workflowIds, ASSISTANCE_GUIDED_WORKFLOW_IDS);
	const initial = renderDialog(guided.getSnapshot());
	assert.match(initial, /role="tab" aria-selected="true"[^>]*>Guided<\/button>/u);
	assert.match(initial, /role="tabpanel"[^>]*aria-label="Guided"/u);
	assert.match(initial, /<label[^>]*>Workflow/u);
	for (const workflowId of ASSISTANCE_GUIDED_WORKFLOW_IDS) {
		assert.match(initial, new RegExp(`value="${workflowId}"`, 'u'));
	}
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
	const guided = createLocalAssistanceGuidedSessionStore({ workflow: null, preparation: null });
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
		targetAspectWidth: 9, targetAspectHeight: 16,
	});
	const markup = renderDialog(guided.getSnapshot());
	assert.match(markup, /Default settings/u);
	assert.match(markup, /&quot;resultCount&quot;:5/u);
});

test('Guided never calls the workflow bridge without an aggregate preparation seam', async () => {
	const fixture = workflowBridge();
	const guided = createLocalAssistanceGuidedSessionStore({
		workflow: fixture.bridge,
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
			return assistanceWorkflowFixture({ jobId: request.jobId,
				workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion });
		},
	});
	const guided = createLocalAssistanceGuidedSessionStore({ workflow: fixture.bridge, preparation });
	guided.selectWorkflow('transcribe-captions');
	assert.equal(guided.getSnapshot().phase, 'ready');
	assert.equal(guided.getSnapshot().canRun, true);
	await guided.run();
	assert.equal(fixture.createCalls, 1);
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0]?.workflowId, 'transcribe-captions');
	assert.equal(preparationRequests.length, 1);
	assert.deepEqual((preparationRequests[0] as Readonly<Record<string, unknown>>).settings,
		defaultAssistanceWorkflowSettingsV1('transcribe-captions'));
	assert.equal(guided.getSnapshot().phase, 'unavailable');
	assert.equal(guided.getSnapshot().unavailableReason, 'workflow-runner-unavailable');
});

function primitivePreparation(
	extra: Partial<LocalAssistanceSelectedMediaPreparationPort> = {},
): LocalAssistanceSelectedMediaPreparationPort {
	return Object.freeze({
		listSelectedMedia: async () => ({ sources: [] }),
		prepareSelectedMedia: async () => { throw new Error('Primitive preparation is not used.'); },
		...extra,
	});
}

function workflowBridge() {
	let createCalls = 0;
	const requests: Parameters<LocalAssistanceWorkflowBridge['run']>[0][] = [];
	const bridge: LocalAssistanceWorkflowBridge = Object.freeze({
		createJob: async () => {
			createCalls += 1;
			return Object.freeze({ contractVersion: 1 as const, jobId: WORKFLOW_JOB_ID });
		},
		run: async (request: Parameters<LocalAssistanceWorkflowBridge['run']>[0]) => {
			requests.push(request);
			return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
				workflowId: request.workflowId, outcome: 'unavailable' as const,
				reason: 'workflow-runner-unavailable' as const });
		},
		cancel: async (jobId: string) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'cancelled' as const,
		}),
		onProgress: () => () => undefined,
	});
	return { bridge, requests,
		get createCalls() { return createCalls; } };
}

function renderDialog(guided: LocalAssistanceGuidedSnapshot): string {
	return renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={primitiveSnapshot()} guided={guided}
		onClose={() => undefined} onSurfaceChange={() => undefined}
		onSelectWorkflow={() => undefined} onRunGuided={() => undefined}
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
