/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TransportAuditionMenu from '../src/common/editor/ui/toolbar/TransportAuditionMenu.tsx';
import { createApplicationSelectMenu } from '../src/common/editor/ui/application-select-menu.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

(globalThis as unknown as { React: unknown }).React = React;

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onClick?: () => unknown;
	readonly items?: readonly MenuItem[];
}

interface Snapshot {
	readonly capabilities?: Readonly<{ audioSpectralEditing?: boolean }>;
	readonly recording?: boolean;
	readonly project?: Readonly<{ sampleRate: number }>;
	readonly selection?: Readonly<{
		startFrame: number;
		endFrame: number;
		frequencyRange?: Readonly<{ minimumFrequency: number; maximumFrequency: number }>;
	}> | null;
}

const selection = {
	startFrame: 48_000, endFrame: 144_000,
	frequencyRange: { minimumFrequency: 300, maximumFrequency: 1_200 },
};
const snapshot: Snapshot = {
	capabilities: { audioSpectralEditing: true }, project: { sampleRate: 48_000 }, selection,
};

test('selected-frequency audition is localized and reachable in both existing menus', () => {
	assert.equal(ENGLISH_COPY.playSpectralSelection, 'Play selected frequencies');
	assert.equal(GERMAN_COPY.playSpectralSelection, 'Ausgewählte Frequenzen abspielen');
	const calls: string[] = [];
	const menu = transportMenu(snapshot, false, calls);
	const entry = spectralTransportItem(menu);
	assert.ok(entry);
	assert.equal(entry.props.disabled, false);
	entry.props.onClick();
	assert.deepEqual(calls, ['close', 'playSpectralSelection']);
	assert.match(renderToStaticMarkup(menu), /role="menuitem"[^>]*>.*Play selected frequencies/u);
	const applicationEntry = spectralSelectItem(snapshot, false, calls);
	assert.ok(applicationEntry);
	assert.equal(applicationEntry.disabled, false);
	applicationEntry.onClick?.();
	assert.deepEqual(calls, ['close', 'playSpectralSelection', 'playSpectralSelection']);
});

test('selected-frequency audition is absent without the spectral capability', () => {
	for (const capabilities of [undefined, { audioSpectralEditing: false }]) {
		const unavailable = { ...snapshot, capabilities };
		assert.equal(spectralTransportItem(transportMenu(unavailable)), undefined);
		assert.equal(spectralSelectItem(unavailable), undefined);
	}
});

test('both menus require a usable explicit time and frequency selection', () => {
	const invalid: readonly Snapshot[] = [
		{ ...snapshot, selection: null },
		{ ...snapshot, selection: { ...selection, endFrame: selection.startFrame } },
		{ ...snapshot, selection: { ...selection, startFrame: Number.NaN } },
		{ ...snapshot, selection: { startFrame: 0, endFrame: 48_000 } },
		...[
			{ minimumFrequency: -1, maximumFrequency: 1_200 },
			{ minimumFrequency: 1_200, maximumFrequency: 300 },
			{ minimumFrequency: 300, maximumFrequency: 300 },
			{ minimumFrequency: 300, maximumFrequency: Number.NaN },
			{ minimumFrequency: 300, maximumFrequency: 24_001 },
		].map((frequencyRange) => ({ ...snapshot, selection: { ...selection, frequencyRange } })),
		{ ...snapshot, recording: true },
	];
	for (const unavailable of invalid) {
		assert.equal(spectralTransportItem(transportMenu(unavailable))?.props.disabled, true);
		assert.equal(spectralSelectItem(unavailable)?.disabled, true);
	}
	assert.equal(spectralTransportItem(transportMenu(snapshot, true))?.props.disabled, true);
	assert.equal(spectralSelectItem(snapshot, true)?.disabled, true);
});

function transportMenu(state: Snapshot, blocked = false, calls: string[] = []) {
	const action = () => undefined;
	return TransportAuditionMenu({
		copy: ENGLISH_COPY, snapshot: state, blocked, transportState: 'stopped',
		controller: { actions: { transport: {
			playPause: action, playCutPreview: action, playStopSelect: action,
			playSpectralSelection: () => { calls.push('playSpectralSelection'); },
		} } },
		run: (operation) => operation(), close: () => { calls.push('close'); },
	});
}

function spectralTransportItem(menu: ReactElement): ReactElement<{ disabled: boolean; onClick(): void }> | undefined {
	const children = (menu.props as { children: readonly ReactElement<{ label: string }>[] }).children;
	return children.find((entry) => entry.props.label === 'Play selected frequencies') as
		ReactElement<{ disabled: boolean; onClick(): void }> | undefined;
}

function spectralSelectItem(state: Snapshot, blocked = false, calls: string[] = []): MenuItem | undefined {
	const createMenu = createApplicationSelectMenu as unknown as (context: unknown, selectionMenu: unknown, actions: unknown) => MenuItem;
	const menu = createMenu({
		copy: ENGLISH_COPY, productId: 'soundscaper', snapshot: state, blocked,
		capabilities: state.capabilities, divider: () => ({ divider: true }), editBlocked: false,
		durationFrames: 192_000, editSelectionActive: true, spectralTrackSelected: true,
		clipSelectionNavigationMenus: { audioClips: { id: 'clips' } }, uiFlags: {},
	}, {}, { playSpectralSelection: () => { calls.push('playSpectralSelection'); } });
	return menu.items?.find((entry) => entry.id === 'menu-selection-spectral')?.items
		?.find((entry) => entry.id === 'play-spectral-selection');
}
