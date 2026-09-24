/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	commitInput,
	resolveBrowserProductTestUrl,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test('uses the desktop project library for create, edit, reopen, duplicate, and delete', async ({ page }) => {
	test.setTimeout(90_000);
	const errors = collectClientErrors(page);
	await page.addInitScript(installDesktopProjectLibrary);
	let editor = await bootEditor(page, '/embed/en/');
	const originalId = await editor.getAttribute('data-project-id');
	expect(originalId).toBeTruthy();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(rename.locator('[data-project-name-input] input'), 'Desktop original');
	await rename.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-project-name]')).toHaveText('Desktop original');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const afterRename = await desktopSnapshot(page);
	expect(afterRename.projects).toEqual([{ id: originalId, title: 'Desktop original', revision: 1 }]);
	expect(afterRename.calls).toContain('finishPublication');

	await page.goto(resolveBrowserProductTestUrl('/embed/en/'));
	editor = await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-project-id', originalId);
	await expect(editor.locator('[data-project-name]')).toHaveText('Desktop original');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	await expect(editor.locator('[data-project-name]')).toHaveText('Desktop original copy');
	const copyId = await editor.getAttribute('data-project-id');
	expect(copyId).toBeTruthy();
	expect(copyId).not.toBe(originalId);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
	const confirm = page.getByRole('dialog', { name: 'Delete this project?' });
	await confirm.getByRole('button', { name: 'Delete permanently' }).click();
	await expect(confirm).toBeHidden();
	await expect(editor).not.toHaveAttribute('data-project-id', copyId);
	const final = await desktopSnapshot(page);
	expect(final.projects).toContainEqual({ id: originalId, title: 'Desktop original', revision: 1 });
	expect(final.projects.some(({ id }) => id === copyId)).toBe(false);
	expect(final.calls).toContain('duplicateProject');
	expect(final.calls).toContain('deleteProject');
	expect(errors).toEqual([]);
});

async function desktopSnapshot(page) {
	return page.evaluate(() => globalThis.__soundscaperDesktopProjectLibraryFixture.snapshot());
}

function installDesktopProjectLibrary() {
	const projects = new Map();
	const pending = new Map();
	const fences = new Map();
	const calls = [];
	let metadataRevision = 0;
	let rowNumber = 0;
	let fenceNumber = 0;
	const saved = sessionStorage.getItem('__soundscaperDesktopProjectLibraryFixture');
	if (saved) {
		const state = JSON.parse(saved);
		metadataRevision = state.metadataRevision;
		rowNumber = state.rowNumber;
		fenceNumber = state.fenceNumber;
		for (const [id, entry] of state.projects) projects.set(id, entry);
	}
	const persist = () => sessionStorage.setItem('__soundscaperDesktopProjectLibraryFixture', JSON.stringify({
		metadataRevision, rowNumber, fenceNumber, projects: [...projects],
	}));
	const encoder = new TextEncoder();
	const handshake = Object.freeze({
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: 'soundscaper',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: 'kw-media-soundscaper-editor-v1',
		desktopLibrarySchemaVersion: 1,
		desktopDatabaseUserVersion: 1,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v1'],
	});
	const digest = async (bytes) => Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
		(byte) => byte.toString(16).padStart(2, '0'),
	).join('');
	const bundle = async (project, rowId) => {
		const document = JSON.stringify(project);
		const bytes = encoder.encode(document);
		const sha256 = await digest(bytes);
		return {
			metadataRevision,
			project: {
				id: rowId,
				projectId: project.id,
				name: project.title,
				metadataFile: `${rowId}/${project.revision}-${sha256}.json`,
				preferredProduct: 'soundscaper',
				updatedAtMs: Date.parse(project.updatedAt),
				schemaFamily: 'soundscaper',
				schemaVersion: 1,
				projectRevision: project.revision,
				byteLength: bytes.byteLength,
				sha256,
			},
			document,
			bodies: [],
		};
	};
	const listed = () => ({
		metadataRevision,
		projects: Array.from(projects.values(), ({ project }) => ({
			schemaFamily: 'soundscaper',
			schemaVersion: 1,
			id: project.id,
			title: project.title,
			revision: project.revision,
			updatedAt: project.updatedAt,
		})),
	});
	const sameWitness = async (entry, witness) => {
		if (entry === undefined) return witness === null;
		const current = await bundle(entry.project, entry.rowId);
		return witness?.projectRevision === entry.project.revision
			&& witness.projectSha256 === current.project.sha256;
	};
	const commit = async (project, rowId) => {
		metadataRevision += 1;
		projects.set(project.id, { project, rowId });
		persist();
		return bundle(project, rowId);
	};
	const bridge = Object.freeze({
		connect: async () => { calls.push('connect'); return handshake; },
		handshakeState: () => 'admitted',
		listProjects: async () => { calls.push('listProjects'); return listed(); },
		claimProjectWriteFence: async (id) => {
			calls.push('claimProjectWriteFence');
			const token = (++fenceNumber).toString(16).padStart(48, '0');
			fences.set(id, token);
			return token;
		},
		checkProjectWriteFence: async ({ projectId, writeFence }) => {
			calls.push('checkProjectWriteFence');
			return fences.get(projectId) === writeFence;
		},
		readProjectBundle: async (id) => {
			calls.push('readProjectBundle');
			const entry = projects.get(id);
			return entry === undefined ? null : bundle(entry.project, entry.rowId);
		},
		readBodyChunk: async () => { calls.push('readBodyChunk'); return new Uint8Array(); },
		beginPublication: async (request) => {
			calls.push('beginPublication');
			const entry = projects.get(request.project.id);
			if (request.expectedMetadataRevision !== metadataRevision
				|| !await sameWitness(entry, request.expectedProject)
				|| request.bodies.length !== 0) {
				throw new Error('Desktop publication lost its exact catalog witness.');
			}
			if (request.writeFence && fences.get(request.project.id) !== request.writeFence) {
				throw new Error('Desktop publication lost its write fence.');
			}
			pending.set(request.publicationId, structuredClone(request.project));
			return { publicationId: request.publicationId, maximumChunkBytes: 4 * 1024 * 1024, bodyCount: 0, requiredBodyIndexes: [] };
		},
		writePublicationChunk: async () => { throw new Error('Unexpected freeze body.'); },
		finishPublication: async ({ publicationId }) => {
			calls.push('finishPublication');
			const project = pending.get(publicationId);
			if (!project) throw new Error('Unknown desktop publication.');
			pending.delete(publicationId);
			const existing = projects.get(project.id);
			return commit(project, existing?.rowId ?? `fixture${++rowNumber}`);
		},
		abortPublication: async ({ publicationId }) => {
			calls.push('abortPublication');
			return pending.delete(publicationId);
		},
		deleteProject: async (request) => {
			calls.push('deleteProject');
			const entry = projects.get(request.projectId);
			if (request.expectedMetadataRevision !== metadataRevision
				|| !await sameWitness(entry, request.expectedProject)) {
				throw new Error('Desktop delete lost its exact catalog witness.');
			}
			projects.delete(request.projectId);
			metadataRevision += 1;
			persist();
			return { projectId: request.projectId, metadataRevision, deleted: true };
		},
		duplicateProject: async (request) => {
			calls.push('duplicateProject');
			const entry = projects.get(request.sourceProjectId);
			if (request.expectedMetadataRevision !== metadataRevision
				|| !await sameWitness(entry, request.expectedSource)
				|| projects.has(request.copyProjectId)) {
				throw new Error('Desktop duplicate lost its exact catalog witness.');
			}
			const copy = {
				...structuredClone(entry.project),
				id: request.copyProjectId,
				title: request.title,
				revision: 0,
				createdAt: request.timestamp,
				updatedAt: request.timestamp,
			};
			return commit(copy, `fixture${++rowNumber}`);
		},
		persistNativePluginState: async () => { throw new Error('Unexpected plug-in state.'); },
		readNativePluginState: async () => null,
	});
	Object.defineProperty(globalThis, 'soundscaperProjectLibraryDesktop', {
		configurable: true,
		enumerable: true,
		value: Object.freeze({ v1: bridge }),
	});
	Object.defineProperty(globalThis, '__soundscaperDesktopProjectLibraryFixture', {
		configurable: true,
		value: Object.freeze({
			snapshot: () => ({
				projects: listed().projects.map(({ id, title, revision }) => ({ id, title, revision })),
				calls: [...calls],
			}),
		}),
	});
}
