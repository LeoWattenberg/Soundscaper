/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import {
	deliveryReportItems,
	formatDeliveryReportItem,
	formatDeliveryReportItemDetail,
	formatDeliveryReportSubject,
	formatDeliveryReportSummary,
} from '../src/common/editor/ui/dialogs/editor-dialog-model.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const RANGE = { startFrame: 0, endFrame: 48_000 };

function report(options: Record<string, unknown> = { format: 'mp3' }) {
	const plan = createExportPlan({
		id: 'surface', title: 'Surface', sampleRate: 48_000, masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [], clips: [],
		tracks: [{
			type: 'audio', id: 't', name: 'A', clipIds: [], mute: false, solo: false,
			hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	}, { ...options, range: RANGE });
	return createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
}

test('both locales carry every delivery report string the renderer reads', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of [
			'deliveryReport', 'deliveryReportSummary',
			'deliveryReportSubject', 'deliveryReportNoConversions', 'deliveryReportSave',
			'deliveryPreset', 'deliveryPresetNone', 'deliveryPresetName', 'deliveryPresetSave',
			'deliveryPresetDelete', 'deliveryPresetImport', 'deliveryPresetExport',
		]) {
			assert.equal(typeof copy[key], 'string', `${key} is missing`);
			assert.ok(copy[key].length > 0, `${key} is empty`);
		}
	}
});

test('the summary and subject render the real report values', () => {
	const value = report({ format: 'mp3' });
	const subject = formatDeliveryReportSubject(value, ENGLISH_COPY);
	assert.match(subject, /mp3/u);
	assert.match(subject, /48000 Hz/u);

	const summary = formatDeliveryReportSummary(value, ENGLISH_COPY);
	assert.match(summary, /mp3/u);
	assert.doesNotMatch(summary, /\{[a-z]+\}/iu, 'every placeholder must be substituted');
});

test('item codes render as readable text without a per-code translation table', () => {
	const items = deliveryReportItems(report({ format: 'mp3' }));
	const lossy = items.find(({ code }: { code: string }) => code === 'delivery.lossy-encode');
	assert.ok(lossy);
	assert.equal(formatDeliveryReportItem(lossy), 'Lossy encode');
	assert.match(formatDeliveryReportItemDetail(lossy), /format: mp3/u);
});

test('a resampling delivery shows the rate change in its item detail', () => {
	const items = deliveryReportItems(report({ format: 'wav', sampleRate: 44_100 }));
	const resample = items.find(({ code }: { code: string }) => code === 'delivery.resample');
	assert.ok(resample);
	const detail = formatDeliveryReportItemDetail(resample);
	assert.match(detail, /fromSampleRate: 48000/u);
	assert.match(detail, /toSampleRate: 44100/u);
});

function findDeliveryItem(menus: readonly unknown[]): Record<string, unknown> | null {
	for (const menu of menus as Array<Record<string, unknown>>) {
		for (const item of (menu.items ?? []) as Array<Record<string, unknown>>) {
			if (item.id === 'delivery-report') return item;
			const nested = (item.items ?? []) as Array<Record<string, unknown>>;
			for (const child of nested) if (child.id === 'delivery-report') return child;
		}
	}
	return null;
}

function menuInput(deliveryReport: unknown, actions: Record<string, unknown>) {
	const project = {
		id: 'project', sampleRate: 48_000, sources: [], clips: [],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: [], effects: [] }],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
	return {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: {}, locale: 'en',
		copy: ENGLISH_COPY, project,
		snapshot: {
			project, selectedTrackId: 'track-a', deliveryReport,
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
		actions: new Proxy({ ...actions }, {
			get: (target, property, receiver) => (Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined),
		}),
	};
}

test('the delivery report is menu-reached and disabled until a delivery has produced one', () => {
	const opened: string[] = [];
	const actions = { openDeliveryReport: () => { opened.push('opened'); } };

	const disabled = findDeliveryItem(createApplicationMenus(menuInput(null, actions)));
	assert.ok(disabled, 'the entry must exist so the feature is discoverable');
	assert.equal(disabled.disabled, true, 'nothing to show before a delivery runs');

	const enabled = findDeliveryItem(
		createApplicationMenus(menuInput(report({ format: 'wav' }), actions)),
	);
	assert.ok(enabled);
	assert.equal(enabled.disabled, false);
	assert.equal(enabled.label, ENGLISH_COPY.deliveryReport);
	(enabled.onClick as () => void)();
	assert.deepEqual(opened, ['opened'], 'the entry runs the action that opens the dialog');
});
