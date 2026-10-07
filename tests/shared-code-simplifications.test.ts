/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isProjectFileName } from '../src/common/project-file-extensions.ts';
import { transferRouteForPath } from '../src/common/transfer/transfer-routes.js';
import { bufferTransferPort } from '../src/common/transfer/transfer-send-watch.ts';
import { encodeTransferRefusal, decodeTransferRefusal } from '../src/common/transfer/transfer-refusal.ts';
import type { ProjectTransferInboundMessage } from '../src/common/transfer/project-transfer-handshake.ts';

test('project suffix recognition examines only the final path segment', () => {
	for (const path of ['mix.sscape', '/mix.sscape', '\\mix.sscape', 'takes.scape/mix.sscape', 'takes.scape\\mix.sscape']) {
		assert.equal(isProjectFileName(path), true, path);
	}
	for (const path of ['takes.sscape/', 'takes.sscape\\', 'takes.sscape/mix', 'takes.sscape\\mix', '']) {
		assert.equal(isProjectFileName(path), false, path);
	}
});

test('transfer routes accept only exact paths with an optional final slash', () => {
	for (const role of ['send', 'receive']) {
		const path = `/transfer/${role}`;
		assert.equal(transferRouteForPath(path)?.role, role);
		assert.equal(transferRouteForPath(`${path}/`)?.role, role);
		for (const invalid of [
			`${path}//`, `${path}/.`, `${path}/..`, `${path}/?q=1`, `${path}/#x`,
			path.replace('/transfer/', '/transfer//'), path.replace('/transfer/', '/transfer/./'),
			path.replace('/transfer/', '/transfer/../transfer/'), path.replace('/transfer/', '/%74ransfer/'),
		]) assert.equal(transferRouteForPath(invalid), null, invalid);
	}
});

test('a buffered subscriber failure detaches the source and cannot be subscribed again', () => {
	let receive = (_message: ProjectTransferInboundMessage): void => { throw new Error('Source is not subscribed.'); };
	let stops = 0;
	const raw = {
		post: () => undefined,
		subscribe: (next: (message: ProjectTransferInboundMessage) => void) => {
			receive = next;
			return () => { stops += 1; };
		},
	};
	const buffered = bufferTransferPort(raw);
	receive({ origin: 'https://framescaper.org', data: 'ready' });
	const failure = new Error('subscriber failed');
	assert.throws(() => buffered.subscribe(() => { throw failure; }), (error: unknown) => error === failure);
	assert.equal(stops, 1);
	assert.throws(() => buffered.subscribe(() => undefined), /only be subscribed once/u);
});

test('transfer refusal text keeps its fallback and trims surrounding whitespace', () => {
	for (const text of [undefined, null, '', ' \t\n ']) {
		assert.equal(encodeTransferRefusal({ text }), 'no reason reported');
	}
	const encoded = encodeTransferRefusal({ skipped: true, code: 'archive-read-only', text: '  Future archive. \n' });
	assert.deepEqual(decodeTransferRefusal(encoded), {
		skipped: true, code: 'archive-read-only', text: 'Future archive.',
	});
});
