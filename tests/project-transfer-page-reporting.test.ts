/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the two transfer documents *say*, once the layers under them stopped
 * lying by omission.
 *
 * The bundle layer no longer rejects when it refuses a run: it resolves with
 * the records that already landed, a `completed` flag and a named `stopped`.
 * Every one of these tests is about a consumer that has to carry that honesty
 * the last inch to the visitor - a truncated run that must not read as a
 * finished one, a refusal whose name must survive the trip back to the sending
 * origin, records that must not be thrown away when the protocol dies, and
 * residue wording that must not accuse a transfer of leaving a partial copy it
 * never wrote.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
	type ProjectTransferImportRecord,
	type ProjectTransferImportResult,
} from '../src/common/transfer/project-transfer-bundle.ts';
import {
	receiveProjectTransfer,
	sendProjectTransfer,
} from '../src/common/transfer/project-transfer-handshake.ts';
import {
	collectTransferArchives,
	decodeTransferRefusal,
	receiveTransferArchives,
	sendTransferArchives,
	type TransferRuntime,
	type TransferSendReport,
} from '../src/common/transfer/transfer-session.ts';
import {
	describeTransferDownload,
	describeTransferImport,
	describeTransferSend,
} from '../src/common/transfer/transfer-report-rows.ts';
import { createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import {
	createWindowTransferPort,
	type TransferMessageEventLike,
} from '../src/common/transfer/transfer-window-port.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';

/* ------------------------------------------------------------------ */
/* A run the bundle layer stopped is not a run that finished.          */
/* ------------------------------------------------------------------ */

test('an import the bundle layer refused is never reported as a complete success', () => {
	// Exactly what importProjectTransferBundle() now resolves with when its own
	// admission refuses the first entry: no records, and a named stop.
	const refused: ProjectTransferImportResult = Object.freeze({
		entries: Object.freeze([]),
		total: 0,
		imported: 0,
		skipped: 0,
		failed: 0,
		completed: false,
		stopped: Object.freeze({
			code: 'entry-too-large' as const,
			index: 0,
			reason: 'A transfer entry of 300000000 bytes is over the 268435456 byte limit.',
		}),
	});

	const described = describeTransferImport(refused);
	assert.equal(described.complete, false, 'a refused run is not a complete one');
	assert.match(described.summary, /stopped/iu, 'the summary has to say the run was cut short');
	assert.match(
		described.summary,
		/entry-too-large|over the 268435456 byte limit/u,
		'and it has to name the refusal rather than leave the visitor guessing',
	);
	assert.ok(
		described.rows.some((row) => row.outcome === 'failed' && /entry-too-large/u.test(row.detail)),
		`a truncated run needs a visible row naming the refusal; saw ${JSON.stringify(described.rows)}`,
	);
});

test('a run that simply ran out of archives is still complete', () => {
	const finished: ProjectTransferImportResult = resultOf([
		importRecord({ index: 0, outcome: 'imported' }),
	]);
	const described = describeTransferImport(finished);
	assert.equal(described.complete, true);
	assert.doesNotMatch(described.summary, /stopped/iu);
	assert.deepEqual(described.rows.map((row) => row.outcome), ['ok']);
});

test('an abort mid-import is reported as a stop, with what already landed kept', () => {
	const aborted: ProjectTransferImportResult = Object.freeze({
		...resultOf([importRecord({ index: 0, outcome: 'imported', title: 'Landed' })]),
		completed: false,
		stopped: Object.freeze({ code: 'aborted' as const, index: 1, reason: 'The import was cancelled.' }),
	});
	const described = describeTransferImport(aborted);
	assert.equal(described.complete, false, 'an aborted run is not a finished one even with no failures');
	assert.match(described.summary, /stopped/iu);
	assert.ok(
		described.rows.some((row) => row.label === 'Landed' && row.outcome === 'ok'),
		'what already landed still has to be listed - it is on the receiving origin now',
	);
});

/* ------------------------------------------------------------------ */
/* A named refusal keeps its name all the way back to the sender.      */
/* ------------------------------------------------------------------ */

test('a refusal the receiving origin named travels back to the sender by name', async () => {
	const sendingStore = new FakeStore([{ id: 'p1', title: 'Field recording' }]);
	const receivingStore = new FakeStore();
	const archive = createFakeArchive();
	const sending = runtimeFor(archive);
	// The receiving origin's bundle layer refuses this entry outright: it
	// resolves with a stop and no record, which is precisely the shape that
	// used to be flattened into "reported no outcome for this entry".
	const receiving: TransferRuntime = {
		...sending,
		importBundle: (async () => Object.freeze({
			entries: Object.freeze([]),
			total: 0,
			imported: 0,
			skipped: 0,
			failed: 0,
			completed: false,
			stopped: Object.freeze({
				code: 'shared-memory' as const,
				index: 0,
				reason: 'A transfer entry may not be backed by shared memory.',
			}),
		})) as unknown as TransferRuntime['importBundle'],
	};
	const collection = await collectTransferArchives({ runtime: sending, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent, received] = await Promise.all([
		sendTransferArchives({
			runtime: sending, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime: receiving, store: receivingStore, port: receiverPort, sessionId: 'session-refused',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);

	assert.equal(sent.stored, 0, 'nothing was written on the other origin');
	assert.equal(sent.failed, 1);
	const refusal = decodeTransferRefusal(sent.outcomes[0].reason);
	assert.equal(refusal.code, 'shared-memory', `the code has to cross the wire; saw ${sent.outcomes[0].reason}`);
	assert.match(refusal.text, /shared memory/u, 'and the reason with it');
	assert.doesNotMatch(
		sent.outcomes[0].reason,
		/reported no outcome/u,
		'a named refusal must not be flattened into a generic one',
	);
	const described = describeTransferSend(sent);
	assert.match(described.rows[0].detail, /shared-memory/u, 'the visitor is shown the name they can quote');
	assert.equal(receivingStore.projects.size, 0);
	// And the *receiving* origin keeps its own record of the refusal. A refusal
	// the bundle layer answers with a stop and no record used to leave this
	// empty, so the receiving page listed no row for the archive, counted no
	// failure, and still called the run complete.
	assert.deepEqual(
		received.records.map(({ outcome, reasonCode }) => [outcome, reasonCode]),
		[['failed', 'shared-memory']],
		`the archive this origin refused is still an archive it saw; saw ${JSON.stringify(received.records)}`,
	);
	const local = describeTransferImport({
		entries: received.records,
		total: 1,
		imported: 0,
		skipped: 0,
		failed: 1,
		completed: received.completed,
		stopped: null,
	});
	assert.equal(local.complete, false, 'a run that lost an archive is not a complete one');
	assert.match(local.rows[0].detail, /shared-memory/u, 'and the refusal is named on this side too');
});

/* ------------------------------------------------------------------ */
/* The receiving origin keeps its own records when the protocol dies.  */
/* ------------------------------------------------------------------ */

test('a protocol failure never discards the record of what already landed', async () => {
	const sendingStore = new FakeStore([
		{ id: 'p1', title: 'One' },
		{ id: 'p2', title: 'Two' },
		{ id: 'p3', title: 'Three' },
	]);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();
	const cancel = new AbortController();

	const [, received] = await Promise.all([
		sendTransferArchives({
			runtime, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}).catch((error: unknown) => error),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-cut',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
			signal: cancel.signal,
			// The visitor closes the receiving page after the first archive.
			onRecord: () => cancel.abort(new Error('The receiving page was closed.')),
		}),
	]);

	assert.equal(received.completed, false, 'a transfer cut short is not a completed one');
	assert.ok(received.stopped, 'and the stop has to be named');
	assert.deepEqual(
		received.records.map((record) => record.projectId),
		['p1'],
		'the archive that already landed on this origin must still be reported',
	);
	assert.deepEqual(
		received.records.map((record) => record.index),
		[0],
		'records are numbered by their place in this receive run, not by their place in a one-entry import',
	);
	assert.ok(receivingStore.projects.has('p1'), 'because it really is stored here');

	const described = describeTransferImport({
		entries: received.records,
		total: received.records.length,
		imported: received.records.filter(({ outcome }) => outcome === 'imported').length,
		skipped: 0,
		failed: 0,
		completed: received.completed,
		stopped: received.stopped ? { ...received.stopped, index: received.records.length } : null,
	});
	assert.equal(described.complete, false);
	assert.match(described.summary, /stopped/iu);
});

/* ------------------------------------------------------------------ */
/* Residue wording is what tells a visitor whether their data is safe. */
/* ------------------------------------------------------------------ */

test('a retained project is not reported as a partial copy this transfer left behind', () => {
	// The bundle layer keeps a project it cannot prove it wrote. Calling that a
	// partial copy tells the visitor their own project is debris.
	const kept = importRecord({
		index: 0,
		outcome: 'failed',
		title: 'Interview cut',
		reasonCode: 'import-failed',
		reason: 'A project with this ID already exists.'
			+ ' A project is present at this identity, but this transfer cannot prove it wrote it, so it was kept.',
		residue: 'retained',
	});
	const detail = describeTransferImport(resultOf([kept])).rows[0].detail;
	assert.doesNotMatch(
		detail,
		/partial copy could not be removed/u,
		'the transfer did not write it, so it is not a partial copy of anything',
	);
	assert.match(detail, /cannot prove it wrote it/u, 'the layer that decided still gets to say why');
	assert.match(
		detail,
		/nothing.*(deleted|removed)/iu,
		'the visitor needs to be told plainly that nothing on this origin was deleted',
	);
});

test('a cleared residue says what was removed, and says it in different words', () => {
	const rolled = importRecord({
		index: 0,
		outcome: 'failed',
		title: 'Interview cut',
		reasonCode: 'import-failed',
		reason: 'The project document is unreadable. The project this transfer created was removed.',
		residue: 'cleared',
	});
	const detail = describeTransferImport(resultOf([rolled])).rows[0].detail;
	assert.match(detail, /this transfer/u);
	assert.doesNotMatch(detail, /partial copy/u, 'the two cases must not share one wording');
});

/* ------------------------------------------------------------------ */
/* A run that moved nothing is not a run that finished.                */
/* ------------------------------------------------------------------ */

test('a send that carried no project at all never reads as a finished transfer', () => {
	// `stored === total` is satisfied by 0 === 0, so arithmetic alone calls an
	// empty run complete - and "Sent 0 of 0 projects. They are still stored here
	// too" is the single most dangerous sentence this page can render, because it
	// is read by a visitor deciding whether they may now abandon this origin.
	//
	// The page refuses to open a popup for a selection with nothing transferable
	// in it, which is not the same as this run being unreachable: the selection is
	// read from one listing and the export re-lists from a freshly opened store,
	// so a project another tab deleted in between leaves the predicate matching
	// nothing and the exporter yielding neither an entry nor a failure.
	const emptyRun = describeTransferSend(sendReport({ total: 0, stored: 0 }));
	assert.equal(emptyRun.complete, false, 'a run with nothing in it is not a completed transfer');
	assert.doesNotMatch(
		emptyRun.summary,
		/nothing was removed|still stored here too/u,
		'the reassurance sentence belongs to a run that actually moved something',
	);
	// And the ordinary finished run still reads as finished.
	const realRun = describeTransferSend(sendReport({
		total: 1,
		stored: 1,
		outcomes: [{ entryId: 'e1', name: 'Cut.scape', status: 'stored', byteLength: 64, reason: '' }],
	}));
	assert.equal(realRun.complete, true);
	assert.match(realRun.summary, /Sent 1 of 1/u);
});

test('a download that saved nothing and failed at nothing says so, rather than counting to zero', () => {
	const emptyRun = describeTransferDownload({
		records: [], exportFailures: [], saved: 0, failed: 0,
	});
	assert.equal(emptyRun.complete, false, 'nothing reached the saver, so nothing was downloaded');
	assert.doesNotMatch(
		emptyRun.summary,
		/Downloaded 0 of 0/u,
		'"Downloaded 0 of 0 projects" is true by arithmetic and reads as a finished run',
	);
	assert.match(emptyRun.summary, /nothing in this run reached the exporter/u);
	// A run that saved something still reads as finished.
	const realRun = describeTransferDownload({
		records: [{
			projectId: 'p1', title: 'Cut', fileName: 'Cut.scape',
			byteLength: 64, outcome: 'saved', reason: null,
		}],
		exportFailures: [],
		saved: 1,
		failed: 0,
	});
	assert.equal(realRun.complete, true);
	assert.match(realRun.summary, /Downloaded 1 of 1/u);
});

function sendReport(seed: Partial<TransferSendReport>): TransferSendReport {
	return Object.freeze({
		sessionId: 's1',
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
		titles: new Map<string, string>(),
		...seed,
	}) as TransferSendReport;
}

/* ------------------------------------------------------------------ */

type ImportRecordSeed = Partial<ProjectTransferImportRecord>
	& Pick<ProjectTransferImportRecord, 'index' | 'outcome'>;

function importRecord(record: ImportRecordSeed): ProjectTransferImportRecord {
	return Object.freeze({
		projectId: `p${record.index + 1}`,
		title: null,
		byteLength: 64,
		reasonCode: null,
		reason: null,
		residue: 'none' as const,
		...record,
	});
}

function resultOf(entries: readonly ProjectTransferImportRecord[]): ProjectTransferImportResult {
	return Object.freeze({
		entries: Object.freeze([...entries]),
		total: entries.length,
		imported: entries.filter(({ outcome }) => outcome === 'imported').length,
		skipped: entries.filter(({ outcome }) => outcome === 'skipped').length,
		failed: entries.filter(({ outcome }) => outcome === 'failed').length,
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

/** A window that delivers what is posted into it the way `postMessage` does. */
class FakeWindow {
	readonly listeners = new Set<(event: TransferMessageEventLike) => void>();
	closed = false;
	peer: FakeWindow | null = null;

	constructor(readonly origin: string) {}

	postMessage(data: unknown, _targetOrigin: string): void {
		const from = this.peer;
		if (!from) return;
		const cloned = structuredClone(data);
		queueMicrotask(() => {
			for (const listener of [...this.listeners]) {
				listener({ origin: from.origin, data: cloned, source: from });
			}
		});
	}

	addEventListener(_type: 'message', listener: (event: TransferMessageEventLike) => void): void {
		this.listeners.add(listener);
	}

	removeEventListener(_type: 'message', listener: (event: TransferMessageEventLike) => void): void {
		this.listeners.delete(listener);
	}
}

function linkedWindowPorts() {
	const sender = new FakeWindow(SOUNDSCAPER);
	const receiver = new FakeWindow(FRAMESCAPER);
	sender.peer = receiver;
	receiver.peer = sender;
	const allowedOrigins = [SOUNDSCAPER, FRAMESCAPER];
	return {
		senderPort: createWindowTransferPort({
			peer: receiver, listener: sender, allowedOrigins, expectedSource: receiver,
		}),
		receiverPort: createWindowTransferPort({
			peer: sender, listener: receiver, allowedOrigins, expectedSource: sender,
		}),
	};
}
