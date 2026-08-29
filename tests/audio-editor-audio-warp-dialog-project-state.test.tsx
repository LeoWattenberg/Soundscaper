/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import AudioWarpDialog from '../src/common/editor/ui/dialogs/AudioWarpDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('an audio-warp operation from another project cannot keep or update the dialog busy', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const analysis = deferred<unknown>();
	const controller = {
		actions: {
			audioWarp: {
				view: () => ({ renderStatus: { path: 'exact-offline' as const } }),
				analyze: () => analysis.promise,
				createIdentityMap: () => undefined,
				addMarker: () => undefined,
				moveMarker: () => undefined,
				deleteMarker: () => undefined,
				quantize: () => undefined,
				applyGroove: () => undefined,
				clear: () => undefined,
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <AudioWarpDialog
		productId="soundscaper"
		controller={controller}
		snapshot={{ project: project(projectId), selectedClipId: 'shared-clip' }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, ENGLISH_COPY.audioWarpAnalyze)).onClick({});
		});
		assert.equal(reactProps(buttonWithText(dom.container, ENGLISH_COPY.audioWarpAnalyze)).disabled, true);

		await act(async () => root.render(renderDialog('project-b')));
		assert.notEqual(
			reactProps(buttonWithText(dom.container, ENGLISH_COPY.audioWarpAnalyze)).disabled,
			true,
			'project B must not inherit project A busy state',
		);

		await act(async () => {
			analysis.resolve({ analysis: { transients: [{ sourceFrame: 12, strength: 1 }] } });
			await analysis.promise;
		});
		assert.equal(dom.container.textContent.includes(ENGLISH_COPY.audioWarpAnalyzed), false);
		assert.equal(dom.container.textContent.includes('1 transients found'), false);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

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
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: [clip.id] })],
	});
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
