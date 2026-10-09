/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import type { TrackAutomationRuntime } from '../src/common/editor/track-automation-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Tone = 'bassDb' | 'trebleDb';
interface Options { readonly automation?: Tone | 'volumeDb'; readonly reject?: boolean }

async function withEditor(options: Options, run: (f: Readonly<{
	link(): Promise<void>; edit(name: Tone, value: number): Promise<void>;
	params(): Readonly<Record<string, unknown>>; depth(): number; undo(): void; redo(): void;
	automationCalls: unknown[][]; alerts(): readonly string[];
}>) => Promise<void>) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const effect = createEffect('audacity-bass-treble', { id: 'tone' });
	const project = createSoundscaperProject({ id: 'tone-project', title: 'Tone', now: '2026-10-09T00:00:00.000Z',
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', effects: [effect], clipIds: [] })] });
	let history = createSoundscaperProjectHistory(project);
	const automationCalls: unknown[][] = [];
	const token = Object.freeze({ laneId: 'tone-lane' });
	const runtime: TrackAutomationRuntime = {
		snapshot: { mode: 'touch', laneId: 'tone-lane', gestureActive: false }, setMode: () => undefined,
		beginGesture: (id, value) => { automationCalls.push(['begin', id, value]); return token; },
		previewGesture: (owned, value) => { automationCalls.push(['preview', owned, value]); },
		releaseGesture: (owned, value) => { automationCalls.push(['release', owned, value]); },
		cancelGesture: owned => { automationCalls.push(['cancel', owned]); },
	};
	const automationProject = { automationLanes: options.automation ? [{ id: 'tone-lane', address: {
		kind: 'effect', strip: { kind: 'track', id: 'voice' }, effectId: effect.id, parameterId: options.automation,
	} }] : [] };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const currentEffect = () => (history.present.tracks[0]!.effects as readonly (typeof effect)[])[0]!;
	const params = (): Readonly<Record<string, unknown>> => currentEffect().params;
	const render = () => root.render(<EffectParameterEditor
		effect={currentEffect()} copy={ENGLISH_COPY} disabled={false}
		tracks={history.present.tracks} targetTrackId="voice" captureNoiseProfile={undefined} noiseProfileLabel=""
		onRackEffectGestureBegin={undefined} onRackEffectPreview={undefined} onRackEffectCommit={undefined} onRackEffectCancel={undefined}
		onParametricEqGestureBegin={undefined} onParametricEqPreview={undefined} onParametricEqCommit={undefined}
		onParametricEqCancel={undefined} onParametricEqAudition={undefined} readParametricEqSpectrum={undefined}
		automationRuntime={options.automation ? runtime : undefined} automationProject={automationProject}
		automationStrip={{ kind: 'track', id: 'voice' }} onChange={(changes: Readonly<Record<string, unknown>>) => {
			if (options.reject) throw new Error('Ordinary write refused');
			history = executeSoundscaperProjectCommand(history, { type: 'effect/update', scope: 'track', trackId: 'voice',
				effectId: effect.id, changes }) as typeof history;
			render();
		}} />);
	try {
		await act(async () => { render(); });
		await run({ params, automationCalls, depth: () => history.undoStack.length,
			undo() { history = undoSoundscaperProjectCommand(history); },
			redo() { history = redoSoundscaperProjectCommand(history); },
			async link() {
				const checkbox = dom.one('[role="checkbox"]');
				await act(async () => { reactProps(checkbox).onClick?.({}); });
			},
			async edit(name, value) {
				const input = dom.one(`[data-effect-param="${name}"]`).querySelector('input');
				assert.ok(input);
				await act(async () => { reactProps(input).onChange?.({ target: { value: String(value) } }); });
				await act(async () => { reactProps(input).onBlur?.({}); });
			}, alerts: () => dom.container.querySelectorAll('[role="alert"]').map(alert => alert.textContent),
		});
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

for (const name of ['bassDb', 'trebleDb'] as const) test(`linked ${name} publishes one atomic tone/volume edit with complete Undo and Redo`, async () => {
	await withEditor({}, async f => {
		await f.link(); await f.edit(name, 12);
		assert.equal(f.params()[name], 12); assert.equal(f.params().volumeDb, -6);
		assert.equal(f.depth(), 1, 'one linked user edit must publish one history entry');
		f.undo(); assert.equal(f.params()[name], 0); assert.equal(f.params().volumeDb, 0);
		f.redo(); assert.equal(f.params()[name], 12); assert.equal(f.params().volumeDb, -6);
	});
});

test('an unlinked ordinary tone edit retains one history entry without compensation', async () => {
	await withEditor({}, async f => {
		await f.edit('bassDb', 12); assert.equal(f.depth(), 1);
		assert.equal(f.params().bassDb, 12); assert.equal(f.params().volumeDb, 0);
	});
});

test('a refused linked publication preserves both parameters and reports the refusal', async () => {
	await withEditor({ reject: true }, async f => {
		await f.link(); await f.edit('bassDb', 12);
		assert.equal(f.depth(), 0); assert.equal(f.params().bassDb, 0); assert.equal(f.params().volumeDb, 0);
		assert.deepEqual(f.alerts(), ['Ordinary write refused']);
	});
});

for (const automation of ['bassDb', 'volumeDb'] as const) test(`linked edits preserve the independently owned ${automation} live automation lane`, async () => {
	await withEditor({ automation }, async f => {
		await f.link(); await f.edit('bassDb', 12);
		assert.deepEqual(f.automationCalls.map(call => call[0]), ['begin', 'preview', 'release']);
		assert.deepEqual(f.automationCalls.map(call => call.at(-1)), Array(3).fill(automation === 'bassDb' ? 12 : -6));
		assert.equal(f.params().bassDb, automation === 'bassDb' ? 0 : 12);
		assert.equal(f.params().volumeDb, automation === 'volumeDb' ? 0 : -6);
		assert.equal(f.depth(), 1); assert.deepEqual(f.alerts(), []);
	});
});
