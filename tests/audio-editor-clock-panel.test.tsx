/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ClockPanel from '../src/common/editor/ui/workspace/ClockPanel.tsx';
import { clockPanelDisplayScale } from '../src/common/editor/ui/workspace/clock-panel-display-model.ts';
import TelemetryTimeCode from '../src/common/editor/ui/toolbar/TelemetryTimeCode.tsx';
import { closeWorkspacePanelAndRestoreFocus } from '../src/common/editor/ui/workspace/workspace-panel-focus.js';
import { createAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const copy = { playhead: 'Playhead', format: 'Format', panelClock: 'Clock',
	timecodeUndock: 'Undock timecode', timecodeRedock: 'Return to toolbar' };

function controllerAt(positionFrame: number) {
	return {
		subscribeTelemetry: (_listener: () => void) => () => undefined,
		getTelemetrySnapshot: () => ({ positionFrame }),
		actions: { transport: { seek: (_frame: number) => undefined },
			sequences: { seekLabel: (_label: string) => undefined },
			preferences: { update: (_changes: unknown) => undefined } },
	};
}

test('the clock fills the available panel while retaining digit proportions', () => {
	assert.equal(clockPanelDisplayScale({ width: 640, height: 200 }, { width: 200, height: 28 }), 3.08);
	assert.equal(clockPanelDisplayScale({ width: 1_000, height: 80 }, { width: 200, height: 28 }), 2);
	assert.equal(clockPanelDisplayScale({ width: 120, height: 160 }, { width: 200, height: 28 }), 0.48);
	assert.equal(clockPanelDisplayScale({ width: 0, height: 0 }, { width: 0, height: 0 }), 1);
});

test('closing the clock returns focus to the toolbar timecode', () => {
	const dom = installReactTestDom();
	try {
		const timer = dom.container.ownerDocument.createElement('div');
		Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, writable: true,
			value: (callback: () => void) => { callback(); return 1; } });
		const closed: string[] = [];
		closeWorkspacePanelAndRestoreFocus({ querySelector: (selector: string) => {
			assert.equal(selector, '[data-editor-tool-toolbar] [data-time-display] .timecode');
			return timer;
		} }, 'clock', (panelId: string) => closed.push(panelId));
		assert.deepEqual(closed, ['clock']);
		assert.equal(dom.container.ownerDocument.activeElement, timer);
	} finally {
		dom.restore();
	}
});

test('the playhead format survives workspace panel changes and rejects frequency formats', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.equal(preferences.workspace.timeDisplayFormat, null);
	const samples = updateAudioEditorPreferencesV1(preferences, { workspace: { timeDisplayFormat: 'samples' } });
	const undocked = updateAudioEditorPreferencesV1(samples, { workspace: { panels: {
		clock: { ...samples.workspace.panels.clock, visible: true, dock: 'floating' },
	} } });
	assert.equal(undocked.workspace.timeDisplayFormat, 'samples');
	assert.equal(createAudioEditorPreferencesV1(JSON.parse(JSON.stringify(undocked))).workspace.timeDisplayFormat, 'samples');
	assert.throws(() => updateAudioEditorPreferencesV1(samples, { workspace: { timeDisplayFormat: 'Hz' } }), /timeDisplayFormat/u);
});

test('the clock renders live sample telemetry in the selected toolbar format', () => {
	const markup = renderToStaticMarkup(<ClockPanel
		controller={controllerAt(48_000)} copy={copy}
		snapshot={{ project: { sampleRate: 48_000, tracks: [], clips: [] }, preferences: { workspace: { timeDisplayFormat: 'samples' } } }}
		run={(operation) => operation()}
	/>);
	assert.match(markup, /data-clock-panel="true"/u);
	assert.match(markup, /data-time-display="true"/u);
	const digits = [...markup.matchAll(/class="timecode-digit[^>]*>(\d)<\/span>/gu)].map((match) => match[1]).join('');
	assert.equal(digits, '48000');
});

test('the existing timecode format dropdown exposes undocking beside grouped format choices', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	dom.container.setAttribute('data-audio-editor', 'true');
	const root = createRoot(dom.container as unknown as Element);
	const changedFormats: string[] = [];
	let undocks = 0;
	try {
		await act(async () => root.render(<TelemetryTimeCode
			controller={controllerAt(0)} copy={copy} project={{ sampleRate: 48_000 }} durationFrames={96_000}
			recording
			run={(operation) => operation()} onUndock={() => { undocks += 1; }}
			onFormatChange={(format) => changedFormats.push(format)}
		/>));
		const button = dom.one('.timecode__format-button');
		assert.equal(button.parentNode, dom.one('.timecode'), 'the application format button stays inside the timer');
		assert.equal(dom.one('.timecode').getAttribute('aria-disabled'), 'true', 'recording disables time edits');
		assert.equal(button.hasAttribute('disabled'), false, 'recording keeps docking available');
		assert.equal(button.getAttribute('tabindex'), '-1', 'the timer keeps one keyboard tab stop');
		await act(async () => reactProps(button).onClick({ detail: 0 }));
		const menuItems = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]');
		const labels = menuItems.map((item) => item.querySelector('.context-menu-item-label')?.textContent);
		assert.ok(labels.includes('Video frames'));
		assert.ok(labels.includes('CD frames'));
		assert.ok(labels.includes('Undock timecode'));
		const samples = menuItems.find((item) => item.querySelector('.context-menu-item-label')?.textContent === 'samples');
		assert.ok(samples);
		await act(async () => reactProps(samples).onClick({}));
		assert.deepEqual(changedFormats, ['samples']);
		await act(async () => reactProps(button).onClick({ detail: 0 }));
		const undock = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]').find(
			(item) => item.querySelector('.context-menu-item-label')?.textContent === 'Undock timecode',
		);
		assert.ok(undock);
		await act(async () => reactProps(undock).onClick({}));
		assert.equal(undocks, 1);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
