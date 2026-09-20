/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { AudioDevicesFlyout } from '../src/common/editor/ui/toolbar/AudioEditorMeterControls.jsx';
import { EditorActionBar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const ROOT = new URL('../', import.meta.url);

test('audio devices honor an explicit display-audio capability without changing the default', () => {
	const omitted = renderToStaticMarkup(<AudioDevicesFlyout {...audioDeviceProps()} />);
	const supported = renderToStaticMarkup(<AudioDevicesFlyout {...audioDeviceProps()} displayAudioSupported />);
	const unsupported = renderToStaticMarkup(<AudioDevicesFlyout {...audioDeviceProps()} displayAudioSupported={false} />);
	const displayOption = `<option value="display">${ENGLISH_COPY.recordingDesktopAudio}</option>`;

	assert.equal(omitted.includes(displayOption), true);
	assert.equal(supported.includes(displayOption), true);
	assert.equal(unsupported.includes(displayOption), false);
});

test('the action-bar Audio setup flyout hides desktop audio when the host reports it unavailable', async () => {
	const unavailable = await mountedActionBar(false);
	try {
		assert.equal(inputOptions(unavailable.body).includes(ENGLISH_COPY.recordingDesktopAudio), false);
	} finally {
		await unavailable.cleanup();
	}

	const available = await mountedActionBar(true);
	try {
		assert.equal(inputOptions(available.body).includes(ENGLISH_COPY.recordingDesktopAudio), true);
	} finally {
		await available.cleanup();
	}
});

test('Audio preferences receives the same resolved display-audio capability', () => {
	const unavailable = preferencesMarkup(false);
	const available = preferencesMarkup(true);
	const displayOption = `<option value="display">${ENGLISH_COPY.recordingDesktopAudio}</option>`;

	assert.equal(unavailable.includes(displayOption), false);
	assert.equal(available.includes(displayOption), true);
});

test('the workspace model forwards display-audio support to both Audio setup entry points', async () => {
	const [view, overlays] = await Promise.all([
		readFile(new URL('src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', ROOT), 'utf8'),
	]);

	assert.match(view, /<EditorActionBar[\s\S]*?displayAudioSupported=\{displayAudioSupported\}[\s\S]*?\/>/u);
	assert.match(overlays, /<WorkspacePreferencesDialog[\s\S]*?displayAudioSupported=\{displayAudioSupported\}[\s\S]*?\/>/u);
});

function audioDevices() {
	return {
		inputs: [], outputs: [], preferredInputDeviceId: 'default', preferredInputChannelCount: 1,
		preferredOutputDeviceId: '', inputAccess: true, inputSupported: true,
		microphoneInputSupported: true, displayInputSupported: true, displayCaptureOpen: false,
		outputSupported: true, outputStatus: 'default',
	};
}

function snapshot() {
	return {
		project: null,
		history: { canUndo: false, canRedo: false },
		preferences: createAudioEditorPreferencesV1({}),
		audioDevices: audioDevices(),
		recordingInputs: { hasOpenInputs: false },
	};
}

function controller() {
	return {
		actions: {
			audioDevices: {},
			preferences: {},
			recording: {},
		},
	};
}

function run(operation: () => unknown) {
	return operation();
}

function audioDeviceProps() {
	return { copy: ENGLISH_COPY, snapshot: snapshot(), controller: controller(), run };
}

function preferencesMarkup(displayAudioSupported: boolean): string {
	return renderToStaticMarkup(<WorkspacePreferencesDialog
		controller={controller()}
		snapshot={snapshot()}
		copy={ENGLISH_COPY}
		locale="en"
		fileService={{ isDesktop: true }}
		menus={[]}
		run={run}
		initialPage="audio"
		displayAudioSupported={displayAudioSupported}
		onTogglePanel={() => undefined}
		onClose={() => undefined}
	/>);
}

async function mountedActionBar(displayAudioSupported: boolean) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<EditorActionBar
		copy={ENGLISH_COPY}
		snapshot={snapshot()}
		controller={controller()}
		showAup4={false}
		run={run}
		editBlocked={false}
		blocked={false}
		executeEdit={() => undefined}
		onSaveAup4={() => undefined}
		onExportAudio={() => undefined}
		onToggleMixer={() => undefined}
		displayAudioSupported={displayAudioSupported}
	/>));
	const trigger = dom.one('[data-action="audio-devices"]').querySelector('button');
	assert.ok(trigger);
	await act(async () => { reactProps(trigger).onClick({ nativeEvent: { detail: 1 } }); });
	const body = (globalThis as unknown as { document: { body: ReactTestElement } }).document.body;
	return {
		body,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function inputOptions(body: ReactTestElement): string[] {
	const flyout = body.querySelector('[data-audio-devices-flyout]');
	assert.ok(flyout, 'the Audio setup flyout is mounted');
	const input = flyout.querySelector('select');
	assert.ok(input, 'the Audio setup input selector is mounted');
	return input.options.map((option) => option.textContent);
}
