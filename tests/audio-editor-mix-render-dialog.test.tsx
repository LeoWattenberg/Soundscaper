/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MixRenderDialog from '../src/common/editor/ui/dialogs/MixRenderDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('Mix & Render presents checked defaults and selectable predicted output layouts', () => {
	const mono = renderDialog(project(1));
	assert.match(mono, /role="dialog"[^>]*aria-label="Mix &amp; Render"/u);
	assert.match(mono, /role="checkbox"[^>]*aria-checked="true"[^>]*aria-label="Mix down"/u);
	assert.match(mono, /role="checkbox"[^>]*aria-checked="true"[^>]*aria-label="Render effects"/u);
	assert.match(mono, /role="checkbox"[^>]*aria-checked="true"[^>]*aria-label="Replace originals"/u);
	assert.doesNotMatch(mono, /<p id="[^"]+">(?:Combine|Burn|Replace)[^<]*<\/p>/u);
	assertDropdownMarkup(mono, 'Mono');
	assertDropdownMarkup(renderDialog(project(2)), 'Stereo');
	assertDropdownMarkup(renderDialog(project(1, 6)), '6 channels');
	const empty = project(1);
	assert.match(renderDialog({
		...empty,
		tracks: [{ ...empty.tracks[0]!, clipIds: [] }],
		clips: [],
	}), /<button[^>]*class="[^"]*button--primary[^"]*button--disabled[^"]*"[^>]*disabled=""/u);
});

test('Mix & Render exposes option help as accessible hover and focus tooltips and uses dialog actions', async () => {
	const mounted = await mountDialog({ project: project(1), mixAndRender: () => undefined });
	const options = [
		{
			key: 'mix-down', label: 'Mix down',
			description: 'Combine the selected tracks into one rendered track. Clear this option to render each track separately.',
		},
		{
			key: 'render-effects', label: 'Render effects',
			description: 'Burn realtime effects into the rendered audio.',
		},
		{
			key: 'replace-originals', label: 'Replace originals',
			description: 'Replace the selected tracks. Clear this option to create new tracks.',
		},
	] as const;
	try {
		for (const option of options) assertOptionHelp(mounted.dom.container, option);
		const visibleParagraphs = mounted.dom.container.querySelectorAll('p').map(({ textContent }) => textContent);
		for (const { description } of options) assert.equal(visibleParagraphs.includes(description), false);
		assertDialogButton(mounted.dom.container, 'Cancel', 'secondary');
		assertDialogButton(mounted.dom.container, 'Mix & Render', 'primary');

		await setOptionTooltipPointer(mounted.dom.container, 'mix-down', true);
		assertVisibleTooltip('mix-down', options[0].description);
		await setOptionTooltipFocus(mounted.dom.container, 'mix-down', true);
		await setOptionTooltipPointer(mounted.dom.container, 'mix-down', false);
		assertVisibleTooltip('mix-down', options[0].description);
		await setOptionTooltipFocus(mounted.dom.container, 'mix-down', false);
		assert.equal(optionTooltip('mix-down'), null);

		await setOptionTooltipPointer(mounted.dom.container, 'render-effects', true);
		await setOptionTooltipFocus(mounted.dom.container, 'render-effects', true);
		await setOptionTooltipFocus(mounted.dom.container, 'render-effects', false);
		assertVisibleTooltip('render-effects', options[1].description);
		await setOptionTooltipPointer(mounted.dom.container, 'render-effects', false);
		assert.equal(optionTooltip('render-effects'), null);
	} finally {
		await mounted.unmount();
	}
});

test('Mix & Render disables an empty operation, submits every boolean once, and waits before closing', async () => {
	const completion = deferred<void>();
	const calls: unknown[] = [];
	let closes = 0;
	const mounted = await mountDialog({
		project: project(1),
		mixAndRender: (options) => { calls.push(options); return completion.promise; },
		onClose: () => { closes += 1; },
	});
	try {
		await toggle(mounted.dom.container, 'Mix down');
		assert.equal(checkbox(mounted.dom.container, 'Mix down').getAttribute('aria-checked'), 'false');
		assert.equal(reactProps(dropdownTrigger(mounted.dom.container)).disabled, true);
		await toggle(mounted.dom.container, 'Render effects');
		assert.equal(checkbox(mounted.dom.container, 'Render effects').getAttribute('aria-checked'), 'false');
		const disabledSubmit = buttonWithText(mounted.dom.container, 'Mix & Render');
		assert.equal(reactProps(disabledSubmit).disabled, true);
		assertClass(disabledSubmit, 'button--primary');
		assertClass(disabledSubmit, 'button--disabled');

		await toggle(mounted.dom.container, 'Render effects');
		await toggle(mounted.dom.container, 'Replace originals');
		const form = mounted.dom.one('form');
		await act(async () => {
			void reactProps(form).onSubmit({ preventDefault() {} });
			void reactProps(form).onSubmit({ preventDefault() {} });
			await Promise.resolve();
		});
		assert.deepEqual(calls, [{
			mixDown: false,
			renderEffects: true,
			replaceOriginals: false,
		}]);
		assert.equal(closes, 0);
		assert.equal(reactProps(buttonWithText(mounted.dom.container, 'Mix & Render')).disabled, true);
		assertClass(buttonWithText(mounted.dom.container, 'Cancel'), 'button--disabled');
		assertClass(buttonWithText(mounted.dom.container, 'Mix & Render'), 'button--disabled');

		await act(async () => {
			completion.resolve();
			await completion.promise;
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(closes, 1);
	} finally {
		await mounted.unmount();
	}
});

test('Mix & Render submits the chosen mix-down layout and locks it while pending', async () => {
	const completion = deferred<void>();
	const calls: unknown[] = [];
	const mounted = await mountDialog({
		project: project(1),
		mixAndRender: (options) => { calls.push(options); return completion.promise; },
	});
	try {
		assert.equal(dropdownSelectedText(mounted.dom.container), 'Mono');
		await chooseDropdown(mounted.dom.container, 'Stereo');
		assert.equal(dropdownSelectedText(mounted.dom.container), 'Stereo');
		await clickButton(mounted.dom.container, 'Mix & Render', false);
		assert.deepEqual(calls, [{
			mixDown: true,
			mixDownChannelCount: 2,
			renderEffects: true,
			replaceOriginals: true,
		}]);
		assert.equal(reactProps(dropdownTrigger(mounted.dom.container)).disabled, true);
		await act(async () => {
			completion.resolve();
			await completion.promise;
			await Promise.resolve();
			await Promise.resolve();
		});
	} finally {
		await mounted.unmount();
	}
});

test('Mix & Render cancels without mutation and restores defaults on the next opening', async () => {
	const calls: unknown[] = [];
	const mounted = await mountDialog({
		project: project(1),
		mixAndRender: (options) => { calls.push(options); },
	});
	try {
		await chooseDropdown(mounted.dom.container, 'Stereo');
		await toggle(mounted.dom.container, 'Mix down');
		await toggle(mounted.dom.container, 'Render effects');
		await toggle(mounted.dom.container, 'Replace originals');
		assert.equal(dropdownSelectedText(mounted.dom.container), 'Stereo');
		await act(async () => {
			void reactProps(buttonWithText(mounted.dom.container, 'Cancel')).onClick({});
		});
		assert.deepEqual(calls, []);
		assert.equal(mounted.closes(), 1);

		await mounted.hide();
		await mounted.render(project(1));
		for (const label of ['Mix down', 'Render effects', 'Replace originals']) {
			assert.equal(checkbox(mounted.dom.container, label).getAttribute('aria-checked'), 'true', label);
		}
		assert.equal(dropdownSelectedText(mounted.dom.container), 'Mono');
		assert.deepEqual(calls, []);
	} finally {
		await mounted.unmount();
	}
});

test('Mix & Render reports failure without closing and fences completion to its opening project', async () => {
	const failure = await mountDialog({
		project: project(1),
		mixAndRender: async () => { throw new Error('Render refused'); },
	});
	try {
		await submit(failure.dom.container);
		assert.equal(failure.closes(), 0);
		assert.equal(failure.dom.one('[role="alert"]').textContent, 'Render refused');
	} finally {
		await failure.unmount();
	}

	const completion = deferred<void>();
	const fenced = await mountDialog({
		project: project(1),
		mixAndRender: () => completion.promise,
	});
	try {
		await toggle(fenced.dom.container, 'Replace originals');
		await submit(fenced.dom.container, false);
		await fenced.render(project(2, undefined, 'project-b'));
		assert.equal(checkbox(fenced.dom.container, 'Replace originals').getAttribute('aria-checked'), 'true');
		assert.equal(dropdownSelectedText(fenced.dom.container), 'Stereo');
		await act(async () => {
			completion.resolve();
			await completion.promise;
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fenced.closes(), 0, 'completion from the prior project must not dismiss this surface');
	} finally {
		await fenced.unmount();
	}
});

function renderDialog(value: ReturnType<typeof project>): string {
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		return renderToStaticMarkup(<MixRenderDialog
			controller={{ actions: { track: { mixAndRender: () => undefined } } }}
			snapshot={snapshot(value)}
			copy={ENGLISH_COPY}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>);
	} finally {
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
}

async function mountDialog({
	project: initialProject,
	mixAndRender,
	onClose,
}: Readonly<{
	project: ReturnType<typeof project>;
	mixAndRender(options: Readonly<{
		mixDown: boolean;
		mixDownChannelCount?: number;
		renderEffects: boolean;
		replaceOriginals: boolean;
	}>): unknown;
	onClose?: () => void;
}>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let closeCount = 0;
	const close = () => { closeCount += 1; onClose?.(); };
	const render = async (value: ReturnType<typeof project>) => {
		await act(async () => root.render(<MixRenderDialog
			controller={{ actions: { track: { mixAndRender } } }}
			snapshot={snapshot(value)}
			copy={ENGLISH_COPY}
			run={(operation) => operation()}
			onClose={close}
		/>));
	};
	await render(initialProject);
	return {
		dom,
		closes: () => closeCount,
		render,
		async hide() {
			await act(async () => root.render(null));
		},
		async unmount() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project(channelCount: number, masterChannels?: number, id = 'project-a') {
	return {
		...(masterChannels === undefined ? { schemaVersion: 17 } : {
			schemaFamily: 'soundscaper' as const,
			schemaVersion: 1,
			masterChannels,
		}),
		id, title: 'Project', sampleRate: 48_000,
		tracks: [{
			id: 'track-a', name: 'Track', type: 'audio' as const, clipIds: ['clip-a'],
			effects: [], gain: 1, pan: 0,
		}],
		clips: [{
			id: 'clip-a', title: 'Clip', sourceId: 'source-a', timelineStartFrame: 0,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}],
		sources: [{
			id: 'source-a', storageKey: 'source-a', name: 'Source', mimeType: 'audio/wav',
			frameCount: 20, channelCount, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		selection: { startFrame: 0, endFrame: 20, trackIds: ['track-a'], clipIds: [] },
		mixer: { groups: [], sends: [], routes: {} },
	};
}

function snapshot(value: ReturnType<typeof project>) {
	return { project: value, selectedTrackId: 'track-a', selectedClipId: null };
}

async function toggle(root: ReactTestElement, label: string): Promise<void> {
	await act(async () => {
		void reactProps(checkbox(root, label)).onClick({});
		await Promise.resolve();
	});
}

async function submit(root: ReactTestElement, settle = true): Promise<void> {
	await act(async () => {
		void reactProps(root.querySelector('form')!).onSubmit({ preventDefault() {} });
		if (settle) {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		}
	});
}

async function clickButton(root: ReactTestElement, label: string, settle = true): Promise<void> {
	await act(async () => {
		void reactProps(buttonWithText(root, label)).onClick({});
		if (settle) {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		}
	});
}

function checkbox(root: ReactTestElement, label: string): ReactTestElement {
	const result = root.querySelectorAll('[role="checkbox"]')
		.find((candidate) => candidate.getAttribute('aria-label') === label);
	assert.ok(result, `Missing checkbox ${label}.`);
	return result;
}

function dropdownTrigger(root: ReactTestElement): ReactTestElement {
	const wrapper = root.querySelector('[data-mix-render-channel-count]');
	assert.ok(wrapper, 'Missing Mix down channel-count wrapper.');
	const group = wrapper.querySelectorAll('[role="group"]')
		.find((candidate) => candidate.getAttribute('aria-label') === 'Mix down to');
	assert.ok(group, 'Missing labelled Mix down to dropdown group.');
	const trigger = group.querySelector('.dropdown__trigger');
	assert.ok(trigger, 'Missing Mix down to dropdown trigger.');
	assert.equal(trigger.getAttribute('aria-label'), 'Mix down to');
	return trigger;
}

function dropdownSelectedText(root: ReactTestElement): string {
	const text = dropdownTrigger(root).querySelector('.dropdown__text');
	assert.ok(text, 'Missing selected Mix down layout text.');
	return text.textContent;
}

async function chooseDropdown(root: ReactTestElement, optionLabel: string): Promise<void> {
	await act(async () => {
		void reactProps(dropdownTrigger(root)).onClick({});
		await Promise.resolve();
		await Promise.resolve();
	});
	const body = (globalThis.document as unknown as { body: ReactTestElement }).body;
	const option = body.querySelectorAll('[role="option"]')
		.find((candidate) => candidate.textContent === optionLabel);
	assert.ok(option, `Missing Mix down to option ${optionLabel}.`);
	await act(async () => {
		void reactProps(option).onClick({});
		await Promise.resolve();
	});
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Missing button ${text}.`);
	return button;
}

function assertOptionHelp(root: ReactTestElement, option: Readonly<{
	key: string;
	label: string;
	description: string;
}>): void {
	const control = checkbox(root, option.label);
	const descriptionId = control.getAttribute('aria-describedby');
	assert.ok(descriptionId, `Checkbox ${option.label} must retain an accessible description.`);
	const description = root.querySelector(`[id="${descriptionId}"]`);
	assert.ok(description, `Missing persistent description for ${option.label}.`);
	assert.notEqual(description.tagName, 'P', `${option.label} description must not remain a visible paragraph.`);
	assertClass(description, 'kw-audio-editor-sr-only');
	assert.equal(description.textContent, option.description);
	const help = optionHelp(root, option.key);
	assert.equal(help.getAttribute('type'), 'button');
	assert.equal(help.getAttribute('aria-label'), `Help: ${option.label}`);
	assert.equal(help.getAttribute('aria-describedby'), descriptionId);
	assert.equal(help.hasAttribute('data-tooltip-ignore'), true);
}

function optionHelp(root: ReactTestElement, key: string): ReactTestElement {
	const help = root.querySelector(`[data-mix-render-help="${key}"]`);
	assert.ok(help, `Missing Mix and Render help trigger ${key}.`);
	return help;
}

function optionHelpWrapper(root: ReactTestElement, key: string): ReactTestElement {
	const wrapper = optionHelp(root, key).closest('.audio-editor-help-wrap');
	assert.ok(wrapper, `Missing Mix and Render help wrapper ${key}.`);
	return wrapper;
}

async function setOptionTooltipPointer(root: ReactTestElement, key: string, active: boolean): Promise<void> {
	const wrapper = optionHelpWrapper(root, key);
	await act(async () => {
		void reactProps(wrapper)[active ? 'onPointerEnter' : 'onPointerLeave']({
			currentTarget: wrapper,
			relatedTarget: null,
		});
		await Promise.resolve();
	});
}

async function setOptionTooltipFocus(root: ReactTestElement, key: string, active: boolean): Promise<void> {
	const trigger = optionHelp(root, key);
	await act(async () => {
		void reactProps(trigger)[active ? 'onFocus' : 'onBlur']({ currentTarget: trigger, relatedTarget: null });
		await Promise.resolve();
	});
}

function optionTooltip(key: string): ReactTestElement | null {
	const body = (globalThis.document as unknown as { body: ReactTestElement }).body;
	return body.querySelector(`[data-mix-render-tooltip="${key}"]`)?.closest('[role="tooltip"]') ?? null;
}

function assertVisibleTooltip(key: string, description: string): void {
	const tooltip = optionTooltip(key);
	assert.ok(tooltip, `Missing visible Mix and Render tooltip ${key}.`);
	assert.equal(tooltip.getAttribute('role'), 'tooltip');
	assert.ok(tooltip.getAttribute('id'), `Mix and Render tooltip ${key} must be addressable.`);
	assert.equal(tooltip.textContent, description);
	assert.equal(optionHelp((globalThis.document as unknown as { body: ReactTestElement }).body, key)
		.getAttribute('aria-describedby'), tooltip.getAttribute('id'));
	const flyout = tooltip.closest('.flyout');
	assert.ok(flyout, `Mix and Render tooltip ${key} must use the design-system flyout.`);
	assertClass(flyout, 'audio-editor-help-tooltip');
	const body = (globalThis.document as unknown as { body: ReactTestElement }).body;
	assert.equal(body.querySelectorAll('[role="tooltip"]').length, 1,
		'Mix and Render help must not create a duplicate global button tooltip.');
}

function assertDialogButton(
	root: ReactTestElement,
	label: string,
	variant: 'primary' | 'secondary',
): void {
	const footer = root.querySelector('.footer');
	assert.ok(footer, 'Mix and Render actions must use DialogFooter.');
	assertClass(footer, 'audio-editor-dialog-footer');
	const button = buttonWithText(root, label);
	assert.equal(button.closest('form'), null, `${label} must live in the dialog footer.`);
	assert.equal(button.getAttribute('type'), 'button');
	assertClass(button, 'button');
	assertClass(button, `button--${variant}`);
	assertClass(button, 'button--default');
}

function assertClass(element: ReactTestElement, className: string): void {
	assert.ok((element.getAttribute('class') ?? '').split(/\s+/u).includes(className),
		`Expected ${element.tagName} to have class ${className}.`);
}

function assertDropdownMarkup(markup: string, selectedLabel: string): void {
	assert.match(markup, /data-mix-render-channel-count="true"/u);
	assert.match(markup, /role="group"[^>]*aria-label="Mix down to"/u);
	assert.match(markup, new RegExp(
		`<span class="dropdown__text">${escapeRegex(selectedLabel)}</span>`,
		'u',
	));
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, resolve, reject };
}
