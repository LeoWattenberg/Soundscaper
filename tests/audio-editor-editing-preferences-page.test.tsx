/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import EditingPreferencesPage from '../src/common/editor/ui/dialogs/EditingPreferencesPage.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom,
	reactProps,
	type ReactTestElement,
} from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

const EDITING = Object.freeze({
	rippleMode: 'off',
	collisionBehavior: 'audacity',
	snapToZeroCrossings: false,
	zoomPrecision: 1,
	applyEffectsToAllAudio: true,
	deleteBehavior: 'leave-gap',
	closeGapBehavior: 'clip',
	pasteBehavior: 'overlap',
	pasteInsertBehavior: 'track',
	alwaysPasteAsNewClip: true,
	asymmetricStereoHeights: 'never',
	asymmetricStereoHeightWorkspaces: ['modern'],
	alwaysConvertToMono: false,
	zoomTogglePreset1: 'zoom-default',
	zoomTogglePreset2: 'four-pixels-per-sample',
});

const ZOOM_LABELS = Object.freeze([
	'Fit to Width',
	'Zoom to Selection',
	'Zoom Default',
	'Minutes',
	'Seconds',
	'5ths of Seconds',
	'10ths of Seconds',
	'20ths of Seconds',
	'50ths of Seconds',
	'100ths of Seconds',
	'500ths of Seconds',
	'MilliSeconds',
	'Samples',
	'4 Pixels per Sample',
	'Max Zoom',
]);

test('the Audacity 4 editing page has its exact six sections and conditional choices', () => {
	const defaultMarkup = renderPage();
	assert.deepEqual(sectionIds(defaultMarkup), [
		'effect-behavior',
		'delete-behavior',
		'paste-behavior',
		'asymmetric-stereo-heights',
		'mono-stereo-conversion',
		'zoom-toggle',
	]);
	for (const text of [
		'Effect behavior',
		'Apply effects to all audio when no selection is made',
		'Choose behavior when deleting a portion of a clip',
		'Leave gap',
		'Close gap (ripple)',
		'Choose behavior when pasting audio',
		'Paste overlaps other clips',
		'Paste pushes other clips',
		'Always paste audio as a new clip',
		'Asymmetric stereo heights',
		'Dragging on the center line may adjust the height of the channel:',
		'Always',
		'Depending on workspace',
		'Never',
		'Mono &amp; stereo conversion',
		'Always convert to mono without prompt',
		'Zoom toggle (magnifying glass)',
		'A special tool in the top bar that toggles between two different zoom states.',
		'Zoom state 1:',
		'Zoom state 2:',
		'Ripple editing',
		'Snap selections to zero crossings',
		'Mouse zoom precision',
	]) assert.ok(defaultMarkup.includes(text), `renders ${text}`);

	assert.ok(!defaultMarkup.includes('When closing the gap, do the following'));
	assert.ok(!defaultMarkup.includes('When making room for pasted audio, do the following'));
	assert.doesNotMatch(defaultMarkup, /data-asymmetric-stereo-workspace=/u);

	const conditionalMarkup = renderPage({
		deleteBehavior: 'close-gap',
		pasteBehavior: 'insert',
		asymmetricStereoHeights: 'workspace-dependent',
		asymmetricStereoHeightWorkspaces: ['classic', 'studio'],
	});
	for (const text of [
		'When closing the gap, do the following',
		'The selected clip moves back to fill the gap',
		'All clips on the same track move back to fill the gap',
		'All clips on all tracks move back to fill the gap',
		'When making room for pasted audio, do the following',
		'Pasting audio pushes other clips on the same track',
		'Pasting audio pushes all clips on all tracks',
	]) assert.ok(conditionalMarkup.includes(text), `renders ${text}`);
	assert.deepEqual(
		[...conditionalMarkup.matchAll(/data-asymmetric-stereo-workspace="([^"]+)"/gu)]
			.map((match) => match[1]),
		['classic', 'music', 'modern', 'audacity', 'video-editor', 'studio'],
	);
	assert.match(conditionalMarkup, /role="group" aria-label="Workspaces"/u);
	assert.ok(conditionalMarkup.includes('Studio workspace'));
});

test('both zoom toggles expose the exact 15 Audacity presets', async () => {
	const mounted = await mountPage();
	try {
		for (const label of ['Zoom state 1:', 'Zoom state 2:']) {
			assert.deepEqual(await dropdownOptions(mounted.dom.container, label), ZOOM_LABELS);
		}
	} finally {
		await mounted.unmount();
	}
});

test('NotSet leaves both choices unselected in the normal preferences page', async () => {
	const mounted = await mountPage({ deleteBehavior: 'not-set', closeGapBehavior: 'track' });
	try {
		const deleteChoices = [...mounted.dom.container.querySelectorAll('input')].filter((candidate) => {
			const props = reactProps(candidate) as unknown as Readonly<{ name?: unknown; value?: unknown }>;
			return props.name === 'audio-editor-delete-behavior';
		});
		assert.equal(deleteChoices.length, 2);
		assert.ok(deleteChoices.every((choice) => (
			(reactProps(choice) as unknown as Readonly<{ checked?: boolean }>).checked === false
		)));
		assert.deepEqual(mounted.updates, []);
		assert.doesNotMatch(mounted.dom.container.textContent || '', /When closing the gap/u);
	} finally {
		await mounted.unmount();
	}
});

test('every editing control persists through the preferences action', async () => {
	const mounted = await mountPage({
		deleteBehavior: 'close-gap',
		closeGapBehavior: 'track',
		pasteBehavior: 'insert',
		pasteInsertBehavior: 'all-tracks',
		alwaysPasteAsNewClip: true,
		asymmetricStereoHeights: 'workspace-dependent',
		asymmetricStereoHeightWorkspaces: ['modern', 'studio'],
	});
	try {
		await clickCheckbox(mounted.dom.container, 'Apply effects to all audio when no selection is made');
		await chooseRadio(mounted.dom.container, 'audio-editor-delete-behavior', 'leave-gap');
		await chooseRadio(mounted.dom.container, 'audio-editor-close-gap-behavior', 'clip');
		await chooseRadio(mounted.dom.container, 'audio-editor-paste-behavior', 'overlap');
		await chooseRadio(mounted.dom.container, 'audio-editor-paste-insert-behavior', 'track');
		await clickCheckbox(mounted.dom.container, 'Always paste audio as a new clip');
		await chooseRadio(mounted.dom.container, 'audio-editor-asymmetric-stereo-heights', 'always');
		await clickCheckbox(mounted.dom.container, 'Classic');
		await clickCheckbox(mounted.dom.container, 'Always convert to mono without prompt');
		await chooseDropdown(mounted.dom.container, 'Zoom state 1:', 'Minutes');
		await chooseDropdown(mounted.dom.container, 'Zoom state 2:', 'Max Zoom');
		await chooseDropdown(mounted.dom.container, 'Ripple editing', 'All tracks');
		await clickCheckbox(mounted.dom.container, 'Snap selections to zero crossings');
		const precision = mounted.dom.container.querySelectorAll('input').find((candidate) => (
			candidate.getAttribute('aria-label') === 'Mouse zoom precision'
		));
		assert.ok(precision, 'renders mouse zoom precision input');
		await act(async () => {
			reactProps(precision).onChange({ currentTarget: { value: '8' } });
		});

		assert.deepEqual(mounted.updates, [
			{ editing: { applyEffectsToAllAudio: false } },
			{ editing: { deleteBehavior: 'leave-gap' } },
			{ editing: { closeGapBehavior: 'clip' } },
			{ editing: { pasteBehavior: 'overlap' } },
			{ editing: { pasteInsertBehavior: 'track' } },
			{ editing: { alwaysPasteAsNewClip: false } },
			{ editing: { asymmetricStereoHeights: 'always' } },
			{ editing: { asymmetricStereoHeightWorkspaces: ['classic', 'modern', 'studio'] } },
			{ editing: { alwaysConvertToMono: true } },
			{ editing: { zoomTogglePreset1: 'minutes' } },
			{ editing: { zoomTogglePreset2: 'max-zoom' } },
			{ editing: { rippleMode: 'all-tracks' } },
			{ editing: { snapToZeroCrossings: true } },
			{ editing: { zoomPrecision: 8 } },
		]);
	} finally {
		await mounted.unmount();
	}
});

function renderPage(overrides: Readonly<Record<string, unknown>> = {}): string {
	return renderToStaticMarkup(<EditingPreferencesPage
		controller={{ actions: { preferences: { update: () => undefined } } }}
		preferences={preferences(overrides)}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
	/>);
}

function preferences(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		editing: { ...EDITING, ...overrides },
		workspace: {
			custom: [{ id: 'studio', name: 'Studio workspace' }],
		},
	};
}

function sectionIds(markup: string): Array<string | undefined> {
	return [...markup.matchAll(/data-editing-preferences-section="([^"]+)"/gu)]
		.map((match) => match[1]);
}

async function mountPage(overrides: Readonly<Record<string, unknown>> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const updates: Record<string, unknown>[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<EditingPreferencesPage
		controller={{ actions: { preferences: { update: (update: Record<string, unknown>) => {
			updates.push(update);
		} } } }}
		preferences={preferences(overrides)}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
	/>));
	return {
		dom,
		updates,
		async unmount() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

async function clickCheckbox(root: ReactTestElement, label: string): Promise<void> {
	const checkbox = root.querySelectorAll('[role="checkbox"]')
		.find((candidate) => candidate.getAttribute('aria-label') === label);
	assert.ok(checkbox, `Missing checkbox ${label}.`);
	await act(async () => {
		reactProps(checkbox).onClick({});
		await Promise.resolve();
	});
}

async function chooseRadio(root: ReactTestElement, name: string, value: string): Promise<void> {
	const radio = root.querySelectorAll('input').find((candidate) => {
		const props = reactProps(candidate) as unknown as { name?: string; value?: string };
		return props.name === name && props.value === value;
	});
	assert.ok(radio, `Missing ${name} radio ${value}.`);
	await act(async () => {
		reactProps(radio).onChange({ currentTarget: radio });
	});
}

async function dropdownOptions(root: ReactTestElement, label: string): Promise<string[]> {
	const trigger = dropdownTrigger(root, label);
	await act(async () => {
		reactProps(trigger).onClick({});
		await Promise.resolve();
		await Promise.resolve();
	});
	const body = (globalThis.document as unknown as { body: ReactTestElement }).body;
	const options = body.querySelectorAll('[role="option"]').map((option) => option.textContent);
	await act(async () => {
		reactProps(trigger).onClick({});
		await Promise.resolve();
	});
	return options;
}

async function chooseDropdown(root: ReactTestElement, label: string, optionLabel: string): Promise<void> {
	const trigger = dropdownTrigger(root, label);
	await act(async () => {
		reactProps(trigger).onClick({});
		await Promise.resolve();
		await Promise.resolve();
	});
	const body = (globalThis.document as unknown as { body: ReactTestElement }).body;
	const option = body.querySelectorAll('[role="option"]')
		.find((candidate) => candidate.textContent === optionLabel);
	assert.ok(option, `Missing ${label} option ${optionLabel}.`);
	await act(async () => {
		reactProps(option).onClick({});
		await Promise.resolve();
	});
}

function dropdownTrigger(root: ReactTestElement, label: string): ReactTestElement {
	const group = root.querySelectorAll('[role="group"]')
		.find((candidate) => candidate.getAttribute('aria-label') === label);
	assert.ok(group, `Missing dropdown group ${label}.`);
	const trigger = group.querySelector('.dropdown__trigger');
	assert.ok(trigger, `Missing dropdown trigger ${label}.`);
	return trigger;
}
