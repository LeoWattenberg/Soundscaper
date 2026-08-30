/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	deliveryBatchTargetOptions,
	selectableDeliveryBatchTargets,
} from '../src/common/editor/ui/delivery-batch-dialog-model.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const TARGET_COPY = {
	entireProject: 'Entire project',
	currentSelection: 'Current selection',
	loopRegion: 'Loop region',
	noSelection: 'Make a selection to deliver it.',
	noLoop: 'Enable the loop to deliver it.',
	undeliverableSequence: 'Resolve the sequence issues to deliver it.',
	stemsUnsupported: 'A mastering sequence cannot be delivered as stems.',
};

const SEQUENCES = {
	regions: [{ id: 'r-one', name: 'Opening', startFrame: 0, endFrame: 96_000 }],
	sequences: [
		{
			id: 'album-order', name: 'Album order', sequenceId: 'main',
			entries: [], deliverable: true, issues: [], totalFrames: 96_000,
		},
		{
			id: 'broken', name: 'Broken order', sequenceId: 'main',
			entries: [], deliverable: false, issues: [], totalFrames: null,
		},
	],
};

test('every target the project offers is listed, unavailable ones with their reason', () => {
	// "Why can I not deliver the loop" should be answerable from the dialog
	// rather than from the absence of a row.
	const options = deliveryBatchTargetOptions({
		hasSelection: false, hasLoop: false, masteringSequences: SEQUENCES as never,
	}, TARGET_COPY);

	assert.deepEqual(options.map(({ key }) => key), [
		'project', 'selection', 'loop', 'region:r-one',
		'mastering-sequence:album-order', 'mastering-sequence:broken',
	]);
	assert.equal(options[1].available, false);
	assert.equal(options[1].reason, 'Make a selection to deliver it.');
	assert.equal(options[2].reason, 'Enable the loop to deliver it.');
	assert.equal(options[5].available, false, 'a sequence that cannot deliver cannot be batched');
	assert.equal(options[5].reason, 'Resolve the sequence issues to deliver it.');
	assert.equal(options[4].available, true);
	assert.equal(options[4].reason, null, 'and a deliverable one has nothing to explain');
});

test('a stems batch drops the targets stems cannot express, and says which', () => {
	const options = deliveryBatchTargetOptions({
		hasSelection: true, hasLoop: true, masteringSequences: SEQUENCES as never,
	}, TARGET_COPY);

	assert.deepEqual(selectableDeliveryBatchTargets(options, 'mix').map(({ key }) => key), [
		'project', 'selection', 'loop', 'region:r-one', 'mastering-sequence:album-order',
	]);
	assert.deepEqual(selectableDeliveryBatchTargets(options, 'stems').map(({ key }) => key), [
		'project', 'selection', 'loop', 'region:r-one',
	]);
	assert.equal(
		options.find(({ key }) => key === 'mastering-sequence:album-order')?.stemsReason,
		'A mastering sequence cannot be delivered as stems.',
	);
});

test('a project with no sequences still offers the ordinary ranges', () => {
	const options = deliveryBatchTargetOptions({ hasSelection: true, hasLoop: false }, TARGET_COPY);
	assert.deepEqual(options.map(({ key }) => key), ['project', 'selection', 'loop']);
	assert.deepEqual(selectableDeliveryBatchTargets(options, 'mix').map(({ key }) => key), ['project', 'selection']);
});

test('the delivery queue is menu-reached and opens its own surface', () => {
	const opened: string[] = [];
	const project = {
		id: 'p', title: 'P', sampleRate: 48_000, masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [], clips: [],
		tracks: [{
			type: 'audio', id: 't', name: 'A', clipIds: [], mute: false, solo: false,
			hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	};
	const menus = createApplicationMenus({
		productId: 'soundscaper', capabilities: {}, copy: ENGLISH_COPY, project,
		snapshot: {
			project, selectedTrackId: 't',
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 100,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({
			openDeliveryQueue: () => { opened.push('delivery-queue'); },
		} as Record<string, unknown>, {
			get: (target, property, receiver) => (Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined),
		}),
	} as never);

	const file = menus.find(({ id }: { id: string }) => id === 'file');
	const entry = file?.items?.find(({ id }: { id?: string }) => id === 'delivery-queue');
	assert.equal(entry?.label, ENGLISH_COPY.deliveryQueue);
	assert.equal(entry?.disabled, false);
	entry?.onClick?.();
	assert.deepEqual(opened, ['delivery-queue']);
});

test('the workspace hosts the delivery-queue surface and the dialog binds the batch actions', async () => {
	// Rendering the dialog would need the whole `.jsx` inspector-control tree, so
	// the binding is checked where it is written, as the other workspace surfaces
	// are.
	const [overlays, dialog, menuRuntime] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/inspector/DeliveryQueueDialog.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', import.meta.url), 'utf8'),
	]);

	assert.match(overlays, /activeSurface === 'delivery-queue'/u);
	assert.match(overlays, /<DeliveryQueueDialog/u);
	assert.match(menuRuntime, /openDeliveryQueue: \(\) => openSurface\('delivery-queue'\)/u);

	assert.match(dialog, /queueActions\.enqueueBatch\(batch\)/u);
	assert.match(dialog, /queueActions\.retryBatchFailures\(batchId\)/u);
	assert.match(dialog, /createDeliveryBatch\(snapshot\.project/u, 'the batch is built from the document');
	assert.match(dialog, /selectableDeliveryBatchTargets\(targets, mode\)/u);
	assert.match(dialog, /queueActions\.persistent/u, 'desktop persistence enhances the existing menu surface');
	assert.match(dialog, /queueActions\.selectDestination\(\)/u);
	assert.match(dialog, /queueActions\.reauthorizeDestination\(entry\.destinationGrantId\)/u);
	assert.match(dialog, /queueActions\.report\(entry\.jobId\)/u);
	assert.match(dialog, /queueActions\.reorder\(entry\.jobId/u);
	assert.doesNotMatch(dialog, /createExportPlan|renderSnapshot/u, 'a batch never renders anything itself');
});
