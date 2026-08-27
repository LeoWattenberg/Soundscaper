/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the sending page says about the rows it offers but cannot move.
 *
 * The page lists every row every store handed it, including three kinds it knows
 * will never cross: a row this origin listed without a usable project id, the
 * older of two copies that share one id, and a whole store that could not be
 * read. Listing them is deliberate - a row the page hides is a project the
 * visitor never learns about, and this is the last page they see before their
 * work has to survive an origin move.
 *
 * Listing them also means they can be *ticked*, and that is where the reporting
 * used to give out. Their selection keys match no project, so the exporter was
 * never given them and they fell out of the run without a trace: no row, no
 * count, no mention. A run made only of such rows reported "Downloaded 0 of 0
 * projects" and flagged itself complete - a page telling a visitor their
 * migration finished over a run that moved nothing at all.
 *
 * The count sentence had the mirror-image fault. "N projects found on this
 * origin" was written over every offer, and one of those offers is not a project
 * but a store that could not be read. A visitor deciding whether the move is
 * done needs that fact on its own, prominently, rather than added into the total
 * of what they are about to move.
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
import { createTransferStoreFederation } from '../src/common/transfer/transfer-store-federation.ts';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import type { TransferRuntime } from '../src/common/transfer/transfer-session.ts';
import { createFakeArchive } from './project-transfer-bundle-fixture.ts';
import { FakeWindow, settle, withUnreferencedTimers } from './project-transfer-page-fixture.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';
const SENDING = Object.freeze({
	selfOrigin: SOUNDSCAPER,
	peerOrigin: FRAMESCAPER,
	allowedOrigins: Object.freeze([SOUNDSCAPER, FRAMESCAPER]),
	loopback: false,
});

/** Why the V24 generation could not be listed, as the fixture reports it. */
const UNREADABLE_REASON = 'The database is held open by another tab.';

/* ------------------------------------------------------------------ */
/* Every ticked row is accounted for.                                  */
/* ------------------------------------------------------------------ */

test('a ticked row that cannot be exported still appears in the report', async () => {
	await withSendingPage(async ({ sender, tickEverything }) => {
		tickEverything();
		await sender.document.clickButton('Download the ticked archives');
		await settle();

		const rows = sender.document.rowText();
		assert.ok(
			rows.some((row) => row.startsWith('Interview cut —') && /Saved as/u.test(row)),
			`the one exportable project still has to cross; saw ${JSON.stringify(rows)}`,
		);
		for (const [label, reason] of [
			['Nameless take', /without a usable project id/u],
			['Interview cut \\(older\\)', /same id/u],
			['Framescaper V24 storage', new RegExp(UNREADABLE_REASON.replace('.', '\\.'), 'u')],
		] as const) {
			const row = rows.find((candidate) => new RegExp(`^${label} —`, 'u').test(candidate));
			assert.ok(
				row,
				`a row the visitor ticked may not vanish from the run without a word; no row for ${label}`
				+ ` in ${JSON.stringify(rows)}`,
			);
			assert.match(row, reason, `and it has to say what happened to it; saw ${row}`);
		}
		assert.equal(
			sender.document.completeFlag(),
			'false',
			'three of the four ticked rows did not cross, so the run did not finish',
		);
	});
});

test('a run made entirely of rows that cannot be exported never reads as a finished transfer', async () => {
	await withSendingPage(async ({ sender, tick }) => {
		tick(['Nameless take', 'Interview cut (older)', 'Framescaper V24 storage']);
		await sender.document.clickButton('Download the ticked archives');
		await settle();

		const summary = sender.document.summaryText();
		assert.doesNotMatch(
			summary,
			/Downloaded 0 of 0 projects/u,
			`"Downloaded 0 of 0 projects" is true by arithmetic and reads as a migration that finished;`
			+ ` saw ${summary}`,
		);
		assert.equal(
			sender.document.completeFlag(),
			'false',
			'a run that moved nothing at all is not a completed transfer',
		);
		assert.equal(
			sender.saved.length,
			0,
			'and none of these rows may be handed to the browser as an archive',
		);
		assert.equal(
			sender.document.rowText().length,
			3,
			`every ticked row still gets its own row; saw ${JSON.stringify(sender.document.rowText())}`,
		);
	});
});

test('the handshake opens no popup for a selection nothing in it can cross', async () => {
	// The download path can run an empty export and report it. The handshake
	// cannot: it would open a popup on the other origin, announce a transfer of
	// nothing and wait out an acknowledgement budget, and the rows the visitor
	// actually ticked would still be missing from whatever came back.
	await withSendingPage(async ({ sender, tick }) => {
		tick(['Nameless take', 'Framescaper V24 storage']);
		await sender.document.clickButton(/^Send /u);
		await settle();
		await sender.document.clickButton(/^Yes, send/u);
		await settle();

		assert.equal(sender.opened, 0, 'no popup may be opened for a transfer with nothing in it');
		assert.equal(sender.document.rowText().length, 2, JSON.stringify(sender.document.rowText()));
		assert.equal(sender.document.completeFlag(), 'false');
	});
});

test('a blocked popup still reports the rows this page had already refused', async () => {
	// The two facts are independent, and the status line only carries one of
	// them. A visitor told "the popup was blocked" and nothing else is left
	// believing the other three rows were fine.
	await withSendingPage(async ({ sender, tickEverything }) => {
		sender.opens = () => null;
		tickEverything();
		await sender.document.clickButton(/^Send /u);
		await settle();
		await sender.document.clickButton(/^Yes, send/u);
		await settle();

		assert.match(sender.document.statusText(), /popup|window/iu, sender.document.statusText());
		const rows = sender.document.rowText();
		assert.equal(rows.length, 3, `the three refused rows still need their answer; saw ${JSON.stringify(rows)}`);
		assert.equal(sender.document.completeFlag(), 'false');
	});
});

/* ------------------------------------------------------------------ */
/* The count sentence counts projects.                                 */
/* ------------------------------------------------------------------ */

test('the page counts projects and names an unreadable store on its own', async () => {
	await withSendingPage(async ({ sender }) => {
		const status = sender.document.statusText();
		assert.match(
			status,
			/^3 projects found on this origin\./u,
			`the store that could not be read is not a project and may not be counted as one;`
			+ ` saw ${status}`,
		);
		assert.match(
			status,
			/could not be read/u,
			`and a storage the page could not open is exactly what a visitor about to leave this origin`
			+ ` has to be told; saw ${status}`,
		);
		assert.equal(
			sender.document.body.querySelector('p[role="status"]')?.dataset.tone,
			'error',
			'a store this origin could not read is not an informational aside',
		);
	});
});

/* ------------------------------------------------------------------ */

interface SendingPage {
	readonly sender: FakeWindow;
	/** Tick every offered row, whether or not it can cross. */
	tickEverything(): void;
	/** Tick exactly the rows whose labels are named. */
	tick(labels: readonly string[]): void;
}

/**
 * A mounted sending page over an origin holding all four kinds of row.
 *
 * The federation is the real one, so the inventory the page reads - which row is
 * shadowed by which, which store each row came from, which store could not be
 * listed - is decided by the code under test rather than staged by hand.
 */
async function withSendingPage(check: (page: SendingPage) => Promise<void>): Promise<void> {
	await withUnreferencedTimers(async () => {
		const sender = new FakeWindow(SOUNDSCAPER);
		const v31 = listingStore([
			{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
			// Listed with no id at all: nothing can address it, so the exporter is
			// never given it.
			{ title: 'Nameless take', schemaVersion: 31 },
		]);
		// The same identity, in an older generation. One identity crosses once.
		const v27 = listingStore([{ id: 'video-1', title: 'Interview cut (older)', schemaVersion: 27 }]);
		const federation = createTransferStoreFederation({
			sources: [
				{ id: 'framescaper-v31', label: 'Framescaper V31 storage', store: v31 },
				{ id: 'framescaper-v27', label: 'Framescaper V27 storage', store: v27 },
			],
			writer: v31,
			unreadable: [{
				storeId: 'framescaper-v24',
				storeLabel: 'Framescaper V24 storage',
				reason: UNREADABLE_REASON,
			}],
		});

		await mountTransferPage({
			scope: sender as never,
			role: 'send',
			configuration: SENDING as never,
			dependencies: {
				loadRuntime: async () => runtimeFor(createFakeArchive()),
				openStore: async () => ({
					id: 'federated',
					label: 'Federated',
					store: federation.store,
					close: federation.close,
				}) as never,
			},
		});
		await settle();
		await sender.document.clickButton('Find my projects');
		await settle();

		const boxes = sender.document.body.querySelectorAll('[data-transfer-choice]');
		const labelOf = (box: { parent: { textContent: string } | null }): string => (
			(box.parent?.textContent ?? '').trim().split(' — ')[0]
		);
		await check({
			sender,
			tickEverything: () => {
				for (const box of boxes) box.checked = true;
			},
			tick: (labels) => {
				for (const box of boxes) box.checked = labels.includes(labelOf(box as never));
			},
		});
	});
}

/** A store that can only be listed, which is all the federation asks of a source. */
function listingStore(projects: readonly unknown[]) {
	return {
		listProjects: async () => projects,
		loadProject: async (projectId: string) => (
			projects.find((project) => (project as { id?: unknown }).id === projectId) ?? null
		),
		ready: async () => undefined,
		close: async () => undefined,
	};
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
