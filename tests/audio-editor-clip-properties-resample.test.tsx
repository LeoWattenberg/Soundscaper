/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { ClipPropertiesDialog } from '../src/common/editor/ui/inspector/ClipPropertiesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('clip properties report the rate of the clip that is selected', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		assert.match(fixture.sourceFact('sampleRate').textContent, /96000/u);
		// Sources are stored as float32 PCM whatever they declare, so the editor
		// neither offers a format nor reports one it would never convert.
		assert.equal(fixture.declaredFormatShown(), false);
		assert.equal(Boolean(fixture.resampleDialog()), false);
	} finally {
		await fixture.cleanup();
	}
});

test('the resample dialog opens seeded from the clip and applies to that clip alone', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		await fixture.openResample();

		const dialog = fixture.resampleDialog();
		assert.ok(dialog, 'the resample button opens its dialog');
		await fixture.submitResample();

		assert.deepEqual(fixture.resampleCalls, [['shared-clip', { sampleRate: 96_000 }]]);
		assert.equal(Boolean(fixture.resampleDialog()), false, 'applying closes the dialog');
	} finally {
		await fixture.cleanup();
	}
});

test('the rate and the control that changes it share the media settings grid', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		const rate = fixture.sourceFact('sampleRate');
		const grid = rate.closest('.audio-editor-clip-properties__time-grid');
		assert.ok(grid, 'the rate is stated among the clip\u2019s other media settings');
		assert.ok(
			grid.querySelector('[data-clip-field="durationFrame"]'),
			'that grid is the media settings one rather than some other pair of columns',
		);
		assert.ok(
			rate.querySelector('[data-clip-action="resample-clip"]'),
			'resampling reads as an action on the rate rather than a card of its own',
		);
	} finally {
		await fixture.cleanup();
	}
});

test('a product without audio effects reports the rate but cannot resample', async () => {
	const fixture = await mountedFixture({ audioEffects: false });
	try {
		await fixture.render();
		assert.match(fixture.sourceFact('sampleRate').textContent, /96000/u);
		assert.equal(
			fixture.buttons().some((button) => button.textContent === ENGLISH_COPY.resample),
			false,
			'a product whose handler refuses must not offer the command',
		);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedFixture(capabilities: Readonly<Record<string, boolean>> = { audioEffects: true }) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const currentProject = project();
	const resampleCalls: Array<[string, unknown]> = [];
	const controller = {
		get project() { return currentProject; },
		actions: {
			clip: {
				update: () => undefined,
				move: () => undefined,
				trim: () => undefined,
				setTimePitch: () => undefined,
				toggleStretchToTempo: () => undefined,
				reverse: () => undefined,
				normalizePeak: () => undefined,
				normalizeLoudness: () => undefined,
				renderPitchSpeed: () => undefined,
				resetPitchSpeed: () => undefined,
				resample: (clipId: string, request: unknown) => {
					resampleCalls.push([clipId, request]);
					return Promise.resolve(clipId);
				},
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const buttons = () => dom.container.querySelectorAll('button');
	const named = (text: string) => {
		const button = buttons().find((candidate) => candidate.textContent === text);
		assert.ok(button, `Missing mounted button ${text}.`);
		return button;
	};
	return {
		resampleCalls,
		buttons,
		render: async () => {
			await act(async () => root.render(<ClipPropertiesDialog
				isOpen
				controller={controller}
				snapshot={{ project: currentProject, selectedClipId: 'shared-clip', capabilities }}
				copy={ENGLISH_COPY}
				onClose={() => undefined}
			/>));
		},
		sourceFact: (name: string) => dom.one(`[data-clip-source-fact="${name}"]`),
		declaredFormatShown: () => Boolean(dom.find('[data-clip-source-fact="sampleFormat"]'))
			|| dom.container.textContent.includes(ENGLISH_COPY.sampleFormat),
		resampleDialog: () => dom.find('[data-clip-resample-dialog]'),
		openResample: async () => {
			await act(async () => { reactProps(named(ENGLISH_COPY.resample)).onClick(); });
		},
		submitResample: async () => {
			const form = dom.one('[data-clip-resample-dialog]').querySelector('form');
			assert.ok(form, 'the resample dialog carries a form.');
			await act(async () => {
				reactProps(form).onSubmit({ preventDefault: () => undefined });
				await Promise.resolve();
			});
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

function project() {
	const source = createAudioSource({
		id: 'shared-source', storageKey: 'shared-source', name: 'Interview',
		frameCount: 1_000, channelCount: 1, sampleRate: 96_000, sampleFormat: 'int24',
	});
	const clip = createAudioClip({
		id: 'shared-clip', sourceId: source.id, title: 'Interview',
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 0, sourceDurationFrames: 200,
	});
	return createSoundscaperProject({
		id: 'project', title: 'Project', now: '2026-09-03T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'shared-track', name: 'Track', clipIds: [clip.id] })],
	});
}
