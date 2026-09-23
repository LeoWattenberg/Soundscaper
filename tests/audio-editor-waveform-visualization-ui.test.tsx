/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WaveformPreferencesPage from '../src/common/editor/ui/dialogs/WaveformPreferencesPage.tsx';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { workspacePreferencesPage } from '../src/common/editor/ui/workspace/workspace-preferences-routing.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom,
	reactProps,
	type ReactTestElement,
} from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

interface MenuActionLabelProps {
	readonly action: Readonly<{ actionId: string }>;
}

interface MenuItem {
	readonly id?: string;
	readonly label?: ReactElement<MenuActionLabelProps> | string;
	readonly checked?: boolean;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

test('frequency waveform entries are capability-gated and route settings to the waveform page', async () => {
	const { createTimelineMenuModel } = await import(
		'../src/common/editor/ui/timeline/timeline-menu-model.js'
	) as unknown as {
		createTimelineMenuModel(input: unknown): { trackMenuItems: readonly MenuItem[] };
	};
	const actionCalls: unknown[][] = [];
	const surfaceCalls: unknown[][] = [];
	const capable = createTimelineMenuModel(menuInput(
		{ audioSpectralEditing: true },
		actionCalls,
		surfaceCalls,
	));
	const display = requiredItem(capable.trackMenuItems, 'track-display');
	assert.deepEqual(display.items?.map(actionId).filter(Boolean), [
		'action://trackedit/track-view-waveform',
		'local://track-view-waveform-three-band',
		'local://track-view-waveform-rainbow',
		'action://trackedit/track-view-spectrogram',
		'action://trackedit/track-view-multi',
		'local://waveform-visualization-settings',
	]);
	const threeBand = requiredAction(display.items, 'local://track-view-waveform-three-band');
	const rainbow = requiredAction(display.items, 'local://track-view-waveform-rainbow');
	const settings = requiredAction(display.items, 'local://waveform-visualization-settings');
	assert.equal(threeBand.checked, true);
	threeBand.onClick?.();
	rainbow.onClick?.();
	settings.onClick?.();
	assert.deepEqual(actionCalls, [
		['setThreeBandWaveformView', 'audio-track'],
		['setRainbowWaveformView', 'audio-track'],
	]);
	assert.deepEqual(surfaceCalls, [['preferences', { section: 'waveform' }]]);

	const incapable = createTimelineMenuModel(menuInput(
		{ audioSpectralEditing: false },
		[],
		[],
	));
	const incapableDisplay = requiredItem(incapable.trackMenuItems, 'track-display');
	assert.deepEqual(incapableDisplay.items?.map(actionId).filter(Boolean), [
		'action://trackedit/track-view-waveform',
	]);
});

test('the waveform preferences page is routable, localized, and hidden without spectral capability', () => {
	assert.equal(workspacePreferencesPage('waveform'), 'waveform');
	const preferences = createAudioEditorPreferencesV1();
	const markup = renderToStaticMarkup(<WorkspacePreferencesDialog
		controller={{ actions: { preferences: { update: () => undefined } } }}
		snapshot={{ preferences, capabilities: { audioSpectralEditing: true } }}
		copy={ENGLISH_COPY}
		locale="en"
		fileService={{ isDesktop: false }}
		menus={[]}
		run={(operation: () => unknown) => operation()}
		initialPage="waveform"
		onTogglePanel={() => undefined}
		onClose={() => undefined}
	/>);
	assert.match(markup, /data-waveform-visualization-settings="true"/u);
	assert.match(markup, /Low\/mid crossover \(Hz\)/u);
	assert.match(markup, /value="250"/u);
	assert.match(markup, /value="4000"/u);

	const unavailable = renderToStaticMarkup(<WorkspacePreferencesDialog
		controller={{ actions: { preferences: { update: () => undefined } } }}
		snapshot={{ preferences, capabilities: { audioSpectralEditing: false } }}
		copy={ENGLISH_COPY}
		locale="en"
		fileService={{ isDesktop: false }}
		menus={[]}
		run={(operation: () => unknown) => operation()}
		initialPage="waveform"
		onTogglePanel={() => undefined}
		onClose={() => undefined}
	/>);
	assert.doesNotMatch(unavailable, /data-waveform-visualization-settings/u);
	assert.equal(GERMAN_COPY.threeBandWaveformView, '3-Band-Wellenform');
	assert.equal(GERMAN_COPY.rainbowWaveformView, 'Regenbogen-Wellenform');
	assert.equal(GERMAN_COPY.preferencesWaveform, 'Wellenform');
});

test('waveform crossover fields commit one valid pair and reject invalid drafts', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const updates: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<WaveformPreferencesPage
			controller={{ actions: { preferences: { update: (patch) => { updates.push(patch); } } } }}
			preferences={createAudioEditorPreferencesV1()}
			copy={ENGLISH_COPY}
			run={(operation) => operation()}
		/>));
		const low = input(dom.container, ENGLISH_COPY.waveformLowMidCrossover);
		const high = input(dom.container, ENGLISH_COPY.waveformMidHighCrossover);
		await change(low, '320');
		await blur(low);
		assert.deepEqual(updates, [{
			waveformVisualization: { lowMidCrossoverHz: 320, midHighCrossoverHz: 4_000 },
		}]);

		await change(high, '300');
		await blur(high);
		assert.equal(updates.length, 1, 'an inverted crossover pair is not persisted');
		assert.equal(reactProps(high)['aria-invalid'], true);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function menuInput(
	capabilities: Readonly<Record<string, boolean>>,
	actionCalls: unknown[][],
	surfaceCalls: unknown[][],
): unknown {
	const track = {
		id: 'audio-track', type: 'audio', displayMode: 'waveform-three-band', locked: false,
		clipIds: [], hidden: false, effects: [],
	};
	return {
		controller: { actions: { track: {
			setThreeBandWaveformView: (trackId: string) => actionCalls.push(['setThreeBandWaveformView', trackId]),
			setRainbowWaveformView: (trackId: string) => actionCalls.push(['setRainbowWaveformView', trackId]),
			update: () => undefined,
		} } },
		snapshot: { capabilities },
		locale: 'en',
		copy: new Proxy({}, { get: (_target, property) => String(property) }),
		showArmControls: false,
		onToggleArmControls: () => undefined,
		mutationsBlocked: false,
		state: {
			trackMenu: { trackId: track.id }, outputMenu: null, trackColorMenu: null, clipMenu: null,
			trackRulerFlyout: null, waveformRulerState: null, setTrackColorMenu: () => undefined,
			setWaveformRulerState: () => undefined, loopPreview: null,
		},
		model: {
			project: {
				id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [track],
				selection: null, loop: { enabled: false }, trackFolders: [],
			},
			sampleRate: 48_000,
		},
		menuActions: { run: (operation: () => unknown) => operation() },
		onOpenSurface: (...args: unknown[]) => { surfaceCalls.push(args); },
		productId: capabilities.audioSpectralEditing ? 'soundscaper' : 'framescaper',
		capabilities,
	};
}

function requiredItem(items: readonly MenuItem[] | undefined, id: string): MenuItem {
	const item = items?.find((candidate) => candidate.id === id);
	assert.ok(item, `Expected menu item ${id}`);
	return item;
}

function actionId(item: MenuItem): string | null {
	return typeof item.label === 'object' && item.label !== null
		? item.label.props.action.actionId
		: null;
}

function requiredAction(items: readonly MenuItem[] | undefined, id: string): MenuItem {
	const item = items?.find((candidate) => actionId(candidate) === id);
	assert.ok(item, `Expected menu action ${id}`);
	return item;
}

function input(root: ReactTestElement, label: string): ReactTestElement {
	const candidate = root.querySelectorAll('input')
		.find((element) => element.getAttribute('aria-label') === label);
	assert.ok(candidate, `Expected input ${label}`);
	return candidate;
}

async function change(element: ReactTestElement, value: string): Promise<void> {
	await act(async () => reactProps(element).onChange({ currentTarget: { value } }));
}

async function blur(element: ReactTestElement): Promise<void> {
	await act(async () => reactProps(element).onBlur({ currentTarget: element }));
}
