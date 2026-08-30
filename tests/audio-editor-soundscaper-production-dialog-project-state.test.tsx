/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import SoundscaperProductionDialog from '../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx';
import { SOUNDSCAPER_PRODUCTION_COPY } from '../src/common/editor/ui/soundscaper-production-copy.ts';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('production work from another project cannot retain or publish dialog state', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const first = deferred<void>();
	let calls = 0;
	const actions = {
		execute: () => {
			calls += 1;
			return calls === 1 ? first.promise : undefined;
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={{ audioAnalysis: true }}
		snapshot={{ project: project(projectId) }}
		initialSurface="metering"
		actions={actions}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.resetMeters)).onClick({});
			await Promise.resolve();
		});
		assert.equal(calls, 1);

		await act(async () => root.render(renderDialog('project-b')));
		assert.equal(dom.container.textContent.includes(`${SOUNDSCAPER_PRODUCTION_COPY.metersTab}…`), false);
		await act(async () => {
			void reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.resetMeters)).onClick({});
			await Promise.resolve();
		});
		assert.equal(calls, 2, 'project B must not inherit project A busy state');
		assert.equal(dom.container.textContent.includes(SOUNDSCAPER_PRODUCTION_COPY.operationComplete), true);

		await act(async () => {
			first.reject(new Error('project A failed'));
			await first.promise.catch(() => undefined);
			await Promise.resolve();
		});
		assert.equal(dom.container.textContent.includes('project A failed'), false);
		assert.equal(dom.container.textContent.includes(SOUNDSCAPER_PRODUCTION_COPY.operationComplete), true);
	} finally {
		first.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a failed automation release remains active so the user can retry or cancel it', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const release = deferred<void>();
	const operations: unknown[] = [];
	const actions = {
		execute: (operation: Readonly<{ readonly type: string }>) => {
			operations.push(operation);
			return operation.type === 'automation-gesture/release' ? release.promise : undefined;
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperProductionDialog
			productId="soundscaper"
			capabilities={{ audioAutomation: true }}
			snapshot={{
				project: automationProject(), selectedTrackId: 'voice', selectedLaneId: 'voice-gain',
			}}
			initialSurface="automation"
			automationMode="touch"
			actions={actions}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.beginAutomationGesture)).onClick({});
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(
			reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.cancelAutomationGesture)).disabled,
			false,
		);

		await act(async () => {
			void reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.releaseAutomationGesture)).onClick({});
			await Promise.resolve();
		});
		await act(async () => {
			release.reject(new Error('release refused'));
			await release.promise.catch(() => undefined);
			await Promise.resolve();
		});

		assert.deepEqual(operations.map((operation) => Reflect.get(operation as object, 'type')), [
			'automation-gesture/begin', 'automation-gesture/release',
		]);
		assert.equal(dom.container.textContent.includes('release refused'), true);
		assert.equal(
			reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.cancelAutomationGesture)).disabled,
			false,
			'a failed release must leave cancellation reachable',
		);
		assert.equal(
			reactProps(buttonWithText(dom.container, SOUNDSCAPER_PRODUCTION_COPY.beginAutomationGesture)).disabled,
			true,
			'a failed release must not allow a second gesture to begin',
		);
	} finally {
		release.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('an automation draft cannot cross into a replacement project with identical lane data', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string, mode: 'read' | 'touch' = 'touch') => <SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={{ audioAutomation: true }}
		snapshot={{
			project: automationProject(projectId), selectedTrackId: 'voice', selectedLaneId: 'voice-gain',
		}}
		initialSurface="automation"
		automationMode={mode}
		actions={{ execute: () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		const projectADraft = JSON.stringify({
			...automationProject('project-a').automationLanes[0],
			points: [{ id: 'point-1', position: 0, value: 2 }],
		}, null, '\t');
		await act(async () => {
			reactProps(dom.one('textarea')).onChange({ currentTarget: { value: projectADraft } });
		});
		assert.equal(dom.one('textarea').value, projectADraft);

		await act(async () => root.render(renderDialog('project-b', 'read')));
		assert.equal(reactProps(automationModeControl(dom.container)).value, 'read',
			'project B must receive its own controller automation mode');
		const replacementDraft = JSON.parse(String(dom.one('textarea').value)) as {
			readonly points: readonly Readonly<{ readonly value: number }>[];
		};
		assert.equal(replacementDraft.points[0]?.value, 1,
			'project B must receive its canonical lane instead of project A\'s unsubmitted draft');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function project(id: string) {
	return {
		id,
		schemaFamily: 'soundscaper' as const,
		schemaVersion: 1 as const,
		sampleRate: 48_000,
		tracks: [],
	};
}

function automationProject(id = 'automation-project') {
	return {
		...project(id),
		tracks: [{
			id: 'voice', type: 'audio', name: 'Voice', locked: false, clipIds: [], effects: [],
		}],
		automationLanes: [{
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'point-1', position: 0, value: 1 }],
			segments: [],
		}],
	};
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	let reject: (reason?: unknown) => void = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}

function automationModeControl(root: ReactTestElement): ReactTestElement {
	const modes = new Set(['read', 'trim', 'touch', 'latch', 'write']);
	const control = root.querySelectorAll('select').find((candidate) => (
		modes.has(String(reactProps(candidate).value))
	));
	if (!control) throw new Error('Missing automation mode control.');
	return control;
}
