/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the transfer pages tell the visitor, and what they hold while doing it.
 *
 * These are the three transport properties the wiring tests in
 * `project-transfer-page-session.test.ts` do not cover, because each one is
 * about the shape of the seam rather than about a project crossing it:
 *
 *   - an entry the receiving build could not write is never acknowledged as
 *     stored, and the sender's report says so in words;
 *   - the wait for an acknowledgement is sized for an import, not for a chat,
 *     and is still finite;
 *   - the export streams into whichever transport is consuming it, and the
 *     whole transfer is bounded by an aggregate byte cap.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_TRANSFER_DEFAULT_TIMEOUT_MILLISECONDS,
	PROJECT_TRANSFER_MAX_TIMEOUT_MILLISECONDS,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	receiveProjectTransfer,
	sendProjectTransfer,
	type ProjectTransferPort,
} from '../src/common/transfer/project-transfer-handshake.ts';
import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
} from '../src/common/transfer/project-transfer-bundle.ts';
import * as Session from '../src/common/transfer/transfer-session.ts';
import {
	describeTransferDownload,
	describeTransferImport,
	describeTransferSend,
} from '../src/common/transfer/transfer-report-rows.ts';
import {
	createWindowTransferPort,
	type TransferMessageEventLike,
} from '../src/common/transfer/transfer-window-port.ts';
import { archiveBytes, createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';

/**
 * The module is addressed as a namespace on purpose: several of these tests
 * assert that the transport module *offers* a streaming source and a named
 * budget refusal at all, and a named import of a symbol that does not exist
 * fails the whole file at link time instead of failing its own test.
 */
const {
	collectTransferArchives,
	downloadTransferArchives,
	receiveTransferArchives,
	sendTransferArchives,
	streamTransferArchives,
	TransferBudgetError,
	TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS,
	TRANSFER_MAX_TOTAL_BYTES,
} = Session;

/* ------------------------------------------------------------------ */
/* Defect 2: an entry that was never written is not "stored".          */
/* ------------------------------------------------------------------ */

test('an archive the receiving build cannot write is reported as skipped, not stored', async () => {
	const sendingStore = new FakeStore([
		{ id: 'p1', title: 'Good' },
		{ id: 'p2', title: 'From a newer build' },
	]);
	const receivingStore = new FakeStore();
	// p2's archive announces a schema this build only opens read-only, so the
	// bundle layer skips it with reasonCode 'archive-read-only' and writes
	// nothing at all.
	const runtime = runtimeFor(createFakeArchive({
		bytesFor: (project) => archiveBytes(project.id === 'p2'
			? {
				id: project.id,
				title: project.title,
				readOnly: true,
				reason: 'The .scape archive was written by a newer Framescaper build.',
			}
			: { id: project.id, title: project.title }),
	}));
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent, received] = await Promise.all([
		sendTransferArchives({
			runtime, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-skip',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);

	// The receiving origin does not hold p2. The sender must not be told it does.
	assert.deepEqual([...receivingStore.projects.keys()], ['p1']);
	assert.deepEqual(received.records.map(({ outcome }) => outcome), ['imported', 'skipped']);
	assert.equal(received.records[1].reasonCode, 'archive-read-only');

	assert.equal(sent.stored, 1, 'only one project actually landed');
	assert.equal(sent.skipped, 1, 'the skip has to survive the trip back');
	assert.equal(sent.failed, 0, 'a skip is not a failure either');
	assert.notEqual(sent.outcomes[1].status, 'stored');
	assert.match(sent.outcomes[1].reason, /newer Framescaper build/u);

	const described = describeTransferSend(sent);
	assert.deepEqual(described.rows.map(({ outcome }) => outcome), ['ok', 'skipped']);
	assert.match(described.rows[1].detail, /newer Framescaper build/u);
	assert.match(described.summary, /1 skipped/u);
	assert.equal(described.complete, false, 'a transfer with a skip is not complete');
});

test('a duplicate the other origin already holds still counts as present', async () => {
	// The counterpart of the test above: this skip means the project *is* there,
	// which is the whole question the sender is asking, so it stays a store.
	const sendingStore = new FakeStore([{ id: 'p1', title: 'Field recording' }]);
	const receivingStore = new FakeStore([{ id: 'p1', title: 'Field recording' }]);
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent] = await Promise.all([
		sendTransferArchives({
			runtime, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-dup',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);
	assert.equal(sent.stored, 1);
	assert.equal(sent.skipped, 0);
	assert.equal(describeTransferSend(sent).complete, true);
});

/* ------------------------------------------------------------------ */
/* Defect 3: the acknowledgement wait is sized for an import.          */
/* ------------------------------------------------------------------ */

test('both roles ask the protocol for an import-sized acknowledgement budget', async () => {
	const store = new FakeStore([{ id: 'p1', title: 'One' }]);
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store });
	const asked: (number | undefined)[] = [];
	const spy = {
		...runtime,
		sendTransfer: async (options: { timeoutMilliseconds?: number }) => {
			asked.push(options.timeoutMilliseconds);
			return { sessionId: 's', protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION, entryCount: 0, storedCount: 0, failedCount: 0, entries: [] };
		},
		receiveTransfer: async (options: { timeoutMilliseconds?: number }) => {
			asked.push(options.timeoutMilliseconds);
			return { sessionId: 's', protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION, entryCount: 0, storedCount: 0, failedCount: 0, entries: [] };
		},
	} as unknown as Session.TransferRuntime;
	const channel = { port: silentPort(), targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER] };
	await sendTransferArchives({ runtime: spy, collection, ...channel });
	await receiveTransferArchives({ runtime: spy, store, sessionId: 'session-timeout', ...channel });

	for (const timeout of asked) {
		assert.equal(typeof timeout, 'number', 'neither page may leave the protocol on its chat-sized default');
		assert.ok(
			(timeout as number) > PROJECT_TRANSFER_DEFAULT_TIMEOUT_MILLISECONDS,
			`an acknowledgement covers importing up to ${Session.TRANSFER_MAX_ARCHIVE_BYTES} bytes,`
			+ ` which does not fit in ${PROJECT_TRANSFER_DEFAULT_TIMEOUT_MILLISECONDS} ms`,
		);
		assert.ok(
			(timeout as number) <= PROJECT_TRANSFER_MAX_TIMEOUT_MILLISECONDS,
			'the protocol refuses anything past its own ceiling, so a page that asked for more would throw',
		);
	}
	assert.deepEqual(asked, [
		TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS,
		TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS,
	]);
});

test('a peer that never answers fails the transfer instead of hanging it', async () => {
	const store = new FakeStore([{ id: 'p1', title: 'One' }]);
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store });
	const requested: number[] = [];
	const clock = {
		setTimeout: (callback: () => void, milliseconds: number) => {
			requested.push(milliseconds);
			// Fire immediately: the point is that a timer was armed at all, and
			// with what budget, not that the test waits ten real minutes for it.
			return setTimeout(callback, 0);
		},
		clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	};
	// Reported, not thrown: a transfer the protocol killed still holds whatever
	// the peer had already acknowledged, and rejecting is what threw that away.
	// A silent peer acknowledged nothing, so here the report is empty - but it
	// still has to name the timeout and refuse to call itself complete.
	const report = await sendTransferArchives({
		runtime,
		collection,
		port: silentPort(),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		clock,
	});
	assert.deepEqual(requested, [TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS]);
	assert.equal(report.completed, false, 'a transfer nobody answered is not a completed one');
	assert.equal(report.stopped?.code, 'TIMEOUT');
	assert.match(report.stopped?.reason ?? '', /did not answer within/u);
	assert.equal(report.stored, 0, 'nothing may be reported as stored on a peer that never answered');
	// A peer that never announced `ready` never received an offer either: the
	// protocol waits for `ready` before it posts the first entry, so this archive
	// was not merely unacknowledged, it was never put on the wire. Reporting it as
	// unanswered would claim the page cannot tell whether it crossed, about an
	// archive the page knows it never sent.
	assert.deepEqual(
		report.unanswered.map(({ entryId }) => entryId),
		[],
		'nothing was ever posted, so nothing about this run is genuinely unknown',
	);
	assert.deepEqual(
		report.unsent.map(({ entryId }) => entryId),
		['p1'],
		'the archive that never left this origin is named, not silently dropped',
	);
	const described = describeTransferSend(report);
	assert.equal(described.complete, false);
	assert.match(described.summary, /did not answer within/u);
	assert.doesNotMatch(
		described.summary,
		/cannot say whether/u,
		`the sender knows it posted nothing, so it may not report uncertainty; saw ${described.summary}`,
	);
	assert.match(
		described.rows[0].detail,
		/never sent/iu,
		`and the archive's row says which of the two it is; saw ${JSON.stringify(described.rows)}`,
	);
	assert.deepEqual(store.deletions, [], 'and the sending origin still loses nothing');
});

/* ------------------------------------------------------------------ */
/* Defect 4: the export streams, and the transfer is capped.           */
/* ------------------------------------------------------------------ */

test('the download saves each archive as it is exported, never a resident library', async () => {
	const order: string[] = [];
	const store = new FakeStore([
		{ id: 'p1', title: 'One' },
		{ id: 'p2', title: 'Two' },
		{ id: 'p3', title: 'Three' },
	]);
	const runtime = runtimeFor(createFakeArchive({
		bytesFor: (project) => {
			order.push(`export ${project.id}`);
			return archiveBytes({ id: project.id, title: project.title });
		},
	}));
	const report = await downloadTransferArchives({
		archives: streamTransferArchives({ runtime, store }),
		save: (entry) => {
			order.push(`save ${entry.projectId}`);
		},
	});
	assert.deepEqual(order, [
		'export p1', 'save p1',
		'export p2', 'save p2',
		'export p3', 'save p3',
	], 'a library that materializes before the first save is the bug this stream exists to prevent');
	assert.equal(report.saved, 3);
	assert.equal(report.failed, 0);
});

test('the stream yields one archive at a time and reports its own running total', async () => {
	const store = new FakeStore([{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }]);
	const archive = createFakeArchive();
	const seen: number[] = [];
	let summary: { total: number; exported: number; failed: number; byteLength: number } | null = null;
	for await (const event of streamTransferArchives({ runtime: runtimeFor(archive), store })) {
		if (event.kind === 'entry') seen.push(archive.exportCalls.length);
		else if (event.kind === 'summary') summary = event;
	}
	assert.deepEqual(seen, [1, 2], 'each archive must be handed over before the next export starts');
	assert.equal(summary?.exported, 2);
	assert.ok((summary?.byteLength ?? 0) > 0);
});

test('a transfer larger than the aggregate cap is refused by name, mid-stream', async () => {
	const store = new FakeStore([
		{ id: 'p1', title: 'One' },
		{ id: 'p2', title: 'Two' },
		{ id: 'p3', title: 'Three' },
	]);
	const archive = createFakeArchive({
		bytesFor: (project) => new Uint8Array(600).fill(project.id.charCodeAt(1)),
	});
	const events = streamTransferArchives({
		runtime: runtimeFor(archive),
		store,
		maximumTotalBytes: 1_000,
	});
	const entries: unknown[] = [];
	await assert.rejects(async () => {
		for await (const event of events) if (event.kind === 'entry') entries.push(event.entry);
	}, (error: unknown) => {
		assert.ok(error instanceof TransferBudgetError, `expected a named refusal, got ${String(error)}`);
		assert.equal(error.code, 'transfer-budget-exceeded');
		assert.match(error.message, /1,?000/u);
		return true;
	});
	assert.equal(entries.length, 1, 'the cap must bite before the second archive is held as well');
	assert.deepEqual(archive.exportCalls, ['p1', 'p2'], 'and before a third project is even read');
	assert.ok(TRANSFER_MAX_TOTAL_BYTES > Session.TRANSFER_MAX_ARCHIVE_BYTES);
});

test('the one-at-a-time download stream explicitly opts out of the resident handshake cap', async () => {
	const store = new FakeStore([
		{ id: 'p1', title: 'One' },
		{ id: 'p2', title: 'Two' },
		{ id: 'p3', title: 'Three' },
	]);
	const archive = createFakeArchive({
		bytesFor: (project) => new Uint8Array(600).fill(project.id.charCodeAt(1)),
	});
	const entries: unknown[] = [];
	for await (const event of streamTransferArchives({
		runtime: runtimeFor(archive), store, maximumTotalBytes: null,
	})) {
		if (event.kind === 'entry') entries.push(event.entry);
	}
	assert.equal(entries.length, 3);
	assert.deepEqual(archive.exportCalls, ['p1', 'p2', 'p3']);
});

test('the handshake path streams the export straight into the offer', async () => {
	const order: string[] = [];
	const sendingStore = new FakeStore([{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }]);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive({
		bytesFor: (project) => {
			order.push(`export ${project.id}`);
			return archiveBytes({ id: project.id, title: project.title });
		},
	}));
	const { senderPort, receiverPort } = linkedWindowPorts();
	const [sent] = await Promise.all([
		sendTransferArchives({
			runtime,
			archives: streamTransferArchives({ runtime, store: sendingStore }),
			port: senderPort,
			targetOrigin: FRAMESCAPER,
			allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-stream',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);
	assert.deepEqual(order, ['export p1', 'export p2']);
	assert.equal(sent.stored, 2);
	assert.equal(sent.total, 2);
	assert.deepEqual([...receivingStore.projects.keys()].sort(), ['p1', 'p2']);
	assert.deepEqual(sendingStore.deletions, [], 'the sending origin still loses nothing');
});

/* ------------------------------------------------------------------ */
/* Defect 5: one project, one name, on every report of a run.          */
/* ------------------------------------------------------------------ */

/**
 * A title the archive file name cannot carry back.
 *
 * `projectTransferFileName()` replaces every character outside
 * `\p{L}\p{N} ._-` with a space, collapses the runs and strips trailing dots, so
 * the colon, the path separator, the guillemets, the em dash and the trailing
 * ellipsis are all gone from the name while `Ståle` survives. Deriving a title
 * back out of that name is lossy by construction, and the first assertion below
 * proves it for this fixture: without it these tests could pass over a title
 * that round-trips.
 */
const AWKWARD_TITLE = 'Rushes: 12/03 «Ståle b-roll» — take 2...';

test('every report of one run names the project by its title, not by its file name', async () => {
	const sendingStore = new FakeStore([{ id: 'p1', title: AWKWARD_TITLE }]);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const fileName = collection.entries[0].fileName;
	assert.notEqual(
		Session.transferArchiveTitle(fileName),
		AWKWARD_TITLE,
		`${fileName} has to be a lossy derivation of the title, or this test proves nothing`,
	);
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent, received] = await Promise.all([
		sendTransferArchives({
			runtime, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-title',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);
	assert.equal(sent.stored, 1, 'the project has to cross before its name can be compared');

	const sending = describeTransferSend(sent).rows.map(({ label }) => label);
	const receiving = describeTransferImport({
		entries: received.records,
		total: received.records.length,
		imported: received.records.length,
		skipped: 0,
		failed: 0,
		completed: received.completed,
		stopped: null,
	}).rows.map(({ label }) => label);
	const downloading = describeTransferDownload(
		await downloadTransferArchives({ collection, save: () => undefined }),
	).rows.map(({ label }) => label);

	assert.deepEqual(sending, [AWKWARD_TITLE], 'the sending page may not reconstruct a title from a file name');
	assert.deepEqual(receiving, sending, 'one project must not be named two things across the two origins');
	assert.deepEqual(downloading, sending, "nor across the sending page's own two transports");
});

test('an archive that never left the origin is still named by its title', async () => {
	// The pending rows are labelled from the same place the acknowledged ones
	// are, and a transfer that died is exactly when the visitor has to match a
	// row against the project list they are looking at.
	const store = new FakeStore([{ id: 'p1', title: AWKWARD_TITLE }]);
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store });
	const report = await sendTransferArchives({
		runtime,
		collection,
		port: silentPort(),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		clock: {
			setTimeout: (callback: () => void) => setTimeout(callback, 0),
			clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		},
	});
	assert.deepEqual(report.unsent.map(({ entryId }) => entryId), ['p1']);
	const [row] = describeTransferSend(report).rows;
	assert.equal(row.label, AWKWARD_TITLE, `saw ${row.label}`);
	assert.match(row.detail, /Never sent/u);
});

function silentPort(): ProjectTransferPort {
	return { post: () => undefined, subscribe: () => () => undefined };
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

function runtimeFor(archive: ReturnType<typeof createFakeArchive>): Session.TransferRuntime {
	return {
		exportProject: archive.exportProject as Session.TransferRuntime['exportProject'],
		inspectProject: archive.inspectProject as Session.TransferRuntime['inspectProject'],
		importProject: archive.importProject as Session.TransferRuntime['importProject'],
		exportBundle: exportProjectTransferBundle,
		importBundle: importProjectTransferBundle,
		sendTransfer: sendProjectTransfer,
		receiveTransfer: receiveProjectTransfer,
	};
}
