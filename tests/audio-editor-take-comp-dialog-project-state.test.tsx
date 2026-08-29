/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import TakeCompDialog from '../src/common/editor/ui/dialogs/TakeCompDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('take-comp work from another project cannot retain or publish dialog state', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const audition = deferred<void>();
	const controller = {
		actions: { takeComp: {
			auditionTake: () => undefined,
			auditionLane: () => audition.promise,
			stopAudition: () => undefined,
			promoteTake: () => undefined,
			editCompBoundary: () => undefined,
			editSharedCompBoundary: () => undefined,
			flatten: () => undefined,
			removeGroup: () => undefined,
		} },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <TakeCompDialog
		productId="soundscaper"
		controller={controller}
		snapshot={{ project: project(projectId) }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, ENGLISH_COPY.takeCompAuditionLane)).onClick({});
		});
		assert.equal(
			reactProps(buttonWithText(dom.container, ENGLISH_COPY.takeCompAuditionLane)).disabled,
			true,
		);

		await act(async () => root.render(renderDialog('project-b')));
		assert.notEqual(
			reactProps(buttonWithText(dom.container, ENGLISH_COPY.takeCompAuditionLane)).disabled,
			true,
			'project B must not inherit project A busy state',
		);

		await act(async () => {
			audition.resolve();
			await audition.promise;
		});
		assert.equal(dom.container.textContent.includes(ENGLISH_COPY.takeCompOperationComplete), false);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a successful remove reports after its own group leaves the project', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const removal = deferred<void>();
	const controller = {
		actions: { takeComp: {
			auditionTake: () => undefined,
			auditionLane: () => undefined,
			stopAudition: () => undefined,
			promoteTake: () => undefined,
			editCompBoundary: () => undefined,
			editSharedCompBoundary: () => undefined,
			flatten: () => undefined,
			removeGroup: () => removal.promise,
		} },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const populatedProject = project('project-a');
	const renderDialog = (currentProject: unknown) => <TakeCompDialog
		productId="soundscaper"
		controller={controller}
		snapshot={{ project: currentProject }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog(populatedProject)));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, ENGLISH_COPY.takeCompRemoveGroup)).onClick({});
			await Promise.resolve();
		});
		await act(async () => root.render(renderDialog({ ...populatedProject, takeGroups: [] })));
		await act(async () => {
			removal.resolve();
			await removal.promise;
			await Promise.resolve();
		});

		assert.equal(dom.container.textContent.includes(ENGLISH_COPY.takeCompRemoveComplete), true);
	} finally {
		removal.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function project(id: string) {
	const sources = [
		createAudioSource({
			id: 'source-a', storageKey: `${id}-source-a`, name: `${id} take A`,
			frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
		}),
		createAudioSource({
			id: 'source-b', storageKey: `${id}-source-b`, name: `${id} take B`,
			frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
		}),
	];
	return createAudioEditorProjectV17({
		id, title: id, now: '2026-08-29T00:00:00.000Z', sources,
		tracks: [createAudioTrack({ id: 'track', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'sequence', trackIds: ['track'] }],
		primarySequenceId: 'sequence',
		takeGroups: [{
			id: 'shared-group', sequenceId: 'sequence', trackId: 'track',
			startSample: 100, endSample: 500,
			laneOrder: ['lane-a', 'lane-b'],
			lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
			takes: [
				{ id: 'take-a', laneId: 'lane-a', sourceId: sources[0]!.id,
					startSample: 100, endSample: 500, sourceStartSample: 0 },
				{ id: 'take-b', laneId: 'lane-b', sourceId: sources[1]!.id,
					startSample: 100, endSample: 500, sourceStartSample: 0 },
			],
			compRegions: [
				{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 300 },
				{ id: 'region-b', takeId: 'take-b', startSample: 300, endSample: 500 },
			],
		}],
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
