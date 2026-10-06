/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { RegularIntervalAnnotationDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import type { RegularIntervalDialogProject } from '../src/common/editor/ui/regular-interval-dialog-defaults.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('regular interval dialog resets project defaults only when project identity changes', async () => {
	const fixture = await mountedRegularIntervalFixture();
	try {
		const projectA = annotationProject('project-a', 'sequence-a', 44_100, 441_000);
		await fixture.render(projectA);
		await change(fixture.startFrame(), '22050');
		await change(fixture.namePrefix(), 'Scene');

		await fixture.render({ ...projectA, revision: 2 });
		assert.equal(fixture.startFrame().value, '22050');
		assert.equal(fixture.namePrefix().value, 'Scene');

		await fixture.render(annotationProject('project-b', 'sequence-b', 96_000, 192_000));
		assert.equal(fixture.startFrame().value, '0');
		assert.equal(fixture.endFrame().value, '192000');
		assert.equal(fixture.intervalFrames().value, '96000');
		assert.equal(fixture.namePrefix().value, 'Cue');

		await fixture.submit();
		assert.deepEqual(fixture.requests, [{
			kind: 'marker',
			anchor: 'sample',
			sequenceId: 'sequence-b',
			startFrame: 0,
			endFrame: 192_000,
			intervalFrames: 96_000,
			namePrefix: 'Cue',
			color: 'auto',
		}]);
		assert.equal(fixture.closes.count, 1);
	} finally {
		await fixture.cleanup();
	}
});

test('regular interval dialog refuses a stale submit before the project rerender arrives', async () => {
	const fixture = await mountedRegularIntervalFixture();
	try {
		await fixture.render(annotationProject('project-a', 'sequence-a', 48_000, 96_000));
		fixture.switchControllerProject(annotationProject('project-b', 'sequence-b', 96_000, 192_000));

		await fixture.submit();
		assert.deepEqual(fixture.requests, []);
		assert.equal(fixture.closes.count, 0);
	} finally {
		await fixture.cleanup();
	}
});

test('regular interval dialog can open and submit the visible native video extent', async () => {
	const fixture = await mountedRegularIntervalFixture();
	try {
		await fixture.render({ ...annotationProject('video-project', 'main', 48_000, 44_800), schemaVersion: 17,
			sequences: [{ id: 'main', rate: { num: 30, den: 1 } }],
			clips: [{ id: 'video', kind: 'video', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 28, sourceInFrame: 0, sourceFrameCount: 22 }],
		});
		assert.equal(fixture.endFrame().value, '44800');
		await fixture.submit();
		assert.equal((fixture.requests[0] as { endFrame: number }).endFrame, 44_800);
		assert.equal(fixture.closes.count, 1);
	} finally { await fixture.cleanup(); }
});

type AnnotationProject = ReturnType<typeof annotationProject>;

async function mountedRegularIntervalFixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let currentProject: AnnotationProject | null = null;
	const requests: unknown[] = [];
	const closes = { count: 0 };
	const controller = {
		get project() { return currentProject; },
		actions: {
			project: { importFiles: () => undefined },
			timelineAnnotations: {
				regularInterval: (request: unknown) => { requests.push(request); },
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const fields = () => dom.one('form').querySelectorAll('input');
	return {
		requests,
		closes,
		render: async (project: AnnotationProject) => {
			currentProject = project;
			await act(async () => root.render(<RegularIntervalAnnotationDialog
				controller={controller}
				copy={ENGLISH_COPY}
				run={(operation) => operation()}
				onClose={() => { closes.count += 1; }}
			/>));
		},
		switchControllerProject: (project: AnnotationProject) => { currentProject = project; },
		startFrame: () => fields()[0]!,
		endFrame: () => fields()[1]!,
		intervalFrames: () => fields()[2]!,
		namePrefix: () => fields()[3]!,
		submit: async () => {
			await act(async () => {
				reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
				await Promise.resolve();
			});
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function annotationProject(
	id: string,
	primarySequenceId: string,
	sampleRate: number,
	durationFrames: number,
): RegularIntervalDialogProject & { readonly revision: number } {
	return {
		id,
		revision: 1,
		primarySequenceId,
		sampleRate,
		clips: [{ id: 'audio', kind: 'audio', timelineStartFrame: 0, durationFrames, sourceStartFrame: 0, sourceDurationFrames: durationFrames }],
	};
}

async function change(element: ReactTestElement, value: string): Promise<void> {
	await act(async () => {
		reactProps(element).onChange({ currentTarget: { value, valueAsNumber: Number(value) } });
		await Promise.resolve();
	});
}
