/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two things the sending document does with the window it is running in:
 * it opens a popup and starts listening to it, and it hands the browser files
 * to save.
 *
 * Both are ordering properties rather than reporting ones, and neither is
 * observable from the transport modules alone - they are about *when* the page
 * does something relative to its own awaits. So these tests drive the real page
 * module against a fake window pair and a fake DOM, and watch the order.
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
	sendTransferArchives,
	streamTransferArchives,
	type TransferRuntime,
} from '../src/common/transfer/transfer-session.ts';
import { createWindowTransferPort } from '../src/common/transfer/transfer-window-port.ts';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import { createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import {
	boundedClock,
	deferred,
	FakeWindow,
	settle,
	withUnreferencedTimers,
} from './project-transfer-page-fixture.ts';

const SOUNDSCAPER = 'https://soundscaper.org';
const FRAMESCAPER = 'https://framescaper.org';
const CONFIGURATION = Object.freeze({
	selfOrigin: SOUNDSCAPER,
	peerOrigin: FRAMESCAPER,
	allowedOrigins: Object.freeze([SOUNDSCAPER, FRAMESCAPER]),
	loopback: false,
});

/* ------------------------------------------------------------------ */
/* The popup answers while the page is still loading its own machinery. */
/* ------------------------------------------------------------------ */

test('a ready that lands while the sender is still loading is not dropped', async () => {
	await withUnreferencedTimers(async () => {
		const sender = new FakeWindow(SOUNDSCAPER);
		const popup = new FakeWindow(FRAMESCAPER);
		sender.peer = popup;
		popup.peer = sender;
		sender.opens = () => popup;

		const sendingStore = new FakeStore([
			{ id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1 },
		] as never);
		const receivingStore = new FakeStore();
		const runtime = runtimeFor(createFakeArchive());
		// The archive runtime arrives when this resolves, and not before. It is
		// the first of the two unbounded awaits between opening the popup and
		// the transport subscribing to the port.
		const arrival = deferred<TransferRuntime>();

		await mountTransferPage({
			scope: sender as never,
			role: 'send',
			configuration: CONFIGURATION as never,
			dependencies: {
				loadRuntime: () => arrival.promise,
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
		// The popup is opened inside this click, synchronously.
		await sender.document.clickButton(/^Yes, send/u);
		await settle();
		assert.equal(sender.opened, 1, 'the confirmation opens the popup before it awaits anything');

		// The receiving origin mounts and announces itself *now* - while the
		// sender is still waiting for its archive runtime. A port nobody has
		// subscribed to drops this, and the transfer then hangs until the
		// acknowledgement timeout minutes later.
		const receiving = receiveTransferArchives({
			runtime,
			store: receivingStore,
			port: createWindowTransferPort({
				peer: sender, listener: popup, allowedOrigins: [...CONFIGURATION.allowedOrigins],
				expectedSource: sender,
			}),
			sessionId: 'session-race',
			targetOrigin: SOUNDSCAPER,
			allowedOrigins: [...CONFIGURATION.allowedOrigins],
			clock: boundedClock(),
		});
		await settle();

		arrival.resolve(runtime);
		const received = await receiving;
		await settle();

		assert.equal(
			received.completed,
			true,
			'the receiving origin has to see the offer at all; a dropped `ready` leaves it waiting',
		);
		assert.deepEqual(received.records.map(({ outcome }) => outcome), ['imported']);
		assert.deepEqual([...receivingStore.projects.keys()], ['video-1']);
		assert.match(
			sender.document.summaryText(),
			/Sent 1 of 1 projects/u,
			`the sending page must report the transfer it actually made; saw ${sender.document.summaryText()}`,
		);
		assert.deepEqual(sendingStore.deletions, [], 'and the sending origin still loses nothing');
	});
});

test('one sender confirmation owns the popup until its run settles and always releases its port', async () => {
	const sender = new FakeWindow(SOUNDSCAPER);
	const popup = new FakeWindow(FRAMESCAPER);
	sender.peer = popup;
	popup.peer = sender;
	sender.opens = () => popup;
	const store = new FakeStore([
		{ id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1 },
	] as never);
	let rejectRuntime!: (error: Error) => void;
	const arrival = new Promise<TransferRuntime>((_resolve, reject) => { rejectRuntime = reject; });

	await mountTransferPage({
		scope: sender as never,
		role: 'send',
		configuration: CONFIGURATION as never,
		dependencies: {
			loadRuntime: () => arrival,
			openStore: async () => ({
				id: 'fake', label: 'Fake', store, close: async () => undefined,
			}) as never,
		},
	});
	await settle();
	await sender.document.clickButton('Find my projects');
	await settle();

	await sender.document.clickButton(/^Send /u);
	await settle();
	await sender.document.clickButton(/^Send /u);
	await settle();
	assert.match(sender.document.statusText(), /already.*confirmation|already.*progress/iu);
	assert.equal(confirmationButtons(sender, /^Yes, send/u).length, 1);
	await sender.document.clickButton('Cancel');
	await settle();

	await sender.document.clickButton(/^Send /u);
	await settle();
	await sender.document.clickButton(/^Yes, send/u);
	await settle();
	assert.equal(sender.opened, 1);
	assert.equal(sender.listeners.size, 1);
	const receivingRuntime = runtimeFor(createFakeArchive());
	const receiving = receiveTransferArchives({
		runtime: receivingRuntime,
		store: new FakeStore(),
		port: createWindowTransferPort({
			peer: sender,
			listener: popup,
			allowedOrigins: [...CONFIGURATION.allowedOrigins],
			expectedSource: sender,
		}),
		sessionId: 'sender-runtime-failure',
		targetOrigin: SOUNDSCAPER,
		allowedOrigins: [...CONFIGURATION.allowedOrigins],
		clock: {
			setTimeout: () => Object.freeze({}),
			clearTimeout: () => undefined,
		},
	});
	await settle();
	await sender.document.clickButton(/^Send /u);
	await settle();
	assert.match(sender.document.statusText(), /already.*confirmation|already.*progress/iu);
	assert.equal(
		confirmationButtons(sender, /^Yes, send/u).filter(({ disabled }) => !disabled).length,
		0,
		'a running handshake must not install a second enabled confirmation',
	);
	assert.equal(sender.opened, 1);

	rejectRuntime(new Error('runtime unavailable'));
	await settle();
	await settle();
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const received = await Promise.race([
		receiving,
		new Promise<never>((_resolve, reject) => {
			deadline = setTimeout(
				() => reject(new Error('The receiver was left waiting after sender setup failed.')),
				100,
			);
		}),
	]);
	clearTimeout(deadline);
	assert.equal(received.stopped?.code, 'PEER_ABORTED');
	assert.match(received.stopped?.reason ?? '', /runtime unavailable/iu);
	assert.equal(sender.listeners.size, 0, 'runtime setup failure must detach the sender listener');
	assert.equal(
		sender.document.body.querySelector('[data-transfer-choice]')?.disabled,
		false,
		'runtime setup failure must restore the source selection',
	);
	await sender.document.clickButton(/^Send /u);
	await settle();
	assert.equal(confirmationButtons(sender, /^Yes, send/u).length, 1, 'the failed run releases single-flight');
});

/* ------------------------------------------------------------------ */
/* The receiving page reports what its own transfer actually did.      */
/* ------------------------------------------------------------------ */

test('the receiving page reports a finished handshake as finished', async () => {
	const opener = new FakeWindow(SOUNDSCAPER);
	const receiver = new FakeWindow(FRAMESCAPER);
	receiver.location.pathname = '/transfer/receive/';
	opener.peer = receiver;
	receiver.peer = opener;
	receiver.opener = opener;

	const sendingStore = new FakeStore([{
		id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1,
	}] as never);
	const receivingStore = new FakeStore();
	const runtime = runtimeFor(createFakeArchive());

	// The sending side goes first, exactly as it does in a browser: it is the
	// window that opens the other one, and it is listening before the receiving
	// document exists to announce itself.
	const sending = sendTransferArchives({
		runtime,
		archives: streamTransferArchives({ runtime, store: sendingStore }),
		port: createWindowTransferPort({
			peer: receiver, listener: opener, allowedOrigins: [...CONFIGURATION.allowedOrigins],
			expectedSource: receiver,
		}),
		targetOrigin: FRAMESCAPER,
		allowedOrigins: [...CONFIGURATION.allowedOrigins],
	});

	// Not awaited: mounting the receiving page *is* accepting the transfer, so
	// this promise only settles once the handshake is over.
	const mounted = mountTransferPage({
		scope: receiver as never,
		role: 'receive',
		configuration: { ...CONFIGURATION, selfOrigin: FRAMESCAPER, peerOrigin: SOUNDSCAPER } as never,
		dependencies: {
			loadRuntime: async () => runtime,
			openStore: async () => ({
				id: 'fake', label: 'Fake', store: receivingStore, close: async () => undefined,
			}) as never,
		},
	});
	const sent = await sending;
	await mounted;
	await settle();

	assert.equal(sent.stored, 1);
	assert.deepEqual([...receivingStore.projects.keys()], ['video-1']);
	assert.equal(
		receiver.document.completeFlag(),
		'true',
		`a transfer that finished must not be reported as incomplete; summary was ${receiver.document.summaryText()}`,
	);
	assert.match(receiver.document.summaryText(), /Imported 1 of 1 archive\./u);
	assert.doesNotMatch(receiver.document.summaryText(), /stopped/iu);
});

test('receiver setup failure detaches the opener listener before reporting the stop', async () => {
	const opener = new FakeWindow(SOUNDSCAPER);
	const receiver = new FakeWindow(FRAMESCAPER);
	receiver.location.pathname = '/transfer/receive/';
	opener.peer = receiver;
	receiver.peer = opener;
	receiver.opener = opener;

	await mountTransferPage({
		scope: receiver as never,
		role: 'receive',
		configuration: { ...CONFIGURATION, selfOrigin: FRAMESCAPER, peerOrigin: SOUNDSCAPER } as never,
		dependencies: {
			loadRuntime: async () => { throw new Error('receiver runtime unavailable'); },
			openStore: async () => assert.fail('a failed runtime load must not open destination storage'),
		},
	});

	assert.equal(receiver.listeners.size, 0);
	assert.match(receiver.document.statusText(), /receiver runtime unavailable/iu);
});

/* ------------------------------------------------------------------ */
/* The download transport holds one archive, not a library of them.    */
/* ------------------------------------------------------------------ */

test('the download path holds exactly one archive at a time', async () => {
	const scope = new FakeWindow(SOUNDSCAPER);
	const store = new FakeStore([
		{ id: 'video-1', title: 'One', schemaFamily: 'framescaper', schemaVersion: 1 },
		{ id: 'video-2', title: 'Two', schemaFamily: 'framescaper', schemaVersion: 1 },
		{ id: 'video-3', title: 'Three', schemaFamily: 'framescaper', schemaVersion: 1 },
	] as never);

	await mountTransferPage({
		scope: scope as never,
		role: 'send',
		configuration: CONFIGURATION as never,
		dependencies: {
			loadRuntime: async () => runtimeFor(createFakeArchive()),
			openStore: async () => ({
				id: 'fake', label: 'Fake', store, close: async () => undefined,
			}) as never,
		},
	});
	await settle();

	await scope.document.clickButton('Find my projects');
	await settle();
	await scope.document.clickButton('Download the ticked archives');
	await settle();
	await settle();

	assert.deepEqual(scope.saved, ['One.scape', 'Two.scape', 'Three.scape']);
	// Only the zero-delay browser-consumption handoff tasks have fired; the
	// 60-second final-group backstop has not.
	assert.equal(
		scope.blobs.peak,
		1,
		`an object URL is a strong reference to its blob, so ${scope.blobs.peak} live URLs is`
		+ ' a whole library resident at once - exactly what the streaming export exists to prevent',
	);
	assert.equal(scope.blobs.revoked.length, 2, 'each archive is released as the next one is created');
	assert.equal(scope.blobs.live, 1, 'only the last archive waits out the revoke backstop');
});

/* ------------------------------------------------------------------ */

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

function confirmationButtons(scope: FakeWindow, label: RegExp) {
	return scope.document.body.querySelectorAll('button').filter((button) => label.test(button.textContent));
}
