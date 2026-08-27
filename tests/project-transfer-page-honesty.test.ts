/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What a visitor can work out from the *receiving* page alone.
 *
 * Its sibling, `project-transfer-page-sender-honesty.test.ts`, covers the origin
 * the archives left. This half is the origin they arrive at, so its one question
 * is the one the whole feature exists to answer: **which projects are on this
 * origin now?** Every test here is a way the page could have answered it with a
 * number larger than the truth.
 *
 *   - An archive the import layer refused produced no record, and so appeared in
 *     no row and in no count. It refuses in two shapes - resolving with a named
 *     stop, and rejecting - and a page that keeps records on only one of them
 *     loses every archive refused the other way.
 *   - The live status line counted every record it saw as "imported", including
 *     the ones that were skipped without ever being written.
 *   - The receiving layer holds its records outside its own try so a run the wire
 *     cut short still reports what landed; the page then rendered them when the
 *     run resolved and dropped them when it rejected.
 *   - A skip that leaves the project absent still let the run call itself
 *     complete, so the two origins told one visitor opposite things.
 *
 * They are driven through `mountTransferPage()` against a fake window pair
 * rather than through the transports, because every one of them is about what
 * ends up on the page.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
	ProjectTransferRefusalError,
} from '../src/common/transfer/project-transfer-bundle.ts';
import {
	receiveProjectTransfer,
	sendProjectTransfer,
} from '../src/common/transfer/project-transfer-handshake.ts';
import {
	sendTransferArchives,
	streamTransferArchives,
	type TransferImportRecord,
	type TransferRuntime,
} from '../src/common/transfer/transfer-session.ts';
import {
	describeTransferImport,
	describeTransferSend,
	type TransferImportOutcome,
} from '../src/common/transfer/transfer-report-rows.ts';
import { createWindowTransferPort } from '../src/common/transfer/transfer-window-port.ts';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import { archiveBytes, createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import { FakeWindow, settle } from './project-transfer-page-fixture.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';
const ALLOWED = Object.freeze([SOUNDSCAPER, FRAMESCAPER]);
const RECEIVING = Object.freeze({
	selfOrigin: FRAMESCAPER,
	peerOrigin: SOUNDSCAPER,
	allowedOrigins: ALLOWED,
	loopback: false,
});
/* ------------------------------------------------------------------ */
/* Defect 1: a refused archive must not vanish from the page.          */
/* ------------------------------------------------------------------ */

test('an archive the receiving origin refused outright still gets a row that names the refusal', async () => {
	const { opener, receiver } = linkedPages();
	const sendingStore = new FakeStore([
		{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
		{ id: 'video-2', title: 'Rooftop b-roll', schemaVersion: 31 },
	] as never);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());

	const sending = sendTransferArchives({
		runtime,
		archives: streamTransferArchives({ runtime, store: sendingStore }),
		port: portFrom(opener, receiver),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [...ALLOWED],
	});
	const mounted = mountReceivingPage(receiver, receivingStore, refusingRuntime(runtime, {
		at: 2,
		code: 'shared-memory',
		reason: 'A transfer entry may not be backed by shared memory.',
	}));
	await sending;
	await mounted;
	await settle();

	assert.deepEqual(
		[...receivingStore.projects.keys()],
		['video-1'],
		'only the first archive was ever written, which is what makes the second one worth reporting',
	);
	const rows = receiver.document.rowText();
	assert.equal(
		rows.length,
		2,
		`every archive the run saw needs a row; saw ${JSON.stringify(rows)}`,
	);
	assert.ok(
		rows.some((row) => /Rooftop b-roll/u.test(row) && /shared-memory/u.test(row)),
		`the refused archive has to be named, and its refusal with it; saw ${JSON.stringify(rows)}`,
	);
	assert.match(
		receiver.document.summaryText(),
		/1 failed/u,
		'a refused archive is a failure, not an archive that never existed',
	);
	assert.equal(
		receiver.document.completeFlag(),
		'false',
		`a run that lost an archive is not a complete one; summary was ${receiver.document.summaryText()}`,
	);
});

test('an archive the receiving origin refused by rejecting also gets a row that names the refusal', async () => {
	// The sibling shape of the same refusal. `importBundle()` resolves with a
	// named stop for a refusal it took as a decision and *rejects* for one it
	// took as a broken request, and the receiving page only ever reached
	// `records.push` on the first of those - so an archive refused the second way
	// got no record, no row, and no failure counted, which is exactly the defect
	// the resolved shape was fixed for.
	const { opener, receiver } = linkedPages();
	const sendingStore = new FakeStore([
		{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
		{ id: 'video-2', title: 'Rooftop b-roll', schemaVersion: 31 },
	] as never);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());

	const sending = sendTransferArchives({
		runtime,
		archives: streamTransferArchives({ runtime, store: sendingStore }),
		port: portFrom(opener, receiver),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [...ALLOWED],
	});
	const mounted = mountReceivingPage(receiver, receivingStore, rejectingRuntime(runtime, {
		at: 2,
		error: new ProjectTransferRefusalError(
			'shared-memory',
			'A transfer entry may not be backed by shared memory.',
		),
	}));
	const sent = await sending;
	await mounted;
	await settle();

	assert.deepEqual(
		[...receivingStore.projects.keys()],
		['video-1'],
		'only the first archive was ever written, which is what makes the second one worth reporting',
	);
	const rows = receiver.document.rowText();
	assert.equal(
		rows.length,
		2,
		`an archive refused by a rejection is still an archive this origin saw; saw ${JSON.stringify(rows)}`,
	);
	assert.ok(
		rows.some((row) => /Rooftop b-roll/u.test(row) && /shared-memory/u.test(row)),
		`the refused archive has to be named, and its refusal with it; saw ${JSON.stringify(rows)}`,
	);
	assert.match(
		receiver.document.summaryText(),
		/1 failed/u,
		'a rejected archive is a failure, not an archive that never existed',
	);
	assert.equal(
		receiver.document.completeFlag(),
		'false',
		`a run that lost an archive is not a complete one; summary was ${receiver.document.summaryText()}`,
	);
	// And the name still crosses the wire, the same way the resolved refusal's
	// does: the sending visitor gets the code they can quote back.
	assert.match(
		describeTransferSend(sent).rows[1].detail,
		/shared-memory/u,
		`the refusal a rejection carried has to reach the other origin too; saw ${JSON.stringify(sent.outcomes)}`,
	);
});

test('a rejection that named nothing still reaches the page as a named refusal', async () => {
	// Fail closed: a refusal that arrives without a name of its own is still a
	// refusal, and letting it through as an anonymous failure leaves the visitor
	// on either origin with prose they cannot quote, search for, or act on.
	const { opener, receiver } = linkedPages();
	const sendingStore = new FakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }] as never);
	const runtime = runtimeFor(createFakeArchive());

	const sending = sendTransferArchives({
		runtime,
		archives: streamTransferArchives({ runtime, store: sendingStore }),
		port: portFrom(opener, receiver),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [...ALLOWED],
	});
	const mounted = mountReceivingPage(receiver, new FakeStore(), rejectingRuntime(runtime, {
		at: 1,
		error: new Error('the receiving store went away'),
	}));
	const sent = await sending;
	await mounted;
	await settle();

	const rows = receiver.document.rowText();
	assert.ok(
		rows.some((row) => /Interview cut/u.test(row) && /import-rejected/u.test(row)),
		`an unnamed refusal is given a name rather than left anonymous; saw ${JSON.stringify(rows)}`,
	);
	assert.ok(
		rows.some((row) => /the receiving store went away/u.test(row)),
		`and what actually happened travels with it; saw ${JSON.stringify(rows)}`,
	);
	assert.match(
		describeTransferSend(sent).rows[0].detail,
		/import-rejected/u,
		`the sending origin gets the same name; saw ${JSON.stringify(sent.outcomes)}`,
	);
});

test('a receive that ends in a rejection still lists the archives that landed', async () => {
	// The receiving layer holds its records outside its own try precisely so an
	// entry written to this origin is reported whether or not the run finished.
	// The page then had two paths for the two ways that layer can end: the one
	// that resolves with a stop rendered the records, and the one that rejects
	// replaced the whole report with a status line - throwing away, one layer up,
	// exactly what the layer below went to the trouble of keeping.
	const { opener, receiver } = linkedPages();
	const sendingStore = new FakeStore([
		{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
		{ id: 'video-2', title: 'Rooftop b-roll', schemaVersion: 31 },
	] as never);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());
	const failing: TransferRuntime = {
		...runtime,
		receiveTransfer: (async (options: never) => {
			await receiveProjectTransfer(options);
			throw new Error('the receiving page lost its store handle');
		}) as unknown as TransferRuntime['receiveTransfer'],
	};

	const sending = sendTransferArchives({
		runtime,
		archives: streamTransferArchives({ runtime, store: sendingStore }),
		port: portFrom(opener, receiver),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [...ALLOWED],
	});
	const mounted = mountReceivingPage(receiver, receivingStore, failing);
	await sending;
	await mounted;
	await settle();

	assert.deepEqual(
		[...receivingStore.projects.keys()],
		['video-1', 'video-2'],
		'both archives really are on this origin now, which is what makes hiding them a lie',
	);
	const rows = receiver.document.rowText();
	for (const title of ['Interview cut', 'Rooftop b-roll']) {
		assert.ok(
			rows.some((row) => row.startsWith(`${title} —`) && /Imported/u.test(row)),
			`an archive this origin wrote is on it whatever ended the run, and has to be listed as`
			+ ` imported; ${title} was missing from ${JSON.stringify(rows)}`,
		);
	}
	assert.ok(
		rows.some((row) => /receive-failed/u.test(row)),
		`and the failure that ended the run gets its own row rather than replacing the list;`
		+ ` saw ${JSON.stringify(rows)}`,
	);
	assert.equal(
		receiver.document.completeFlag(),
		'false',
		'a run that ended in a rejection is still not a finished one',
	);
	assert.match(
		receiver.document.summaryText(),
		/lost its store handle/u,
		'and what ended it has to be said, not swallowed by the list of what landed',
	);
});

/* ------------------------------------------------------------------ */
/* Defect 2: the live status line counted everything it saw.           */
/* ------------------------------------------------------------------ */

test('the receiving page never counts a skipped archive as one it imported', async () => {
	const { opener, receiver } = linkedPages();
	const sendingStore = new FakeStore([
		{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
		{ id: 'video-2', title: 'Rooftop b-roll', schemaVersion: 31 },
	] as never);
	// The first project is already here, so it is skipped rather than written.
	const receivingStore = new FakeStore([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }] as never);
	const runtime = runtimeFor(createFakeArchive());

	const sending = sendTransferArchives({
		runtime,
		archives: streamTransferArchives({ runtime, store: sendingStore }),
		port: portFrom(opener, receiver),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [...ALLOWED],
	});
	const mounted = mountReceivingPage(receiver, receivingStore, runtime);
	await sending;
	await mounted;
	await settle();

	const status = receiver.document.statusText();
	assert.doesNotMatch(
		status,
		/Imported 2/u,
		`only one archive was written, so a status line claiming two is the defect; saw ${status}`,
	);
	assert.match(status, /Imported 1\b/u, `the one that was written is still counted; saw ${status}`);
	assert.match(status, /skipped 1/iu, `and the skip has to be visible while it happens; saw ${status}`);
});

test('the manual import status does not claim archives were imported while it is still reading them', async () => {
	const receiver = new FakeWindow(FRAMESCAPER);
	receiver.location.pathname = '/transfer/receive/';
	const store = new FakeStore();
	const archive = createFakeArchive();
	const seen: string[] = [];
	await mountTransferPage({
		scope: receiver as never,
		role: 'receive',
		configuration: RECEIVING as never,
		dependencies: {
			loadRuntime: async () => runtimeFor(archive),
			openStore: async () => ({
				id: 'fake', label: 'Fake', store, close: async () => undefined,
			}) as never,
		},
	});
	await settle();

	const files = receiver.document.body.querySelectorAll('input').find((node) => node.type === 'file');
	assert.ok(files, 'the manual fallback is always on the page');
	files.files = [
		fakeArchiveFile({ id: 'video-1', title: 'Interview cut' }, seen),
		fakeArchiveFile({ id: 'video-2', title: 'Rooftop b-roll' }, seen),
	];
	for (const listener of files.listeners.get('change') ?? []) listener({ target: files });
	await settle();

	assert.deepEqual(seen, ['video-1', 'video-2'], 'both files were read');
	assert.doesNotMatch(
		receiver.document.statusText(),
		/Imported \d/u,
		'progress is how many archives have been read, not how many were written -'
		+ ` the write outcome is not known until the record is; saw ${receiver.document.statusText()}`,
	);
	assert.match(receiver.document.summaryText(), /Imported 2 of 2 archives\./u);
});

test('a skip that means the project is not here costs the import its complete flag', () => {
	// The two origins have to agree about one run. `describeTransferSend()`
	// already calls any skip incomplete, because a skip is what the wire carries
	// for an archive the receiving build refused to write. The receiving page
	// was calling the same run complete, so the sending visitor was told their
	// project had not crossed while the receiving visitor was told it was done.
	const refusedHere = describeTransferImport(importResult([
		importRow({ index: 0, outcome: 'imported', title: 'Interview cut' }),
		importRow({
			index: 1,
			outcome: 'skipped',
			title: 'From a newer build',
			reasonCode: 'archive-read-only',
			reason: 'The .scape archive was written by a newer Framescaper build.',
		}),
	]));
	assert.equal(
		refusedHere.complete,
		false,
		`this origin does not hold the second project, so the run did not finish the job;`
		+ ` summary was ${refusedHere.summary}`,
	);
	assert.match(refusedHere.rows[1].detail, /archive-read-only/u, 'and the refusal keeps its name');

	// A duplicate is the one skip that leaves the project present, so it is the
	// one skip that must not raise the alarm.
	const alreadyHere = describeTransferImport(importResult([
		importRow({ index: 0, outcome: 'imported', title: 'Interview cut' }),
		importRow({
			index: 1,
			outcome: 'skipped',
			title: 'Rooftop b-roll',
			reasonCode: 'already-present',
			reason: 'A project with this ID is already on this origin.',
		}),
	]));
	assert.equal(alreadyHere.complete, true, `a duplicate is still here; summary was ${alreadyHere.summary}`);
});

/* ------------------------------------------------------------------ */

function linkedPages(): { opener: FakeWindow; receiver: FakeWindow } {
	const opener = new FakeWindow(SOUNDSCAPER);
	const receiver = new FakeWindow(FRAMESCAPER);
	receiver.location.pathname = '/transfer/receive/';
	opener.peer = receiver;
	receiver.peer = opener;
	receiver.opener = opener;
	return { opener, receiver };
}

function portFrom(listener: FakeWindow, peer: FakeWindow) {
	return createWindowTransferPort({
		peer: peer as never, listener: listener as never, allowedOrigins: [...ALLOWED], expectedSource: peer as never,
	});
}

function mountReceivingPage(receiver: FakeWindow, store: FakeStore, runtime: TransferRuntime): Promise<void> {
	return mountTransferPage({
		scope: receiver as never,
		role: 'receive',
		configuration: RECEIVING as never,
		dependencies: {
			loadRuntime: async () => runtime,
			openStore: async () => ({
				id: 'fake', label: 'Fake', store, close: async () => undefined,
			}) as never,
		},
	});
}

/**
 * A runtime whose import layer refuses the nth archive the way the real one
 * does: by resolving with a named stop and no record at all.
 */
function refusingRuntime(
	base: TransferRuntime,
	refusal: { at: number; code: string; reason: string },
): TransferRuntime {
	let seen = 0;
	return {
		...base,
		importBundle: ((options: unknown) => {
			seen += 1;
			if (seen !== refusal.at) {
				return (base.importBundle as (value: unknown) => unknown)(options);
			}
			return Promise.resolve(Object.freeze({
				entries: Object.freeze([]),
				total: 0,
				imported: 0,
				skipped: 0,
				failed: 0,
				completed: false,
				stopped: Object.freeze({ code: refusal.code, index: 0, reason: refusal.reason }),
			}));
		}) as unknown as TransferRuntime['importBundle'],
	};
}

/**
 * A runtime whose import layer refuses the nth archive the *other* way it can:
 * by rejecting rather than resolving with a stop.
 *
 * Both shapes mean one archive was not written to this origin, so a receiving
 * page that reaches its record-keeping on only one of them loses the other.
 */
function rejectingRuntime(
	base: TransferRuntime,
	refusal: { at: number; error: Error },
): TransferRuntime {
	let seen = 0;
	return {
		...base,
		importBundle: ((options: unknown) => {
			seen += 1;
			if (seen !== refusal.at) {
				return (base.importBundle as (value: unknown) => unknown)(options);
			}
			return Promise.reject(refusal.error);
		}) as unknown as TransferRuntime['importBundle'],
	};
}

function fakeArchiveFile(project: { id: string; title: string }, seen: string[]) {
	return {
		name: `${project.title}.scape`,
		async arrayBuffer(): Promise<ArrayBuffer> {
			seen.push(project.id);
			return archiveBytes(project).buffer;
		},
	};
}

function importRow(
	seed: Partial<TransferImportRecord> & Pick<TransferImportRecord, 'index' | 'outcome'>,
): TransferImportRecord {
	return Object.freeze({
		projectId: `p${seed.index + 1}`,
		title: null,
		byteLength: 64,
		reasonCode: null,
		reason: null,
		residue: 'none' as const,
		...seed,
	});
}

function importResult(entries: readonly TransferImportRecord[]): TransferImportOutcome {
	return Object.freeze({
		entries: Object.freeze([...entries]),
		total: entries.length,
		imported: entries.filter(({ outcome: held }) => held === 'imported').length,
		skipped: entries.filter(({ outcome: held }) => held === 'skipped').length,
		failed: entries.filter(({ outcome: held }) => held === 'failed').length,
		completed: true,
		stopped: null,
	});
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
