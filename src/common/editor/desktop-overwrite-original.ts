/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopOriginalFileFor, releaseDesktopOriginalFile, retainDesktopOriginalFile, type DesktopOriginalFile } from './desktop-original-file-port.ts';
import type { DesktopOriginalExportSettings } from './desktop-original-export-settings.ts';

export interface DesktopOriginalMedia extends DesktopOriginalFile {
	readonly settings: DesktopOriginalExportSettings;
}

interface Session {
	readonly projectId: string;
	readonly importedFileCount: number;
	readonly original: DesktopOriginalMedia | null;
	readonly candidate: DesktopOriginalFile | null;
}

interface ImportProject {
	readonly id: string;
	readonly sources?: readonly unknown[];
	readonly clips?: readonly unknown[];
}

interface ImportRecorderRuntime {
	readonly state: object;
	readonly getProject: () => ImportProject | null;
	readonly publishDocumentSnapshot?: () => void;
}

const sessions = new WeakMap<object, Session>();

/** Original-file authority is controller session state and never joins the saved document. */
export function desktopOriginalForProject(state: object, projectId: string | null | undefined): DesktopOriginalMedia | null {
	const session = sessions.get(state);
	return session && session.projectId === projectId && session.importedFileCount === 1 ? session.original : null;
}

export function resetDesktopOriginal(state: object): void {
	retireOriginal(sessions.get(state)?.candidate);
	sessions.delete(state);
}

/** Count only completed imports; a failed decoder must not lose the first imported target. */
export function createDesktopOriginalImportRecorder<Arguments extends readonly unknown[], Result>(
	runtime: ImportRecorderRuntime,
	importFile: (file: unknown, ...args: Arguments) => Promise<Result>,
): (file: unknown, ...args: Arguments) => Promise<Result> {
	if (typeof runtime.getProject !== 'function' || !runtime.state || typeof runtime.state !== 'object') return importFile;
	return async (file, ...args) => {
		const before = runtime.getProject();
		const original = desktopOriginalFileFor(file);
		let result: Result;
		try { result = await importFile(file, ...args); }
		catch (error) {
			if (sessions.get(runtime.state)?.candidate?.id !== original?.id) retireOriginal(original);
			throw error;
		}
		const after = runtime.getProject();
		if (!before || !after || typeof before.id !== 'string' || before.id !== after.id) {
			retireOriginal(original);
			return result;
		}
		const previousIds = new Set((before.sources ?? []).map(sourceId));
		const newSources = (after.sources ?? []).filter((source) => !previousIds.has(sourceId(source)));
		const previousClipIds = new Set((before.clips ?? []).map(sourceId));
		const hasNewClips = (after.clips ?? []).some((clip) => !previousClipIds.has(sourceId(clip)));
		const previous = sessions.get(runtime.state);
		if (!newSources.length && !hasNewClips) {
			if (previous?.candidate?.id !== original?.id) retireOriginal(original);
			return result;
		}
		retireOriginal(previous?.candidate);
		const session: Session = { projectId: after.id,
			importedFileCount: previous?.projectId === after.id ? previous.importedFileCount + 1 : 1,
			original: null, candidate: original };
		sessions.set(runtime.state, session);
		if (session.importedFileCount !== 1 || before.sources?.length || before.clips?.length) {
			retireOriginal(original);
			sessions.set(runtime.state, { ...session, candidate: null });
			runtime.publishDocumentSnapshot?.();
			return result;
		}
		if (original) {
			try {
				const { resolveDesktopOriginalExportSettings } = await import('./desktop-original-export-settings.ts');
				const settings = await resolveDesktopOriginalExportSettings(file, newSources);
				// A second import or a project switch may have settled while headers were read.
				if (settings && sessions.get(runtime.state) === session && runtime.getProject()?.id === after.id) {
					retainDesktopOriginalFile(original);
					sessions.set(runtime.state, { ...session, original: Object.freeze({ ...original, settings }) });
				} else retireOriginal(original);
			} catch { retireOriginal(original); }
		}
		runtime.publishDocumentSnapshot?.();
		return result;
	};
}

function retireOriginal(original: DesktopOriginalFile | null | undefined): void {
	if (original) void releaseDesktopOriginalFile(original).catch(() => undefined);
}

function sourceId(source: unknown): unknown {
	return source && typeof source === 'object' ? Reflect.get(source, 'id') as unknown : null;
}
