/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioTrackEnvelope } from '../src/common/editor/ui/timeline/useAudioTrackEnvelope.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const change of ['none', 'rename', 'same-points', 'replace-points', 'undo'] as const) {
	test(`native clip-gain draft preserves authoritative points after ${change} before mouse release`, async context => {
		context.mock.timers.enable({ apis: ['setTimeout'] });
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const document = dom.container.ownerDocument as unknown as Document;
		const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
		document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (!listener) return;
			const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
			entries.add(listener); listeners.set(type, entries);
		};
		document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) listeners.get(type)?.delete(listener); };
		const initial = createSoundscaperProject({ id: 'envelope-authority', sampleRate: 48_000,
			sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 100,
				sampleRate: 48_000, channelCount: 1 })],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100,
				envelope: [] })],
			sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main' });
		let history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), {
			type: 'clip/update', clipId: 'clip', changes: { envelope: [{ frame: 50, value: 1 }] },
		});
		const updates: AudioEditorCommand[] = [];
		const controller = { actions: { clip: { update(id: string, changes: Record<string, unknown>) {
			const command: AudioEditorCommand = { type: 'clip/update', clipId: id, changes };
			history = executeSoundscaperProjectCommand(history, command); updates.push(command);
		} } } };
		const root = createRoot(dom.container as unknown as Element);
		const render = () => root.render(<Harness controller={controller}
			project={resolveRuntimeProjectProjection(history.present)} />);
		try {
			await act(async () => { render(); });
			await act(async () => { reactProps(dom.one('[data-envelope-draft]')).onMouseMove?.({}); });
			if (change !== 'none') {
				history = change === 'undo' ? undoSoundscaperProjectCommand(history)
					: executeSoundscaperProjectCommand(history, { type: 'clip/update', clipId: 'clip', changes:
						change === 'rename' ? { title: 'Renamed recording' }
							: { envelope: [{ frame: 50, value: change === 'same-points' ? 1 : .6 }] },
					});
				await act(async () => { render(); });
			}
			const authoritative = history.present.clips[0]!.envelope;

			await act(async () => {
				for (const listener of listeners.get('mouseup') ?? []) {
					const event = Object.assign(new Event('mouseup'), { button: 0 });
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
				context.mock.timers.runAll();
			});
			const changed = change === 'undo' || change === 'replace-points';
			assert.equal(updates.length, changed ? 0 : 1);
			if (changed) assert.deepEqual(history.present.clips[0]!.envelope, authoritative);
			else {
				const envelope: unknown = history.present.clips[0]!.envelope;
				assert.ok(Array.isArray(envelope));
				assert.ok(envelope.some((point: unknown) => point !== null && typeof point === 'object'
					&& 'value' in point && typeof point.value === 'number' && point.value < .3));
			}
		} finally {
			await act(async () => { root.unmount(); context.mock.timers.runAll(); });
			assert.equal(listeners.get('mouseup')?.size ?? 0, 0);
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}

type Project = ReturnType<typeof resolveRuntimeProjectProjection>;
type Controller = Readonly<{ actions: Readonly<{ clip: Readonly<{
	update(id: string, changes: Record<string, unknown>): void;
}> }> }>;

function Harness({ controller, project }: { readonly controller: Controller; readonly project: Project }) {
	const { updateEnvelope } = useAudioTrackEnvelope({ controller,
		run: (operation: () => unknown) => operation(), blocked: false, automationToolEnabled: true,
		clipLookup: new Map(project.clips.map(clip => [clip.id, clip])),
		projectionClips: project.clips.map(clip => ({ ...clip, waveformStartFrame: 0, waveformEndFrame: 100 })),
		sampleRate: 48_000 });
	return <div data-envelope-draft onMouseMove={() => updateEnvelope('clip', [{ time: 50 / 48_000, db: -12 }])} />;
}
