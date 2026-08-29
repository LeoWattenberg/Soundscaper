/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two transfer documents, as pages.
 *
 * `scripts/generate-static-routes.mjs` emits documents that load exactly one
 * script - this chunk - and deliberately never load the application entry. So
 * **this module mounts on load.** Declaring `mountTransferPageFromLocation()`
 * and leaving it to a caller is how the feature shipped as a page that
 * evaluates a module and then does nothing; the named export survives for
 * `src/common/site/route.js` and for tests, but the load side effect is the
 * production path and is the thing worth testing.
 *
 * The sender always offers both paths, and offers the download first. The
 * handshake is one click and no file management, but it can be refused by a
 * popup blocker, by an opener-severing policy, or by a browser the visitor does
 * not control - and the visitor's projects are about to become unreachable from
 * this origin. So the path that assumes nothing is always present, never hidden
 * behind a failure of the path that assumes more.
 *
 * Neither path ever decides for the visitor what to move. Both products share
 * this origin's storage, so the page lists what it found, marks what belongs to
 * the product being transferred to, and reads back the ticked set - twice, the
 * second time as a named confirmation - before it reads a single project. That
 * half lives in `transfer-page-send.ts`: the two routes are two mounts, and one
 * module holding both had grown past the maintainability ceiling. What is left
 * here is the boot, the one-mount rule, and the receiving document.
 */

import {
	transferRouteForPath,
	transferRouteForRole,
	type TransferRole,
} from './transfer-routes.js';
import {
	resolveTransferOrigins,
	type TransferOriginConfiguration,
} from './transfer-configuration.ts';
import {
	createWindowTransferPort,
	resolveTransferOpener,
	TransferWindowError,
	type TransferMessageTarget,
} from './transfer-window-port.ts';
import {
	bufferTransferPort,
	describeTransferError,
	importTransferArchiveFiles,
	receiveTransferArchives,
	type TransferImportRecord,
} from './transfer-session.ts';
import { describeTransferImport } from './transfer-report-rows.ts';
import { createTransferView } from './transfer-page-view.ts';
import { mountSender } from './transfer-page-send.ts';
import type { TransferPageContext, TransferPageDependencies } from './transfer-page-context.ts';

export interface MountTransferPageOptions {
	readonly scope: Window & typeof globalThis;
	readonly role: TransferRole;
	readonly configuration: TransferOriginConfiguration;
	readonly dependencies?: TransferPageDependencies;
}

/**
 * One document, one mount.
 *
 * Both entry points funnel through `mountTransferPage()`, and the second call
 * for a document is a no-op. That is not tidiness: on the dev server the
 * self-mount below and `src/common/site/route.js` both fire, and a receiving
 * page mounted twice opens two handshake sessions on one window, which fight
 * over the same protocol stream.
 */
const mountedDocuments = new WeakSet<Document>();

/**
 * Mount, if this really is a transfer document being loaded in a browser.
 *
 * Every guard here exists because this runs at module scope, where a throw
 * would take out the whole chunk:
 *   - no `document` at all - the Node test runner, a worker - mounts nothing;
 *   - a pathname that is not one of the two transfer routes - the dev server's
 *     SPA fallback, or an unrelated page that pulled this chunk in - mounts
 *     nothing and does not treat it as an error;
 *   - anything that throws anyway is reported into the document's own boot
 *     line rather than rethrown.
 */
export function autoMountTransferPage(scope: unknown = globalThis): Promise<void> | null {
	try {
		const page = asTransferPageScope(scope);
		if (!page || !transferRouteForPath(page.location.pathname)) return null;
		return mountTransferPageFromLocation(page)
			.catch((error) => reportTransferBootFailure(page, error));
	} catch (error) {
		try {
			reportTransferBootFailure(asTransferPageScope(scope), error);
		} catch {
			// There is no page left to tell. Refusing to throw is the last duty.
		}
		return null;
	}
}

function asTransferPageScope(scope: unknown): (Window & typeof globalThis) | null {
	const candidate = scope as Partial<Window> | null | undefined;
	if (!candidate || typeof candidate !== 'object') return null;
	const document = candidate.document as Document | undefined;
	if (!document || typeof document.getElementById !== 'function') return null;
	if (typeof candidate.location?.pathname !== 'string') return null;
	return scope as Window & typeof globalThis;
}

function reportTransferBootFailure(scope: (Window & typeof globalThis) | null, error: unknown): void {
	const boot = scope?.document?.querySelector('[data-transfer-boot]');
	if (boot) boot.textContent = `The transfer page could not start: ${describeTransferError(error)}`;
}

/**
 * Entry point for `src/common/site/route.js` and for tests; the generated
 * production documents reach the page through the self-mount at the foot of
 * this file instead.
 */
export async function mountTransferPageFromLocation(
	scope: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): Promise<void> {
	const route = transferRouteForPath(scope.location?.pathname);
	if (!route) throw new RangeError(`${scope.location?.pathname} is not a project transfer route.`);
	const configuration = resolveTransferOrigins({
		selfOrigin: scope.location?.origin,
		environment: readBuildEnvironment(),
	});
	await mountTransferPage({ scope, role: route.role, configuration });
}

/** Vite inlines `import.meta.env`; nothing else on the page reads it. */
function readBuildEnvironment(): unknown {
	try {
		return (import.meta as { env?: unknown }).env ?? null;
	} catch {
		return null;
	}
}

export async function mountTransferPage(options: MountTransferPageOptions): Promise<void> {
	const { scope, configuration } = options;
	if (mountedDocuments.has(scope.document)) return;
	mountedDocuments.add(scope.document);
	const route = transferRouteForRole(options.role);
	// The view is built before anything is loaded, so a runtime chunk that fails
	// to arrive is reported on a page the visitor can already read.
	const view = createTransferView(scope.document, route.title, route.summary);
	const dependencies = options.dependencies ?? deferredDependencies();
	view.note(configuration.loopback
		? `This page reads the projects stored on ${configuration.selfOrigin} and hands them back to`
			+ ` ${configuration.peerOrigin} - the same origin, which is how the transfer is exercised`
			+ ' before the second origin exists.'
		: `This page reads the projects stored on ${configuration.selfOrigin}.`
			+ ` The other product is served from ${configuration.peerOrigin}.`);
	// A failure here is still a page the visitor is looking at. It has to say so
	// on the page rather than reject into a caller that has already handed the
	// document over and will render nothing further.
	try {
		if (options.role === 'send') await mountSender({ scope, configuration, dependencies, view });
		else await mountReceiver({ scope, configuration, dependencies, view });
	} catch (error) {
		view.status(describeTransferError(error), 'error');
	}
}

/**
 * The archive machinery arrives on first use, never at mount.
 *
 * `.scape` export and import reach a large part of the editor's storage code,
 * and the first useful state of this page is a list of project names.
 */
function deferredDependencies(): TransferPageDependencies {
	const runtime = async () => import('./transfer-archive-runtime.ts');
	return {
		loadRuntime: async () => (await runtime()).loadTransferRuntime(),
		openStore: async () => (await runtime()).openTransferStore(),
	};
}

/**
 * The manual import's live line.
 *
 * Progress is how many archives have been *read*, not how many were written:
 * an archive's outcome is not known until its record is, and "Imported 2
 * archives…" over two files that were both skipped is the page telling a
 * visitor their projects landed when they did not.
 */
function readProgressText(progress: { completed: number; total: number | null; title: string | null }): string {
	return `Read ${progress.completed}${progress.total === null ? '' : ` of ${progress.total}`}`
		+ ` archive${progress.total === 1 ? '' : 's'}${progress.title ? `: ${progress.title}` : ''}…`;
}

/**
 * The handshake's live line, counting only what this origin actually wrote.
 *
 * "Imported N archives…" over every record seen tells a visitor that N projects
 * landed when some were skipped without ever being written and some failed
 * outright. Only an `imported` record is a project that is now on this origin,
 * so the other two get their own counts rather than being folded into that one.
 */
function importTallyText(tally: { imported: number; skipped: number; failed: number }): string {
	return `Imported ${tally.imported} archive${tally.imported === 1 ? '' : 's'}`
		+ `${tally.skipped ? `, skipped ${tally.skipped}` : ''}`
		+ `${tally.failed ? `, ${tally.failed} failed` : ''}…`;
}

async function mountReceiver(context: TransferPageContext): Promise<void> {
	const { configuration, scope, view } = context;
	const { ACCEPTED_PROJECT_FILE_EXTENSION_LIST } = await import('../project-file-extensions.ts');
	view.files(
		'Import downloaded project archives and conversion-report sidecars',
		`${ACCEPTED_PROJECT_FILE_EXTENSION_LIST},.json`,
		async (files) => {
		view.status(`Reading ${files.length} selected file${files.length === 1 ? '' : 's'}…`);
		const runtime = await context.dependencies.loadRuntime();
		const source = await context.dependencies.openStore();
		try {
			const result = await importTransferArchiveFiles({
				runtime,
				store: source.store as Parameters<typeof importTransferArchiveFiles>[0]['store'],
				files,
				onProgress: (progress) => view.status(readProgressText(progress)),
			});
			view.report(describeTransferImport(result));
		} finally {
			await source.close().catch(() => undefined);
		}
		},
	);

	let opener: TransferMessageTarget;
	try {
		opener = resolveTransferOpener(scope);
	} catch (error) {
		view.status(error instanceof TransferWindowError
			? error.message
			: describeTransferError(error));
		return;
	}
	// Built and subscribed before the store is opened, for the same reason the
	// sender's is: the opener is already talking by the time this page mounts.
	const windowPort = createWindowTransferPort({
		peer: opener,
		listener: scope,
		allowedOrigins: configuration.allowedOrigins,
		expectedSource: opener,
	});
	// One tally, kept as the records arrive and reused for the final report:
	// the live line and the summary have to be counting the same thing, and two
	// tallies is how they came to disagree.
	const tally = { imported: 0, skipped: 0, failed: 0 };
	// And one list of what this origin actually wrote, held here rather than read
	// off the result. `receiveTransferArchives()` keeps its records outside its
	// own try so that a run the wire cut short still reports them, and it can
	// still reject outright for a defect in an injected seam - so a page that
	// reads the records only off a resolved result throws away, one layer up,
	// exactly what the layer below took care to keep.
	const landed: TransferImportRecord[] = [];
	let source: Awaited<ReturnType<TransferPageContext['dependencies']['openStore']>> | null = null;
	try {
		const port = bufferTransferPort(windowPort);
		const runtime = await context.dependencies.loadRuntime();
		source = await context.dependencies.openStore();
		view.status(`Accepting a transfer from ${configuration.peerOrigin}…`);
		const received = await receiveTransferArchives({
			runtime,
			store: source.store as Parameters<typeof receiveTransferArchives>[0]['store'],
			port,
			sessionId: scope.crypto.randomUUID(),
			targetOrigin: configuration.peerOrigin,
			allowedOrigins: configuration.allowedOrigins,
			onRecord: (record) => {
				landed.push(record);
				tally[record.outcome === 'imported' ? 'imported' : record.outcome] += 1;
				view.status(importTallyText(tally));
			},
		});
		const records = received.records;
		// Reported from what this origin actually did, not from a literal cast
		// into the renderer's parameter type: `completed` and `stopped` are how
		// a transfer the protocol cut short stops reading as a finished one, and
		// a cast is precisely what let them be omitted.
		view.report(describeTransferImport({
			entries: records,
			total: Math.max(records.length, received.report?.entryCount ?? 0),
			...tally,
			completed: received.completed,
			stopped: received.stopped
				? { code: received.stopped.code, index: records.length, reason: received.stopped.reason }
				: null,
		}));
	} catch (error) {
		view.status(
			`The transfer did not complete: ${describeTransferError(error)}.`
			+ ' The other product still holds every project, so nothing was lost.',
			'error',
		);
		// The same report the resolved path renders, over the same records. What
		// ended the run becomes the stop, so the run cannot read as a finished
		// one, and every archive already written here keeps its row.
		view.report(describeTransferImport({
			entries: landed,
			total: landed.length,
			...tally,
			completed: false,
			stopped: {
				code: 'receive-failed',
				index: landed.length,
				reason: describeTransferError(error),
			},
		}));
	} finally {
		windowPort.close();
		await source?.close().catch(() => undefined);
	}
}

/**
 * The load side effect the generated documents depend on.
 *
 * Last statement in the module, and not awaited: `route.js` imports this module
 * and then calls the export, and a top-level await here would hold that import
 * open for the length of a whole transfer.
 */
void autoMountTransferPage();
