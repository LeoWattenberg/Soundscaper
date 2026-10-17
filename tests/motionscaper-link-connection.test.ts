/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionLinkConnectionUrl, readMotionLinkConnectionUrl, resolveMotionLinkOrigins } from '../src/common/editor/motion-link-connection-urls.ts';
import { connectMotionLinkBroadcast, listenMotionLinkBroadcast } from '../src/common/editor/controller/composition/internal/motion-link-broadcast.ts';

const origin = 'https://framescaper.org'; const cap = '12'.repeat(32); const session = '34'.repeat(32);
test('M10 pairing URLs accept only the exact configured receiver route and one ephemeral capability', () => {
	const url = createMotionLinkConnectionUrl(origin, cap); assert.equal(readMotionLinkConnectionUrl(url, origin).href, url);
	assert.deepEqual(resolveMotionLinkOrigins('motionscaper', 'https://motionscaper.org'), { senderOrigin: 'https://motionscaper.org', receiverOrigin: origin });
	for (const value of [url.replace(origin, 'https://attacker.invalid'), `${url}&cap=${cap}`, url.replace('/receive/', '/send/'), url.replace('#', '?project=secret#'), `${url}&project=secret`]) assert.throws(() => readMotionLinkConnectionUrl(value, origin));
});

test('M10 nonce broadcast rendezvous carries a bounded port request across isolated-agent boundaries', async () => {
	const listener = listenMotionLinkBroadcast({ cap, peerOrigin: origin, session });
	const connecting = connectMotionLinkBroadcast({ cap, peerOrigin: origin, session });
	const [editor, bridge] = await Promise.all([listener.connection, connecting]);
	const request = { protocol: 'motion-link-port', version: 1, session, type: 'request', id: 1, request: { kind: 'offer-chunk', offset: 0, bytes: new Uint8Array([1, 2, 3]).buffer } };
	const got = new Promise<MessageEvent<unknown>>((resolve) => { bridge.port.addEventListener('message', resolve, { once: true }); bridge.port.start(); });
	editor.port.postMessage(request, [request.request.bytes]);
	assert.deepEqual((await got).data, { ...request, request: { ...request.request, bytes: new Uint8Array([1, 2, 3]).buffer } });
	editor.dispose(); bridge.dispose(); listener.dispose();
});

test('M10 broadcast rendezvous refuses a wrong peer origin and cancellation closes a pending session', async () => {
	const listener = listenMotionLinkBroadcast({ cap, peerOrigin: origin, session });
	const connected = connectMotionLinkBroadcast({ cap, peerOrigin: 'https://attacker.invalid', session, timeoutMs: 30 });
	const results = await Promise.allSettled([listener.connection, connected]); assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'rejected'); listener.dispose();
	const signal = new AbortController(); const pending = listenMotionLinkBroadcast({ cap, peerOrigin: origin, signal: signal.signal }); signal.abort(); await assert.rejects(pending.connection, { name: 'AbortError' }); pending.dispose();
});
