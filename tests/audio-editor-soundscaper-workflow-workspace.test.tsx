/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import {
	resolveSoundscaperFreezeStatus,
	useSoundscaperWorkflowWorkspace,
	type SoundscaperWorkflowControllerPort,
} from '../src/common/editor/ui/workspace/useSoundscaperWorkflowWorkspace.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('native workflow runtime opens standalone mastering and exposes freeze state', async () => {
	const fixture = await mountedWorkflowFixture();
	try {
		await fixture.render('soundscaper', project('project-a', 1, true));
		const runtime = fixture.runtime();
		assert.equal(runtime.freezeStatus, 'stale');
		assert.equal(runtime.freezeStatusForTrack('track-b'), 'none');
		assert.equal(runtime.freezeActionsAvailable, true);
		await act(async () => { runtime.openMasteringSequences(); });
		assert.deepEqual(fixture.surfaces, ['mastering-sequences']);
		await act(async () => { await runtime.freeze('refresh', 'track-a'); });
		assert.deepEqual(fixture.freezeCalls, [['refresh', 'track-a']]);
	} finally {
		await fixture.cleanup();
	}
});

test('workflow automation owns one token across same-project revisions and cancels on replacement', async () => {
	const fixture = await mountedWorkflowFixture();
	try {
		await fixture.render('soundscaper', project('project-a', 1));
		const first = fixture.runtime().automationRuntime;
		let token: unknown;
		await act(async () => { token = first.beginGesture?.('lane-a', 0.25); });
		assert.equal(token, fixture.token);
		await act(async () => { first.previewGesture?.(token, 0.5); });

		await fixture.render('soundscaper', project('project-a', 2));
		assert.deepEqual(fixture.cancellations, []);
		await fixture.render('soundscaper', project('project-b', 1));
		assert.deepEqual(fixture.cancellations, [fixture.token]);
	} finally {
		await fixture.cleanup();
	}
});

test('failed automation release retains the token for cancellation or retry', async () => {
	const fixture = await mountedWorkflowFixture({ failFirstRelease: true });
	try {
		await fixture.render('soundscaper', project('project-a', 1));
		const automation = fixture.runtime().automationRuntime;
		let token: unknown;
		await act(async () => { token = automation.beginGesture?.('lane-a', 0.25); });
		let refusal: unknown;
		await act(async () => {
			try {
				await Promise.resolve(automation.releaseGesture?.(token, 0.75));
			} catch (cause) {
				refusal = cause;
			}
		});
		assert.match(refusal instanceof Error ? refusal.message : String(refusal), /release refused/iu);
		let result: unknown;
		await act(async () => { result = await automation.releaseGesture?.(token, 0.75); });
		assert.equal(result, 'released');
		assert.deepEqual(fixture.releases, [
			[fixture.token, 0.75], [fixture.token, 0.75],
		]);
	} finally {
		await fixture.cleanup();
	}
});

test('workflow runtime is absent outside Soundscaper', async () => {
	const fixture = await mountedWorkflowFixture();
	try {
		await fixture.render('framescaper', project('project-a', 1));
		assert.equal(fixture.captured, null);
	} finally {
		await fixture.cleanup();
	}
});

test('freeze status prefers runtime verification and falls back to document ownership', () => {
	const value = project('project-a', 1, true);
	const verified = controllerFixture().controller;
	assert.equal(resolveSoundscaperFreezeStatus(verified, value, 'track-a'), 'stale');
	assert.equal(resolveSoundscaperFreezeStatus(verified, value, 'missing'), 'none');
	assert.equal(resolveSoundscaperFreezeStatus({ actions: {} }, value, 'track-a'), 'unknown');
});

async function mountedWorkflowFixture(options: Readonly<{ failFirstRelease?: boolean }> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const ports = controllerFixture(options);
	const surfaces: string[] = [];
	let captured: ReturnType<typeof useSoundscaperWorkflowWorkspace> = null;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		...ports,
		surfaces,
		get captured() { return captured; },
		runtime: () => {
			assert.ok(captured);
			return captured;
		},
		render: async (productId: string, projectValue: unknown) => {
			await act(async () => root.render(<WorkflowHarness
				productId={productId}
				project={projectValue}
				controller={ports.controller}
				openSurface={(surface) => { surfaces.push(surface); }}
				capture={(runtime) => { captured = runtime; }}
			/>));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function WorkflowHarness(input: Readonly<{
	productId: string;
	project: unknown;
	controller: SoundscaperWorkflowControllerPort;
	openSurface(surface: string): void;
	capture(runtime: ReturnType<typeof useSoundscaperWorkflowWorkspace>): void;
}>): null {
	input.capture(useSoundscaperWorkflowWorkspace({
		...input,
		selectedTrackId: 'track-a',
	}));
	return null;
}

function controllerFixture(options: Readonly<{ failFirstRelease?: boolean }> = {}) {
	const token = Object.freeze({ type: 'automation-token', generation: 1 });
	const cancellations: unknown[] = [];
	const releases: unknown[][] = [];
	const freezeCalls: unknown[][] = [];
	let releaseAttempts = 0;
	const controller: SoundscaperWorkflowControllerPort = {
		actions: {
			audioAutomation: {
				getSnapshot: () => ({ mode: 'touch', laneId: 'lane-a', gestureActive: false }),
				setMode: () => undefined,
				beginGesture: () => token,
				previewGesture: (_token, value) => value,
				releaseGesture: (active, value) => {
					releases.push([active, value]);
					releaseAttempts += 1;
					return options.failFirstRelease && releaseAttempts === 1
						? Promise.reject(new Error('release refused'))
						: Promise.resolve('released');
				},
				cancelGesture: (active) => { cancellations.push(active); return true; },
			},
			audioFreeze: {
				getStatus: (trackId) => trackId === 'track-a' ? 'stale' : 'none',
				freeze: (trackId) => { freezeCalls.push(['freeze', trackId]); },
				refresh: (trackId) => { freezeCalls.push(['refresh', trackId]); },
				unfreeze: (trackId) => { freezeCalls.push(['unfreeze', trackId]); },
				commit: (trackId) => { freezeCalls.push(['commit', trackId]); },
			},
		},
	};
	return { controller, token, cancellations, releases, freezeCalls };
}

function project(id: string, revision: number, frozen = false): unknown {
	return {
		id,
		revision,
		tracks: [{ id: 'track-a', type: 'audio', ...(frozen ? { audioFreeze: { schemaVersion: 1 } } : {}) }],
	};
}
