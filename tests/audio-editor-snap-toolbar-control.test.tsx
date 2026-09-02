/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { audacityActionDefinition } from '../src/common/editor/audacity-action-parity.js';
import { createSnapMenu, snapMenuCurrentLabel } from '../src/common/editor/ui/application-menu-model.js';
import SnapToolbarControl from '../src/common/editor/ui/toolbar/SnapToolbarControl.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

// The .jsx sources compile to the classic runtime under tsx, so the control
// needs the React global that the Vite build provides automatically.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const UI = new URL('../src/common/editor/ui/', import.meta.url);
const MUSICAL_LABELS = ['Bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64', '1/128'];

test('the snap dropdown label is the checked interval, skipping the toggle rows', () => {
	const label = (project: unknown) => snapMenuCurrentLabel(createSnapMenu(ENGLISH_COPY, project, false, () => undefined));
	assert.equal(label({ snap: { enabled: true, unit: '1/4', division: '1/4' } }), '1/4');
	assert.equal(label({ snap: { enabled: true, triplets: true, unit: '1/8', division: '1/8' } }), '1/8');
	assert.equal(label({ snap: { enabled: true, unit: 'bar', division: 'bar' } }), 'Bar');
	assert.equal(label({ snap: { enabled: true, unit: 'cdda', division: 'cdda' } }), 'CDDA frames (75 fps)');
	assert.equal(label(undefined), 'Seconds');
	assert.equal(label({ snap: { enabled: true, unit: 'unknown-unit', division: 'unknown-unit' } }), 'Seconds');
});

test('the snap control reflects the project snap state and the edit block', () => {
	const enabled = markup({ project: project({ enabled: true, unit: '1/8', division: '1/8' }) });
	assert.match(enabled, /role="checkbox"[^>]*aria-checked="true"[^>]*aria-label="Snap"/u);
	assert.match(enabled, /data-snap-control/u);
	assert.match(enabled, /<button[^>]*data-snap-interval[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-label="Snap interval: 1\/8"/u);
	assert.doesNotMatch(enabled, /<button[^>]*data-snap-interval[^>]*disabled/u);
	assert.match(enabled, />1\/8</u);

	const off = markup({ project: project({ enabled: false, unit: '1/8', division: '1/8' }) });
	assert.match(off, /role="checkbox"[^>]*aria-checked="false"/u);
	assert.match(off, /<button[^>]*data-snap-interval[^>]*disabled=""/u);
	assert.doesNotMatch(off, /checkbox--disabled/u);

	const readOnly = markup({ project: project({ enabled: true }), readOnly: true });
	assert.match(readOnly, /checkbox--disabled/u);
	assert.match(readOnly, /<button[^>]*data-snap-interval[^>]*disabled=""/u);

	const noProject = markup({ project: null });
	assert.match(noProject, /checkbox--disabled/u);
	assert.match(noProject, /<button[^>]*data-snap-interval[^>]*disabled=""/u);
	assert.match(noProject, /aria-label="Snap interval: Seconds"/u);
});

test('the snap checkbox and the interval menu drive timeline.setSnap', async () => {
	const fixture = await mountedControl(project({ enabled: true, unit: '1/8', division: '1/8' }));
	try {
		// One click on the vendored checkbox fires the inner control and its
		// label wrapper; the gesture must reach the controller exactly once.
		await act(async () => {
			reactProps(fixture.dom.one('[role="checkbox"]')).onClick({});
			reactProps(fixture.dom.one('.labeled-checkbox')).onClick({});
		});
		assert.deepEqual(fixture.calls.splice(0), [{ enabled: false }]);

		const trigger = fixture.dom.one('[data-snap-interval]');
		await act(async () => { reactProps(trigger).onClick({ nativeEvent: { detail: 1 } }); });
		assert.equal(trigger.getAttribute('aria-expanded'), 'true');
		const menu = fixture.dom.one('[role="menu"]');
		assert.ok(menu.getAttribute('class')?.includes('kw-audio-editor__snap-menu'));
		assert.deepEqual(menuLabels(menu), [
			...MUSICAL_LABELS, 'Enable triplets', 'Seconds and samples', 'Video frames', 'CD frames',
		]);
		assert.equal(menu.querySelectorAll('[role="separator"]').length, 2);
		assert.equal(isChecked(menuItem(menu, '1/8')), true);
		assert.equal(isChecked(menuItem(menu, 'Bar')), false);
		for (const item of menu.childNodes) {
			assert.ok(item instanceof fixture.ElementClass, 'menu children must be direct ContextMenuItems');
		}

		await act(async () => { reactProps(menuItem(menu, 'Enable triplets')).onClick({ stopPropagation() {} }); });
		assert.deepEqual(fixture.calls.splice(0), [{ triplets: true }]);
		assert.ok(fixture.dom.find('[role="menu"]'), 'toggling triplets keeps the menu open');

		await act(async () => { reactProps(menuItem(fixture.dom.one('[role="menu"]'), '1/4')).onClick({ stopPropagation() {} }); });
		assert.deepEqual(fixture.calls.splice(0), [{ unit: '1/4', division: '1/4' }]);
		assert.equal(fixture.dom.find('[role="menu"]'), null, 'choosing an interval closes the menu');
		assert.equal(trigger.getAttribute('aria-expanded'), 'false');
	} finally {
		await fixture.cleanup();
	}
});

test('the time, video and CD groups open as submenus that close the menu on choice', async () => {
	const fixture = await mountedControl(project({ enabled: true, unit: 'seconds', division: 'seconds' }));
	try {
		await act(async () => { reactProps(fixture.dom.one('[data-snap-interval]')).onClick({ nativeEvent: { detail: 0 } }); });
		const menu = fixture.dom.one('[role="menu"]');
		const timeGroup = menuItem(menu, 'Seconds and samples');
		assert.equal(isChecked(timeGroup), true, 'the group holding the checked unit is checked');
		assert.equal(isChecked(menuItem(menu, 'Video frames')), false);
		await act(async () => { reactProps(timeGroup).onClick({ stopPropagation() {} }); });
		const submenu = timeGroup.querySelector('[role="menu"]');
		assert.ok(submenu);
		assert.deepEqual(menuLabels(submenu), ['Seconds', 'Deciseconds', 'Centiseconds', 'Milliseconds', 'Samples']);
		await act(async () => { reactProps(menuItem(submenu, 'Samples')).onClick({ stopPropagation() {} }); });
		assert.deepEqual(fixture.calls.splice(0), [{ unit: 'samples', division: 'samples' }]);
		assert.equal(fixture.dom.find('[role="menu"]'), null);
	} finally {
		await fixture.cleanup();
	}
});

test('the toolbar hosts the snap control between the time display and the meters', async () => {
	const [toolbar, shortcuts, css] = await Promise.all([
		readFile(new URL('toolbar/EditorToolToolbar.jsx', UI), 'utf8'),
		readFile(new URL('workspace-shortcuts.ts', UI), 'utf8'),
		readFile(new URL('audio-editor-design-system/03-shell-toolbars-meters.css', UI), 'utf8'),
	]);
	assert.match(toolbar, /\{ id: 'time-display', label: copy\.timecode, icon: 'playhead' \},\n\s*\{ id: 'snap', label: copy\.snap, icon: iconNameToChar\('MAGNET'\) \}/u);
	assert.match(toolbar, /isToolbarButtonVisible\('snap'\) && <SnapToolbarControl/u);
	const timecodeAt = toolbar.indexOf('<TelemetryTimeCode');
	const sequenceAt = toolbar.indexOf('<SequenceTimingControls');
	const snapAt = toolbar.indexOf('<SnapToolbarControl');
	const recordingMeterAt = toolbar.indexOf('<RecordingMeterToolbarGroup');
	assert.ok(timecodeAt > 0 && sequenceAt > timecodeAt && snapAt > sequenceAt && recordingMeterAt > snapAt);
	assert.match(shortcuts, /'button, select, input, \[role="group"\], \[role="checkbox"\]'/u);
	assert.match(css, /\.kw-audio-editor__snap-interval/u);
	const snap = audacityActionDefinition('snap');
	assert.deepEqual(snap.locations, ['Transport toolbar']);
	assert.equal(snap.handler, 'timeline.configureSnap');
});

function project(snap: Record<string, unknown>) {
	return { id: 'project', title: 'project', revision: 1, sampleRate: 48_000, tracks: [], clips: [], snap };
}

function markup(snapshot: Record<string, unknown>) {
	return renderToStaticMarkup(<SnapToolbarControl
		controller={{ actions: { timeline: { setSnap: () => undefined } } }}
		snapshot={snapshot}
		copy={ENGLISH_COPY}
		run={(operation: () => unknown) => operation()}
	/>);
}

function menuLabels(menu: ReactTestElement): string[] {
	return menu.childNodes
		.filter((node): node is ReactTestElement => node instanceof ReactTestElement && node.getAttribute('role') === 'menuitem')
		.map((item) => item.querySelector('.context-menu-item-label')?.textContent ?? '');
}

// The item's own checkmark cell precedes any open submenu in document order.
function isChecked(item: ReactTestElement): boolean {
	const checkmark = item.querySelector('.context-menu-item-checkmark');
	assert.ok(checkmark, 'snap items always render a checkmark cell');
	return checkmark.querySelectorAll('.icon').length === 1;
}

function menuItem(menu: ReactTestElement, label: string): ReactTestElement {
	const item = menu.childNodes.find((node): node is ReactTestElement => (
		node instanceof ReactTestElement
		&& node.getAttribute('role') === 'menuitem'
		&& node.querySelector('.context-menu-item-label')?.textContent === label
	));
	assert.ok(item, `Missing menu item ${label}`);
	return item;
}

async function mountedControl(projectValue: unknown) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[] = [];
	const controller = { actions: { timeline: { setSnap: (settings: unknown) => { calls.push(settings); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<SnapToolbarControl
		controller={controller}
		snapshot={{ project: projectValue }}
		copy={ENGLISH_COPY}
		run={(operation: () => unknown) => operation()}
	/>));
	return {
		dom,
		calls,
		ElementClass: ReactTestElement,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
