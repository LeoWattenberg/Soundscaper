/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';

import EffectPresetBar from '../src/common/editor/ui/inspector/EffectPresetBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const entry of [
	{ action: 0, item: ENGLISH_COPY.saveEffectPreset, call: 'save' },
	{ action: 3, item: 'Advanced settings', call: 'advanced' },
] as const) {
	test(`effect preset ${entry.call} menu uses viewport coordinates outside a transformed dialog`, async () => {
		const fixture = await mountedBar();
		try {
			await fixture.open(entry.action);
			const menu = fixture.menu();
			assert.equal(Boolean(menu.closest('[role="dialog"]')), false,
				'a fixed menu must escape the dialog that establishes a transformed containing block');
			const style = menu.style as unknown as { readonly left: string; readonly top: string };
			assert.equal(style.left, '922px');
			assert.equal(style.top, '217px');
			assert.equal(menu.closest('[dir]')?.getAttribute('dir'), 'rtl');
			assert.equal(menu.style.values.get('--context-menu-bg'), '#291c2a');
			assert.equal(menu.closest('.audio-editor-effect-preset-menu-layer')?.style.values.get('--focus-color'), '#ffaccd');
			await fixture.choose(entry.item);
			assert.deepEqual(fixture.calls, [entry.call]);
			assert.equal(fixture.body.querySelector('[role="menu"]'), null);
		} finally {
			await fixture.cleanup();
		}
	});
}

test('portalled preset menus keep import, export, Save as and subject cleanup', async () => {
	const fixture = await mountedBar();
	try {
		await fixture.open(3);
		await fixture.choose(ENGLISH_COPY.importEffectPreset);
		assert.equal(fixture.dom.one('[data-effect-preset-file]').clickCount, 1);
		await fixture.open(3);
		await fixture.choose(ENGLISH_COPY.exportEffectPreset);
		assert.deepEqual(fixture.calls, ['export']);
		await fixture.open(0);
		await fixture.choose(ENGLISH_COPY.saveEffectPresetAs);
		assert.ok(fixture.dom.find('[data-preset-name-dialog]'));
		await fixture.render('next-effect');
		assert.equal(fixture.dom.find('[data-preset-name-dialog]'), null);
		await fixture.open(3);
		assert.ok(fixture.menu());
		await fixture.render('next-effect', 'ltr');
		assert.equal(fixture.menu().closest('[dir]')?.getAttribute('dir'), 'ltr');
		await fixture.render('another-effect');
		assert.equal(fixture.body.querySelector('[role="menu"]'), null);
	} finally {
		await fixture.cleanup();
	}
});

test('effect About opens a separate details window and closes with its subject', async () => {
	const fixture = await mountedBar();
	try {
		await fixture.open(3);
		await fixture.choose(ENGLISH_COPY.effectAbout);
		const about = fixture.body.querySelector('[data-effect-about-dialog]');
		assert.ok(about);
		assert.match(about.textContent, /Noise gate/u);
		assert.match(about.textContent, /Soundscaper/u);
		assert.equal(fixture.body.querySelector('[role="menu"]'), null);
		await fixture.render('next-effect');
		assert.equal(fixture.body.querySelector('[data-effect-about-dialog]'), null);
	} finally {
		await fixture.cleanup();
	}
});

test('effect action buttons retain localized accessible names without native tooltips', async () => {
	const fixture = await mountedBar();
	try {
		const buttons = fixture.dom.container.querySelectorAll('.effect-header__icon-button');
		assert.deepEqual(buttons.map(button => button.getAttribute('aria-label')), [
			ENGLISH_COPY.saveEffectPreset,
			ENGLISH_COPY.resetEffectPreset,
			ENGLISH_COPY.deleteEffectPreset,
			ENGLISH_COPY.moreOptions,
		]);
		for (const button of buttons) assert.equal(button.getAttribute('title'), null);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedBar() {
	const dom = installReactTestDom();
	const body = (globalThis.document as unknown as { body: ReactTestElement }).body;
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	const render = async (resetKey = 'gate', direction = 'rtl') => {
		await act(async () => root.render(<ThemeProvider theme={resolveSkinTheme('sakura', 'dark')}>
			<section role="dialog" dir={direction} style={{ transform: 'translate(310px, 137px)' }}>
				<EffectPresetBar copy={ENGLISH_COPY} presets={[{ id: 'mine', label: 'Mine', custom: true }]}
					aboutEffect="noise-gate"
					selectedId="mine" resetKey={resetKey} onSelect={() => undefined}
					onSave={() => { calls.push('save'); }} onSaveAs={() => undefined}
					onAdvancedSettings={() => { calls.push('advanced'); }}
					onReset={() => undefined} onDelete={() => undefined} onImport={() => undefined}
					onExport={() => { calls.push('export'); }} />
			</section>
		</ThemeProvider>));
	};
	await render();
	return {
		dom, body, calls, render,
		menu: () => {
			const menu = body.querySelector('[role="menu"]');
			assert.ok(menu, 'Missing effect preset menu');
			return menu;
		},
		open: async (index: number) => {
			const trigger = dom.container.querySelectorAll('.effect-header__icon-button')[index];
			assert.ok(trigger);
			Object.defineProperty(trigger, 'getBoundingClientRect', { configurable: true,
				value: () => ({ left: 922, bottom: 213 }) });
			await act(async () => { reactProps(trigger).onClick({ currentTarget: trigger }); });
		},
		choose: async (label: string) => {
			const item = body.querySelectorAll('[role="menuitem"]').find(node => node.textContent === label);
			assert.ok(item, `Missing effect preset item ${label}`);
			await act(async () => { reactProps(item).onClick(); });
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
