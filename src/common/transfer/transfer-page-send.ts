/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The sending document: what it offers, what it is allowed to read, and how it
 * says what happened.
 *
 * Split out of `transfer-page-entry.ts`, which had grown past the maintainability
 * ceiling holding both documents at once. The seam is the one the feature already
 * has - the two routes are two mounts - and the sending half is the larger of
 * them, because it is the half that gathers consent.
 *
 * Three rules run through everything here.
 *
 * **Nothing is read that the visitor did not tick**, and the ticked set is read
 * back at the moment consent is given rather than at the moment the button was
 * pressed. `selectionPredicate()` is the only thing an exporter is ever handed.
 *
 * **Every ticked row is accounted for.** The page deliberately offers rows it
 * knows cannot cross, so it must also report them: `refusedChoices()` carries
 * them past the transports, which never see them, and into the run's own report.
 *
 * **The download is always available.** It assumes no popup, no opener and no
 * cooperating second origin, so it is never hidden behind a failure of the
 * handshake.
 */

import { transferPeerUrl } from './transfer-configuration.ts';
import { transferRouteForRole } from './transfer-routes.js';
import {
	createWindowTransferPort,
	openTransferPopup,
	TransferWindowError,
	type TransferMessageTarget,
} from './transfer-window-port.ts';
import {
	bufferTransferPort,
	describeTransferError,
	downloadTransferArchives,
	sendTransferArchives,
	streamTransferArchives,
} from './transfer-session.ts';
import {
	describeTransferDownload,
	describeTransferSend,
	withRefusedTransferChoices,
	type TransferRefusedChoice,
} from './transfer-report-rows.ts';
import {
	describeTransferProduct,
	listTransferProjects,
	transferProductForOrigin,
	type TransferProjectOffer,
} from './transfer-project-selection.ts';
import type { TransferChoiceHandle } from './transfer-page-view.ts';
import type { TransferPageContext } from './transfer-page-context.ts';
import { readProjectSchemaIdentity } from '../editor/project-schema-identity.ts';

type ExportStore = Parameters<typeof streamTransferArchives>[0]['store'];

/**
 * Build the sending document: the project list, the two transports, and the
 * consent the visitor gives twice before either of them reads anything.
 */
export async function mountSender(context: TransferPageContext): Promise<void> {
	const { configuration, view } = context;
	const peerProduct = transferProductForOrigin(configuration.peerOrigin);
	let offers: readonly TransferProjectOffer[] = [];
	let choices: TransferChoiceHandle | null = null;

	const download = view.action('Download the ticked archives', async () => {
		const chosen = requireChosen(context, choices, offers);
		if (!chosen) return;
		await runSenderDownload(context, chosen);
	});
	const send = view.action(`Send the ticked projects to ${configuration.peerOrigin}`, async () => {
		const chosen = requireChosen(context, choices, offers);
		if (!chosen) return;
		// Confirmed by name before anything is read, let alone posted - and
		// counted over what can actually cross. A ticked row this page cannot
		// move is still listed below with its reason, but it is not one of the
		// projects being sent, and counting it as one overstates the consent.
		const sending = transferableChoices(chosen).length;
		view.confirm({
			heading: `Send ${sending} project${sending === 1 ? '' : 's'}`
				+ ` to ${configuration.peerOrigin}? Nothing is removed from this origin.`,
			lines: chosen.map((offer) => `${offer.title} — ${describeTransferProduct(offer)}`),
			confirmLabel: `Yes, send ${sending === 1 ? 'it' : 'these'}`,
			cancelLabel: 'Cancel',
			// Read back a second time, at the moment consent is actually given.
			// The confirmation is a panel on the page, not a modal that takes the
			// boxes away, so the set ticked when Send was clicked is not
			// necessarily the set the visitor means now - and the set they mean
			// now is the only one this page is entitled to read. Still
			// synchronous, because the popup below has to open inside this click.
			confirm: async () => {
				const confirmed = requireChosen(context, choices, offers);
				if (!confirmed) return;
				await runSenderHandshake(context, confirmed, choices);
			},
		});
	});
	download.disabled = true;
	send.disabled = true;

	view.action('Find my projects', async () => {
		view.status('Reading this origin\'s project list…');
		const source = await context.dependencies.openStore();
		try {
			offers = await listTransferProjects({
				store: source.store as Parameters<typeof listTransferProjects>[0]['store'],
				product: peerProduct,
			});
		} finally {
			await source.close().catch(() => undefined);
		}
		choices = view.choices(offers.map((offer) => ({
			id: offer.projectId,
			label: offer.title,
			detail: describeTransferProduct(offer),
			checked: offer.preselected,
		})));
		// Counted over the projects, not over the offers. An offer is also how a
		// store this origin could not read is put on the page, and folding those
		// into "N projects found" tells a visitor about to migrate that the page
		// saw work it could not see - while burying the one fact that decides
		// whether their move is actually finished.
		const projects = offers.filter((offer) => offer.kind === 'project');
		const unreadable = offers.filter((offer) => offer.kind === 'store');
		const preselected = projects.filter((offer) => offer.preselected).length;
		view.status(`${projects.length} project${projects.length === 1 ? '' : 's'} found on this origin.`
			+ (peerProduct
				? ` ${preselected} of them belong${preselected === 1 ? 's' : ''} to the other product and`
					+ ` ${preselected === 1 ? 'is' : 'are'} ticked; tick or untick anything you like.`
					+ ' Only ticked projects are read.'
				: ' None are ticked, because this origin cannot tell the two products apart.'
					+ ' Tick the ones you want to move.')
			+ unreadableStorageSentence(unreadable.length),
			// Prominent rather than folded away: a storage that could not be read
			// may hold projects, and a visitor who leaves this origin believing
			// the list was complete loses them.
			unreadable.length === 0 ? 'info' : 'error');
		download.disabled = offers.length === 0;
		send.disabled = offers.length === 0;
	});
}

/** The one fact a total cannot carry: some of this origin's storage is opaque. */
function unreadableStorageSentence(count: number): string {
	if (count === 0) return '';
	return ` ${count} of this origin's project storages could not be read at all,`
		+ ` so whatever ${count === 1 ? 'it holds is' : 'they hold is'} neither counted above nor`
		+ ` listed below. ${count === 1 ? 'It is' : 'They are'} named in the list with the reason,`
		+ ' and nothing in them can be transferred from this page.';
}

/** The ticked offers, or `null` after telling the visitor why there are none. */
function requireChosen(
	context: TransferPageContext,
	choices: TransferChoiceHandle | null,
	offers: readonly TransferProjectOffer[],
): readonly TransferProjectOffer[] | null {
	if (!choices) {
		context.view.status('Find your projects first.', 'error');
		return null;
	}
	const ticked = new Set(choices.selected());
	const chosen = offers.filter((offer) => ticked.has(offer.projectId));
	if (chosen.length === 0) {
		context.view.status('Nothing is ticked, so there is nothing to send.', 'error');
		return null;
	}
	return chosen;
}

/** The exporter never sees a project the visitor did not tick. */
function selectionPredicate(chosen: readonly TransferProjectOffer[]): (project: { id: string }) => boolean {
	const ticked = new Set(chosen
		.filter((offer) => offer.storeProjectId !== null)
		.map((offer) => offer.schemaFamily === null
			? offer.storeProjectId as string
			: `${offer.schemaFamily}:${offer.storeProjectId as string}`));
	return (project) => {
		let key = project.id;
		try {
			key = `${readProjectSchemaIdentity(project).schemaFamily}:${project.id}`;
		} catch {
			// A malformed identity was never preselected, but remains visible for
			// explicit custody. Its raw id is the only selection handle available.
		}
		return ticked.has(key);
	};
}

/**
 * The ticked rows a transport can actually be given.
 *
 * A refused row's selection key is generated rather than a project id, so it
 * matches nothing the exporter lists - which is deliberate, and is exactly why
 * it has to be separated here rather than left to disappear into the predicate.
 * What is separated out is reported: see `refusedChoices()`.
 */
function transferableChoices(chosen: readonly TransferProjectOffer[]): readonly TransferProjectOffer[] {
	return chosen.filter((offer) => offer.refusal === null);
}

/** And the ones that cannot, each carrying the refusal already written for it. */
function refusedChoices(chosen: readonly TransferProjectOffer[]): readonly TransferRefusedChoice[] {
	return chosen
		.filter((offer) => offer.refusal !== null)
		.map((offer) => Object.freeze({ label: offer.title, reason: offer.refusal as string }));
}

async function runSenderDownload(
	context: TransferPageContext,
	chosen: readonly TransferProjectOffer[],
): Promise<void> {
	const { scope, view } = context;
	const refused = refusedChoices(chosen);
	const transferable = transferableChoices(chosen);
	if (transferable.length === 0) {
		// Nothing here can be exported, so no store is opened and no run is
		// started - but every ticked row still gets its answer.
		view.report(withRefusedTransferChoices(null, refused));
		return;
	}
	view.status(`Exporting and saving ${transferable.length}`
		+ ` archive${transferable.length === 1 ? '' : 's'}…`);
	const runtime = await context.dependencies.loadRuntime();
	const source = await context.dependencies.openStore();
	const saveArchive = createArchiveSaver(scope);
	try {
		const report = await downloadTransferArchives({
			archives: streamTransferArchives({
				runtime,
				store: source.store as ExportStore,
				select: selectionPredicate(transferable),
				onProgress: (progress) => view.status(exportProgressText(progress)),
			}),
			save: (entry) => saveArchive(entry.bytes, entry.fileName, entry.mimeType),
		});
		view.report(withRefusedTransferChoices(describeTransferDownload(report), refused));
	} finally {
		await source.close().catch(() => undefined);
	}
}

async function runSenderHandshake(
	context: TransferPageContext,
	chosen: readonly TransferProjectOffer[],
	choices: TransferChoiceHandle | null,
): Promise<void> {
	const { configuration, scope, view } = context;
	const refused = refusedChoices(chosen);
	const transferable = transferableChoices(chosen);
	if (transferable.length === 0) {
		// No popup is opened for a selection with nothing in it that can cross.
		view.report(withRefusedTransferChoices(null, refused));
		return;
	}
	const url = transferPeerUrl(configuration, transferRouteForRole('receive').path);
	let popup: TransferMessageTarget;
	try {
		// First, and synchronously: a popup opened after an await is not opened
		// inside the visitor's click, and every browser blocks it.
		popup = openTransferPopup({ scope: scope as unknown as Parameters<typeof openTransferPopup>[0]['scope'], url });
	} catch (error) {
		if (error instanceof TransferWindowError) {
			view.status(`${error.message}`, 'error');
			view.report(withRefusedTransferChoices(null, refused));
			return;
		}
		throw error;
	}
	choices?.freeze(true);
	const windowPort = createWindowTransferPort({
		peer: popup,
		listener: scope,
		allowedOrigins: configuration.allowedOrigins,
		expectedSource: popup,
	});
	// Subscribed here, in the same turn the popup was opened and before either
	// await below. The popup is loading right now and announces `ready` the
	// moment it mounts; an unsubscribed port drops that message, and the only
	// symptom is this page waiting out its whole acknowledgement budget while
	// the other origin sits idle. Moving this line below an await reintroduces
	// exactly that race.
	const port = bufferTransferPort(windowPort);
	view.status(`Waiting for ${configuration.peerOrigin} to accept the transfer…`);
	const runtime = await context.dependencies.loadRuntime();
	const source = await context.dependencies.openStore();
	try {
		const report = await sendTransferArchives({
			runtime,
			// Streamed, not collected: the archives reach the offer one at a
			// time and the aggregate ceiling is what bounds the whole transfer.
			archives: streamTransferArchives({
				runtime,
				store: source.store as ExportStore,
				select: selectionPredicate(transferable),
				onProgress: (progress) => view.status(exportProgressText(progress)),
			}),
			port,
			targetOrigin: configuration.peerOrigin,
			allowedOrigins: configuration.allowedOrigins,
		});
		view.report(withRefusedTransferChoices(describeTransferSend(report), refused));
	} catch (error) {
		view.status(
			`The transfer did not complete: ${describeTransferError(error)}.`
			+ ' Nothing was removed from this origin - download the archives instead.',
			'error',
		);
		// A run that never produced a report still owes the visitor an answer
		// for the rows this page refused: they are the ones a status line about
		// the wire says nothing about, and they did not fail on the wire.
		view.report(withRefusedTransferChoices(null, refused));
	} finally {
		windowPort.close();
		choices?.freeze(false);
		await source.close().catch(() => undefined);
	}
}

function exportProgressText(progress: { completed: number; total: number | null; title: string | null }): string {
	return `Exporting ${progress.completed}${progress.total === null ? '' : ` of ${progress.total}`}`
		+ `${progress.title ? `: ${progress.title}` : ''}…`;
}

/**
 * How long the last archive's object URL is left alive.
 *
 * An object URL has to outlive the click that starts the download, so it cannot
 * be revoked synchronously. This is the backstop for the final archive of a
 * run; every earlier one is released when the next is created, which is what
 * keeps the download transport to one resident archive.
 */
const TRANSFER_DOWNLOAD_URL_LIFETIME_MILLISECONDS = 60_000;

/**
 * Hand archives to the browser one at a time, holding one at a time.
 *
 * The download path is the transport that streams, and the reason it needs no
 * aggregate byte ceiling is that it never holds more than the archive currently
 * being saved. An object URL is a strong reference to its Blob, so revoking
 * each one only on a 60-second timer quietly broke that: a library of thirty
 * archives saved in under a minute kept all thirty resident, and the transport
 * that was supposed to be the safe fallback for an enormous library was the one
 * with no bound at all.
 *
 * So the previous archive is released as the next one is created - deliberately
 * not on a timer, which a run of resolved promises can starve - and only the
 * last archive of a run waits out the backstop above.
 */
function createArchiveSaver(
	scope: Window & typeof globalThis,
): (bytes: Uint8Array, fileName: string, mimeType: string) => void {
	let held: { url: string; timer: unknown } | null = null;
	const release = (): void => {
		if (!held) return;
		const { url, timer } = held;
		held = null;
		scope.clearTimeout(timer as ReturnType<typeof setTimeout>);
		scope.URL.revokeObjectURL(url);
	};
	return (bytes, fileName, mimeType) => {
		release();
		const url = scope.URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mimeType }));
		try {
			const anchor = scope.document.createElement('a');
			anchor.href = url;
			anchor.download = fileName;
			anchor.rel = 'noopener';
			scope.document.body.append(anchor);
			anchor.click();
			anchor.remove();
		} finally {
			held = { url, timer: scope.setTimeout(release, TRANSFER_DOWNLOAD_URL_LIFETIME_MILLISECONDS) };
		}
	};
}
