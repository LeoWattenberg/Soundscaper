/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperLinkSender } from '../src/motionscaper/editor-link-sender.ts';
import { openMotionLinkSenderConnection } from '../src/common/editor/controller/composition/motion-link-connection.ts';
import { openMotionLinkSendBridge, readMotionLinkSendBridgeIntent, readMotionLinkReceiveBridgeIntent } from '../src/common/editor/controller/composition/motion-link-window-bridge.ts';
import { createMotionLinkConnectionUrl } from '../src/common/editor/motion-link-connection-urls.ts';
import { assertMotionLinkLocale, motionLinkLocaleForEditor } from '../src/common/editor/motion-link-locale.ts';
import { TRANSLATION_CATALOG_LOCALES } from '../src/common/i18n/translations/index.js';

const origins = { senderOrigin: 'https://motionscaper.org', receiverOrigin: 'https://framescaper.org' };
const cap = '12'.repeat(32), sessionId = '34'.repeat(32);
const receiver = createMotionLinkConnectionUrl(origins.receiverOrigin, cap);
const sendHash = (locale: string) => `#${new URLSearchParams({ cap, session: sessionId, receiver, locale })}`;
const receiveHash = (locale: string) => `#${new URLSearchParams({ cap, session: sessionId, sender: origins.senderOrigin, locale })}`;

test('M10 French locale survives the real saved-editor sender and authenticated bridge URL', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	let id = 0, openedUrl = '';
	const session = new MotionscaperDocumentSession(store, () => `locale-${++id}`);
	await session.create({ title: 'French bridge', width: 2, height: 2, frameRate: { num: 30, den: 1 }, durationFrames: 2 });
	const sender = createMotionscaperLinkSender({ session, store, ...origins, locale: 'fr',
		openConnection: options => openMotionLinkSenderConnection({ ...options, openWindow(url) { openedUrl = url; return null; } }),
	});
	try {
		await sender.connect(receiver, session.getSnapshot().project!.primaryCompositionId);
		assert.match(sender.getSnapshot().error ?? '', /blocked/u);
		const url = new URL(openedUrl);
		assert.equal(url.origin, origins.senderOrigin);
		assert.equal(url.pathname, '/composition-link/send/');
		assert.equal(readMotionLinkSendBridgeIntent(url.hash, origins.receiverOrigin).locale, 'fr');
	} finally { await sender.dispose(); await store.close(); }
});

test('M10 French bridge locale reaches the actual Frame receiver URL without changing its identity fences', async () => {
	let openedUrl = '';
	const target = new EventTarget();
	const scope = Object.assign(target, { open(url: string) { openedUrl = url; return { closed: false }; } }) as unknown as Window;
	const cancellation = new AbortController(); cancellation.abort();
	await assert.rejects(openMotionLinkSendBridge(scope, origins, {
		cap, session: sessionId, receiver: new URL(receiver), locale: 'fr',
	}, cancellation.signal), { name: 'AbortError' });
	const url = new URL(openedUrl);
	assert.equal(url.origin, origins.receiverOrigin);
	assert.equal(url.pathname, '/composition-link/receive/');
	const intent = readMotionLinkReceiveBridgeIntent(url.hash, origins.senderOrigin);
	assert.deepEqual([intent.locale, intent.cap, intent.session, intent.senderOrigin], ['fr', cap, sessionId, origins.senderOrigin]);
});

test('M10 bridge retains English and German defaults and refuses unknown language or malformed authority', () => {
	for (const locale of ['en', 'de']) {
		assert.equal(readMotionLinkSendBridgeIntent(sendHash(locale), origins.receiverOrigin).locale, locale);
		assert.equal(readMotionLinkReceiveBridgeIntent(receiveHash(locale), origins.senderOrigin).locale, locale);
	}
	for (const locale of ['zz', '../fr', 'fr&cap=bad', 'fr-FR-uncommitted']) {
		assert.throws(() => readMotionLinkSendBridgeIntent(sendHash(locale), origins.receiverOrigin));
		assert.throws(() => readMotionLinkReceiveBridgeIntent(receiveHash(locale), origins.senderOrigin));
	}
	for (const hash of [sendHash('en').replace(cap, 'bad'), `${sendHash('en')}&session=${sessionId}`,
		sendHash('en').replace('https%3A%2F%2Fframescaper.org', 'https%3A%2F%2Fattacker.invalid')]) {
		assert.throws(() => readMotionLinkSendBridgeIntent(hash, origins.receiverOrigin));
	}
	assert.throws(() => readMotionLinkReceiveBridgeIntent(receiveHash('en'), 'https://attacker.invalid'));
});

test('M10 bridge preserves every committed full locale tag and editor selection normalization', () => {
	for (const locale of TRANSLATION_CATALOG_LOCALES) {
		assert.equal(motionLinkLocaleForEditor(locale), locale);
		assert.equal(readMotionLinkSendBridgeIntent(sendHash(locale), origins.receiverOrigin).locale, locale);
		assert.equal(readMotionLinkReceiveBridgeIntent(receiveHash(locale), origins.senderOrigin).locale, locale);
	}
	assert.equal(motionLinkLocaleForEditor('pt_br'), 'pt-BR');
	assert.equal(motionLinkLocaleForEditor('de-CH'), 'de');
	assert.equal(motionLinkLocaleForEditor('zz-ZZ'), 'en');
	for (const value of [undefined, null, {}, 'FR', 'fr-FR', 'a'.repeat(65)]) assert.throws(() => assertMotionLinkLocale(value));
});

test('M10 French bridge retains the exact window, origin and session handshake fences', async () => {
	const peer = { closed: false } as Window;
	const scope = Object.assign(new EventTarget(), { open: () => peer }) as unknown as Window;
	const opened = openMotionLinkSendBridge(scope, origins, { cap, session: sessionId, receiver: new URL(receiver), locale: 'fr' });
	let settled = false; const observed = opened.finally(() => { settled = true; }); void observed.catch(() => undefined);
	function message(origin: string, source: Window, session: string) {
		const event = new MessageEvent('message', { origin, data: { protocol: 'motion-link-window', version: 1, type: 'ready', session } });
		Object.defineProperty(event, 'source', { value: source }); scope.dispatchEvent(event);
	}
	message('https://attacker.invalid', peer, sessionId);
	message(origins.receiverOrigin, {} as Window, sessionId);
	await Promise.resolve(); assert.equal(settled, false, 'Foreign windows and origins cannot complete or cancel this handshake.');
	message(origins.receiverOrigin, peer, '56'.repeat(32));
	await assert.rejects(observed, /identity or protocol changed/u);
});
