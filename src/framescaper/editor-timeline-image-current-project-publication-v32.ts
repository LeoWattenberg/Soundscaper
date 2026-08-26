/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import type {
	FramescaperTimelineImagePublicationPortV32,
	FramescaperTimelineImagePublicationRequestV32,
} from './editor-image-import-coordinator-v32.ts';
import type { FramescaperProjectCommandV32 } from './editor-project-v32-commands.ts';
import type { FramescaperProjectHistoryV32 } from './editor-project-v32-history.ts';
import type { FramescaperProjectV32 } from './editor-project-v32.ts';

interface ProjectHistoryCaptureV32 {
	readonly history: FramescaperProjectHistoryV32;
	readonly token: unknown;
}

export interface FramescaperTimelineImagePublicationSessionV32 {
	captureProjectHistory(projectId: string): ProjectHistoryCaptureV32;
	assertProjectHistoryToken(projectId: string, token: unknown): unknown;
	updateProjectHistory(
		projectId: string,
		history: FramescaperProjectHistoryV32,
		options: Readonly<{ readonly dirty: false }>,
	): unknown;
	markProjectSaved(projectId: string): unknown;
	getProjectHistory(projectId: string): FramescaperProjectHistoryV32;
}

export interface FramescaperTimelineImagePublicationControllerV32 {
	readonly project: FramescaperProjectV32 | null;
	readonly actions: Readonly<{
		readonly project: Readonly<{
			openById(projectId: string): PromiseLike<unknown> | unknown;
		}>;
	}>;
}

export interface FramescaperTimelineImageCurrentProjectPublicationDependenciesV32 {
	readonly controller: FramescaperTimelineImagePublicationControllerV32;
	readonly session: FramescaperTimelineImagePublicationSessionV32;
	readonly executeCommand: (
		history: FramescaperProjectHistoryV32,
		command: FramescaperProjectCommandV32,
		options: Readonly<{ readonly now: Date | string }>,
	) => FramescaperProjectHistoryV32;
	readonly publishIfCurrent: (request: Readonly<{
		readonly expected: FramescaperProjectV32;
		readonly project: FramescaperProjectV32;
		readonly bytes: Uint8Array;
		readonly signal?: AbortSignal;
	}>) => Promise<FramescaperProjectV32 | null>;
	readonly now?: () => Date | string;
}

/** Adopt one exact body-plus-project CAS into the already-open editor history. */
export function createFramescaperTimelineImageCurrentProjectPublicationV32(
	dependencies: FramescaperTimelineImageCurrentProjectPublicationDependenciesV32,
): Readonly<FramescaperTimelineImagePublicationPortV32> {
	if (!dependencies || typeof dependencies !== 'object'
		|| typeof dependencies.executeCommand !== 'function'
		|| typeof dependencies.publishIfCurrent !== 'function'
		|| typeof dependencies.session?.captureProjectHistory !== 'function'
		|| typeof dependencies.controller?.actions?.project?.openById !== 'function') {
		throw new TypeError('Timeline image publication requires exact controller, session, runtime, and storage ports.');
	}
	const now = dependencies.now ?? (() => new Date());
	return Object.freeze({ publish });

	async function publish(
		request: FramescaperTimelineImagePublicationRequestV32,
	): Promise<FramescaperProjectV32> {
		const expected = request.project;
		const active = dependencies.controller.project;
		if (!active || !sameProject(active, expected)) {
			throw stale('The active Framescaper project changed before image publication.');
		}
		const capture = dependencies.session.captureProjectHistory(expected.id);
		if (!sameProject(capture.history.present, expected)) {
			throw stale('The active Framescaper history changed before image publication.');
		}
		const nextHistory = dependencies.executeCommand(
			capture.history,
			request.command,
			{ now: now() },
		);
		dependencies.session.assertProjectHistoryToken(expected.id, capture.token);
		if (!sameProject(dependencies.controller.project, expected)) {
			throw stale('The active Framescaper project changed while the image body was prepared.');
		}
		const bytes = new Uint8Array(await request.body.arrayBuffer());
		dependencies.session.assertProjectHistoryToken(expected.id, capture.token);
		const published = await dependencies.publishIfCurrent({
			expected,
			project: nextHistory.present,
			bytes,
			...(request.signal ? { signal: request.signal } : {}),
		});
		if (published === null) throw stale('The image project revision was superseded before publication.');
		dependencies.session.assertProjectHistoryToken(expected.id, capture.token);
		if (!sameProject(nextHistory.present, published)) {
			throw new Error('Timeline image storage returned a different project revision.');
		}
		dependencies.session.updateProjectHistory(expected.id, nextHistory, { dirty: false });
		dependencies.session.markProjectSaved(expected.id);
		await dependencies.controller.actions.project.openById(expected.id);
		if (!sameProject(dependencies.controller.project, published)) {
			throw stale('The published image revision was not adopted by the active editor.');
		}
		return published;
	}
}

function sameProject(left: unknown, right: unknown): boolean {
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	try { return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right); }
	catch { return false; }
}

function stale(message: string): Error {
	return Object.assign(new Error(message), { name: 'AbortError' });
}
