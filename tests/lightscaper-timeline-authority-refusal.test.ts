/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readProjectSchemaIdentity } from '../src/common/editor/project-schema-identity.ts';
import { validateAssistanceSelectionFence } from '../src/common/editor/assistance/proposal-session.ts';
import { validateAssistanceWorkflowFenceV1 } from '../src/common/editor/assistance/workflow-fence-v1.ts';
import { createLocalAssistanceSelectedMediaPreparation, resolveLocalAssistanceSelectedMediaAuthority } from '../src/common/editor/controller/assistance/internal/local-assistance-selected-media.ts';
import { primitiveFence, projectRecord, assertSafeProjectTopology } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-admission.ts';
import { prepareLocalAssistanceGuidedHighlightInputsV1 } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-highlight-preparation.ts';
import { createLocalAssistanceAdvancedSelectedContextPreparation } from '../src/common/editor/controller/assistance/internal/local-assistance-advanced-selected-context.ts';
import { createLocalAssistanceAdvancedWorkflowPreparation } from '../src/common/editor/controller/assistance/internal/local-assistance-advanced-workflow-preparation.ts';
import { createLocalAssistanceGuidedWorkflowPreparation } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-preparation.ts';
import { createLocalAssistanceGuidedPublicationFenceResolver } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-publication-fence.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { createCrossProductHandoffLaunchIntent, admitCrossProductHandoffLaunchIntent } from '../src/common/cross-product-handoff-intent.ts';
import { convertCrossProductEditableCopy } from '../src/common/transfer/cross-product-handoff-conversion.ts';
import { crossProductHandoffSourceAuthorityRefusals, crossProductHandoffDestinationAuthorityRefusals } from '../src/common/transfer/cross-product-handoff-authority-preflight.ts';
import { listTransferProjects, transferProjectProduct } from '../src/common/transfer/transfer-project-selection.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

function photoTripwire() {
	let reads = 0;
	const project: Record<string, unknown> = { schemaFamily: 'lightscaper', schemaVersion: 1, id: 'photo-1' };
	for (const field of ['sources', 'clips', 'tracks', 'occurrenceIds', 'sourceRanges', 'photos', 'revision', 'title']) {
		Object.defineProperty(project, field, { enumerable: true, get() { reads++; throw new Error(`Traversed ${field}.`); } });
	}
	return { project, reads: () => reads };
}

test('photo identity is recognised without acquiring either timeline assistance fence', () => {
	const { project, reads } = photoTripwire();
	assert.deepEqual(readProjectSchemaIdentity(project), { schemaFamily: 'lightscaper', schemaVersion: 1 });
	for (const validate of [validateAssistanceSelectionFence, validateAssistanceWorkflowFenceV1]) {
		assert.throws(() => validate(project), RangeError);
	}
	assert.equal(reads(), 0);
});

test('selected and guided assistance refuse photo identity before topology, occurrences or project copying', () => {
	const { project, reads } = photoTripwire();
	let portCalls = 0;
	assert.throws(() => resolveLocalAssistanceSelectedMediaAuthority({
		getProject: () => project, getSelectedClipId: () => { portCalls++; return 'clip'; },
		captureProject: () => project, assertProject: () => undefined,
		renderDryTrackRange: async () => { portCalls++; return []; },
	}), RangeError);
	assert.throws(() => primitiveFence(project), RangeError);
	assert.throws(() => projectRecord(project, 'clip'), RangeError);
	assert.throws(() => assertSafeProjectTopology(project), RangeError);
	assert.equal(reads(), 0);
	assert.equal(portCalls, 0);
});

test('highlight assistance refuses photo project before invoking selection or decode ports', async () => {
	const { project, reads } = photoTripwire();
	let portCalls = 0;
	await assert.rejects(prepareLocalAssistanceGuidedHighlightInputsV1({
		project, inventory: [], settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => { portCalls++; return { selectionFence: project }; },
		prepareSelectedMedia: async () => { portCalls++; return null; },
	}), RangeError);
	assert.equal(reads(), 0);
	assert.equal(portCalls, 0);
});

test('selected audio preparation refuses photo identity before project capture or render', async () => {
	const { project, reads } = photoTripwire();
	let calls = 0;
	const preparation = createLocalAssistanceSelectedMediaPreparation({
		getProject: () => project, getSelectedClipId: () => { calls++; return 'clip'; },
		captureProject: () => { calls++; return project; }, assertProject: () => { calls++; },
		renderDryTrackRange: async () => { calls++; return []; },
	});
	await assert.rejects(preparation.prepareSelectedMedia({ sourceId: 'photo-1', operation: 'audio-tagging' }), RangeError);
	assert.equal(calls, 0);
	assert.equal(reads(), 0);
});

test('guided and Advanced workflows refuse photos before capture, selection, capacity or staging', async () => {
	const { project, reads } = photoTripwire();
	let calls = 0;
	const forbidden = async (): Promise<never> => { calls++; throw new Error('Timeline custody port invoked.'); };
	const custody = { stageInput: forbidden, reserveOutput: forbidden, bindProducer: forbidden, release: forbidden };
	const dependencies = {
		getProject: () => project, getSelectedClipId: () => { calls++; return 'clip'; },
		captureProject: () => { calls++; return project; }, assertProject: () => { calls++; },
		preflightStorage: forbidden, currentSelectionFence: () => { calls++; return project; },
		selected: { listSelectedMedia: forbidden, prepareSelectedMedia: forbidden },
	};
	const model = { modelId: 'deepfilternet3', version: '1.0.0', task: 'speech-enhancement', artifactSha256s: ['a'.repeat(64)] };
	const request = { jobId: 'ab'.repeat(20), models: [model], custody, signal: new AbortController().signal };
	assert.deepEqual(await createLocalAssistanceGuidedWorkflowPreparation(dependencies).prepareGuidedWorkflow({
		...request, workflowId: 'enhance-dialogue', settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
	}), { outcome: 'unavailable', reason: 'source-custody-unavailable' });
	assert.deepEqual(await createLocalAssistanceAdvancedWorkflowPreparation(dependencies).prepareAdvancedWorkflow({
		...request, workflowId: 'advanced:speech-enhancement', operation: 'speech-enhancement', sourceId: 'photo-1',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:speech-enhancement'),
	}), { outcome: 'unavailable', reason: 'source-custody-unavailable' });
	assert.equal(calls, 0);
	assert.equal(reads(), 0);
});

test('advanced context does not list or delegate timeline primitives for a photo project', async () => {
	const { project, reads } = photoTripwire();
	let portCalls = 0;
	const prepared = createLocalAssistanceAdvancedSelectedContextPreparation({
		getProject: () => project, selectionFenceForSource: () => project,
		selected: { listSelectedMedia: async () => { portCalls++; return { sources: [] }; },
			prepareSelectedMedia: async (_request: unknown) => { portCalls++; return null; } },
	});
	assert.deepEqual(await prepared.listSelectedMedia(), { sources: [] });
	await assert.rejects(prepared.prepareSelectedMedia({ sourceId: 'photo-1', operation: 'audio-tagging' }), RangeError);
	assert.equal(reads(), 0);
	assert.equal(portCalls, 0);
});

test('Advanced inventory stays empty without a current timeline header', async () => {
	let calls = 0;
	for (const project of [null, { id: 'uninitialised' }, { schemaFamily: 'soundscaper', schemaVersion: 2 }]) {
		const preparation = createLocalAssistanceAdvancedSelectedContextPreparation({
			getProject: () => project, selectionFenceForSource: () => project,
			selected: { listSelectedMedia: async () => { calls++; return { sources: [] }; },
				prepareSelectedMedia: async (_request: unknown) => { calls++; return null; } },
		});
		assert.deepEqual(await preparation.listSelectedMedia(), { sources: [] });
	}
	assert.equal(calls, 0);
});

test('publishing a timeline workflow refuses current photo identity before capture or selection', async () => {
	const { project, reads } = photoTripwire();
	let calls = 0;
	const forbidden = async (): Promise<never> => { calls++; throw new Error('Timeline publication port invoked.'); };
	const resolver = createLocalAssistanceGuidedPublicationFenceResolver({
		getProject: () => project, captureProject: () => { calls++; return project; },
		assertProject: () => { calls++; }, currentSelectionFence: () => { calls++; return project; },
		selected: { listSelectedMedia: forbidden, prepareSelectedMedia: forbidden },
	});
	await assert.rejects(resolver.resolveCurrentFence(assistanceWorkflowFixture(), new AbortController().signal), RangeError);
	assert.equal(calls, 0);
	assert.equal(reads(), 0);
});

test('photo editable-copy intent is refused before reading source id or revision', () => {
	const { project, reads } = photoTripwire();
	assert.throws(() => createCrossProductHandoffLaunchIntent({ sourceProject: project, destinationFamily: 'framescaper' }), RangeError);
	const intent = { kind: 'cross-product-editable-copy', version: 1, invocationId: 'invocation', sourceRevision: 0,
		source: { schemaFamily: 'soundscaper', schemaVersion: 1, projectId: 'audio' },
		destination: { schemaFamily: 'lightscaper', schemaVersion: 1, projectId: 'photo' } };
	assert.throws(() => admitCrossProductHandoffLaunchIntent(intent), RangeError);
	assert.throws(() => convertCrossProductEditableCopy({
		intent: { ...intent, destination: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'frame' } },
		sourceProject: project,
	}), RangeError);
	assert.equal(reads(), 0);
});

test('untyped photo feature-preflight calls refuse before traversing manifests', () => {
	const { project, reads } = photoTripwire();
	for (const preflight of [crossProductHandoffSourceAuthorityRefusals, crossProductHandoffDestinationAuthorityRefusals]) {
		assert.throws(() => { Reflect.apply(preflight, null, ['lightscaper', project]); }, RangeError);
	}
	assert.equal(reads(), 0);
});

test('transfer listing retains photo identity with an explicit refusal and no preselection', async () => {
	const { project, reads } = photoTripwire();
	assert.equal(transferProjectProduct(project), null);
	const offers = await listTransferProjects({ store: { listProjects: () => [project] }, product: 'framescaper' });
	assert.equal(offers[0]?.schemaFamily, 'lightscaper');
	assert.equal(offers[0]?.schemaVersion, 1);
	assert.equal(offers[0]?.product, null);
	assert.equal(offers[0]?.preselected, false);
	assert.match(offers[0]?.refusal ?? '', /Lightscaper/u);
	assert.equal(reads(), 0);
});
