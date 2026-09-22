/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_COMMAND_TYPES, type AudioEditorCommand } from './commands/protocol.ts';
import { snapshotInertEditorCommand } from './commands/editor-command-snapshot.ts';

const MAXIMUM_PAGE_BYTES = 64 * 1024;
const MAXIMUM_DOCUMENT_NODES = 100_000;
const encoder = new TextEncoder();

interface McpProject {
	readonly id: string;
	readonly title?: unknown;
	readonly revision?: unknown;
	readonly selection?: unknown;
}

interface CurrentMcpProject extends McpProject {
	readonly title: string;
	readonly revision: number;
}

interface McpController {
	readonly getSnapshot: () => {
		readonly project: McpProject | null;
		readonly readOnly: boolean;
		readonly selectedTrackId: string | null;
		readonly selectedClipId: string | null;
		readonly selectedAnnotationId: string | null;
	};
	readonly actions: { readonly edit: { readonly commit: (command: AudioEditorCommand) => unknown } };
}

interface McpRequest { readonly requestId: string; readonly operation: string; readonly args: unknown }
interface McpResponse {
	readonly requestId: string;
	readonly success: boolean;
	readonly result?: unknown;
	readonly error?: string;
}
interface McpFileService {
	readonly onMcpRequest: (listener: (request: McpRequest) => void) => () => void;
	readonly respondMcpRequest: (response: McpResponse) => void | Promise<unknown>;
}

/** Connect the current Soundscaper controller to main's desktop MCP request owner. */
export function createSoundscaperDesktopMcpPort({
	controller, fileService,
}: Readonly<{ controller: McpController; fileService: McpFileService }>): Readonly<{ dispose: () => void }> {
	let active = true;
	const unsubscribe = fileService.onMcpRequest((request) => {
		if (!active) return;
		void Promise.resolve().then(() => {
			if (!active) throw new Error('The MCP connection closed.');
			return executeRequest(controller, request.operation, request.args);
		})
			.then((result) => fileService.respondMcpRequest({ requestId: request.requestId, success: true, result }))
			.catch((error: unknown) => fileService.respondMcpRequest({
				requestId: request.requestId,
				success: false,
				error: boundedError(error),
			}));
	});
	return Object.freeze({ dispose: () => { active = false; unsubscribe(); } });
}

function executeRequest(controller: McpController, operation: string, argsValue: unknown): unknown {
	if (operation === 'list_editor_commands') return [...AUDIO_EDITOR_COMMAND_TYPES];
	const snapshot = controller.getSnapshot();
	const project = currentProject(snapshot.project);
	if (operation === 'get_active_project') {
		return {
			projectId: project.id, title: project.title, revision: project.revision,
			readOnly: snapshot.readOnly,
			selection: {
				...selectionRecord(project.selection),
				selectedTrackId: snapshot.selectedTrackId,
				selectedClipId: snapshot.selectedClipId,
				selectedAnnotationId: snapshot.selectedAnnotationId,
			},
		};
	}
	const args = record(argsValue, 'MCP arguments');
	if (operation === 'read_project_document') {
		assertCurrentProject(project, args);
		const content = JSON.stringify(sanitizeProjectDocument(project));
		const cursor = args.cursor === undefined ? 0 : documentCursor(args.cursor);
		if (cursor >= content.length && cursor !== 0 || isLowSurrogate(content.charCodeAt(cursor))) {
			throw new RangeError('Document cursor is out of range.');
		}
		const end = pageEnd(content, cursor);
		return { projectId: project.id, revision: project.revision,
			content: content.slice(cursor, end), nextCursor: end < content.length ? String(end) : null };
	}
	if (operation === 'execute_editor_command') {
		assertCurrentProject(project, args);
		if (snapshot.readOnly) throw new Error('The active project is read-only.');
		const command = snapshotInertEditorCommand(args.command);
		// The controller owns capability policy, project validation, history and autosave.
		controller.actions.edit.commit(command);
		const current = currentProject(controller.getSnapshot().project);
		if (current.id !== project.id) throw new Error('The active project changed during the command.');
		return { projectId: current.id, revision: current.revision };
	}
	throw new Error('Unknown MCP operation.');
}

function currentProject(project: McpProject | null): CurrentMcpProject {
	if (!project) throw new Error('No project is open.');
	if (typeof project.id !== 'string' || !project.id
		|| typeof project.title !== 'string'
		|| !Number.isSafeInteger(project.revision) || (project.revision as number) < 0) {
		throw new TypeError('The active project has invalid MCP metadata.');
	}
	return project as CurrentMcpProject;
}

function assertCurrentProject(project: CurrentMcpProject, args: Record<string, unknown>): void {
	if (args.projectId !== project.id) throw new Error('The active project changed.');
	if (nonNegativeInteger(args.expectedRevision, 'expectedRevision') !== project.revision) {
		throw new Error('The project revision changed.');
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative integer.`);
	return value as number;
}

function documentCursor(value: unknown): number {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
		throw new TypeError('Document cursor is invalid.');
	}
	return nonNegativeInteger(Number(value), 'cursor');
}

function selectionRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? sanitizeProjectDocument(value) as Record<string, unknown> : {};
}

function sanitizeProjectDocument(value: unknown): unknown {
	const active = new Set<object>();
	let nodes = 0;
	function visit(current: unknown, depth: number): unknown {
		if (current === null || typeof current !== 'object') return current;
		if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) return undefined;
		if (depth > 64 || ++nodes > MAXIMUM_DOCUMENT_NODES) throw new RangeError('Project metadata exceeds the MCP read limit.');
		if (active.has(current)) throw new TypeError('Project metadata contains a cycle.');
		const prototype: unknown = Object.getPrototypeOf(current);
		if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) return undefined;
		if (Object.hasOwn(current, '$soundscaperOpaqueBinary')) return undefined;
		active.add(current);
		const result: Record<string, unknown> | unknown[] = Array.isArray(current) ? [] : {};
		for (const key of Object.keys(current)) {
			if (key === 'opaqueExtensions' || key === '$soundscaperOpaqueBinary') continue;
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
			const next = visit(descriptor.value, depth + 1);
			if (Array.isArray(result)) result.push(next ?? null);
			else if (next !== undefined) result[key] = next;
		}
		active.delete(current);
		return result;
	}
	return visit(value, 0);
}

function pageEnd(content: string, start: number): number {
	let low = start + 1;
	let high = Math.min(content.length, start + MAXIMUM_PAGE_BYTES);
	let accepted = start;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const safeMiddle = middle < content.length && isLowSurrogate(content.charCodeAt(middle)) ? middle - 1 : middle;
		if (encoder.encode(content.slice(start, safeMiddle)).byteLength <= MAXIMUM_PAGE_BYTES) {
			accepted = safeMiddle;
			low = middle + 1;
		} else high = middle - 1;
	}
	return accepted;
}

function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

function boundedError(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 512) : 'MCP operation failed.';
}
