/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import SpectralSelectionDialog from '../src/common/editor/ui/dialogs/SpectralSelectionDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('spectral selection replaces project defaults without resetting same-project edits', async () => {
	const fixture = await mountedSpectralSelectionFixture();
	try {
		const projectA = spectralSnapshot('project-a', 48_000, 100, 9_000);
		await fixture.render(projectA);
		await change(fixture.field(ENGLISH_COPY.minimumFrequency), '700');
		await change(fixture.field(ENGLISH_COPY.maximumFrequency), '7000');
		await change(fixture.field(ENGLISH_COPY.spectralGain), '12');

		await fixture.render({
			...projectA,
			project: { ...projectA.project, revision: 2 },
			selection: { frequencyRange: { minimumFrequency: 200, maximumFrequency: 8_000 } },
		});
		assert.equal(fixture.field(ENGLISH_COPY.minimumFrequency).value, '700');
		assert.equal(fixture.field(ENGLISH_COPY.maximumFrequency).value, '7000');
		assert.equal(fixture.field(ENGLISH_COPY.spectralGain).value, '12');

		await fixture.render(spectralSnapshot('project-b', 16_000, 250, 6_000));
		assert.equal(fixture.field(ENGLISH_COPY.minimumFrequency).value, '250');
		assert.equal(fixture.field(ENGLISH_COPY.maximumFrequency).value, '6000');
		assert.equal(fixture.field(ENGLISH_COPY.spectralGain).value, '6');

		await click(fixture.button(ENGLISH_COPY.spectralAmplify));
		assert.deepEqual(fixture.selections, [{ minimumFrequency: 250, maximumFrequency: 6_000 }]);
		assert.deepEqual(fixture.amplifications, [6]);
		assert.equal(fixture.closes.count, 1);
	} finally {
		await fixture.cleanup();
	}
});

test('a queued spectral submission cannot apply after its project is replaced', async () => {
	const fixture = await mountedSpectralSelectionFixture({ deferRun: true });
	try {
		await fixture.render(spectralSnapshot('project-a', 48_000, 100, 9_000));
		await click(fixture.button(ENGLISH_COPY.spectralDelete));
		assert.equal(fixture.queued.length, 1);

		await fixture.render(spectralSnapshot('project-b', 16_000, 250, 6_000));
		await fixture.runQueued(0);

		assert.deepEqual(fixture.selections, []);
		assert.equal(fixture.deletions.count, 0);
		assert.deepEqual(fixture.amplifications, []);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedSpectralSelectionFixture(options: Readonly<{ deferRun?: boolean }> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const selections: Array<Readonly<{ minimumFrequency: number; maximumFrequency: number }>> = [];
	const amplifications: number[] = [];
	const deletions = { count: 0 };
	const closes = { count: 0 };
	const queued: Array<() => unknown> = [];
	const controller = {
		actions: {
			spectral: {
				boxSelect: (selection: Readonly<{ minimumFrequency: number; maximumFrequency: number }>) => {
					selections.push(selection);
				},
				delete: async () => { deletions.count += 1; },
				amplify: async (gainDb: number) => { amplifications.push(gainDb); },
			},
		},
	};
	const run = (operation: () => unknown) => {
		if (options.deferRun) {
			queued.push(operation);
			return undefined;
		}
		return operation();
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		amplifications,
		button: (text: string) => buttonWithText(dom.container, text),
		closes,
		deletions,
		field: (label: string) => fieldInput(dom.container, label),
		queued,
		render: async (snapshot: ReturnType<typeof spectralSnapshot>) => act(async () => root.render(
			<SpectralSelectionDialog
				controller={controller}
				snapshot={snapshot}
				copy={ENGLISH_COPY}
				run={run}
				onClose={() => { closes.count += 1; }}
			/>,
		)),
		runQueued: async (index: number) => act(async () => { await queued[index]?.(); }),
		selections,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function spectralSnapshot(
	id: string,
	sampleRate: number,
	minimumFrequency: number,
	maximumFrequency: number,
) {
	const trackId = `${id}-track`;
	return {
		project: {
			id,
			revision: 1,
			sampleRate,
			tracks: [{
				id: trackId,
				type: 'audio',
				spectrogram: { minimumFrequency, maximumFrequency },
			}],
		},
		selectedTrackId: trackId,
		selection: { frequencyRange: { minimumFrequency, maximumFrequency } },
	};
}

async function change(input: ReactTestElement, value: string): Promise<void> {
	await act(async () => {
		reactProps(input).onChange({ target: { value }, currentTarget: { value } });
	});
}

async function click(button: ReactTestElement): Promise<void> {
	await act(async () => {
		void reactProps(button).onClick({});
		await Promise.resolve();
	});
}

function fieldInput(root: ReactTestElement, label: string): ReactTestElement {
	const field = root.querySelectorAll('label').find((candidate) => (
		candidate.querySelectorAll('span').some((span) => span.textContent === label)
	));
	const input = field?.querySelector('input');
	assert.ok(input, `Missing spectral field ${label}.`);
	return input;
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Missing button ${text}.`);
	return button;
}
