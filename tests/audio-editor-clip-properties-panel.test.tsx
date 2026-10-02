/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type ComponentProps } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the live panel follows single selection without showing redundant tabs', async () => {
	const f = await fixture();
	try {
		await f.render(['one']);
		assert.equal(f.dom.find('[role="tablist"]'), null);
		assert.equal(f.input('name').value, 'First clip');
		await f.render(['two']);
		assert.equal(f.input('name').value, 'Second source');
		await f.render([]);
		assert.ok(f.dom.find('[data-no-clip]'));
		assert.equal(f.dom.find('[data-clip-fields]'), null);
	} finally { await f.cleanup(); }
});

test('selected clips have accessible local tabs and every commit targets the active tab', async () => {
	const f = await fixture();
	try {
		await f.render(['one', 'two']);
		assert.deepEqual(f.tabs().map((tab) => tab.textContent), ['First clip', 'Second source']);
		await f.clickTab('two');
		assert.equal(f.dom.one('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip'), 'two');
		assert.equal(f.tab('two').getAttribute('aria-selected'), 'true');
		assert.equal(f.tab('one').getAttribute('tabindex'), '-1');
		await f.type('name', 'Renamed second clip');
		await f.blur('name');
		assert.deepEqual(f.updates, [{ clipId: 'two', changes: { title: 'Renamed second clip' } }]);
		await f.type('speedRatio', '1.5');
		await f.blur('speedRatio');
		assert.deepEqual(f.timePitchCalls, [{ clipId: 'two', changes: { speedRatio: 1.5 } }]);
		await f.clickAction('normalize-peak');
		assert.deepEqual(f.normalizeCalls, ['two'], 'async transforms receive the explicit active clip id');
		assert.deepEqual(f.project().selection.clipIds, ['one', 'two'], 'local tabs preserve multi-selection');
		await f.render(['two', 'one'], { primary: 'one' });
		assert.equal(f.tab('two').getAttribute('aria-selected'), 'true', 'selection reorder preserves the active tab');
		await act(async () => reactProps(f.tab('two')).onKeyDown({ key: 'End', preventDefault() {} }));
		assert.equal(f.tab('one').getAttribute('aria-selected'), 'true');
		assert.equal(f.dom.container.ownerDocument.activeElement, f.tab('one'));
		const body = f.dom.one('[data-clip-properties-active-clip]');
		assert.equal(body.getAttribute('aria-labelledby'), f.tab('one').getAttribute('id'));
		assert.equal(f.tab('one').getAttribute('aria-controls'), body.getAttribute('id'));
	} finally { await f.cleanup(); }
});

test('half-typed drafts and stale callbacks never cross clips or projects, including repeated ids', async () => {
	const f = await fixture();
	try {
		await f.render(['one', 'two']);
		await f.type('gain', '7');
		const staleBlur = reactProps(f.input('gain')).onBlur;
		await f.clickTab('two');
		assert.equal(f.input('gain').value, '0.00', 'equal saved values still discard the other clip draft');
		await act(async () => staleBlur());
		assert.deepEqual(f.updates, [], 'an unmounted target cannot commit a late blur');
		await f.type('name', 'Uncommitted name');
		await f.render(['one', 'two'], { projectId: 'project-b' });
		assert.equal(f.tab('one').getAttribute('aria-selected'), 'true');
		assert.equal(f.input('name').value, 'First clip');
		await f.render([]);
		await f.render(['one', 'two']);
		assert.equal(f.tab('one').getAttribute('aria-selected'), 'true', 'deselection resets the tab choice');
	} finally { await f.cleanup(); }
});

test('removed clips and async failures cannot leave a stale target or paint another tab', async () => {
	const f = await fixture();
	try {
		await f.render(['one', 'two']);
		await f.clickAction('normalize-peak');
		await f.clickTab('two');
		await act(async () => {
			f.normalization.reject(new Error('First clip failed'));
			await f.normalization.promise.catch(() => undefined);
		});
		assert.equal(f.dom.find('[role="alert"]'), null);
		await f.render(['one', 'two'], { removeClip: 'two' });
		assert.equal(f.dom.find('[role="tablist"]'), null);
		assert.equal(f.input('name').value, 'First clip');
	} finally { await f.cleanup(); }
});

test('opening requests activate and focus the requested clip once, after its dock tab becomes active', async () => {
	const f = await fixture();
	try {
		const request = { clipId: 'two', field: 'speedRatio' } as const;
		await f.render(['one', 'two'], { focusRequest: request, panelActive: false });
		assert.notEqual(f.dom.container.ownerDocument.activeElement, f.input('speedRatio'));
		await f.render(['one', 'two'], { focusRequest: request, panelActive: true });
		assert.equal(f.tab('two').getAttribute('aria-selected'), 'true');
		assert.equal(f.dom.container.ownerDocument.activeElement, f.input('speedRatio'));
		await f.clickTab('one');
		f.tab('one').focus();
		await f.render(['one', 'two'], { focusRequest: request });
		assert.equal(f.tab('one').getAttribute('aria-selected'), 'true');
		assert.equal(f.dom.container.ownerDocument.activeElement, f.tab('one'), 'live snapshots do not replay opening focus');
		await f.render(['one', 'two'], { focusRequest: { clipId: 'two', field: null } });
		assert.equal(f.dom.container.ownerDocument.activeElement, f.input('name'));
	} finally { await f.cleanup(); }
});

test('project-scoped opening requests discard stale targets without activating or focusing another project', async () => {
	const f = await fixture();
	try {
		let handled = 0;
		const request = { projectId: 'project-b', clipId: 'two', field: 'speedRatio', onHandled: () => { handled += 1; } } as const;
		await f.render(['one', 'two'], { focusRequest: request });
		assert.equal(f.tab('one').getAttribute('aria-selected'), 'true');
		assert.notEqual(f.dom.container.ownerDocument.activeElement, f.input('speedRatio'));
		assert.equal(handled, 1);
		await f.render(['one', 'two'], { focusRequest: request });
		assert.equal(handled, 1, 'a discarded request is acknowledged only once');
		await f.render(['one'], { focusRequest: { projectId: 'project-a', clipId: 'two', field: null, onHandled: () => { handled += 1; } } });
		assert.equal(handled, 2, 'a removed requested clip is discarded');
		assert.notEqual(f.dom.container.ownerDocument.activeElement, f.input('name'));
	} finally { await f.cleanup(); }
});

test('acknowledging opening focus lets dock remounts preserve the current menu focus', async () => {
	const f = await fixture();
	try {
		let pending: ComponentProps<typeof ClipPropertiesPanel>['focusRequest'] = {
			projectId: 'project-a', clipId: 'two', field: null, onHandled: () => { pending = null; },
		};
		await f.render(['one', 'two'], { focusRequest: pending });
		assert.equal(pending, null, 'the owner can retire consumed focus before remounting the panel');
		const menuItem = f.dom.container.ownerDocument.createElement('button');
		f.dom.container.ownerDocument.body.appendChild(menuItem);
		menuItem.focus();
		await f.render(['one', 'two'], { focusRequest: pending, mountKey: 'new-dock' });
		assert.equal(f.dom.container.ownerDocument.activeElement, menuItem);
	} finally { await f.cleanup(); }
});

async function fixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let currentProject = project();
	const updates: Array<{ clipId: string; changes: unknown }> = [];
	const normalization = deferred<void>();
	const normalizeCalls: string[] = [];
	const timePitchCalls: Array<{ clipId: string; changes: unknown }> = [];
	const controller = {
		get project() { return currentProject; },
		actions: { clip: {
			update: (clipId: string, changes: unknown) => { updates.push({ clipId, changes }); },
			move: () => undefined, trim: () => undefined,
			setTimePitch: (clipId: string, changes: unknown) => { timePitchCalls.push({ clipId, changes }); },
			toggleStretchToTempo: () => undefined, reverse: () => undefined, invert: () => undefined,
			normalizePeak: (clipId: string) => { normalizeCalls.push(clipId); return normalization.promise; }, normalizeLoudness: () => undefined,
			renderPitchSpeed: () => undefined, resetPitchSpeed: () => undefined,
		} },
	};
	const input = (field: string) => {
		const element = dom.one(`[data-clip-field="${field}"]`).querySelector('input');
		assert.ok(element);
		return element;
	};
	const tab = (clipId: string) => dom.one(`[data-clip-properties-tab="${clipId}"]`);
	return {
		dom, updates, normalization, normalizeCalls, timePitchCalls, input, tab,
		project: () => currentProject,
		tabs: () => dom.container.querySelectorAll('[data-clip-properties-tab]'),
		render: async (ids: string[], options: {
			projectId?: string; primary?: string; removeClip?: string; mountKey?: string;
			focusRequest?: ComponentProps<typeof ClipPropertiesPanel>['focusRequest']; panelActive?: boolean;
		} = {}) => {
			currentProject = project(options.projectId, ids, options.removeClip);
			await act(async () => root.render(<ClipPropertiesPanel key={options.mountKey ?? "initial-dock"} controller={controller} copy={ENGLISH_COPY}
				snapshot={{ project: currentProject, selectedClipIds: ids, selectedClipId: options.primary ?? ids[0] ?? null,
					capabilities: { audioEffects: true, videoEffects: false } }}
				focusRequest={options.focusRequest} panelActive={options.panelActive} />));
		},
		clickTab: async (clipId: string) => { await act(async () => reactProps(tab(clipId)).onClick()); },
		type: async (field: string, value: string) => { await act(async () => reactProps(input(field)).onChange({ target: { value } })); },
		blur: async (field: string) => { await act(async () => reactProps(input(field)).onBlur()); },
		clickAction: async (hook: string) => {
			const button = dom.one(`[data-clip-action="${hook}"]`).querySelector('button');
			assert.ok(button);
			await act(async () => { reactProps(button).onClick(); await Promise.resolve(); });
		},
		cleanup: async () => {
			normalization.resolve();
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project(id = 'project-a', selectedIds: string[] = [], removeClip?: string) {
	const sources = ['one', 'two'].map((key) => createAudioSource({ id: `source-${key}`, name: key === 'one' ? 'First source' : 'Second source',
		storageKey: `${id}-${key}`, frameCount: 1_000, channelCount: 1, sampleRate: 48_000 }));
	const clips = ['one', 'two'].filter((key) => key !== removeClip).map((key) => createAudioClip({
		id: key, sourceId: `source-${key}`, title: key === 'one' ? 'First clip' : '',
		timelineStartFrame: 0, durationFrames: 200, sourceStartFrame: 0, sourceDurationFrames: 200,
	}));
	const created = createSoundscaperProject({ id, title: id, now: '2026-10-02T00:00:00.000Z', sources, clips,
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: clips.map(({ id }) => id) })],
		selection: { clipIds: selectedIds.filter((clipId) => clipId !== removeClip), trackIds: ['track'], startFrame: 0, endFrame: 0 },
	});
	return { ...created, clips: created.clips.map((clip) => clip.id === 'two' ? { ...clip, title: '' } : clip) };
}
