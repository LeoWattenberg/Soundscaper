/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useLocalModelCatalog, useLocalModelActivity, useLocalModelTaskOptions, useOfflineModelChoices, useAssistanceModelChoices } from '../src/common/editor/ui/dialogs/useLocalModelPresentation.ts';
import type { LocalModelManagerModel } from '../src/common/editor/ui/local-model-manager-bridge.ts';
import LocalAssistanceOutputReviewList from '../src/common/editor/ui/dialogs/LocalAssistanceOutputReview.tsx';
import { useLocalAssistanceReviewIdentity, localAssistanceReviewIdentity } from '../src/common/editor/ui/dialogs/local-assistance-review-identity.ts';
import type { LocalAssistanceValidatedResult } from '../src/common/editor/ui/local-assistance-session-types.ts';

void test('model progress does not rebuild catalog filters, task options, maintenance choices or activity membership', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let modelReads = 0, labelCalls = 0;
	const models: LocalModelManagerModel[] = Array.from({ length: 500 }, (_, index) => ({ modelId: `model${index}`, version: '1',
		get task() { modelReads++; return 'speech-recognition'; }, availability: 'installable', installedBytes: null, downloadBytes: 100, attributionRequired: false }));
	const purpose = (_copy: object, value: string) => { labelCalls++; return value; }; const copy = {};
	const progress = [{ modelId: 'model1', fileName: 'weights', completedBytes: 1, totalBytes: 100 }];
	const ids = ['model1']; let query = ''; let result: readonly unknown[] = [];
	const assistanceModels = models.map(model => ({ modelId: model.modelId, version: '1', artifactSha256s: [], get task() { modelReads++; return 'speech-recognition'; } }));
	function Harness({ revision }: { revision: number }) {
		result = [useLocalModelCatalog(models, copy, 'en', purpose, query, 'all', 'all', true),
			useLocalModelActivity(progress, ids, ids, ids), useLocalModelTaskOptions(models, copy, purpose), useOfflineModelChoices(models, copy), useAssistanceModelChoices(assistanceModels, 'speech-recognition')];
		return <span>{revision}</span>;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = result; const work = { modelReads, labelCalls };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ modelReads, labelCalls }, work); result.forEach((value, index) => assert.equal(value, first[index]));
		query = 'model49'; await act(async () => root.render(<Harness revision={31} />));
		assert.deepEqual((result[0] as LocalModelManagerModel[]).map(model => model.modelId), models.filter(model => model.modelId.includes(query)).map(model => model.modelId));
		assert.equal(labelCalls, work.labelCalls, 'search reuses localized model search text');
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

void test('retained output identity and read-only semantic review skip deep output reads during progress', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let claimReads = 0, segmentReads = 0; let identity: string | null = null;
	const copy = {};
	const result: LocalAssistanceValidatedResult = { operation: 'speech-recognition', outputs: [{ bytes: new Blob(),
		claim: { claimVersion: 1, get claimId() { claimReads++; return 'claim'; }, jobId: 'job', role: 'transcript', mediaType: 'application/json', byteLength: 1, sha256: 'a'.repeat(64) },
		review: { kind: 'transcript', language: 'en', segments: Array.from({ length: 1000 }, (_, index) => ({ startSeconds: index, endSeconds: index + 1,
			get text() { segmentReads++; return `Segment ${index}`; }, speaker: null, words: [] })) },
	}] };
	function Harness({ revision }: { revision: number }) { identity = useLocalAssistanceReviewIdentity(result); return <><span>{revision}</span><LocalAssistanceOutputReviewList copy={copy} outputs={result.outputs} /></>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const work = { claimReads, segmentReads };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ claimReads, segmentReads }, work); assert.equal(dom.container.querySelectorAll('li').length, 1001);
		assert.equal(identity, localAssistanceReviewIdentity({ result }));
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

void test('activity membership survives fresh progress snapshot arrays and invalidates when membership changes', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let ids = ['model1']; let activity: ReturnType<typeof useLocalModelActivity> | undefined;
	function Harness({ completedBytes }: { completedBytes: number }) {
		activity = useLocalModelActivity([{ modelId: 'model1', fileName: 'weights', completedBytes, totalBytes: 100 }], [...ids], [...ids], []);
		return <span>{completedBytes}</span>;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness completedBytes={1} />));
		assert.ok(activity); const first = activity;
		for (let completedBytes = 2; completedBytes <= 30; completedBytes++) await act(async () => root.render(<Harness completedBytes={completedBytes} />));
		assert.equal(activity.busy, first.busy); assert.equal(activity.installing, first.installing); assert.equal(activity.cancelling, first.cancelling);
		assert.equal(activity.progress.get('model1')?.completedBytes, 30);
		ids = ['model2']; await act(async () => root.render(<Harness completedBytes={31} />));
		assert.notEqual(activity.busy, first.busy); assert.deepEqual([...activity.busy], ['model2']);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
