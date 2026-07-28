/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLabelService,
	type LabelProjectDocument,
	type LabelServiceDependencies,
} from '../src/common/editor/controller/label-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function project(id = 'project-a'): LabelProjectDocument {
	return {
		id,
		title: 'Session.wav',
		sampleRate: 1_000,
		tracks: [{
			type: 'label',
			id: 'labels-a',
			name: 'Captions',
			labels: [{ id: 'label-existing', title: 'Existing', startFrame: 0, endFrame: 100, color: 'auto' }],
		}, {
			type: 'label',
			id: 'labels-b',
			name: 'Notes',
			labels: [{ id: 'label-b', title: 'Second', startFrame: 200, endFrame: 300, color: 'auto' }],
		}],
	};
}

function createFixture(overrides: Partial<LabelServiceDependencies> = {}) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	let activeProject = project();
	projectGeneration.activate(activeProject.id);
	const state = { importing: false, selectedTrackId: 'labels-a' as string | null };
	const commits: Array<Readonly<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}>> = [];
	const statuses: Array<Readonly<{ message: string; state?: string }>> = [];
	const saved: unknown[] = [];
	let publishes = 0;
	let id = 0;
	const dependencies: LabelServiceDependencies = {
		lifetime,
		projectGeneration,
		state,
		copy: {
			labelTrackMissing: 'A label track is required.',
			labels: 'Labels',
			labelsExported: 'Exported {count} labels.',
			labelsImported: 'Imported {count} labels.',
			labelsImportEmpty: 'No labels.',
			labelsImporting: 'Importing labels.',
		},
		getProject: () => activeProject,
		editingBlocked: () => false,
		createId: (prefix) => `${prefix}-${++id}`,
		commit: (command, selection) => { commits.push({ command, selection }); },
		setStatus: (message, nextState) => { statuses.push({ message, state: nextState }); },
		publish: () => { publishes += 1; },
		saveExport: async (result) => { saved.push(result); return { saved: true }; },
		...overrides,
	};
	return {
		commits,
		dependencies,
		lifetime,
		projectGeneration,
		publishes: () => publishes,
		replaceProject(nextId: string) {
			activeProject = project(nextId);
			projectGeneration.activate(nextId);
		},
		saved,
		state,
		statuses,
	};
}

test('label import parses once and commits one prepared label-track command', async () => {
	const fixture = createFixture();
	const service = createLabelService(fixture.dependencies);
	const file = {
		name: 'chapters.txt',
		arrayBuffer: async () => new TextEncoder().encode('0.000\t1.250\tIntro').buffer,
	};

	const result = await service.importLabelFile(file, { name: 'Chapters' });

	assert.equal(result?.trackId, 'label-track-2');
	assert.equal(result?.labels[0]?.id, 'label-1');
	assert.equal(result?.labels[0]?.endFrame, 1_250);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.command.type, 'track/add');
	assert.deepEqual(fixture.commits[0]?.selection, { selectTrackId: 'label-track-2' });
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.publishes(), 2);
	assert.deepEqual(fixture.statuses, [
		{ message: 'Importing labels.', state: undefined },
		{ message: 'Imported 1 labels.', state: 'success' },
	]);
});

test('project switching suppresses a late label import commit and clears owned busy state', async () => {
	const reading = deferred<ArrayBuffer>();
	const fixture = createFixture();
	const service = createLabelService(fixture.dependencies);
	const importing = service.importLabelFile({ name: 'late.txt', arrayBuffer: () => reading.promise });
	fixture.replaceProject('project-b');
	reading.resolve(new TextEncoder().encode('0\t1\tLate').buffer);

	await assert.rejects(importing, (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.statuses.some(({ message }) => message.startsWith('Imported')), false);
});

test('label export defaults to the selected label track and awaits its saver', async () => {
	const fixture = createFixture();
	const service = createLabelService(fixture.dependencies);

	const result = await service.exportLabels({ format: '.vtt' });

	assert.equal(result.format, 'vtt');
	assert.equal(result.fileName, 'Session.vtt');
	assert.equal(result.mimeType, 'text/vtt;charset=utf-8');
	assert.equal(result.labelCount, 1);
	assert.deepEqual(result.trackIds, ['labels-a']);
	assert.match(result.text, /^WEBVTT/u);
	assert.equal(fixture.saved.length, 1);
	assert.deepEqual(fixture.statuses.at(-1), { message: 'Exported 1 labels.', state: 'success' });
});

test('Podcast 2.0 chapter exports use JSON download metadata and schema', async () => {
	const fixture = createFixture();
	const service = createLabelService(fixture.dependencies);

	const result = await service.exportLabels({ format: 'json' });

	assert.equal(result.format, 'json');
	assert.equal(result.fileName, 'Session.json');
	assert.equal(result.mimeType, 'application/json+chapters');
	assert.deepEqual(JSON.parse(result.text), {
		version: '1.2.0',
		chapters: [{ startTime: 0, title: 'Existing' }],
	});
});

test('disposed controller rejects label work before reading or publishing', async () => {
	let reads = 0;
	const fixture = createFixture();
	fixture.lifetime.beginDisposal();
	const service = createLabelService(fixture.dependencies);

	await assert.rejects(
		service.importLabelFile({
			name: 'ignored.txt',
			arrayBuffer: async () => { reads += 1; return new ArrayBuffer(0); },
		}),
		(error: unknown) => error instanceof Error && 'code' in error && error.code === 'DISPOSED',
	);
	assert.equal(reads, 0);
	assert.equal(fixture.publishes(), 0);
});

test('text-only relaxed imports keep parser warnings and derive the track name', async () => {
	const fixture = createFixture();
	const service = createLabelService(fixture.dependencies);

	const result = await service.importLabelFile({
		name: 'review.txt',
		text: async () => 'invalid\n0.100\t0.200\tKeep',
	}, { strict: false });

	assert.equal(result?.warnings.length, 1);
	assert.equal(result?.labels.length, 1);
	assert.deepEqual(fixture.statuses.at(-1), { message: 'Imported 1 labels.', state: 'info' });
	const command = fixture.commits[0]?.command;
	assert.equal(command?.type, 'track/add');
	assert.equal(command?.type === 'track/add' ? command.track.name : null, 'review');
});

test('requested label tracks export without invoking the download adapter', async () => {
	const fixture = createFixture();
	const service = createLabelService(fixture.dependencies);

	const result = await service.exportLabels({
		download: false,
		fileName: 'all:notes.wav',
		trackIds: ['labels-a', 'labels-b'],
	});

	assert.equal(result.format, 'txt');
	assert.equal(result.fileName, 'all-notes.txt');
	assert.equal(result.labelCount, 2);
	assert.deepEqual(result.trackIds, ['labels-a', 'labels-b']);
	assert.equal(fixture.saved.length, 0);
});

test('cancelled label saves return a cancelled result without publishing success', async () => {
	const fixture = createFixture({ saveExport: async () => ({ cancelled: true }) });
	const service = createLabelService(fixture.dependencies);

	const result = await service.exportLabels();

	assert.equal(result.cancelled, true);
	assert.equal(fixture.statuses.length, 0);
});

test('blocked label imports are ignored before task or busy-state creation', async () => {
	const fixture = createFixture({ editingBlocked: () => true });
	const service = createLabelService(fixture.dependencies);

	assert.equal(await service.importLabelFile({ name: 'blocked.txt', text: async () => '' }), null);
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.publishes(), 0);
});
