/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createEffect, createMissingEffect } from '../src/common/editor/effects.js';
import { createNativePluginEffect } from '../src/common/editor/native-plugin-effect.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import AudioEditorEffectsOverlay from '../src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

type Effect = ReturnType<typeof createEffect> | ReturnType<typeof createNativePluginEffect>;
const native = (enabled = true): Effect => createNativePluginEffect({
	id: 'hosted-gain', enabled,
	params: { instanceId: 'gain-instance', latencyFrames: 0 },
	context: { format: 'ladspa', stablePluginId: 'org.test.gain', binarySha256: 'a'.repeat(64) },
});

for (const scope of ['track', 'master'] as const) {
	test(`${scope} hosted stack cannot promise unsupported copy or macro operations`, async () => {
		const fixture = await mountStack([createEffect('audacity-invert'), native()], scope);
		try {
			await fixture.open();
			const copy = fixture.item('Copy effects');
			const macro = fixture.item('Export as macro');
			assert.equal(copy.getAttribute('aria-disabled'), 'true');
			assert.equal(macro.getAttribute('aria-disabled'), 'true');
			await act(async () => { reactProps(copy).onClick!({}); reactProps(macro).onClick!({}); });
			assert.equal(fixture.copyCalls(), 0);
			assert.deepEqual(fixture.savedTexts, []);
		} finally { await fixture.cleanup(); }
	});
}

test('a disabled hosted item still prevents copying but a supported enabled macro exports intact', async () => {
	const fixture = await mountStack([createEffect('audacity-invert'), native(false)], 'track');
	try {
		await fixture.open();
		assert.equal(fixture.item('Copy effects').getAttribute('aria-disabled'), 'true');
		const macro = fixture.item('Export as macro');
		assert.equal(macro.getAttribute('aria-disabled'), 'false');
		await act(async () => { reactProps(macro).onClick!({}); await Promise.resolve(); });
		assert.deepEqual(fixture.savedTexts, ['Invert:\n']);
	} finally { await fixture.cleanup(); }
});

test('ordinary and unavailable effect metadata keep their supported copy and export actions', async () => {
	const fixture = await mountStack([createEffect('audacity-invert'), createMissingEffect({
		missing: { name: 'Unavailable old insert', nativeId: 'old-insert', reason: 'unavailable' },
	})], 'track');
	try {
		await fixture.open();
		const copy = fixture.item('Copy effects');
		assert.equal(copy.getAttribute('aria-disabled'), 'false');
		assert.equal(fixture.item('Export as macro').getAttribute('aria-disabled'), 'false');
		await act(async () => { reactProps(copy).onClick!({}); });
		assert.equal(fixture.copyCalls(), 1);
	} finally { await fixture.cleanup(); }
});

test('a wholly disabled stack keeps copying available without promising an empty macro', async () => {
	const fixture = await mountStack([createEffect('audacity-invert', { enabled: false })], 'track');
	try {
		await fixture.open();
		assert.equal(fixture.item('Copy effects').getAttribute('aria-disabled'), 'false');
		assert.equal(fixture.item('Export as macro').getAttribute('aria-disabled'), 'true');
	} finally { await fixture.cleanup(); }
});

async function mountStack(effects: readonly Effect[], scope: 'track' | 'master') {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	const priorClassList = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'classList');
	const priorBox = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	Object.assign(globalThis.window, {
		getComputedStyle: () => ({ display: '', visibility: '' }),
		setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
		innerHeight: 800, innerWidth: 1200,
	});
	Object.defineProperty(ReactTestElement.prototype, 'classList', { configurable: true,
		get(this: ReactTestElement) { return { contains: (name: string) => (this.getAttribute('class') ?? '').split(/\s+/u).includes(name) }; },
	});
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }),
	});
	const project = createAudioEditorProjectV17({
		id: 'project', title: 'Recording', now: '2026-10-10T00:00:00.000Z',
		tracks: [createAudioTrack({ id: 'track', name: 'Recording', clipIds: [], effects: scope === 'track' ? effects : [] })],
		master: { effects: scope === 'master' ? effects : [] },
		sequences: [{ id: 'sequence', trackIds: ['track'] }], primarySequenceId: 'sequence',
	});
	let copies = 0;
	const savedTexts: string[] = [];
	const controller = { project, actions: {
		effects: { copyStack: () => { copies += 1; }, presets: { list: () => [] } }, mixer: {}, track: {},
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<AudioEditorEffectsOverlay isOpen controller={controller}
		snapshot={{ project, ready: true, selectedTrackId: 'track', effects: { hasStackClipboard: false } }}
		copy={ENGLISH_COPY} locale="en" trackId="track" selectedEffect={undefined} onSelectedEffectChange={undefined}
		fileService={{ saveFile: ({ text }: { text: string }) => { savedTexts.push(text); return Promise.resolve({ cancelled: false }); } }}
		onClose={() => undefined} />));
	return {
		savedTexts, copyCalls: () => copies,
		open: async () => {
			const triggers = dom.container.querySelectorAll('.effects-stack-header__menu-button');
			const trigger = triggers[scope === 'track' ? 0 : 1];
			assert.ok(trigger);
			await act(async () => { reactProps(trigger).onClick!({ currentTarget: trigger, stopPropagation: () => undefined }); });
		},
		item: (label: string) => {
			const item = dom.container.querySelectorAll('[role="menuitem"]').find(entry => entry.textContent === label);
			assert.ok(item, `Missing ${label} menu item.`);
			return item;
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			for (const [key, descriptor] of [['React', priorReact], ['IS_REACT_ACT_ENVIRONMENT', priorAct]] as const) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			for (const [key, descriptor] of [['classList', priorClassList], ['getBoundingClientRect', priorBox]] as const) {
				if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor); else Reflect.deleteProperty(ReactTestElement.prototype, key);
			}
			dom.restore();
		},
	};
}
