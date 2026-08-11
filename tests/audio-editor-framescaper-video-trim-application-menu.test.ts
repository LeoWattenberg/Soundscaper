/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createVideoTrimApplicationMenuActions } from '../src/common/editor/ui/workspace/video-trim-application-menu-actions.ts';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const PLAYHEAD_SAMPLE = 38_400;
const SELECTED_CLIP = Object.freeze({ id: 'video-clip', kind: 'video' });
const TRIM_ITEM_IDS = Object.freeze([
	'trim-left-edge-to-playhead',
	'trim-right-edge-to-playhead',
	'roll-left-edge-to-playhead',
	'roll-right-edge-to-playhead',
	'ripple-left-edge-to-playhead',
	'ripple-right-edge-to-playhead',
]);

test('Framescaper trim planning is lazy per menu open and activation reads the live playhead', () => {
	const previewRequests: unknown[] = [];
	const commitRequests: unknown[] = [];
	let currentPlayheadSample = PLAYHEAD_SAMPLE;
	let playheadReads = 0;
	const actions = actionPorts({
		currentVideoPlayheadSample: () => {
			playheadReads += 1;
			return currentPlayheadSample;
		},
		planVideoTrim: (request: unknown) => {
			previewRequests.push(request);
			return Object.freeze({ kind: 'transform' as const });
		},
		commitVideoTrim: (request: unknown) => {
			commitRequests.push(request);
			return request;
		},
		planVideoRollRippleTrim: (request: unknown) => {
			previewRequests.push(request);
			return Object.freeze({ kind: 'transform' as const });
		},
		commitVideoRollRippleTrim: (request: unknown) => {
			commitRequests.push(request);
			return request;
		},
	});
	const closedRenders = Array.from({ length: 20 }, () => (
		createApplicationMenus(menuInput('framescaper', actions))
	));
	const framescaperMenus = closedRenders.at(-1);
	assert.ok(framescaperMenus);
	const closedFramescaper = clipBoundaryItems(framescaperMenus);

	assert.equal(playheadReads, 0);
	assert.deepEqual(previewRequests, []);
	assert.deepEqual(closedFramescaper
		.filter(({ id }) => TRIM_ITEM_IDS.includes(String(id)))
		.map(({ id, label, disabled, resolve }) => ({
			id, label, disabled, deferred: typeof resolve === 'function',
		})), [{
		id: 'trim-left-edge-to-playhead',
		label: 'Trim left edge to playhead',
		disabled: false,
		deferred: true,
	}, {
		id: 'trim-right-edge-to-playhead',
		label: 'Trim right edge to playhead',
		disabled: false,
		deferred: true,
	}, {
		id: 'roll-left-edge-to-playhead',
		label: 'Roll left edge to playhead',
		disabled: false,
		deferred: true,
	}, {
		id: 'roll-right-edge-to-playhead',
		label: 'Roll right edge to playhead',
		disabled: false,
		deferred: true,
	}, {
		id: 'ripple-left-edge-to-playhead',
		label: 'Ripple left edge to playhead',
		disabled: false,
		deferred: true,
	}, {
		id: 'ripple-right-edge-to-playhead',
		label: 'Ripple right edge to playhead',
		disabled: false,
		deferred: true,
	}]);

	const openedEdit = materializeApplicationMenu(topLevelMenu(framescaperMenus, 'edit'));
	const framescaper = clipBoundaryItems([openedEdit]);
	assert.equal(playheadReads, TRIM_ITEM_IDS.length);
	assert.deepEqual(previewRequests, [{
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		mode: 'roll', activeClipId: 'video-clip', edge: 'left',
		requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		mode: 'roll', activeClipId: 'video-clip', edge: 'right',
		requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		mode: 'ripple', activeClipId: 'video-clip', edge: 'left',
		requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		mode: 'ripple', activeClipId: 'video-clip', edge: 'right',
		requestedBoundarySample: PLAYHEAD_SAMPLE,
	}]);
	assert.ok(framescaper.every(({ resolve }) => resolve === undefined));

	currentPlayheadSample = PLAYHEAD_SAMPLE + 1_600;
	const leftTrim = framescaper.find(({ id }) => id === 'trim-left-edge-to-playhead');
	assert.ok(leftTrim);
	leftTrim.onClick?.();
	assert.deepEqual(commitRequests, [{
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: PLAYHEAD_SAMPLE + 1_600,
	}]);
	assert.equal(playheadReads, TRIM_ITEM_IDS.length + 1);

	materializeApplicationMenu(topLevelMenu(framescaperMenus, 'edit'));
	assert.equal(previewRequests.length, TRIM_ITEM_IDS.length * 2);
	assert.equal(playheadReads, TRIM_ITEM_IDS.length * 2 + 1);
	assert.ok(previewRequests.slice(TRIM_ITEM_IDS.length).every((request) => (
		(request as { requestedBoundarySample?: unknown }).requestedBoundarySample === currentPlayheadSample
	)));

	const previewCount = previewRequests.length;
	const playheadReadCount = playheadReads;
	const soundscaperMenus = createApplicationMenus(menuInput('soundscaper', actions));
	const soundscaper = clipBoundaryItems(soundscaperMenus);
	assert.deepEqual(
		soundscaper.filter(({ id }) => TRIM_ITEM_IDS.includes(String(id))),
		[],
	);
	materializeApplicationMenu(topLevelMenu(soundscaperMenus, 'edit'));
	assert.equal(previewRequests.length, previewCount);
	assert.equal(playheadReads, playheadReadCount);
});

test('workspace menu ports preserve ordinary and nested roll/ripple facade requests', () => {
	const events: unknown[][] = [];
	let positionFrame: unknown = PLAYHEAD_SAMPLE;
	const controller = {
		getTelemetrySnapshot: () => ({ positionFrame }),
		actions: {
			video: {
				trim: {
					preview: (request: unknown) => { events.push(['preview', request]); return request; },
					commit: (request: unknown) => { events.push(['commit', request]); return request; },
					rollRipple: {
						preview: (request: unknown) => { events.push(['rr-preview', request]); return request; },
						commit: (request: unknown) => { events.push(['rr-commit', request]); return request; },
					},
				},
			},
		},
	};
	const actions = createVideoTrimApplicationMenuActions(controller, (operation) => operation());
	const ordinary = Object.freeze({
		activeClipId: 'video-clip', edge: 'left' as const, requestedBoundarySample: PLAYHEAD_SAMPLE,
	});
	const rollRipple = Object.freeze({
		mode: 'roll' as const, activeClipId: 'video-clip', edge: 'right' as const,
		requestedBoundarySample: PLAYHEAD_SAMPLE,
	});

	actions.planVideoTrim(ordinary);
	actions.commitVideoTrim(ordinary);
	actions.planVideoRollRippleTrim(rollRipple);
	actions.commitVideoRollRippleTrim(rollRipple);
	assert.equal(actions.currentVideoPlayheadSample(), PLAYHEAD_SAMPLE);
	positionFrame = -1;
	assert.equal(actions.currentVideoPlayheadSample(), null);

	assert.deepEqual(events, [
		['preview', ordinary],
		['commit', ordinary],
		['rr-preview', rollRipple],
		['rr-commit', rollRipple],
	]);
});

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
	readonly resolve?: () => unknown;
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
		resolve: item.resolve,
	}));
}

function topLevelMenu(value: unknown, id: string): MenuItem {
	const menus = value as readonly MenuItem[];
	const menu = menus.find((candidate) => candidate.id === id);
	assert.ok(menu);
	return menu;
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
		rollLeftToPlayhead: 'Roll left edge to playhead',
		rollRightToPlayhead: 'Roll right edge to playhead',
		rippleLeftToPlayhead: 'Ripple left edge to playhead',
		rippleRightToPlayhead: 'Ripple right edge to playhead',
	}, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}
