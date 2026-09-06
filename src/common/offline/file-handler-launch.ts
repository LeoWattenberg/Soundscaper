/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The files an installed editor is launched with by the operating system.
 *
 * A `file_handlers` entry in the web manifest only tells the system which app
 * owns a suffix; the launch itself is delivered inside the page through
 * `launchQueue.setConsumer`, and a document that never sets a consumer opens to
 * an empty project while the file the user double-clicked sits in a queue
 * nobody drains. This module is that consumer, and it is the whole reason a
 * declared file handler does anything at all.
 *
 * It is installed from the document entry, before the editor exists, so what it
 * resolves is buffered and replayed to the first subscriber - the same shape
 * `stale-build-runtime.ts` uses next door, and for the same reason: the event
 * arrives long before the view that can act on it.
 *
 * Routing is by suffix and only by suffix. A project archive is recognized with
 * `isProjectFileName`, never by the MIME type the system guessed from the same
 * suffix, and everything else is media for the open project. That is the split
 * the workspace already applies to a dropped batch, so a launched file and a
 * dropped file reach the same two entry points.
 *
 * Nothing here throws into the browser's launch handler, where a rejection has
 * no catcher and no reader: a handle that is not a file, or a `getFile()` that
 * fails, is reported through `onError` and the rest of the batch still opens.
 */

import { isProjectFileName } from '../project-file-extensions.ts';

/** One launch, already resolved and split into the two entry points that take it. */
export interface LaunchedFiles {
	/**
	 * Every file the launch resolved, in the order the system listed them.
	 *
	 * The workspace already routes a batch of files - projects, media and label
	 * files together - through one entry point, so a subscriber that wants that
	 * routing hands this list to it whole rather than re-deriving it.
	 */
	readonly files: readonly File[];
	/** Project archives, opened as projects in the order the system listed them. */
	readonly projects: readonly File[];
	/** Everything else, imported into the current project. */
	readonly imports: readonly File[];
}

export type LaunchedFilesHandler = (files: LaunchedFiles) => unknown;

export interface FileHandlerLaunchParams {
	readonly files?: unknown;
}

export interface FileHandlerLaunchQueue {
	setConsumer(consumer: (params: FileHandlerLaunchParams) => void): void;
}

export interface InstallFileHandlerLaunchConsumerOptions {
	/** The Electron build has its own file handling and must not claim the queue. */
	readonly desktop: boolean;
	readonly launchQueue?: FileHandlerLaunchQueue | null;
	/** Where resolved files go. Defaults to the buffer `subscribeLaunchedFiles` drains. */
	readonly deliver?: LaunchedFilesHandler;
	readonly onError?: (error: unknown) => void;
}

export type FileHandlerLaunchConsumerStatus = 'consuming' | 'already-consuming' | 'unsupported';

export interface FileHandlerLaunchConsumerInstallation {
	readonly status: FileHandlerLaunchConsumerStatus;
	/** Resolves once every launch delivered so far has been routed. */
	settled(): Promise<void>;
	/** Stops this consumer acting on further launches, and releases the buffer. */
	release(): void;
}

interface LaunchFileHandle {
	readonly kind?: unknown;
	readonly getFile?: unknown;
}

const subscribers = new Set<LaunchedFilesHandler>();
let buffered: LaunchedFiles[] = [];
let installed = false;
let report: (error: unknown) => void = defaultReport;
let settlement: Promise<void> = Promise.resolve();

/**
 * Claims the operating system's launches for this document.
 *
 * Registers at most once: a second consumer would either replace the first or
 * double-handle every launch, and both open the user's file twice.
 */
export function installFileHandlerLaunchConsumer(
	options: InstallFileHandlerLaunchConsumerOptions,
): Readonly<FileHandlerLaunchConsumerInstallation> {
	const onError = options.onError ?? defaultReport;
	const queue = options.launchQueue ?? defaultLaunchQueue();
	if (options.desktop || !queue || typeof queue.setConsumer !== 'function') return inertInstallation('unsupported');
	if (installed) return inertInstallation('already-consuming');
	const deliver = options.deliver ?? enqueueLaunchedFiles;
	installed = true;
	report = onError;
	settlement = Promise.resolve();
	let released = false;
	queue.setConsumer((params: FileHandlerLaunchParams) => {
		if (released) return;
		settlement = settlement.then(() => routeLaunch(params, deliver, onError)).catch(onError);
	});
	return Object.freeze({
		status: 'consuming' as const,
		settled: () => settlement,
		release: () => {
			if (released) return;
			released = true;
			installed = false;
			buffered = [];
			report = defaultReport;
			settlement = Promise.resolve();
		},
	});
}

/**
 * Splits one resolved batch the way a launch is split, and delivers it.
 *
 * The operating system hands this editor files through more than one door - a
 * file handler the person double-clicked, and a share sheet whose files the
 * service worker stashed - and both are the same thing once the files are
 * resolved: a batch the system chose, arriving before any view can act on it.
 * They therefore go through this one buffer, so that whoever drains it drains
 * both and routes them identically. A second delivery path would be a second
 * routing to keep in step.
 */
export function deliverLaunchedFiles(
	files: readonly File[],
	deliver: LaunchedFilesHandler = enqueueLaunchedFiles,
): unknown {
	const projects: File[] = [];
	const imports: File[] = [];
	for (const file of files) (isProjectFileName(file.name) ? projects : imports).push(file);
	return deliver(Object.freeze({
		files: Object.freeze([...files]),
		projects: Object.freeze(projects),
		imports: Object.freeze(imports),
	}));
}

/**
 * Holds a launch until something can act on it.
 *
 * The default delivery target, because the consumer is installed while the
 * editor is still loading and the launch cannot be asked to wait for it.
 */
export function enqueueLaunchedFiles(files: LaunchedFiles): void {
	if (subscribers.size === 0) {
		buffered.push(files);
		return;
	}
	for (const handler of [...subscribers]) notify(handler, files);
}

/** Whatever has been launched and not yet taken, oldest first. */
export function bufferedLaunchedFiles(): readonly LaunchedFiles[] {
	return Object.freeze([...buffered]);
}

/**
 * Takes the launches this document was opened with, and any that follow.
 *
 * The first subscriber drains what arrived before the editor existed, so a file
 * the user launched the app with is opened once the workspace can open it.
 */
export function subscribeLaunchedFiles(handler: LaunchedFilesHandler): () => void {
	subscribers.add(handler);
	const replayed = buffered;
	if (replayed.length) {
		buffered = [];
		for (const files of replayed) notify(handler, files);
	}
	return () => { subscribers.delete(handler); };
}

async function routeLaunch(
	params: FileHandlerLaunchParams,
	deliver: LaunchedFilesHandler,
	onError: (error: unknown) => void,
): Promise<void> {
	const handles = launchHandles(params);
	if (handles.length === 0) return;
	const files: File[] = [];
	for (const handle of handles) {
		const file = await resolveLaunchedFile(handle, onError);
		if (file !== null) files.push(file);
	}
	if (files.length === 0) return;
	await deliverLaunchedFiles(files, deliver);
}

function launchHandles(params: FileHandlerLaunchParams): readonly unknown[] {
	const files = params?.files;
	if (Array.isArray(files)) return files as readonly unknown[];
	if (files && typeof files === 'object' && Symbol.iterator in (files as object)) {
		return [...(files as Iterable<unknown>)];
	}
	return [];
}

/**
 * One handle resolved to its file, or null when it is not one.
 *
 * A directory handle reaches the same consumer as a file handle and answers
 * `kind` rather than `getFile`, so the kind is checked before the call: an
 * editor that assumed every launched handle was a file would fail with a
 * missing-method error the user cannot read.
 */
async function resolveLaunchedFile(handle: unknown, onError: (error: unknown) => void): Promise<File | null> {
	const candidate = handle as LaunchFileHandle | null;
	if (!candidate || typeof candidate !== 'object'
		|| (candidate.kind !== undefined && candidate.kind !== 'file')
		|| typeof candidate.getFile !== 'function') {
		onError(new TypeError('A file-handler launch supplied a handle the editor cannot read as a file.'));
		return null;
	}
	try {
		const file = await (candidate.getFile as () => Promise<unknown>)();
		if (!file || typeof (file as File).name !== 'string') {
			onError(new TypeError('A file-handler launch resolved a handle to something that is not a file.'));
			return null;
		}
		return file as File;
	} catch (error) {
		onError(error);
		return null;
	}
}

function notify(handler: LaunchedFilesHandler, files: LaunchedFiles): void {
	try {
		const result = handler(files) as { then?: unknown } | null | undefined;
		if (result && typeof result.then === 'function') {
			void (result as Promise<unknown>).then(undefined, report);
		}
	} catch (error) {
		report(error);
	}
}

function defaultLaunchQueue(): FileHandlerLaunchQueue | null {
	const queue = (globalThis as typeof globalThis & {
		launchQueue?: FileHandlerLaunchQueue;
	}).launchQueue;
	return queue ?? null;
}

function inertInstallation(
	status: FileHandlerLaunchConsumerStatus,
): Readonly<FileHandlerLaunchConsumerInstallation> {
	return Object.freeze({
		status,
		settled: () => Promise.resolve(),
		release: () => {},
	});
}

function defaultReport(error: unknown): void {
	console.error('A file the operating system launched the editor with could not be opened:', error);
}
