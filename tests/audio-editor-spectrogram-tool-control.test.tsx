/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';

import SpectrogramToolControl from '../src/common/editor/ui/toolbar/SpectrogramToolControl.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

// The .jsx sources compile to the classic runtime under tsx, so the control
// needs the React global that the Vite build provides automatically.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const TOOLBAR = new URL('../src/common/editor/ui/toolbar/EditorToolToolbar.jsx', import.meta.url);

test('the spectrogram options always offer multi-view and both spectral tools', async () => {
	const fixture = await mountedControl({ view: 'waveform' });
	try {
		const menu = await openOptions(fixture);
		assert.deepEqual(
			menuLabels(menu),
			[ENGLISH_COPY.multiview, ENGLISH_COPY.spectralBoxSelect, ENGLISH_COPY.spectralBrush],
		);
		// Nothing is drawn as a spectrogram yet, so the two spectral tools have
		// nothing to act on; multi-view is the way into that display.
		assert.equal(isDisabled(menuItem(menu, ENGLISH_COPY.multiview)), false);
		assert.equal(isDisabled(menuItem(menu, ENGLISH_COPY.spectralBoxSelect)), true);
		assert.equal(isDisabled(menuItem(menu, ENGLISH_COPY.spectralBrush)), true);
		assert.equal(isChecked(menuItem(menu, ENGLISH_COPY.multiview)), false);
	} finally {
		await fixture.cleanup();
	}
});

test('the multi-view option turns the whole timeline into multi-view and back', async () => {
	const waveform = await mountedControl({ view: 'waveform' });
	try {
		const menu = await openOptions(waveform);
		await act(async () => { reactProps(menuItem(menu, ENGLISH_COPY.multiview)).onClick({ stopPropagation() {} }); });
		assert.deepEqual(waveform.calls.splice(0), ['multiview']);
		assert.equal(waveform.dom.find('[role="menu"]'), null, 'choosing a view closes the options');
	} finally {
		await waveform.cleanup();
	}

	const multiview = await mountedControl({ view: 'multiview' });
	try {
		const menu = await openOptions(multiview);
		assert.equal(isChecked(menuItem(menu, ENGLISH_COPY.multiview)), true);
		// A multi-view track draws a spectrogram in its lower half, so the
		// spectral tools act on it as they do on a full spectrogram.
		assert.equal(isDisabled(menuItem(menu, ENGLISH_COPY.spectralBoxSelect)), false);
		assert.equal(isDisabled(menuItem(menu, ENGLISH_COPY.spectralBrush)), false);
		await act(async () => { reactProps(menuItem(menu, ENGLISH_COPY.multiview)).onClick({ stopPropagation() {} }); });
		assert.deepEqual(multiview.calls.splice(0), ['waveform']);
	} finally {
		await multiview.cleanup();
	}
});

test('the customize-toolbar list offers the spectrogram button without its own options', async () => {
	const toolbar = await readFile(TOOLBAR, 'utf8');
	assert.match(toolbar, /\{ id: 'spectrogram-view', label: copy\.spectrogramView, icon: 'spectrogram' \},/u);
	assert.doesNotMatch(toolbar, /id: 'spectral-box-select'/u);
	assert.doesNotMatch(toolbar, /id: 'spectral-brush'/u);
	assert.doesNotMatch(toolbar, /isToolbarButtonVisible\('spectral-/u);
	assert.match(toolbar, /isToolbarButtonVisible\('spectrogram-view'\) && <SpectrogramToolControl/u);
});

async function mountedControl(timeline: Record<string, unknown>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[] = [];
	const controller = {
		actions: { timeline: { setAllTracksView: (view: unknown) => { calls.push(view); } } },
	};
	const snapshot = {
		timeline,
		selectedTrackId: 'audio-track',
		project: {
			id: 'project',
			tracks: [{ id: 'audio-track', type: 'audio', displayMode: 'waveform' }],
			clips: [],
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<SpectrogramToolControl
		actionRuntime={{ tools: { toggleSpectralBrush: () => undefined } }}
		blocked={false}
		controller={controller}
		copy={ENGLISH_COPY}
		onOpenSpectralSelection={() => undefined}
		run={(operation: () => unknown) => operation()}
		snapshot={snapshot}
		uiFlags={{ spectralBrush: false }}
	/>));
	return {
		dom,
		calls,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

async function openOptions(fixture: Awaited<ReturnType<typeof mountedControl>>): Promise<ReactTestElement> {
	const arrow = fixture.dom.one('.kw-audio-editor__split-button-arrow');
	await act(async () => { reactProps(arrow).onClick({ nativeEvent: { detail: 1 } }); });
	return fixture.dom.one('.kw-audio-editor__spectrogram-tool-options');
}

function menuItems(menu: ReactTestElement): ReactTestElement[] {
	return menu.querySelectorAll('[role="menuitem"]');
}

function menuLabels(menu: ReactTestElement): string[] {
	return menuItems(menu).map((item) => item.querySelector('.context-menu-item-label')?.textContent ?? '');
}

function menuItem(menu: ReactTestElement, label: string): ReactTestElement {
	const item = menuItems(menu).find((candidate) => (
		candidate.querySelector('.context-menu-item-label')?.textContent === label
	));
	assert.ok(item, `Missing option ${label}`);
	return item;
}

function isDisabled(item: ReactTestElement): boolean {
	return item.getAttribute('aria-disabled') === 'true';
}

// The checkmark cell is always rendered; the icon inside it is what marks the
// option as the timeline's current display.
function isChecked(item: ReactTestElement): boolean {
	const checkmark = item.querySelector('.context-menu-item-checkmark');
	assert.ok(checkmark, 'options always render a checkmark cell');
	return checkmark.querySelectorAll('.icon').length === 1;
}
