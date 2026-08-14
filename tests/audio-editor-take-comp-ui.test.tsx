/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import TakeCompDialog from '../src/common/editor/ui/dialogs/TakeCompDialog.tsx';
import { createTakeCompApplicationMenuItems } from '../src/common/editor/ui/take-comp-application-menu.ts';
import {
	createTakeCompDialogModel,
	readTakeCompNumberEntry,
	takeCompDialogDraftIdentity,
} from '../src/common/editor/ui/take-comp-dialog-model.ts';
import { CANONICAL_EXTRA_COPY_BY_LOCALE } from '../src/common/i18n/canonical-extras.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const NOW = '2026-08-12T12:00:00.000Z';

test('take comp application menu is Soundscaper-only, capability-owned, and opens no default chrome', async () => {
	const opened: string[] = [];
	const context = {
		productId: 'soundscaper', capability: true, project: project(), copy: ENGLISH_COPY,
		open: () => { opened.push('take-comp'); },
	};
	const [item] = createTakeCompApplicationMenuItems(context);
	assert.deepEqual({ id: item?.id, label: item?.label, disabled: item?.disabled }, {
		id: 'take-comp-editor', label: 'Take lanes and comps', disabled: false,
	});
	item?.onClick();
	assert.deepEqual(opened, ['take-comp']);
	assert.deepEqual(createTakeCompApplicationMenuItems({ ...context, productId: 'framescaper' }), []);
	assert.deepEqual(createTakeCompApplicationMenuItems({ ...context, capability: false }), []);
	assert.equal(createTakeCompApplicationMenuItems({
		...context, project: { schemaVersion: 16 },
	})[0]?.disabled, true);
	assert.equal(createTakeCompApplicationMenuItems({
		...context, project: { schemaVersion: 21 },
	})[0]?.disabled, false);

	const [menus, timelineMenus, runtime, overlays] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/application-menus.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/timeline/timeline-menu-model.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
	]);
	assert.doesNotMatch(menus, /createTakeCompApplicationMenuItems/u);
	assert.match(timelineMenus, /createTakeCompApplicationMenuItems/u);
	assert.match(runtime, /openTakeComp: \(\) => openSurface\('take-comp'\)/u);
	assert.match(overlays, /capabilities\.takeComp && activeSurface === 'take-comp'/u);
	assert.doesNotMatch(overlays, /capabilities\.takeComp && activeSurface !==/u);
});

test('dialog model lists canonical groups, lanes, takes, and regions from one snapshot', () => {
	const editable = createTakeCompDialogModel({
		productId: 'soundscaper', project: project(), snapshot: {}, selectedGroupId: 'group-a',
	});
	assert.equal(editable.groups.length, 1);
	assert.equal(editable.selectedGroup?.trackName, 'Vocal');
	assert.deepEqual(editable.selectedGroup?.lanesView.map((lane) => ({
		id: lane.id,
		takes: lane.takes.map(({ id, sourceName }) => [id, sourceName]),
	})), [
		{ id: 'lane-a', takes: [['take-a', 'Take A']] },
		{ id: 'lane-b', takes: [['take-b', 'Take B']] },
	]);
	assert.deepEqual(editable.selectedGroup?.compRegions, [
		{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 300 },
		{ id: 'region-b', takeId: 'take-b', startSample: 300, endSample: 500 },
	]);
	assert.equal(editable.operationsBlocked, false);
	assert.equal(createTakeCompDialogModel({
		productId: 'soundscaper', project: { ...project(), schemaVersion: 21 }, snapshot: {},
	}).groups.length, 1);

	for (const [label, model] of [
		['read-only', createTakeCompDialogModel({ productId: 'soundscaper', project: project(), snapshot: { readOnly: true } })],
		['busy', createTakeCompDialogModel({ productId: 'soundscaper', project: project(), snapshot: { importing: true } })],
		['locked', createTakeCompDialogModel({ productId: 'soundscaper', project: project(true), snapshot: {} })],
	] as const) {
		assert.equal(model.operationsBlocked, true, label);
		assert.equal(model.blockReason, label, label);
	}
	assert.deepEqual(createTakeCompDialogModel({
		productId: 'framescaper', project: project(), snapshot: {},
	}).groups, []);
});

test('dialog exposes keyboard-native audition, promotion, boundary, flatten, and removal controls', () => {
	const markup = renderToStaticMarkup(<TakeCompDialog
		productId="soundscaper"
		controller={{ actions: { takeComp: actionPorts() } }}
		snapshot={{ project: project() }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /role="dialog"[^>]*aria-label="Take lanes and comps"/u);
	assert.match(markup, /data-take-comp-dialog="true"/u);
	assert.match(markup, /role="list"[^>]*aria-label="Take lanes and comps"/u);
	assert.match(markup, /Lane 1[\s\S]*Take A[\s\S]*Audition Take A/u);
	assert.match(markup, /Lane 2[\s\S]*Take B[\s\S]*Audition Take B/u);
	assert.match(markup, /<caption>Comp regions<\/caption>/u);
	assert.match(markup, /Promote for full group/u);
	assert.match(markup, /Promote range/u);
	assert.match(markup, /Apply shared boundary/u);
	assert.match(markup, /Flatten comp/u);
	assert.match(markup, /Remove take group/u);
	assert.match(markup, /aria-live="polite" aria-atomic="true"/u);

	const blocked = renderToStaticMarkup(<TakeCompDialog
		productId="soundscaper"
		controller={{ actions: { takeComp: actionPorts() } }}
		snapshot={{ project: project(true) }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(blocked, /Take operations are unavailable while the owning track is locked\./u);
	assert.match(blocked, /<button type="button" disabled=""[^>]*>Audition lane<\/button>/u);
});

test('take names interpolate literally and drafts survive unrelated snapshot rebuilds', async () => {
	const markup = renderToStaticMarkup(<TakeCompDialog
		productId="soundscaper"
		controller={{ actions: { takeComp: actionPorts() } }}
		snapshot={{ project: project(false, 'Guitar $& $$ mix') }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.ok(markup.includes('aria-label="Select Guitar $&amp; $$ mix"'), markup);
	assert.ok(markup.includes('Audition Guitar $&amp; $$ mix'), markup);

	const first = createTakeCompDialogModel({ productId: 'soundscaper', project: project(), snapshot: {} });
	const second = createTakeCompDialogModel({ productId: 'soundscaper', project: project(), snapshot: {} });
	assert.notEqual(first.selectedGroup, second.selectedGroup);
	assert.equal(
		takeCompDialogDraftIdentity(first.selectedGroup),
		takeCompDialogDraftIdentity(second.selectedGroup),
	);
	assert.notEqual(takeCompDialogDraftIdentity(first.selectedGroup), takeCompDialogDraftIdentity(null));
	const moved = structuredClone(project());
	const movedRegions = moved.takeGroups[0]!.compRegions as unknown as Array<{ startSample: number; endSample: number }>;
	movedRegions[0]!.endSample = 350;
	movedRegions[1]!.startSample = 350;
	assert.notEqual(
		takeCompDialogDraftIdentity(createTakeCompDialogModel({
			productId: 'soundscaper', project: moved, snapshot: {},
		}).selectedGroup),
		takeCompDialogDraftIdentity(first.selectedGroup),
	);

	const dialog = await readFile(new URL('../src/common/editor/ui/dialogs/TakeCompDialog.tsx', import.meta.url), 'utf8');
	assert.doesNotMatch(dialog, /\}, \[group\?\.id, group\]\)/u);
	assert.doesNotMatch(dialog, /Number\(event\.currentTarget\.value\)/u);
	assert.doesNotMatch(dialog, /copy\.\w+\.replace\(/u);
});

test('integer field entries hold transient text instead of committing an unentered zero', () => {
	assert.deepEqual(readTakeCompNumberEntry(''), { draft: '', value: null });
	assert.deepEqual(readTakeCompNumberEntry('  '), { draft: '  ', value: null });
	assert.deepEqual(readTakeCompNumberEntry('-'), { draft: '-', value: null });
	assert.deepEqual(readTakeCompNumberEntry('1.5'), { draft: '1.5', value: null });
	assert.deepEqual(readTakeCompNumberEntry('0'), { draft: null, value: 0 });
	assert.deepEqual(readTakeCompNumberEntry(' 420 '), { draft: null, value: 420 });
	assert.deepEqual(readTakeCompNumberEntry('-12'), { draft: null, value: -12 });
});

test('take comp copy is complete and localized in English and German', () => {
	const required = [
		'takeCompMenu', 'takeCompTitle', 'takeCompEmpty', 'takeCompAuditionLane',
		'takeCompAuditionTake', 'takeCompPromoteAll', 'takeCompPromoteRange',
		'takeCompApplyStart', 'takeCompApplyEnd', 'takeCompApplySharedBoundary',
		'takeCompFlatten', 'takeCompRemoveGroup', 'takeCompReadOnly', 'takeCompLocked', 'takeCompBusy',
	];
	for (const key of required) {
		assert.equal(typeof CANONICAL_EXTRA_COPY_BY_LOCALE.en[key], 'string', `English ${key}`);
		assert.equal(typeof CANONICAL_EXTRA_COPY_BY_LOCALE.de[key], 'string', `German ${key}`);
		assert.notEqual(CANONICAL_EXTRA_COPY_BY_LOCALE.en[key], key);
		assert.notEqual(CANONICAL_EXTRA_COPY_BY_LOCALE.de[key], key);
	}
	assert.equal(CANONICAL_EXTRA_COPY_BY_LOCALE.de.takeCompMenu, 'Take-Lanes und Comps');
});

function actionPorts() {
	return {
		auditionTake: () => undefined,
		auditionLane: () => undefined,
		stopAudition: () => undefined,
		promoteTake: () => undefined,
		editCompBoundary: () => undefined,
		editSharedCompBoundary: () => undefined,
		flatten: () => undefined,
		removeGroup: () => undefined,
	};
}

function project(locked = false, takeAName = 'Take A') {
	return createAudioEditorProjectV17({
		id: 'take-ui-project', title: 'Take UI project', now: NOW,
		sources: [
			createAudioSourceV10({
				id: 'source-a', storageKey: 'source-a', name: takeAName,
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSourceV10({
				id: 'source-b', storageKey: 'source-b', name: 'Take B',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [], locked })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'group-a', sequenceId: 'main-sequence', trackId: 'track-a',
			startSample: 100, endSample: 500,
			laneOrder: ['lane-a', 'lane-b'],
			lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
			takes: [
				{ id: 'take-a', laneId: 'lane-a', sourceId: 'source-a', startSample: 100, endSample: 500, sourceStartSample: 0 },
				{ id: 'take-b', laneId: 'lane-b', sourceId: 'source-b', startSample: 100, endSample: 500, sourceStartSample: 25 },
			],
			compRegions: [
				{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 300 },
				{ id: 'region-b', takeId: 'take-b', startSample: 300, endSample: 500 },
			],
		}],
	});
}
