/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The wiring between the two finished transfer modules, exercised for real.
 *
 * The handshake here is the actual protocol implementation talking over the
 * actual window port implementation, across a pair of fake windows that clone
 * their messages the way `postMessage` does. Only the archive layer and the
 * project stores are fakes, so what these tests observe is the seam's own
 * behaviour: which projects cross, what the page is told about the ones that do
 * not, and - the invariant that matters most - that the sending origin still
 * holds everything it held before.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_TRANSFER_MAX_ENTRY_BYTES,
	receiveProjectTransfer,
	sendProjectTransfer,
} from '../src/common/transfer/project-transfer-handshake.ts';
import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
} from '../src/common/transfer/project-transfer-bundle.ts';
import {
	admitTransferOrigin,
	resolveTransferOrigins,
	TransferConfigurationError,
	transferPeerUrl,
} from '../src/common/transfer/transfer-configuration.ts';
import {
	createWindowTransferPort,
	openTransferPopup,
	resolveTransferOpener,
	TransferWindowError,
	type TransferMessageEventLike,
} from '../src/common/transfer/transfer-window-port.ts';
import {
	collectTransferArchives,
	downloadTransferArchives,
	importTransferArchiveFiles,
	receiveTransferArchives,
	sendTransferArchives,
	transferArchiveTitle,
	TRANSFER_MAX_ARCHIVE_BYTES,
	type TransferRuntime,
} from '../src/common/transfer/transfer-session.ts';
import {
	describeTransferDownload,
	describeTransferImport,
	describeTransferSend,
	formatTransferBytes,
} from '../src/common/transfer/transfer-report-rows.ts';
import { archiveBytes, createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';

test('the production pairing is the default, both ways round', () => {
	const sending = resolveTransferOrigins({ selfOrigin: SOUNDSCAPER });
	assert.equal(sending.peerOrigin, FRAMESCAPER);
	assert.deepEqual([...sending.allowedOrigins], [SOUNDSCAPER, FRAMESCAPER]);
	assert.equal(sending.loopback, false);
	assert.equal(resolveTransferOrigins({ selfOrigin: FRAMESCAPER }).peerOrigin, SOUNDSCAPER);
});

test('an unknown origin talks to itself so the transfer is testable locally', () => {
	const local = resolveTransferOrigins({ selfOrigin: 'http://localhost:5173' });
	assert.equal(local.peerOrigin, 'http://localhost:5173');
	assert.equal(local.loopback, true);
	assert.deepEqual([...local.allowedOrigins], ['http://localhost:5173']);
	assert.equal(
		transferPeerUrl(local, '/transfer/receive/'),
		'http://localhost:5173/transfer/receive/',
	);
});

test('configuration overrides the default without widening it', () => {
	const configured = resolveTransferOrigins({
		selfOrigin: SOUNDSCAPER,
		environment: { PUBLIC_TRANSFER_PEER_ORIGIN: 'https://preview.framescaper.org' },
	});
	assert.equal(configured.peerOrigin, 'https://preview.framescaper.org');
	assert.deepEqual([...configured.allowedOrigins], [SOUNDSCAPER, 'https://preview.framescaper.org']);
	// An absent or blank setting is not a configuration.
	assert.equal(resolveTransferOrigins({
		selfOrigin: SOUNDSCAPER,
		environment: { PUBLIC_TRANSFER_PEER_ORIGIN: '  ' },
	}).peerOrigin, FRAMESCAPER);
	assert.equal(resolveTransferOrigins({ selfOrigin: SOUNDSCAPER, environment: {} }).peerOrigin, FRAMESCAPER);
});

test('anything that is not exactly one origin is refused', () => {
	for (const value of [
		'*',
		'null',
		'https://framescaper.org/',
		'https://framescaper.org/transfer/',
		'https://user:pw@framescaper.org',
		'HTTPS://Framescaper.ORG',
		'ftp://framescaper.org',
		'data:text/html,x',
		'framescaper.org',
		'',
		'   ',
		42,
		null,
		{ origin: FRAMESCAPER },
	]) {
		assert.throws(
			() => admitTransferOrigin(value, 'peerOrigin'),
			TransferConfigurationError,
			`${String(value)} must be refused`,
		);
	}
	assert.throws(
		() => resolveTransferOrigins({ selfOrigin: SOUNDSCAPER, environment: { PUBLIC_TRANSFER_PEER_ORIGIN: '*' } }),
		/must name one exact origin/u,
	);
	assert.throws(
		() => transferPeerUrl(resolveTransferOrigins({ selfOrigin: SOUNDSCAPER }), 'https://evil.example/x'),
		/must be root-relative/u,
	);
});

test('the window port drops foreign traffic instead of answering it', () => {
	const listener = new FakeWindow(SOUNDSCAPER);
	const peer = new FakeWindow(FRAMESCAPER);
	const port = createWindowTransferPort({
		peer,
		listener,
		allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		expectedSource: peer,
	});
	const heard: unknown[] = [];
	port.subscribe((message) => heard.push(message.data));
	listener.dispatch({ origin: FRAMESCAPER, data: { kind: 'wanted' }, source: peer });
	listener.dispatch({ origin: 'https://evil.example', data: { kind: 'foreign-origin' }, source: peer });
	listener.dispatch({ origin: FRAMESCAPER, data: { kind: 'foreign-window' }, source: new FakeWindow(FRAMESCAPER) });
	listener.dispatch({ origin: null, data: { kind: 'no-origin' }, source: peer });
	assert.deepEqual(heard, [{ kind: 'wanted' }]);

	port.close();
	listener.dispatch({ origin: FRAMESCAPER, data: { kind: 'after-close' }, source: peer });
	assert.deepEqual(heard, [{ kind: 'wanted' }]);
	assert.equal(listener.listeners.size, 0);
});

test('the window port refuses to post outside the allowed origins or to a closed peer', () => {
	const listener = new FakeWindow(SOUNDSCAPER);
	const peer = new FakeWindow(FRAMESCAPER);
	const port = createWindowTransferPort({ peer, listener, allowedOrigins: [FRAMESCAPER] });
	port.post({ kind: 'ok' }, FRAMESCAPER);
	assert.equal(peer.posted.length, 1);
	assert.throws(() => port.post({ kind: 'no' }, 'https://evil.example'), TransferWindowError);
	assert.throws(() => port.post({ kind: 'no' }, '*'), TransferWindowError);
	peer.closed = true;
	assert.throws(() => port.post({ kind: 'no' }, FRAMESCAPER), /peer window was closed/u);
	assert.equal(peer.posted.length, 1);
	assert.throws(
		() => createWindowTransferPort({ peer, listener, allowedOrigins: [] }),
		/between one and eight allowed origins/u,
	);
});

test('a blocked popup and a severed opener are named, not swallowed', () => {
	assert.throws(
		() => openTransferPopup({ scope: { open: () => null }, url: `${FRAMESCAPER}/transfer/receive/` }),
		(error: unknown) => {
			assert.ok(error instanceof TransferWindowError);
			assert.equal(error.code, 'popup-blocked');
			assert.match(error.message, /download/u);
			return true;
		},
	);
	assert.throws(
		() => resolveTransferOpener({ opener: null }),
		(error: unknown) => {
			assert.ok(error instanceof TransferWindowError);
			assert.equal(error.code, 'no-opener');
			return true;
		},
	);
	assert.throws(
		() => openTransferPopup({ scope: { open: () => null }, url: '/transfer/receive/' }),
		/absolute http\(s\) URL/u,
	);
});

test('collecting archives reports partial success and never touches the store', async () => {
	const store = new FakeStore([
		{ id: 'p1', title: 'Field recording' },
		{ id: 'p2', title: 'Broken' },
		{ id: 'p3', title: 'Interview' },
	]);
	const archive = createFakeArchive({
		failExport: (project) => (project.id === 'p2' ? new Error('the archive could not be written') : null),
	});
	const progress: string[] = [];
	const collection = await collectTransferArchives({
		runtime: runtimeFor(archive),
		store,
		onProgress: (event) => progress.push(`${event.completed}/${event.total}`),
	});
	assert.deepEqual(collection.entries.map((entry) => entry.title), ['Field recording', 'Interview']);
	assert.deepEqual(collection.entries.map((entry) => entry.fileName), [
		'Field recording.scape',
		'Interview.scape',
	]);
	assert.equal(collection.total, 3);
	assert.deepEqual(collection.failures.map(({ projectId }) => projectId), ['p2']);
	assert.match(collection.failures[0].reason, /could not be written/u);
	assert.ok(progress.length > 0);
	assert.deepEqual(store.deletions, []);
	assert.equal(store.projects.size, 3);

	// `skipped` is zero on purpose: a project the *export* refused never reached
	// the other origin to be declined, so it is a failure, not a skip. The two
	// counts are separate fields because conflating them is how a project that
	// nobody has a copy of gets reported as merely set aside.
	const report = describeTransferSend({
		sessionId: 's', total: 3, stored: 2, skipped: 0, failed: 1, outcomes: [],
		exportFailures: collection.failures,
		// The handshake itself ran to the end; the losses were all on this side.
		completed: true, stopped: null, unanswered: [], unsent: [],
		// Nothing crossed, so there is no acknowledged archive to name: the rows
		// here are export failures, which carry their own title already.
		titles: new Map(),
	});
	assert.match(report.summary, /Sent 2 of 3 projects; 1 did not cross/u);
	assert.equal(report.complete, false);
	assert.deepEqual(report.rows.map(({ outcome }) => outcome), ['failed']);
});

test('downloading saves every archive and records the ones the browser refused', async () => {
	const store = new FakeStore([{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }]);
	const archive = createFakeArchive();
	const collection = await collectTransferArchives({ runtime: runtimeFor(archive), store });
	const saved: string[] = [];
	const report = await downloadTransferArchives({
		collection,
		save: (entry) => {
			if (entry.projectId === 'p2') throw new Error('the download was blocked');
			saved.push(entry.fileName);
		},
	});
	assert.deepEqual(saved, ['One.scape']);
	assert.equal(report.saved, 1);
	assert.equal(report.failed, 1);
	assert.deepEqual(report.records.map(({ outcome }) => outcome), ['saved', 'failed']);
	assert.match(report.records[1].reason ?? '', /blocked/u);
	// The download path is a read: the sending origin keeps everything.
	assert.deepEqual(store.deletions, []);
	assert.equal(store.projects.size, 2);

	const described = describeTransferDownload(report, collection.failures);
	assert.match(described.summary, /Nothing on this origin was changed/u);
	assert.equal(described.complete, false);
	assert.match(described.rows[0].detail, /One\.scape/u);
});

test('projects cross the handshake and the sending origin keeps them all', async () => {
	const sendingStore = new FakeStore([
		{ id: 'p1', title: 'Field recording' },
		{ id: 'p2', title: 'Interview' },
	]);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent, received] = await Promise.all([
		sendTransferArchives({
			runtime,
			collection,
			port: senderPort,
			targetOrigin: FRAMESCAPER,
			allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime,
			store: receivingStore,
			port: receiverPort,
			sessionId: 'session-1',
			targetOrigin: SOUNDSCAPER,
			allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);

	assert.equal(sent.stored, 2);
	assert.equal(sent.failed, 0);
	assert.equal(sent.total, 2);
	assert.deepEqual(sent.outcomes.map(({ status }) => status), ['stored', 'stored']);
	assert.deepEqual([...receivingStore.projects.keys()].sort(), ['p1', 'p2']);
	assert.deepEqual(received.records.map(({ outcome }) => outcome), ['imported', 'imported']);
	// Nothing left the sending origin.
	assert.deepEqual(sendingStore.deletions, []);
	assert.deepEqual([...sendingStore.projects.keys()].sort(), ['p1', 'p2']);
	assert.equal(describeTransferSend(sent).complete, true);
	assert.match(describeTransferSend(sent).summary, /nothing was removed/u);
});

test('a duplicate is acknowledged as present while the record stays honest', async () => {
	const sendingStore = new FakeStore([{ id: 'p1', title: 'Field recording' }]);
	const receivingStore = new FakeStore([{ id: 'p1', title: 'Field recording' }]);
	const runtime = runtimeFor(createFakeArchive());
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent, received] = await Promise.all([
		sendTransferArchives({
			runtime, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-2',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);
	assert.deepEqual(sent.outcomes.map(({ status }) => status), ['stored']);
	assert.deepEqual(received.records.map(({ outcome }) => outcome), ['skipped']);
	assert.match(received.records[0].reason ?? '', /.+/u);
	assert.equal(receivingStore.projects.size, 1);
});

test('an archive the receiving origin rejects fails alone and says why', async () => {
	const sendingStore = new FakeStore([
		{ id: 'p1', title: 'Good' },
		{ id: 'p2', title: 'Rejected' },
		{ id: 'p3', title: 'Also good' },
	]);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive({
		failImport: (document) => (document.id === 'p2' ? new Error('the project document is unreadable') : null),
	}));
	const collection = await collectTransferArchives({ runtime, store: sendingStore });
	const { senderPort, receiverPort } = linkedWindowPorts();

	const [sent, received] = await Promise.all([
		sendTransferArchives({
			runtime, collection, port: senderPort,
			targetOrigin: FRAMESCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
		receiveTransferArchives({
			runtime, store: receivingStore, port: receiverPort, sessionId: 'session-3',
			targetOrigin: SOUNDSCAPER, allowedOrigins: [SOUNDSCAPER, FRAMESCAPER],
		}),
	]);
	assert.deepEqual(sent.outcomes.map(({ status }) => status), ['stored', 'failed', 'stored']);
	assert.match(sent.outcomes[1].reason, /unreadable/u);
	assert.equal(sent.stored, 2);
	assert.equal(sent.failed, 1);
	assert.deepEqual([...receivingStore.projects.keys()].sort(), ['p1', 'p3']);
	assert.deepEqual(sendingStore.deletions, []);
	assert.equal(sendingStore.projects.size, 3);
	assert.deepEqual(received.records.map(({ outcome }) => outcome), ['imported', 'failed', 'imported']);
	assert.match(received.records[1].reason ?? '', /unreadable/u);
	// One entry failing is not the protocol failing: this run completed, so the
	// receiver holds the protocol's own report rather than a stop.
	assert.equal(received.completed, true);
	assert.equal(received.stopped, null);
	assert.equal(received.report?.failedCount, 1);
	const described = describeTransferSend(sent);
	assert.equal(described.complete, false);
	assert.match(described.summary, /download the archives/u);
});

test('the manual fallback imports downloaded archives file by file', async () => {
	const store = new FakeStore([{ id: 'p1', title: 'Already here' }]);
	const runtime = runtimeFor(createFakeArchive());
	const reads: string[] = [];
	const first = archiveBytes({ id: 'p1', title: 'Already here' });
	const second = archiveBytes({ id: 'p2', title: 'New one' });
	const result = await importTransferArchiveFiles({
		runtime,
		store,
		files: [
			{ name: 'Already here.scape', byteLength: first.byteLength, read: async () => { reads.push('p1'); return first; } },
			{ name: 'New one.scape', byteLength: second.byteLength, read: async () => { reads.push('p2'); return second; } },
		],
	});
	assert.deepEqual(reads, ['p1', 'p2']);
	assert.equal(result.total, 2);
	assert.equal(result.imported, 1);
	assert.equal(result.skipped, 1);
	assert.deepEqual([...store.projects.keys()].sort(), ['p1', 'p2']);
	const described = describeTransferImport(result);
	assert.deepEqual(described.rows.map(({ outcome }) => outcome), ['skipped', 'ok']);
	assert.match(described.summary, /Imported 1 of 2 archives, skipped 1\./u);
});

test('a half-built runtime is refused before any project is read', async () => {
	const store = new FakeStore([{ id: 'p1', title: 'One' }]);
	const archive = createFakeArchive();
	const partial = { ...runtimeFor(archive), sendTransfer: undefined } as unknown as TransferRuntime;
	await assert.rejects(
		collectTransferArchives({ runtime: partial, store }),
		/missing sendTransfer\(\)/u,
	);
	await assert.rejects(
		collectTransferArchives({ runtime: null as unknown as TransferRuntime, store }),
		/missing exportProject\(\)/u,
	);
	assert.deepEqual(archive.exportCalls, []);
});

test('the page bound mirrors the protocol bound, and titles come off file names', () => {
	assert.equal(TRANSFER_MAX_ARCHIVE_BYTES, PROJECT_TRANSFER_MAX_ENTRY_BYTES);
	assert.equal(transferArchiveTitle('Field recording.scape'), 'Field recording');
	assert.equal(transferArchiveTitle('Field recording.SCAPE'), 'Field recording');
	assert.equal(transferArchiveTitle('no-extension'), 'no-extension');
	assert.equal(transferArchiveTitle('  '), 'Untitled project');
	assert.equal(transferArchiveTitle(undefined), 'Untitled project');
	assert.equal(formatTransferBytes(512), '512 B');
	assert.equal(formatTransferBytes(1536), '1.5 KiB');
	assert.equal(formatTransferBytes(-1), '0 B');
});

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
	readonly posted: unknown[] = [];
	closed = false;
	peer: FakeWindow | null = null;

	constructor(readonly origin: string) {}

	postMessage(data: unknown, _targetOrigin: string): void {
		this.posted.push(data);
		const from = this.peer;
		if (!from) return;
		const cloned = structuredClone(data);
		queueMicrotask(() => this.dispatch({ origin: from.origin, data: cloned, source: from }));
	}

	dispatch(event: TransferMessageEventLike): void {
		for (const listener of [...this.listeners]) listener(event);
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
