/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../src/common/editor/effects.js';
import { createSelectionEffectTypeSnapshot } from '../src/common/editor/controller/document-snapshot.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

interface MenuItem {
	readonly id?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

test('destructive effects without settings apply directly while configurable effects open their dialog', () => {
	const applied: unknown[] = [];
	const opened: unknown[] = [];
	const run = (operation: () => unknown) => operation();
	const effects = {
		applySelection: (effect: unknown) => applied.push(effect),
	};
	const controller = {
		actions: new Proxy({ effects }, { get: (target, property, receiver) => (
			Reflect.get(target, property, receiver) ?? actionPorts()
		) }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }),
	};
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		controller,
		openSelectionEffect: (type: unknown) => opened.push(type),
		run,
	}));

	menuItem(menus, 'audacity-invert').onClick?.();
	assert.deepEqual(applied, [{ type: 'audacity-invert' }]);
	assert.deepEqual(opened, []);

	menuItem(menus, 'audacity-amplify').onClick?.();
	assert.deepEqual(applied, [{ type: 'audacity-invert' }]);
	assert.deepEqual(opened, ['audacity-amplify']);
});

test('selection effect inventory marks only definitions with editable settings or inputs', () => {
	type Definition = Parameters<typeof createSelectionEffectTypeSnapshot>[2];
	const definitions = AUDIO_SELECTION_EFFECT_DEFINITIONS as unknown as Readonly<Record<string, Definition>>;
	const inventory = Object.entries(definitions).map(([type, definition]) => (
		createSelectionEffectTypeSnapshot(type, type, definition)
	));
	assert.deepEqual(inventory.filter(({ hasSettings }) => !hasSettings).map(({ type }) => type), [
		'audacity-fade-in',
		'audacity-fade-out',
		'audacity-invert',
		'audacity-repair',
		'audacity-remove-dc-offset',
		'audacity-reverse',
	]);
	for (const type of ['audacity-amplify', 'audacity-auto-duck', 'audacity-noise-reduction', 'eq', 'reviewed-utility-gain']) {
		assert.equal(inventory.find((effect) => effect.type === type)?.hasSettings, true, type);
	}
});

function workspaceInput(overrides: Readonly<Record<string, unknown>>) {
	const track = { id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [] };
	const project = {
		id: 'project', sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}],
		tracks: [track],
		selection: { startFrame: 0, endFrame: 20, trackIds: ['track-a'], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
	const snapshot = {
		project, selectedTrackId: track.id,
		preferences: { workspace: {
			activeId: 'editing', custom: [],
			panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
		}, view: {} },
		history: { canUndo: false, canRedo: false, hasClipboard: false },
		effects: {
			selectionTypes: [
				{ type: 'audacity-amplify', label: 'Amplify', hasSettings: true },
				{ type: 'audacity-invert', label: 'Invert', hasSettings: false },
			],
			canRepeatLast: false,
		},
	};
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: { audioEffects: true }, locale: 'en',
		copy: copyValues(), project, snapshot, selectedAudioTrack: track,
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: true, selectedClip: null, durationFrames: 20,
		projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		actions: actionPorts(),
		...overrides,
	};
	return new Proxy(input, {
		get: (target, property, receiver) => Reflect.get(target, property, receiver) ?? (() => undefined),
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}

function actionPorts(): object {
	return new Proxy({}, { get: () => () => undefined });
}

function copyValues(): object {
	return new Proxy({}, { get: (_target, property) => String(property) });
}

function menuItem(values: unknown, id: string): MenuItem {
	for (const value of values as readonly MenuItem[]) {
		if (value.id === id) return value;
		const nested = value.items ? optionalMenuItem(value.items, id) : null;
		if (nested) return nested;
	}
	throw new Error(`Missing menu item ${id}.`);
}

function optionalMenuItem(values: readonly MenuItem[], id: string): MenuItem | null {
	for (const value of values) {
		if (value.id === id) return value;
		const nested = value.items ? optionalMenuItem(value.items, id) : null;
		if (nested) return nested;
	}
	return null;
}
