/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { ProjectReimportRequiredError } from '../src/common/editor/project-schema-identity.ts';
import {
	SOUNDSCAPER_BASELINE_ENTRY_MODULES,
	SOUNDSCAPER_BASELINE_VERSIONED_BOUNDARIES,
} from '../src/soundscaper/baseline-versioned-boundaries.ts';
import { editorProjectRuntimeProfileDefinition } from
	'../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from
	'../src/common/editor/project-runtime-profile-prerequisite.ts';
import {
	applySoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-commands.ts';
import {
	cloneSoundscaperProject,
	createSoundscaperProject,
	loadSoundscaperProject,
} from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from
	'../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

const NOW = '2026-08-28T12:00:00.000Z';

test('Soundscaper baseline creates and clones one complete family-qualified authority', () => {
	const project = createSoundscaperProject({
		id: 'soundscaper-baseline',
		title: 'Soundscaper baseline',
		now: NOW,
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice' }],
	});
	assert.equal(project.schemaFamily, 'soundscaper');
	assert.equal(project.schemaVersion, 1);
	assert.deepEqual(project.masteringSequences, []);
	assert.deepEqual(project.nativePluginStates, []);
	assert.deepEqual(project.assistanceAssets, []);
	assert.equal(validateSoundscaperProject(project), true);
	const clone = cloneSoundscaperProject(project);
	assert.deepEqual(clone, project);
	assert.notEqual(clone, project);
	assert.equal(loadSoundscaperProject(project).readOnly, false);
});

test('Soundscaper baseline retires numeric documents and preserves foreign/future custody', () => {
	assert.throws(
		() => loadSoundscaperProject({ schemaVersion: 30 }),
		(error: unknown) => error instanceof ProjectReimportRequiredError
			&& error.code === 'REIMPORT_REQUIRED',
	);
	const current = createSoundscaperProject({ id: 'custody', title: 'Custody', now: NOW });
	const foreign = { ...structuredClone(current), schemaFamily: 'framescaper' as const };
	const foreignLoad = loadSoundscaperProject(foreign);
	assert.equal(foreignLoad.readOnly, true);
	assert.equal(foreignLoad.reason, 'foreign-family');
	assert.deepEqual(foreignLoad.project, foreign);
	const future = { ...structuredClone(current), schemaVersion: 2 };
	const futureLoad = loadSoundscaperProject(future);
	assert.equal(futureLoad.readOnly, true);
	assert.equal(futureLoad.reason, 'newer-schema');
	assert.deepEqual(futureLoad.project, future);
});

test('foreign and future custody never traverses non-identity accessors', () => {
	let traversed = false;
	const foreign = {
		schemaFamily: 'framescaper', schemaVersion: 1,
		get sources() { traversed = true; throw new Error('foreign domain traversed'); },
	};
	const loaded = loadSoundscaperProject(foreign);
	assert.equal(loaded.project, foreign);
	assert.equal(loaded.readOnly, true);
	assert.equal(traversed, false);
	const shell = createSoundscaperProjectRuntimeSelection().projectForRuntimeConsumers(foreign);
	assert.equal(shell.schemaFamily, 'framescaper');
	assert.equal(traversed, false);
});

test('direct baseline commands preserve every product-owned field without predecessor borrowing', () => {
	const project = createSoundscaperProject({
		id: 'command-baseline', title: 'Before', now: NOW,
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice' }],
	});
	const renamed = applySoundscaperProjectCommand(project, {
		type: 'project/rename', title: 'After',
	}, { now: NOW });
	assert.equal(renamed.title, 'After');
	assert.equal(renamed.revision, project.revision + 1);
	assert.deepEqual(renamed.masteringSequences, project.masteringSequences);
	assert.deepEqual(renamed.nativePluginStates, project.nativePluginStates);
	assert.deepEqual(renamed.assistanceAssets, project.assistanceAssets);
	assert.equal(validateSoundscaperProject(renamed), true);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(
		editorProjectRuntimeProfileDefinition(runtime.runtimeProfile).prerequisite,
	);
	assert.equal(prerequisite.projectSchemaVersion, 1);
	assert.equal(prerequisite.attachedScapeFormatVersion, 1);
});

test('the selected Soundscaper graph contains no project-generation facade imports', () => {
	const root = resolve('src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx');
	const pending = [root];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const file = pending.pop()!;
		if (visited.has(file)) continue;
		visited.add(file);
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/gu)) {
			if (!match[1]?.startsWith('.')) continue;
			const imported = resolve(dirname(file), match[1]);
			if (imported.includes('/src/soundscaper/')) pending.push(imported);
		}
	}
	const retired = [...visited].filter((file) => (
		/-v(?:21|23|29|30)\.(?:ts|tsx)$/u.test(file)
		|| /BootstrapV(?:21|23|29|30)\.tsx$/u.test(file)
	));
	assert.deepEqual(retired, []);
});

test('Soundscaper has a closed versioned boundary and no predecessor source files', () => {
	const sourceRoot = resolve('src/soundscaper');
	const registered = new Set(SOUNDSCAPER_BASELINE_VERSIONED_BOUNDARIES.map(({ module }) => (
		module.slice(2)
	)));
	assert.equal(SOUNDSCAPER_BASELINE_VERSIONED_BOUNDARIES.every(({ reason }) => (
		reason.length >= 24
	)), true);
	const versioned = readdirSync(sourceRoot, { recursive: true })
		.filter((entry): entry is string => typeof entry === 'string')
		.filter((entry) => /(?:^|\/)[^/]*(?:-v\d+|V\d+)[^/]*\.(?:ts|tsx)$/u.test(entry));
	assert.deepEqual(versioned.sort(), [...registered].sort());
	for (const entry of SOUNDSCAPER_BASELINE_ENTRY_MODULES) {
		assert.equal(existsSync(resolve(sourceRoot, entry)), true, `missing baseline entry ${entry}`);
	}
	const retiredImport = /(?:from\s*|import\s*)['"]\.\/[^'"]*(?:-v(?:21|23|29|30)|BootstrapV\d+)[^'"]*['"]/gu;
	for (const entry of SOUNDSCAPER_BASELINE_ENTRY_MODULES) {
		assert.doesNotMatch(readFileSync(resolve(sourceRoot, entry), 'utf8'), retiredImport, entry);
	}
});
