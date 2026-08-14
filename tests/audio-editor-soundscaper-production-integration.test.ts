/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createApplicationMenuProductItems,
	extendApplicationMenuProductPanelItem,
} from '../src/common/editor/ui/application-menu-product-items.js';
import type { SoundscaperProductionDialogOperation } from '../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx';
import {
	executeSoundscaperProductionOperation,
	resolveSoundscaperProductionMenuReturnFocus,
	resolveSoundscaperFreezeStatus,
	scheduleSoundscaperProductionMenuFocus,
	soundscaperProductionSurface,
	type SoundscaperProductionAutomationGestureState,
	type SoundscaperProductionControllerPort,
} from '../src/common/editor/ui/workspace/useSoundscaperProductionWorkspace.ts';
import { closeSoundscaperProductionWorkspace } from '../src/common/editor/ui/workspace/SoundscaperProductionWorkspaceOverlay.tsx';
import type { SoundscaperProductionMenuItem } from '../src/common/editor/ui/soundscaper-production-application-menu.ts';

test('the host product seam places each production entry without a default surface', () => {
	const calls: unknown[][] = [];
	const production = {
		automationMode: 'touch',
		freezeStatus: 'none',
		freezeActionsAvailable: false,
		reviewedPackagesAvailable: true,
		open: (surface: string) => { calls.push(['open', surface]); },
		setAutomationMode: (mode: string) => { calls.push(['mode', mode]); },
		freeze: () => { calls.push(['freeze']); },
	};
	const items = createApplicationMenuProductItems({
		productId: 'soundscaper',
		capabilities: capabilities(),
		project: project(),
		snapshot: { selectedTrackId: 'track-a', readOnly: false },
		editBlocked: false,
		copy: {},
		actions: { soundscaperProduction: production },
	});
	assert.deepEqual(items.tracks.map((item) => item?.id), [
		'soundscaper-automation', 'soundscaper-freeze',
	]);
	assert.deepEqual(items.effect.map(({ id }: { id: string }) => id), ['soundscaper-restoration']);
	assert.deepEqual(items.analyze.map(({ id }: { id: string }) => id), ['soundscaper-production-meters']);
	assert.deepEqual(items.tools.map(({ id }: { id: string }) => id), ['soundscaper-reviewed-effects']);
	const mixer = extendApplicationMenuProductPanelItem('mixer', {
		id: 'panel-mixer', label: 'Mixer', checked: false, onClick: () => calls.push(['mixer']),
	}, items);
	assert.deepEqual(mixer.items.map(({ id }: { id: string }) => id), [
		'panel-mixer-visibility', 'soundscaper-routing-graph',
	]);
	const automation = requireProductionMenuItem(items.tracks, 'soundscaper-automation');
	const mode = requireProductionMenuItem(automation.items, 'soundscaper-automation-mode');
	requireProductionMenuItem(automation.items, 'soundscaper-automation-edit').onClick?.();
	requireProductionMenuItem(mode.items, 'soundscaper-automation-mode-write').onClick?.();
	mixer.items[1].onClick();
	const freeze = requireProductionMenuItem(items.tracks, 'soundscaper-freeze');
	for (const item of freeze.items ?? []) item.onClick?.();
	assert.deepEqual(calls, [
		['open', 'automation'], ['mode', 'write'], ['open', 'routing'],
	]);
	assert.equal(soundscaperProductionSurface(null), null);
	assert.equal(soundscaperProductionSurface('soundscaper-production:routing'), 'routing');
	assert.equal(soundscaperProductionSurface('soundscaper-production:unknown'), null);
});

test('the workspace bridge restores the persistent top-level menu trigger after dialog closure', () => {
	const focusCalls: unknown[] = [];
	const menubar = fakeFocusElement({ matches: (selector) => selector === '[data-application-menubar]' });
	const expanded = fakeFocusElement({ parentElement: menubar, focusCalls });
	const active = fakeFocusElement({
		parentElement: menubar,
		matches: (selector) => selector === '[role="menuitem"]',
	});
	const submenu = fakeFocusElement();
	const disappearingLeaf = fakeFocusElement({
		parentElement: submenu,
		matches: (selector) => selector === '[role="menuitem"]',
	});
	const documentWithExpanded = {
		activeElement: disappearingLeaf,
		querySelector: () => expanded,
	} as unknown as Document;
	assert.equal(resolveSoundscaperProductionMenuReturnFocus(documentWithExpanded), expanded);

	expanded.isConnected = false;
	const documentWithActiveTopLevel = {
		activeElement: active,
		querySelector: () => expanded,
	} as unknown as Document;
	assert.equal(resolveSoundscaperProductionMenuReturnFocus(documentWithActiveTopLevel), active);
	assert.equal(resolveSoundscaperProductionMenuReturnFocus({
		activeElement: disappearingLeaf,
		querySelector: () => null,
	} as unknown as Document), null);

	let scheduled: (() => void) | undefined;
	scheduleSoundscaperProductionMenuFocus(active as unknown as HTMLElement, (callback) => {
		scheduled = callback;
	});
	assert.deepEqual(focusCalls, []);
	active.focusCalls = focusCalls;
	scheduled?.();
	assert.deepEqual(focusCalls, [{ preventScroll: true }]);

	const closureOrder: string[] = [];
	closeSoundscaperProductionWorkspace(
		(surface) => { closureOrder.push(`surface:${String(surface)}`); },
		() => { closureOrder.push('restore-focus'); },
	);
	assert.deepEqual(closureOrder, ['surface:null', 'restore-focus']);
});

test('workspace operations commit canonical automation/mixer commands and use reviewed selection processing', async () => {
	const calls: unknown[][] = [];
	const controller: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: (command) => { calls.push(['commit', command]); return command; } },
			effects: {
				applySelection: (request) => { calls.push(['selection', request]); return request; },
			},
			metering: {
				reset: (kind) => { calls.push(['meter-reset', kind]); return true; },
			},
		},
	};
	const modes: string[] = [];
	const lane = operation({ type: 'automation-lane/set', laneId: 'lane-a', expected: null, lane: null });
	const mixer = operation({ type: 'mixer-graph/set', expected: {}, mixer: {} });
	executeSoundscaperProductionOperation(controller, lane, (mode) => { modes.push(mode); });
	executeSoundscaperProductionOperation(controller, mixer, (mode) => { modes.push(mode); });
	executeSoundscaperProductionOperation(
		controller,
		operation({ type: 'automation-mode/set', mode: 'latch' }),
		(mode) => { modes.push(mode); },
	);
	executeSoundscaperProductionOperation(
		controller,
		operation({ type: 'production-meter/reset' }),
		(mode) => { modes.push(mode); },
	);
	await executeSoundscaperProductionOperation(controller, operation({
		type: 'reviewed-effect/apply',
		package: { id: 'org.soundscaper.utility-gain', version: '1.0.0' },
		params: { gain: 1.25 },
	}), (mode) => { modes.push(mode); });
	assert.deepEqual(modes, ['latch']);
	assert.deepEqual(calls, [
		['commit', lane],
		['commit', mixer],
		['meter-reset', 'playback'],
		['selection', { type: 'reviewed-utility-gain', params: { gain: 1.25 } }],
	]);
});

test('restoration noise-profile capture delegates to the maintained selection effect and fails closed when unavailable', async () => {
	const calls: string[] = [];
	const enabled: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: () => undefined },
			effects: { captureNoiseProfile: () => { calls.push('capture'); return 'profile'; } },
		},
	};
	assert.equal(await executeSoundscaperProductionOperation(
		enabled,
		operation({ type: 'restoration/capture-noise-profile' }),
		() => undefined,
	), 'profile');
	assert.deepEqual(calls, ['capture']);

	assert.throws(() => executeSoundscaperProductionOperation(
		{ actions: { edit: { commit: () => undefined }, effects: {} } },
		operation({ type: 'restoration/capture-noise-profile' }),
		() => undefined,
	), /noise-profile capture is unavailable/iu);
});

test('workspace automation gestures retain one opaque generation through preview and release', () => {
	const calls: unknown[][] = [];
	const token = Object.freeze({
		type: 'soundscaper-automation-gesture-v21' as const,
		laneId: 'lane-a',
		generation: 7,
	});
	const controller: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: () => undefined },
			audioAutomation: {
				getSnapshot: () => ({ mode: 'touch' }),
				setMode: () => undefined,
				beginGesture: (laneId, value) => {
					calls.push(['begin', laneId, value]);
					return token;
				},
				previewGesture: (active, value) => {
					calls.push(['preview', active, value]);
					return value;
				},
				releaseGesture: (active, value) => {
					calls.push(['release', active, value]);
					return value;
				},
				cancelGesture: (active) => {
					calls.push(['cancel', active]);
					return true;
				},
			},
		},
	};
	const state: SoundscaperProductionAutomationGestureState = { token: null };
	const mode = () => undefined;
	executeSoundscaperProductionOperation(controller, operation({
		type: 'automation-gesture/begin', laneId: 'lane-a', controlValue: 0.5,
	}), mode, null, state);
	executeSoundscaperProductionOperation(controller, operation({
		type: 'automation-gesture/preview', controlValue: 0.75,
	}), mode, null, state);
	executeSoundscaperProductionOperation(controller, operation({
		type: 'automation-gesture/release', controlValue: 0.25,
	}), mode, null, state);
	assert.equal(state.token, null);
	assert.deepEqual(calls, [
		['begin', 'lane-a', 0.5],
		['preview', token, 0.75],
		['release', token, 0.25],
	]);
	assert.throws(() => executeSoundscaperProductionOperation(controller, operation({
		type: 'automation-gesture/preview', controlValue: 1,
	}), mode, null, state), /active automation gesture/u);

	executeSoundscaperProductionOperation(controller, operation({
		type: 'automation-gesture/begin', laneId: 'lane-a', controlValue: 0.5,
	}), mode, null, state);
	executeSoundscaperProductionOperation(controller, operation({
		type: 'automation-gesture/cancel',
	}), mode, null, state);
	assert.equal(state.token, null);
	assert.deepEqual(calls.at(-1), ['cancel', token]);
});

test('workspace freeze status prefers the verified runtime classifier and falls back to document ownership', () => {
	const projectValue = {
		tracks: [{ id: 'track-a', audioFreeze: { schemaVersion: 1 } }],
	};
	const controller: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: () => undefined },
			audioFreeze: {
				getStatus: (trackId) => trackId === 'track-a' ? 'stale' : 'none',
			},
		},
	};
	assert.equal(resolveSoundscaperFreezeStatus(controller, projectValue, 'track-a'), 'stale');
	assert.equal(resolveSoundscaperFreezeStatus(controller, projectValue, 'missing'), 'none');
	assert.equal(resolveSoundscaperFreezeStatus({
		actions: { edit: { commit: () => undefined } },
	}, projectValue, 'track-a'), 'unknown');
});

test('restoration maps enabled stages to one macro transaction and reports a missing executor', async () => {
	const calls: unknown[] = [];
	const enabled: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: () => undefined },
			macros: { run: (request) => { calls.push(request); return request; } },
		},
	};
	const restoration = operation({
		type: 'restoration/apply',
		workflow: {
			target: 'selection',
			stages: [
				{ id: 'clicks', tool: 'click-removal', enabled: true, params: {} },
				{ id: 'curve', tool: 'filter-curve-eq', enabled: true, params: {} },
			],
		},
	});
	await executeSoundscaperProductionOperation(enabled, restoration, () => undefined, 'track-a');
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		name: 'Restoration',
		trackId: 'track-a',
		effects: [
			{
				id: 'clicks', type: 'audacity-click-removal', enabled: true,
				params: { threshold: 200, maximumWidth: 20 },
			},
			{
				id: 'curve', type: 'audacity-filter-curve-eq', enabled: true,
				params: {
					filterLength: 8191, linearFrequencyScale: false,
					points: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }],
				},
			},
		],
	});
	const controller: SoundscaperProductionControllerPort = {
		actions: { edit: { commit: () => undefined }, effects: {} },
	};
	await assert.rejects(Promise.resolve(executeSoundscaperProductionOperation(
		controller, restoration, () => undefined, 'track-a',
	)), /no transactional restoration executor/iu);
});

function operation(value: SoundscaperProductionDialogOperation): SoundscaperProductionDialogOperation {
	return value;
}

function requireProductionMenuItem(
	items: readonly unknown[] | undefined,
	id: string,
): SoundscaperProductionMenuItem {
	const item = items?.find((candidate) => (
		candidate !== null && typeof candidate === 'object'
		&& Reflect.get(candidate, 'id') === id
	));
	assert.ok(item, `Expected menu item ${id}`);
	return item as SoundscaperProductionMenuItem;
}

function capabilities(): Readonly<Record<string, boolean>> {
	return Object.freeze({
		audioAutomation: true,
		audioMixerGraph: true,
		audioTrackFreeze: true,
		audioEffects: true,
		audioAnalysis: true,
	});
}

function project(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		schemaVersion: 21,
		tracks: Object.freeze([Object.freeze({
			id: 'track-a', type: 'audio', name: 'Track A', locked: false, clipIds: Object.freeze(['clip-a']),
		})]),
		automationLanes: Object.freeze([]),
		mixer: Object.freeze({
			groups: Object.freeze([]), sends: Object.freeze([]), cues: Object.freeze([]),
			vcas: Object.freeze([]), outputs: Object.freeze([]), edges: Object.freeze([]),
		}),
	});
}

interface FakeFocusElement {
	isConnected: boolean;
	parentElement: FakeFocusElement | null;
	focusCalls?: unknown[];
	focus(options?: FocusOptions): void;
	matches(selector: string): boolean;
}

function fakeFocusElement(input: Readonly<{
	parentElement?: FakeFocusElement | null;
	focusCalls?: unknown[];
	matches?: (selector: string) => boolean;
}> = {}): FakeFocusElement {
	const element: FakeFocusElement = {
		isConnected: true,
		parentElement: input.parentElement ?? null,
		focusCalls: input.focusCalls,
		focus: (options) => { element.focusCalls?.push(options); },
		matches: input.matches ?? (() => false),
	};
	return element;
}
