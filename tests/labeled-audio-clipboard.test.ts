/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createClipboardDescriptor } from '../src/common/editor/commands.js';
import {
	createLabeledAudioClipboardDescriptor,
	createLabeledAudioClipboardPort,
} from '../src/common/editor/labeled-audio-clipboard.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const NOW = '2026-09-04T12:00:00.000Z';

function project() {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 10_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, title: 'Clip', anchor: 'sample',
		timelineStartFrame: 0, durationFrames: 10_000,
		sourceStartFrame: 0, sourceDurationFrames: 10_000,
	});
	return projectForCommand(createCurrentAudioEditorProject({
		id: 'labeled-clipboard', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] })],
	}) as unknown as Record<string, unknown>);
}

const describe = (regions: readonly { startFrame: number; endFrame: number }[]) => (
	createLabeledAudioClipboardDescriptor(project(), regions, ['track'], createClipboardDescriptor) as {
		readonly durationFrames: number;
		readonly tracks: readonly { readonly clips: readonly { readonly offsetFrame: number; readonly durationFrames: number }[] }[];
	} | null
);

test('one region produces the same clipboard the plain range copy would', () => {
	const descriptor = describe([{ startFrame: 2_000, endFrame: 3_000 }])!;
	assert.equal(descriptor.durationFrames, 1_000);
	assert.deepEqual(
		descriptor.tracks[0]!.clips.map((clip) => [clip.offsetFrame, clip.durationFrames]),
		[[0, 1_000]],
	);
});

test('several regions keep the silence that separated them, as upstream does', () => {
	const descriptor = describe([
		{ startFrame: 1_000, endFrame: 2_000 },
		{ startFrame: 5_000, endFrame: 5_500 },
	])!;
	// First region start to last region end, with the unlabelled material in
	// between left blank rather than copied.
	assert.equal(descriptor.durationFrames, 4_500);
	assert.deepEqual(
		descriptor.tracks[0]!.clips.map((clip) => [clip.offsetFrame, clip.durationFrames]),
		[[0, 1_000], [4_000, 500]],
	);
});

test('the labelled clipboard carries no timeline annotations of its own', () => {
	const descriptor = describe([{ startFrame: 0, endFrame: 1_000 }]) as unknown as Record<string, unknown>;
	if (Object.hasOwn(descriptor, 'annotations')) assert.deepEqual(descriptor.annotations, []);
});

test('point labels alone leave nothing to copy', () => {
	assert.equal(describe([{ startFrame: 1_000, endFrame: 1_000 }]), null);
	assert.equal(describe([]), null);
});

test('the port reads the edit clipboard projection and carries the session descriptor', () => {
	const document = project();
	const seen: unknown[] = [];
	const port = createLabeledAudioClipboardPort({
		getProject: () => document,
		getCommandProject: () => { throw new Error('the projection wins over the command project'); },
		projectRuntime: {
			projectForEditClipboardConsumers: (value) => { seen.push(value); return value; },
			prepareEditClipboardDescriptor: (_value, descriptor) => ({ carried: descriptor }),
		},
		createDescriptor: createClipboardDescriptor,
	});

	const carried = port.create([{ startFrame: 0, endFrame: 1_000 }], ['track']) as { carried: unknown };
	assert.deepEqual(seen, [document]);
	assert.equal(typeof carried.carried, 'object');
	assert.equal(port.create([], ['track']), null);
});
