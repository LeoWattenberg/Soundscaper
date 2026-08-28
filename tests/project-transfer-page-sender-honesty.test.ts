/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the *sending* page tells a visitor about where their projects went.
 *
 * Its sibling, `project-transfer-page-honesty.test.ts`, covers the receiving
 * origin. This half is about the harder question, because the sending page is
 * reporting on work another origin did: for every archive it offered it has to
 * say which of three things is true, and the three are genuinely different
 * facts rather than shades of one.
 *
 *   - **Acknowledged.** The peer named an outcome, and that outcome is what the
 *     row says - including a refusal it declined by name.
 *   - **Posted, never acknowledged.** The wire died with the archive in flight.
 *     This origin does not know, and the only honest row says so.
 *   - **Never posted.** The wire died before this archive was offered. This
 *     origin knows perfectly well it did not cross, and lending it the uncertain
 *     wording is a page claiming ignorance about work it knows it never started.
 *
 * Collapsing the last two into one is how a fix for overstating success became
 * an overstatement of uncertainty, which sends a visitor hunting the other
 * origin for archives that never reached it and buries the one archive whose
 * fate really is unknown among archives whose fate is not.
 *
 * The last two tests are about consent rather than reporting: one project must
 * not be named two different things by the two pages, and a box unticked while
 * the confirmation is on screen must not still be sent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
} from '../src/common/transfer/project-transfer-bundle.ts';
import {
	receiveProjectTransfer,
	sendProjectTransfer,
} from '../src/common/transfer/project-transfer-handshake.ts';
import {
	receiveTransferArchives,
	type TransferRuntime,
	type TransferSendReport,
} from '../src/common/transfer/transfer-session.ts';
import { projectTransferFileName } from '../src/common/transfer/project-transfer-bundle-admission.ts';
import { transferArchiveTitle } from '../src/common/transfer/transfer-archive-stream.ts';
import { describeTransferSend } from '../src/common/transfer/transfer-report-rows.ts';
import { createWindowTransferPort } from '../src/common/transfer/transfer-window-port.ts';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import { createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import { FakeWindow, settle, withUnreferencedTimers } from './project-transfer-page-fixture.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';
const ALLOWED = Object.freeze([SOUNDSCAPER, FRAMESCAPER]);
const SENDING = Object.freeze({
	selfOrigin: SOUNDSCAPER,
	peerOrigin: FRAMESCAPER,
	allowedOrigins: ALLOWED,
	loopback: false,
});

test('a transfer the protocol cut short still tells the sender which projects crossed', async () => {
	await withCutShortSend(({ sender, sendingStore }) => {
		const summary = sender.document.summaryText();
		const rows = sender.document.rowText();
		assert.ok(
			rows.some((row) => /Interview cut/u.test(row) && /other origin/u.test(row)),
			`the projects that did cross are exactly what a cut-short visitor is owed; saw ${JSON.stringify(rows)}`,
		);
		assert.ok(
			rows.some((row) => /Title card/u.test(row)),
			`and the one that did not has to be named too; saw ${JSON.stringify(rows)}`,
		);
		assert.match(summary, /stopped/iu, `a cut-short transfer is not a finished one; saw ${summary}`);
		assert.match(summary, /1 of 3|of 3 projects/u, `and it has to say how far it got; saw ${summary}`);
		assert.equal(sender.document.completeFlag(), 'false');
		assert.deepEqual(sendingStore.deletions, [], 'the sending origin still loses nothing');
	});
});

test('the sending page never describes an archive it never posted as one that may have crossed', async () => {
	// One run, three states. The peer dies while importing the second archive:
	// the first was acknowledged, the second was posted and its acknowledgement
	// never arrived, and the third was never put on the wire at all.
	//
	// Reporting that third one as "this page cannot say whether it crossed" is a
	// page claiming ignorance about work it knows it never started. It is the
	// same dishonesty as overstating success, pointed the other way: it sends a
	// visitor hunting an origin for an archive that provably never reached it,
	// and it hides the one archive whose fate really is unknown among archives
	// whose fate is not.
	await withCutShortSend(({ sender, receivingStore }) => {
		assert.deepEqual(
			[...receivingStore.projects.keys()],
			['video-1', 'video-2'],
			'the third archive was never offered at all, which is what makes a row about its fate a claim'
			+ ' about nothing',
		);
		const rows = sender.document.rowText();
		const posted = rowFor(rows, 'Rooftop b-roll');
		const never = rowFor(rows, 'Title card');
		assert.match(
			posted,
			/cannot say whether/u,
			`this one really was posted and never answered for, so uncertainty is the honest word; saw ${posted}`,
		);
		assert.doesNotMatch(
			never,
			/cannot say whether|may have|might have|unknown/iu,
			`the sender knows it never posted this archive, so the page may not report it as possibly`
			+ ` crossed; saw ${never}`,
		);
		assert.match(
			never,
			/never sent/iu,
			`and going quiet is not the alternative - it has to say which of the two states this is;`
			+ ` saw ${never}`,
		);
		assert.match(
			never,
			/not on the other origin/u,
			`a never-posted archive definitely did not cross, and the visitor needs that said plainly;`
			+ ` saw ${never}`,
		);
		const summary = sender.document.summaryText();
		assert.doesNotMatch(
			summary,
			/2 archives were (?:sent but )?never acknowledged/u,
			`the summary may not fold a never-posted archive into the unanswered count; saw ${summary}`,
		);
		assert.match(
			summary,
			/1 archive was sent but never acknowledged/u,
			`exactly one archive's fate is genuinely unknown; saw ${summary}`,
		);
		assert.match(
			summary,
			/1 archive was never sent/u,
			`and exactly one is known not to have crossed; saw ${summary}`,
		);
	});
});

test('a project unticked while the confirmation is open is never read', async () => {
	// The confirmation is a panel on the page, not a modal that takes the boxes
	// away, so the visitor can keep unticking while it is open - and the page
	// captured the ticked set at Send-click time. A project the visitor took back
	// before consenting was still exported and still posted to the other origin,
	// which is the one thing this page promises it will never do.
	await withUnreferencedTimers(async () => {
		const sender = new FakeWindow(SOUNDSCAPER);
		const popup = new FakeWindow(FRAMESCAPER);
		sender.peer = popup;
		popup.peer = sender;
		sender.opens = () => popup;

		const sendingStore = new FakeStore([
			{ id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1 },
			{ id: 'video-2', title: 'Title card', schemaFamily: 'framescaper', schemaVersion: 1 },
		] as never);
		const receivingStore = new FakeStore();
		const archive = createFakeArchive();
		const runtime = runtimeFor(archive);

		await mountTransferPage({
			scope: sender as never,
			role: 'send',
			configuration: SENDING as never,
			dependencies: {
				loadRuntime: async () => runtime,
				openStore: async () => ({
					id: 'fake', label: 'Fake', store: sendingStore, close: async () => undefined,
				}) as never,
			},
		});
		await settle();
		await sender.document.clickButton('Find my projects');
		await settle();
		await sender.document.clickButton(/^Send /u);
		await settle();

		// Second thoughts, with the confirmation still on screen.
		const boxes = sender.document.body.querySelectorAll('[data-transfer-choice]');
		assert.deepEqual(boxes.map((box) => box.value), [
			'framescaper:video-1', 'framescaper:video-2',
		]);
		boxes[1].checked = false;

		await sender.document.clickButton(/^Yes, send/u);
		await settle();
		await receiveTransferArchives({
			runtime,
			store: receivingStore,
			port: portFrom(popup, sender),
			sessionId: 'session-untick',
			targetOrigin: SOUNDSCAPER,
			allowedOrigins: [...ALLOWED],
		});
		await settle();

		assert.deepEqual(
			archive.exportCalls,
			['video-1'],
			'consent is read at the moment it is given, so a project unticked before Yes is never even read',
		);
		assert.deepEqual(
			[...receivingStore.projects.keys()],
			['video-1'],
			'and it certainly never reaches the other origin',
		);
	});
});

test('the two pages name one project the same way', async () => {
	// The receiving page labels its rows with project titles. A sending page that
	// labels the same project with its archive file name leaves a visitor holding
	// two reports that never quite line up over the projects they share.
	await withCutShortSend(({ sender }) => {
		const rows = sender.document.rowText();
		for (const row of rows) {
			assert.doesNotMatch(
				row,
				/\.scape\s+—/u,
				`the sending rows are labelled with archive file names while the receiving rows use titles,`
				+ ` so the two origins name one project differently; saw ${JSON.stringify(rows)}`,
			);
		}
		assert.ok(
			rows.some((row) => row.startsWith('Interview cut —')),
			`and the title is what the label has to be; saw ${JSON.stringify(rows)}`,
		);
	});
});

/**
 * Titles the archive file name cannot carry back.
 *
 * `projectTransferFileName()` replaces every character outside `\p{L}\p{N} ._-`
 * with a space, collapses the runs, strips trailing dots and truncates. The
 * colon, the path separator, the guillemets and the trailing ellipsis are all
 * gone from the name that reaches the wire, so a page that rebuilds a label out
 * of that name renames the visitor's project.
 *
 * The three are deliberately different mangling shapes - a colon and a path
 * separator, a non-ASCII letter that survives beside punctuation that does not,
 * and a title left with a trailing dot run - so that all three of the sending
 * page's states are exercised by a title the sanitizer genuinely changes.
 */
const AWKWARD_TITLES: readonly [string, string, string] = Object.freeze([
	'Rushes: 12/03 «take 2»',
	'Ståle b-roll #4 (final)…',
	'2024.09.01 «cut»...',
]);

test('the sending page labels every row with the title, not the sanitized file name', async () => {
	// The page-level counterpart to the transport test's cross-report check. The
	// rows every other test in this file reads are staged from `Interview cut`,
	// which the file-name sanitizer round-trips losslessly - so those label
	// assertions passed just as well over a page that rebuilt its labels out of
	// the archive names. A title the sanitizer changes is the only way that
	// difference becomes visible, and this run puts one into each of the three
	// states the sending page reports: acknowledged, posted-and-unanswered, and
	// never posted.
	for (const title of AWKWARD_TITLES) {
		assert.notEqual(
			transferArchiveTitle(projectTransferFileName(title, 'video-1')),
			title,
			`${title} has to be a title the file name cannot carry back, or this test proves nothing`,
		);
	}
	await withCutShortSend(({ sender }) => {
		const rows = sender.document.rowText();
		for (const title of AWKWARD_TITLES) {
			assert.ok(
				rows.some((row) => row.startsWith(`${title} — `)),
				`every row of the sending report has to name the project the way the visitor's own project`
				+ ` list names it, whatever the sanitizer did to the archive name; no row for ${title}`
				+ ` in ${JSON.stringify(rows)}`,
			);
		}
		assert.equal(rows.length, AWKWARD_TITLES.length, `saw ${JSON.stringify(rows)}`);
	}, AWKWARD_TITLES);
});

test('a stopped send reads differently from a send that finished with failures', () => {
	const stopped = describeTransferSend(sendReport({
		total: 4,
		stored: 1,
		outcomes: [outcome('video-1', 'One', 'stored')],
		completed: false,
		stopped: { code: 'PEER_ABORTED', reason: 'The peer aborted the transfer.' },
		unanswered: [{ entryId: 'video-3', name: 'Three.scape', byteLength: 8 }],
		unsent: [{ entryId: 'video-4', name: 'Four.scape', byteLength: 8 }],
	}));
	const finished = describeTransferSend(sendReport({
		total: 2,
		stored: 1,
		failed: 1,
		outcomes: [outcome('video-1', 'One', 'stored'), outcome('video-2', 'Two', 'failed', 'unreadable')],
	}));

	assert.equal(stopped.complete, false);
	assert.equal(finished.complete, false);
	assert.match(stopped.summary, /stopped/iu);
	assert.doesNotMatch(
		finished.summary,
		/stopped/iu,
		'a run that reached the end and reported failures is not a run that was cut off',
	);
	const pending = stopped.rows.find((row) => /Three/u.test(row.label));
	assert.ok(pending, `the offered archive nobody answered for needs its own row; saw ${JSON.stringify(stopped.rows)}`);
	assert.match(
		pending.detail,
		/cannot say whether|unknown|may have/iu,
		'an entry with no acknowledgement is not known to have crossed and is not known to have failed,'
		+ ' so the row has to say so rather than pick one',
	);
	assert.doesNotMatch(pending.detail, /Stored on the other origin/u);
	assert.doesNotMatch(pending.detail, /did not cross/u);

	// The third state, and the one the uncertain wording must never reach: an
	// archive the sender never posted did not cross, and the sender knows it.
	const never = stopped.rows.find((row) => /Four/u.test(row.label));
	assert.ok(never, `the archive that was never posted needs its own row too; saw ${JSON.stringify(stopped.rows)}`);
	assert.doesNotMatch(
		never.detail,
		/cannot say whether|unknown|may have|might have/iu,
		'the sender knows exactly which archives it posted, so an unposted one is not an unknown one',
	);
	assert.doesNotMatch(never.detail, /Stored on the other origin/u);
	assert.match(never.detail, /never sent/iu);
	assert.equal(never.outcome, 'failed');
});

/* ------------------------------------------------------------------ */

interface CutShortSend {
	readonly sender: FakeWindow;
	readonly sendingStore: FakeStore;
	readonly receivingStore: FakeStore;
}

/**
 * Three projects, a real send driven through the mounted page, and a receiving
 * origin that dies while it is importing the second archive.
 *
 * That one run is where all three of the sender's states exist at once, which is
 * why the tests share it rather than each staging a report by hand: the first
 * archive is acknowledged, the second is posted and never answered for, and the
 * third is never posted at all.
 */
async function withCutShortSend(
	check: (page: CutShortSend) => void,
	titles: readonly [string, string, string] = ['Interview cut', 'Rooftop b-roll', 'Title card'],
): Promise<void> {
	await withUnreferencedTimers(async () => {
		const sender = new FakeWindow(SOUNDSCAPER);
		const popup = new FakeWindow(FRAMESCAPER);
		sender.peer = popup;
		popup.peer = sender;
		sender.opens = () => popup;

		const sendingStore = new FakeStore([
			{ id: 'video-1', title: titles[0], schemaFamily: 'framescaper', schemaVersion: 1 },
			{ id: 'video-2', title: titles[1], schemaFamily: 'framescaper', schemaVersion: 1 },
			{ id: 'video-3', title: titles[2], schemaFamily: 'framescaper', schemaVersion: 1 },
		] as never);
		const receivingStore = new FakeStore();
		const runtime = runtimeFor(createFakeArchive());

		await mountTransferPage({
			scope: sender as never,
			role: 'send',
			configuration: SENDING as never,
			dependencies: {
				loadRuntime: async () => runtime,
				openStore: async () => ({
					id: 'fake', label: 'Fake', store: sendingStore, close: async () => undefined,
				}) as never,
			},
		});
		await settle();
		await sender.document.clickButton('Find my projects');
		await settle();
		await sender.document.clickButton(/^Send /u);
		await settle();
		await sender.document.clickButton(/^Yes, send/u);
		await settle();

		// The visitor closes the receiving page while the second archive is being
		// imported. Two crossed; the third never left this origin.
		const cancel = new AbortController();
		let records = 0;
		await receiveTransferArchives({
			runtime,
			store: receivingStore,
			port: portFrom(popup, sender),
			sessionId: 'session-cut',
			targetOrigin: SOUNDSCAPER,
			allowedOrigins: [...ALLOWED],
			signal: cancel.signal,
			onRecord: () => {
				records += 1;
				if (records === 2) cancel.abort(new Error('The receiving page was closed.'));
			},
		});
		await settle();

		check({ sender, sendingStore, receivingStore });
	});
}

/** The one rendered row that names a project, as the visitor reads it. */
function rowFor(rows: readonly string[], name: string): string {
	const found = rows.find((row) => row.includes(name));
	assert.ok(found, `no row naming ${name} in ${JSON.stringify(rows)}`);
	return found;
}


function portFrom(listener: FakeWindow, peer: FakeWindow) {
	return createWindowTransferPort({
		peer: peer as never, listener: listener as never, allowedOrigins: [...ALLOWED], expectedSource: peer as never,
	});
}

function outcome(entryId: string, name: string, status: 'stored' | 'failed', reason = ''): never {
	return Object.freeze({ entryId, name, byteLength: 8, status, reason }) as never;
}

function sendReport(seed: Partial<TransferSendReport>): TransferSendReport {
	return Object.freeze({
		sessionId: 'session',
		total: 0,
		stored: 0,
		skipped: 0,
		failed: 0,
		outcomes: Object.freeze([]),
		exportFailures: Object.freeze([]),
		completed: true,
		stopped: null,
		unanswered: Object.freeze([]),
		unsent: Object.freeze([]),
		...seed,
	}) as TransferSendReport;
}

function runtimeFor(archive: ReturnType<typeof createFakeArchive>): TransferRuntime {
	return {
		exportProject: archive.exportProject as TransferRuntime['exportProject'],
		inspectProject: archive.inspectProject as TransferRuntime['inspectProject'],
		importProject: archive.importProject as TransferRuntime['importProject'],
		exportBundle: exportProjectTransferBundle,
		importBundle: importProjectTransferBundle,
		sendTransfer: sendProjectTransfer,
		receiveTransfer: receiveProjectTransfer,
	};
}
