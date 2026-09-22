/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_EDITOR_COMMAND_TYPES } from '../src/common/editor/commands/protocol.ts';
import { createSoundscaperDesktopMcpPort } from '../src/common/editor/desktop-mcp-port.ts';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

function fixture(metadataNote = 'safe') {
	const project = {
		id: 'project-1', title: 'Demo', revision: 2,
		selection: { startFrame: 0, endFrame: 0 },
		tracks: [{ id: 'track-1', name: 'Voice', opaqueExtensions: { secret: 'hidden' } }],
		metadata: { note: metadataNote, buffer: new Uint8Array([1, 2]), nested: { $soundscaperOpaqueBinary: true, bytes: 'hidden' } },
	};
	let currentProject = project;
	let readOnly = false;
	let listener: ((request: { requestId: string; operation: string; args: unknown }) => void) | null = null;
	const responses: Array<{ requestId: string; success: boolean; result?: unknown; error?: string }> = [];
	const commits: unknown[] = [];
	const controller = {
		getSnapshot: () => ({ project: currentProject, readOnly, selectedTrackId: 'track-1', selectedClipId: null, selectedAnnotationId: null }),
		actions: { edit: { commit: (command: unknown) => {
			commits.push(command);
			currentProject = { ...currentProject, revision: currentProject.revision + 1 };
			return currentProject;
		} } },
	};
	const fileService = {
		onMcpRequest: (next: typeof listener) => { listener = next; return () => { listener = null; }; },
		respondMcpRequest: (response: (typeof responses)[number]) => { responses.push(response); },
	};
	const port = createSoundscaperDesktopMcpPort({ controller, fileService });
	async function request(operation: string, args: unknown = {}) {
		const requestId = `request-${responses.length}`;
		listener?.({ requestId, operation, args });
		await new Promise((resolve) => setImmediate(resolve));
		return responses.at(-1);
	}
	return { request, responses, commits, port, setReadOnly: (value: boolean) => { readOnly = value; } };
}

test('desktop MCP describes the active project and authoritative command list', async () => {
	const f = fixture();
	assert.deepEqual((await f.request('get_active_project'))?.result, {
		projectId: 'project-1', title: 'Demo', revision: 2, readOnly: false,
		selection: { startFrame: 0, endFrame: 0, selectedTrackId: 'track-1', selectedClipId: null, selectedAnnotationId: null },
	});
	assert.deepEqual((await f.request('list_editor_commands'))?.result, [...AUDIO_EDITOR_COMMAND_TYPES]);
	f.port.dispose();
});

test('desktop MCP metadata paging excludes binary and opaque extensions', async () => {
	const f = fixture();
	const first = await f.request('read_project_document', { projectId: 'project-1', expectedRevision: 2 });
	assert.equal(first?.success, true);
	const result = first?.result as { content: string; nextCursor: string | null };
	assert.equal(result.nextCursor, null);
	assert.equal(result.content.includes('Voice'), true);
	assert.equal(result.content.includes('hidden'), false);
	assert.equal(result.content.includes('buffer'), false);
	f.port.dispose();
});

test('desktop MCP pages large Unicode metadata within the byte bound', async () => {
	const f = fixture('🎙️'.repeat(30_000));
	let cursor: string | undefined;
	const chunks: string[] = [];
	do {
		const response = await f.request('read_project_document', {
			projectId: 'project-1', expectedRevision: 2, ...(cursor === undefined ? {} : { cursor }),
		});
		assert.equal(response?.success, true);
		const page = response?.result as { content: string; nextCursor: string | null };
		assert.equal(new TextEncoder().encode(page.content).byteLength <= 64 * 1024, true);
		chunks.push(page.content);
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	assert.equal((JSON.parse(chunks.join('')) as { metadata: { note: string } }).metadata.note, '🎙️'.repeat(30_000));
	f.port.dispose();
});

test('desktop MCP command uses the live controller commit and undo path', async () => {
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: createMemoryStore(), engine: createMemoryEngine(),
	});
	await controller.ready;
	let listener: ((request: { requestId: string; operation: string; args: unknown }) => void) | null = null;
	const responses: Array<{ success: boolean; result?: unknown; error?: string }> = [];
	const port = createSoundscaperDesktopMcpPort({ controller, fileService: {
		onMcpRequest: (next) => { listener = next; return () => { listener = null; }; },
		respondMcpRequest: (response) => { responses.push(response); },
	} });
	try {
		const before = controller.getSnapshot().project;
		assert.ok(before);
		listener?.({ requestId: 'real-1', operation: 'execute_editor_command', args: {
			projectId: before.id, expectedRevision: before.revision,
			command: { type: 'project/rename', title: 'MCP rename' },
		} });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(responses[0]?.success, true);
		assert.equal(controller.getSnapshot().project?.title, 'MCP rename');
		assert.equal(controller.getSnapshot().project?.revision, before.revision + 1);
		const afterRename = controller.getSnapshot().project;
		assert.ok(afterRename);
		listener?.({ requestId: 'real-2', operation: 'execute_editor_command', args: {
			projectId: afterRename.id, expectedRevision: afterRename.revision,
			command: { type: 'batch', commands: [
				{ type: 'project/rename', title: 'Should roll back' },
				{ type: 'track/remove', trackId: 'missing-track' },
			] },
		} });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(responses[1]?.success, false);
		assert.equal(controller.getSnapshot().project?.title, 'MCP rename');
		assert.equal(controller.getSnapshot().project?.revision, afterRename.revision);
		controller.actions.edit.undo();
		assert.equal(controller.getSnapshot().project?.title, before.title);
	} finally {
		port.dispose();
		await controller.dispose();
	}
});

test('desktop MCP refuses stale or read-only writes before commit', async () => {
	const f = fixture();
	const command = { type: 'project/rename', title: 'New' };
	assert.equal((await f.request('execute_editor_command', { projectId: 'project-1', expectedRevision: 1, command }))?.success, false);
	f.setReadOnly(true);
	assert.equal((await f.request('execute_editor_command', { projectId: 'project-1', expectedRevision: 2, command }))?.success, false);
	assert.equal(f.commits.length, 0);
	f.port.dispose();
});

test('desktop MCP snapshots valid command batches before normal commit', async () => {
	const f = fixture();
	const command = { type: 'batch', commands: [{ type: 'project/rename', title: 'New' }] };
	const response = await f.request('execute_editor_command', { projectId: 'project-1', expectedRevision: 2, command });
	assert.equal(response?.success, true);
	assert.deepEqual(response?.result, { projectId: 'project-1', revision: 3 });
	assert.equal(f.commits.length, 1);
	assert.notEqual(f.commits[0], command);
	f.port.dispose();
});
