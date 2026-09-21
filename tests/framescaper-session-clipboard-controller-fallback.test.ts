/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands/clipboard-runtime.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from
	'../src/framescaper/editor-project-runtime-selection.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperBaselineImageFixture } from
	'./helpers/framescaper-baseline-image-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

type Data = Record<string, unknown>;

test('ordinary controller paste projects a rich V13 carrier to its body-free foundation', () => {
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const origin = createFramescaperBaselineImageFixture().project;
	const descriptor = createClipboardDescriptor(runtime.projectForEditClipboardConsumers(origin), {
		startFrame: 0,
		endFrame: 48_000,
		trackIds: origin.tracks.map(({ id }) => id),
		clipIds: origin.clips.map(({ id }) => id),
	});
	const carrier = runtime.createEditSessionClipboard(origin, descriptor);
	const destination = emptyDestination();
	const createId = stableIds();
	const paste = preparePasteCommand(descriptor, {
		atFrame: 48_000,
		mode: 'overlap',
		trackMap: { 'video-track': 'video-track', 'audio-track': 'audio-track' },
	}, createId);
	const command = runtime.prepareEditClipboardPasteCommand(
		destination,
		carrier,
		{
			type: 'batch',
			commands: [
				...carrier.sources.map((source) => ({
					type: 'source/add' as const,
					source: structuredClone(source),
				})),
				paste,
			],
		} as AudioEditorCommand,
		createId,
	);

	const commands = flattenCommands(command);
	assert.deepEqual(commands.filter(({ type }) => type === 'source/add').map(({ source }) => (
		(source as Data).kind
	)), ['audio', 'video']);
	assert.equal(commands.some(({ type }) => type === 'image-source/set'), false);
	assert.equal(commands.some(({ type }) => type === 'image-clip/set'), false);

	const pasted = runtime.applyCommand(destination, command, { now: '2026-09-21T12:00:00.000Z' });
	assert.deepEqual(pasted.clips.map(({ kind }) => kind).sort(), ['audio', 'video']);
	assert.equal(pasted.sources.some(({ kind }) => kind === 'image'), false);
});

function emptyDestination() {
	const options = framescaperBaselineOptions();
	options.id = 'clipboard-destination';
	options.sources = [];
	options.clips = [];
	options.projectBin = { clips: [] };
	options.tracks = (options.tracks as Data[]).map((track) => ({ ...track, clipIds: [] }));
	return createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options);
}

function flattenCommands(value: unknown): Data[] {
	const command = value as Data;
	return command.type === 'batch'
		? (command.commands as unknown[]).flatMap(flattenCommands)
		: [command];
}

function stableIds(): (prefix?: string) => string {
	let next = 0;
	return (prefix = 'id') => `${prefix}-${String((next += 1))}`;
}
