/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { exclusiveTrackAudibilityCommand } from '../src/common/editor/ui/timeline/exclusive-track-audibility.ts';

for (const parameter of ['solo', 'mute'] as const) test(`track-header Control and Meta ${parameter} publish one exclusive command`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const tracks = [
		{ id: 'first', type: 'audio', mute: true, solo: true },
		{ id: 'target', type: 'audio', name: 'Target', gain: 1, pan: 0, mute: false, solo: false },
		{ id: 'labels', type: 'label', mute: true, solo: true },
	];
	const published: AudioEditorCommand[] = [];
	const controller = { getSnapshot: () => ({ project: { id: 'project', tracks } }),
		getTelemetrySnapshot: () => ({ meters: {} }), subscribeTelemetry: () => () => undefined,
		actions: { track: { update: (trackId: string, changes: Record<string, unknown>) => published.push({ type: 'track/update', trackId, changes }) },
			timeline: { selectTrack() {} }, edit: { commit: (command: AudioEditorCommand) => published.push(command) },
			mixer: { beginParameterGesture: () => 0, previewParameterGesture() {}, commitParameterGesture() {}, cancelParameterGesture() {} } },
	};
	try {
		await act(async () => root.render(<TrackControls controller={controller} track={tracks[1]}
			trackHeight={180} panelWidth={240} selected blocked={false} showArmControls={false} displayAudioSupported={false}
			recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
			isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onMenu={() => undefined} onOpenEffects={() => undefined} onAutomationTarget={() => undefined}
			onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
		const button = dom.container.querySelectorAll('button').find(element => element.getAttribute('aria-label') === (parameter === 'solo' ? 'Solo' : 'Mute'));
		assert.ok(button);
		for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
			published.length = 0;
			await act(async () => { reactProps(button).onClick({ ...modifiers, stopPropagation() {} }); });
			assert.deepEqual(published, [{ type: 'batch', commands: [
				{ type: 'track/update', trackId: 'first', changes: { [parameter]: false } },
				{ type: 'track/update', trackId: 'target', changes: { [parameter]: true } },
			] }]);
		}
		published.length = 0;
		await act(async () => { reactProps(button).onClick({ stopPropagation() {} }); });
		assert.deepEqual(published, [{ type: 'track/update', trackId: 'target', changes: { [parameter]: true } }]);
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
	}
});

test('exclusive track audibility clears peers even when its target is already enabled', () => {
	const project = { tracks: [
		{ id: 'target', type: 'audio', solo: true }, { id: 'peer', type: 'audio', solo: true },
		{ id: 'picture', type: 'video', solo: true },
		{ id: 'idle', type: 'audio', solo: false }, { id: 'labels', type: 'label', solo: true },
	] };
	assert.deepEqual(exclusiveTrackAudibilityCommand(project, 'target', 'solo'), {
		type: 'batch', commands: [{ type: 'track/update', trackId: 'peer', changes: { solo: false } }],
	});
	assert.equal(exclusiveTrackAudibilityCommand({ tracks: project.tracks.filter(track => track.id !== 'peer') }, 'target', 'solo'), null);
	assert.equal(exclusiveTrackAudibilityCommand(project, 'missing', 'solo'), null);
	assert.equal(exclusiveTrackAudibilityCommand(project, 'labels', 'solo'), null);
	assert.equal(exclusiveTrackAudibilityCommand(project, 'picture', 'solo'), null);
});
