/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorActionBar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const snapshot = (visible: boolean) => ({
	history: { canUndo: false, canRedo: false },
	preferences: { workspace: { panels: { freesound: { visible } } } },
	audioDevices: { inputs: [], outputs: [], inputAccess: true, inputSupported: false, outputSupported: false },
});
const actionBar = (visible: boolean, showFreesound = true, onToggleFreesound = () => undefined) => (
	<EditorActionBar
		copy={ENGLISH_COPY}
		snapshot={snapshot(visible)}
		controller={{ actions: { recording: {}, preferences: {}, audioDevices: {} } }}
		showAup4={showFreesound}
		showFreesound={showFreesound}
		run={(operation: () => unknown) => operation()}
		editBlocked={false}
		blocked={false}
		executeEdit={() => undefined}
		onSaveAup4={() => undefined}
		onExportAudio={() => undefined}
		onToggleMixer={() => undefined}
		onToggleFreesound={onToggleFreesound}
	/>
);

test('the Soundscaper action bar offers a waveform SFX panel toggle', async () => {
	const closed = renderToStaticMarkup(actionBar(false));
	const opened = renderToStaticMarkup(actionBar(true));
	assert.match(closed, /data-action="sfx"[^>]*>[\s\S]*?\uF43C[\s\S]*?>SFX</u);
	assert.doesNotMatch(closed, /data-action="sfx"[^>]*>[\s\S]*?kw-audio-editor__action-bar-button--active/u);
	assert.match(opened, /data-action="sfx"[^>]*>[\s\S]*?kw-audio-editor__action-bar-button--active/u);
	assert.doesNotMatch(renderToStaticMarkup(actionBar(false, false)), /data-action="sfx"/u);

	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let toggles = 0;
	try {
		await act(async () => root.render(actionBar(false, true, () => { toggles += 1; })));
		const trigger = dom.one('[data-action="sfx"]').querySelector('button');
		assert.ok(trigger);
		await act(async () => reactProps(trigger).onClick());
		assert.equal(toggles, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
