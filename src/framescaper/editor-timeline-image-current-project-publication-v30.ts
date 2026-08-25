/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import type {
	FramescaperTimelineImagePublicationPortV30,
	FramescaperTimelineImagePublicationRequestV30,
} from './editor-image-import-coordinator-v30.ts';
import type { FramescaperProjectCommandV30 } from './editor-project-v30-commands.ts';
import type { FramescaperProjectHistoryV30 } from './editor-project-v30-history.ts';
import type { FramescaperProjectV30 } from './editor-project-v30.ts';

interface ProjectHistoryCaptureV30 {
	readonly history: FramescaperProjectHistoryV30;
	readonly token: unknown;
}

export interface FramescaperTimelineImagePublicationSessionV30 {
	captureProjectHistory(projectId: string): ProjectHistoryCaptureV30;
	assertProjectHistoryToken(projectId: string, token: unknown): unknown;
	updateProjectHistory(
		projectId: string,
		history: FramescaperProjectHistoryV30,
		options: Readonly<{ readonly dirty: false }>,
	): unknown;
	markProjectSaved(projectId: string): unknown;
	getProjectHistory(projectId: string): FramescaperProjectHistoryV30;
}

export interface FramescaperTimelineImagePublicationControllerV30 {
	readonly project: FramescaperProjectV30 | null;
	readonly actions: Readonly<{
		readonly project: Readonly<{
			openById(projectId: string): PromiseLike<unknown> | unknown;
		}>;
	}>;
}

export interface FramescaperTimelineImageCurrentProjectPublicationDependenciesV30 {
	readonly controller: FramescaperTimelineImagePublicationControllerV30;
	readonly session: FramescaperTimelineImagePublicationSessionV30;
	readonly executeCommand: (
		history: FramescaperProjectHistoryV30,
		command: FramescaperProjectCommandV30,
		options: Readonly<{ readonly now: Date | string }>,
	) => FramescaperProjectHistoryV30;
	readonly publishIfCurrent: (request: Readonly<{
		readonly expected: FramescaperProjectV30;
		readonly project: FramescaperProjectV30;
		readonly bytes: Uint8Array;
		readonly signal?: AbortSignal;
	}>) => Promise<FramescaperProjectV30 | null>;
	readonly now?: () => Date | string;
}

/** Adopt one exact body-plus-project CAS into the already-open editor history. */
export function createFramescaperTimelineImageCurrentProjectPublicationV30(
	dependencies: FramescaperTimelineImageCurrentProjectPublicationDependenciesV30,
): Readonly<FramescaperTimelineImagePublicationPortV30> {
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
		request: FramescaperTimelineImagePublicationRequestV30,
	): Promise<FramescaperProjectV30> {
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
