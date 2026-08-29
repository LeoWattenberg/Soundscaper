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
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('clip property async failures belong only to the project and clip that started them', async () => {
	const fixture = await mountedClipPropertiesFixture();
	try {
		await fixture.render(project('project-a'));
		await fixture.startNormalizePeak();
		assert.deepEqual(fixture.normalizeCalls.map(({ projectId, clipId }) => ({ projectId, clipId })), [
			{ projectId: 'project-a', clipId: 'shared-clip' },
		]);

		await fixture.render(project('project-b'));
		await reject(fixture.normalizeCalls[0]!.completion, new Error('Project A normalization failed'));
		assert.equal(Boolean(fixture.alert()), false, 'project A failure must not paint on project B');

		await fixture.startNormalizePeak();
		await reject(fixture.normalizeCalls[1]!.completion, new Error('Project B normalization failed'));
		assert.equal(fixture.alert()?.textContent, 'Project B normalization failed');
	} finally {
		await fixture.cleanup();
	}
});

test('clip property errors reset across projects even when clip ids repeat', async () => {
	const fixture = await mountedClipPropertiesFixture();
	try {
		await fixture.render(project('project-a'));
		await fixture.startNormalizePeak();
		await reject(fixture.normalizeCalls[0]!.completion, new Error('Project A normalization failed'));
		assert.equal(fixture.alert()?.textContent, 'Project A normalization failed');

		await fixture.render(project('project-b'));
		assert.equal(Boolean(fixture.alert()), false);
	} finally {
		await fixture.cleanup();
	}
});

test('clip property actions cannot reenter while the first action is pending', async () => {
	const fixture = await mountedClipPropertiesFixture();
	try {
		await fixture.render(project('project-a'));
		await fixture.startNormalizePeak();
		await fixture.startNormalizePeak();

		assert.equal(fixture.normalizeCalls.length, 1);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedClipPropertiesFixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let currentProject = project('initial');
	const normalizeCalls: Array<Readonly<{
		projectId: string;
		clipId: string;
		completion: Deferred<void>;
	}>> = [];
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
				normalizePeak: (clipId: string) => {
					const completion = deferred<void>();
					normalizeCalls.push({ projectId: currentProject.id, clipId, completion });
					return completion.promise;
				},
				normalizeLoudness: () => undefined,
				renderPitchSpeed: () => undefined,
				resetPitchSpeed: () => undefined,
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		normalizeCalls,
		render: async (nextProject: ReturnType<typeof project>) => {
			currentProject = nextProject;
			await act(async () => root.render(<ClipPropertiesDialog
				isOpen
				controller={controller}
				snapshot={{
					project: nextProject,
					selectedClipId: 'shared-clip',
					capabilities: { audioEffects: true, videoEffects: false },
				}}
				copy={ENGLISH_COPY}
				onClose={() => undefined}
			/>));
		},
		startNormalizePeak: async () => {
			await act(async () => {
				void reactProps(buttonNamed(dom.container, ENGLISH_COPY.normalizePeak)).onClick();
				await Promise.resolve();
			});
		},
		alert: () => dom.container.querySelector('[role="alert"]'),
		cleanup: async () => {
			for (const call of normalizeCalls) call.completion.resolve();
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project(id: string) {
	const source = createAudioSource({
		id: 'shared-source', storageKey: `${id}-source`, name: `${id} source`,
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'shared-clip', sourceId: source.id, title: `${id} clip`,
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 0, sourceDurationFrames: 200,
	});
	return createSoundscaperProject({
		id, title: id, now: '2026-08-29T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'shared-track', name: 'Track', clipIds: [clip.id] })],
	});
}

function buttonNamed(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Missing mounted button ${text}.`);
	return button;
}

async function reject(completion: Deferred<void>, error: Error): Promise<void> {
	await act(async () => {
		completion.reject(error);
		await completion.promise.catch(() => undefined);
		await Promise.resolve();
	});
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (cause: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}
