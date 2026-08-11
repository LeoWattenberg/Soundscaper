/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const PLAYHEAD_SAMPLE = 38_400;
const SELECTED_CLIP = Object.freeze({ id: 'video-clip', kind: 'video' });
const TRIM_ITEM_IDS = Object.freeze([
	'trim-left-edge-to-playhead',
	'trim-right-edge-to-playhead',
]);

test('application menus compose live Framescaper trim preview and commit ports without exposing them in Soundscaper', () => {
	const previewRequests: unknown[] = [];
	const commitRequests: unknown[] = [];
	const actions = actionPorts({
		planVideoTrim: (request: unknown) => {
			previewRequests.push(request);
			return Object.freeze({ kind: 'transform' as const });
		},
		commitVideoTrim: (request: unknown) => {
			commitRequests.push(request);
			return request;
		},
	});
	const framescaper = clipBoundaryItems(createApplicationMenus(menuInput('framescaper', actions)));

	assert.deepEqual(framescaper
		.filter(({ id }) => TRIM_ITEM_IDS.includes(String(id)))
		.map(({ id, label, disabled }) => ({ id, label, disabled })), [{
		id: 'trim-left-edge-to-playhead',
		label: 'Trim left edge to playhead',
		disabled: false,
	}, {
		id: 'trim-right-edge-to-playhead',
		label: 'Trim right edge to playhead',
		disabled: false,
	}]);
	assert.deepEqual(previewRequests, [{
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: PLAYHEAD_SAMPLE,
	}]);

	for (const id of TRIM_ITEM_IDS) {
		const item = framescaper.find((candidate) => candidate.id === id);
		assert.ok(item);
		item.onClick?.();
	}
	assert.deepEqual(commitRequests, previewRequests);
	assert.equal(commitRequests[0], previewRequests[0]);
	assert.equal(commitRequests[1], previewRequests[1]);

	const previewCount = previewRequests.length;
	const soundscaper = clipBoundaryItems(createApplicationMenus(menuInput('soundscaper', actions)));
	assert.deepEqual(
		soundscaper.filter(({ id }) => TRIM_ITEM_IDS.includes(String(id))),
		[],
	);
	assert.equal(previewRequests.length, previewCount);
});

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function clipBoundaryItems(value: unknown): readonly MenuItem[] {
	const menus = value as readonly MenuItem[];
	const edit = menus.find(({ id }) => id === 'edit');
	const boundaries = edit?.items?.find(({ id }) => id === 'clip-boundaries');
	assert.ok(boundaries?.items);
	return boundaries.items.map((item) => ({
		id: item.id,
		label: item.label,
		disabled: item.disabled,
		onClick: item.onClick,
	}));
}

function menuInput(productId: 'framescaper' | 'soundscaper', actions: object) {
	const panels = Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }]));
	const project = {
		id: 'project',
		sampleRate: 48_000,
		sources: [],
		clips: [SELECTED_CLIP],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['video-clip'], hidden: false }],
		selection: null,
		loop: { enabled: false },
		snap: { enabled: false, division: 'samples' },
	};
	return {
		productId,
		aboutLabel: 'About',
		capabilities: {
			audioAnalysis: true,
			audioEffects: true,
			audioGenerators: true,
			audioMacros: true,
			audioRecording: true,
		},
		locale: 'en',
		copy: copyValues(),
		project,
		snapshot: {
			selectedTrackId: 'video-track',
			preferences: {
				workspace: { activeId: 'video-editor', custom: [], panels },
				view: {},
			},
			videoNavigation: { positionFrame: PLAYHEAD_SAMPLE, programEndFrame: 48_000, rate: 0 },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked: false,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: false,
		selectedClip: SELECTED_CLIP,
		playheadSample: PLAYHEAD_SAMPLE,
		durationFrames: 48_000,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: { clipping: false, statusbar: true, storagePanel: false, tracksPanel: true },
		actionRuntime: null,
		actions,
	};
}

function actionPorts(overrides: Readonly<Record<string, unknown>>): object {
	return new Proxy({ ...overrides }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
}

function copyValues(): object {
	return new Proxy({
		trimLeftToPlayhead: 'Trim left edge to playhead',
		trimRightToPlayhead: 'Trim right edge to playhead',
	}, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}
