/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAddTrackFolderCommand, createMoveTrackNodeCommand, createUpdateTrackFolderCommand } from '../src/common/editor/commands/factories.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';

for (const [mute, solo] of [[false, false], [true, false], [false, true], [true, true]] as const) test(`own DAWproject folder round trip preserves mute=${String(mute)} solo=${String(solo)}`, () => {
	let project = createSoundscaperProject({ id: 'programme', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	project = applySoundscaperProjectCommand(project, createAddTrackFolderCommand('main-sequence', { id: 'dialogue', name: 'Dialogue' }));
	project = applySoundscaperProjectCommand(project, createMoveTrackNodeCommand('main-sequence', 'voice', 'dialogue', 0));
	project = applySoundscaperProjectCommand(project, createUpdateTrackFolderCommand('dialogue', { mute, solo }));
	assert.equal(validateSoundscaperProject(project), true);
	assert.equal(project.trackFolders[0]?.mute, mute);
	assert.equal(project.trackFolders[0]?.solo, solo);
	assert.equal(project.mixer.groups.find(bus => bus.id === 'dialogue')?.mute, false);
	const original = structuredClone(project);
	const exported = createDawprojectExport({ project });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	const channel = document.tracks.find(track => track.name === 'Dialogue')?.channel;
	assert.equal(channel?.mute?.value, mute, 'the actual folder channel preserves the authored folder gate');
	assert.equal(channel?.solo, solo);
	let ordinal = 0;
	const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
	const imported = importSoundscaperAudacityProject(createAudioEditorProjectV17(plan.project), plan.routingContext);
	assert.equal(validateSoundscaperProject(imported), true);
	assert.equal(imported.trackFolders[0]?.mute, mute);
	assert.equal(imported.trackFolders[0]?.solo, solo);
	assert.equal(imported.mixer.groups[0]?.mute, false, 'folder-owned bus never duplicates the structural gate');
	assert.equal(imported.mixer.groups[0]?.solo, false);
	assert.deepEqual(project, original);
});

test('nested authored folder gates survive decoding and its reported legacy nested-bus conversion', () => {
	let project = createSoundscaperProject({ id: 'programme', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	project = applySoundscaperProjectCommand(project, createAddTrackFolderCommand('main-sequence', { id: 'dialogue', name: 'Dialogue' }));
	project = applySoundscaperProjectCommand(project, createAddTrackFolderCommand('main-sequence', { id: 'nested', name: 'Nested' }, { parentFolderId: 'dialogue' }));
	project = applySoundscaperProjectCommand(project, createMoveTrackNodeCommand('main-sequence', 'voice', 'nested', 0));
	project = applySoundscaperProjectCommand(project, createUpdateTrackFolderCommand('nested', { mute: true, solo: true }));
	assert.equal(validateSoundscaperProject(project), true);
	assert.equal(project.mixer.groups.some(bus => bus.id === 'nested'), true);
	const exported = createDawprojectExport({ project });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	const channel = document.tracks.find(track => track.name === 'Dialogue')?.children[0]?.channel;
	assert.equal(channel?.mute?.value, true);
	assert.equal(channel?.solo, true);
	let ordinal = 0;
	const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
	assert.equal(plan.report.items.some(item => item.code === 'dawproject.nested-bus-converted'), true);
	const folders = plan.project.trackFolders as readonly { name: string; mute: boolean; solo: boolean }[];
	assert.equal(folders.find(folder => folder.name === 'Nested')?.mute, true);
	assert.equal(folders.find(folder => folder.name === 'Nested')?.solo, true);
});

test('the structure-only audio-free folder profile explicitly reports authored gate loss', () => {
	let project = createSoundscaperProject({ id: 'programme' });
	project = applySoundscaperProjectCommand(project, createAddTrackFolderCommand('main-sequence', { id: 'empty', name: 'Empty' }));
	project = applySoundscaperProjectCommand(project, createUpdateTrackFolderCommand('empty', { mute: true, solo: true }));
	assert.equal(validateSoundscaperProject(project), true);
	assert.equal(project.mixer.groups.length, 0);
	const exported = createDawprojectExport({ project });
	const loss = exported.report.items.find(item => item.code === 'dawproject.folder-gates-omitted');
	assert.deepEqual(loss?.scope, { kind: 'folder', id: 'empty' });
	assert.deepEqual(loss?.data, { mute: true, solo: true });
	assert.equal(loss?.severity, 'warning');
});
