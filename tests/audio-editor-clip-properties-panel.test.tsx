/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type ComponentProps } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the upstream properties surface follows selection and keeps the source viewer separate', async () => {
	const f = await fixture();
	try {
		await f.render(['one']);
		assert.equal(f.input('name').value, 'First clip');
		assert.ok(f.dom.find('[data-clip-properties-field="strip"]'));
		assert.equal(f.dom.find('[data-audio-source-monitor-panel]'), null);
		assert.equal(f.dom.find('[data-clip-properties-drawer]'), null);
		await f.render(['two']);
		assert.equal(f.input('name').value, 'Second source');
		await f.render([]);
		assert.ok(f.dom.find('[data-clip-properties-empty]'));
	} finally { await f.cleanup(); }
});

test('merged clip properties edit all selected clips in one native batch without changing selection', async () => {
	const f = await fixture();
	try {
		await f.render(['one', 'two']);
		assert.equal(f.dom.find('[role="tablist"]'), null);
		assert.equal(f.dom.one('[data-clip-properties-panel]').getAttribute('data-selection'), '2');
		assert.equal(f.input('pitch').getAttribute('placeholder'), ENGLISH_COPY.clipMixed);
		await f.typeAndCommit('pitch', '2');
		assert.deepEqual(f.timePitch, [{ ids: ['one', 'two'], changes: { pitchCents: 200 } }]);
		const reverse = f.dom.one('[data-clip-properties-field="reverse"]');
		await act(async () => reactProps(reverse).onClick());
		assert.deepEqual(f.commits, [{ type: 'batch', commands: [
			{ type: 'clip/update', clipId: 'one', changes: { reversed: true } },
			{ type: 'clip/update', clipId: 'two', changes: { reversed: true } },
		] }]);
		assert.deepEqual(f.project().selection.clipIds, ['one', 'two']);
	} finally { await f.cleanup(); }
});

test('opening requests focus pitch and speed once when their dock becomes active', async () => {
	const f = await fixture();
	try {
		let handled = 0;
		const request = { projectId: 'project-a', clipId: 'two', field: 'speedRatio', onHandled: () => { handled++; } } as const;
		await f.render(['one', 'two'], { focusRequest: request, panelActive: false });
		assert.notEqual(document.activeElement, f.input('speed'));
		await f.render(['one', 'two'], { focusRequest: request, panelActive: true });
		assert.equal(document.activeElement, f.input('speed') as unknown as Element);
		assert.equal(handled, 1);
		f.input('pitch').focus();
		await f.render(['one', 'two'], { focusRequest: request });
		assert.equal(document.activeElement, f.input('pitch') as unknown as Element);
		assert.equal(handled, 1);
	} finally { await f.cleanup(); }
});

test('drafts and stale callbacks cannot target a different selection or project', async () => {
	const f = await fixture();
	try {
		await f.render(['one']);
		await f.type('name', 'Uncommitted');
		const stale = reactProps(f.input('name')).onBlur;
		await f.render(['two']);
		assert.equal(f.input('name').value, 'Second source');
		await act(async () => stale());
		assert.deepEqual(f.updates, []);
		await f.type('name', 'Old project');
		const otherStale = reactProps(f.input('name')).onBlur;
		await f.render(['two'], { projectId: 'project-b' });
		await act(async () => otherStale());
		assert.deepEqual(f.updates, []);
	} finally { await f.cleanup(); }
});

test('Escape discards a rename before synchronous blur and Enter commits only once', async () => {
	const f = await fixture();
	try {
		await f.render(['one']);
		const name = f.input('name');
		Object.defineProperty(name, 'blur', { configurable: true, value: () => reactProps(name).onBlur() });
		await f.type('name', 'Discard me');
		await act(async () => reactProps(f.dom.one('[data-clip-properties-field="name"]')).onKeyDown({ key: 'Escape', target: name, stopPropagation() {} }));
		assert.deepEqual(f.updates, []);
		assert.equal(name.value, 'First clip');
		await f.type('name', 'New name');
		await act(async () => reactProps(f.dom.one('[data-clip-properties-field="name"]')).onKeyDown({ key: 'Enter', target: name }));
		assert.deepEqual(f.updates, [{ id: 'one', changes: { title: 'New name' } }]);
	} finally { await f.cleanup(); }
});

test('native blocked state disables every property mutation while German fields keep accessible names', async () => {
	const f = await fixture();
	try {
		await f.render(['one'], { locked: true, copy: GERMAN_COPY });
		assert.notEqual(f.input('name').getAttribute('disabled'), null);
		assert.notEqual(f.input('pitch').getAttribute('disabled'), null);
		assert.equal(f.input('name').getAttribute('aria-label'), GERMAN_COPY.clipName);
		assert.equal(f.input('pitch').getAttribute('aria-label'), GERMAN_COPY.clipPitchField);
		await f.render(['one']);
		assert.equal(f.input('name').getAttribute('disabled'), null);
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
	let current = project();
	const updates: unknown[] = [], commits: unknown[] = [], timePitch: unknown[] = [];
	const controller = { get project() { return current; }, actions: {
		edit: { commit: (command: unknown) => { commits.push(command); } },
		clip: { update: (id: string, changes: unknown) => { updates.push({ id, changes }); },
			setTimePitch: (id: string, changes: unknown) => { timePitch.push({ ids: [id], changes }); },
			setTimePitchMany: (ids: readonly string[], changes: unknown) => { timePitch.push({ ids, changes }); } },
	} };
	const field = (name: string) => dom.one(`[data-clip-properties-field="${name}"]`);
	const input = (name: string) => { const value = field(name).querySelector('input'); assert.ok(value); return value; };
	const type = async (name: string, value: string) => {
		input(name).focus();
		await act(async () => reactProps(input(name)).onChange({ target: { value } }));
	};
	return { dom, input, updates, commits, timePitch, type, project: () => current,
		typeAndCommit: async (name: string, value: string) => { await type(name, value); await act(async () => reactProps(field(name)).onBlur({ target: input(name) })); },
		render: async (ids: string[], options: { projectId?: string; locked?: boolean; copy?: typeof ENGLISH_COPY;
			focusRequest?: ComponentProps<typeof ClipPropertiesPanel>['focusRequest']; panelActive?: boolean } = {}) => {
			current = project(options.projectId, ids, options.locked);
			await act(async () => root.render(<ClipPropertiesPanel controller={controller} copy={options.copy ?? ENGLISH_COPY}
				snapshot={{ project: current, selectedClipIds: ids, selectedClipId: ids[0] ?? null, capabilities: { audioEffects: true } }}
				focusRequest={options.focusRequest} panelActive={options.panelActive} />));
		},
		cleanup: async () => { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); },
	};
}
function project(id = 'project-a', selectedIds: string[] = [], locked = false) {
	const sources = ['one', 'two'].map(key => createAudioSource({ id: `source-${key}`, name: key === 'one' ? 'First source' : 'Second source',
		storageKey: `${id}-${key}`, frameCount: 48_000, channelCount: 1, sampleRate: 48_000 }));
	const clips = ['one', 'two'].map(key => createAudioClip({ id: key, sourceId: `source-${key}`, title: key === 'one' ? 'First clip' : '',
		timelineStartFrame: 0, durationFrames: 24_000, sourceStartFrame: 0, sourceDurationFrames: 24_000, pitchCents: key === 'one' ? 0 : 100 }));
	const created = createSoundscaperProject({ id, title: id, now: '2026-10-02T00:00:00.000Z', sources, clips,
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: clips.map(clip => clip.id), locked })],
		selection: { clipIds: selectedIds, trackIds: ['track'], startFrame: 0, endFrame: 0 } });
	return { ...created, clips: created.clips.map(clip => clip.id === 'two' ? { ...clip, title: '' } : clip) };
}
