/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_PATH = resolve(ROOT, 'desktop/main.mjs');

test('desktop Scape open smoke observes each descriptor before preserving delivery outcome', async () => {
	const source = await readFile(MAIN_PATH, 'utf8');
	const deliverySource = sourceSection(
		source,
		'const pendingOpenProjects = new PendingProjectQueue',
		'const applicationShutdown = new DesktopApplicationShutdown',
	);
	const match = deliverySource.match(/send:\s*(\(descriptor\)\s*=>\s*\{[\s\S]*?\n\t\}),\n\treportError/u);
	assert.ok(match, 'pending project delivery must expose a block-bodied send callback');
	assert.match(
		match[1],
		/desktopSmokeProbe\.observeProjectDescriptor\(descriptor, \(id\) => readCapabilities\.get\(id\)\);/u,
	);
	const createSend = Function(
		'desktopSmokeProbe',
		'sendToRenderer',
		'IPC',
		'readCapabilities',
		`"use strict"; return (${match[1]});`,
	);

	for (const delivered of [false, true]) {
		const events = [];
		const descriptor = Object.freeze({ id: 'a'.repeat(64), name: 'session.scape' });
		const send = createSend({
			observeProjectDescriptor(value, readEvidence) {
				events.push(['observe', value]);
				events.push(['evidence', readEvidence(value.id)]);
			},
		}, (channel, value) => {
			events.push(['send', channel, value]);
			return delivered;
		}, { openProject: 'desktop:open-project' }, {
			get(id) {
				events.push(['get', id]);
				return { id, name: 'session.scape' };
			},
		});

		assert.equal(send(descriptor), delivered);
		assert.deepEqual(events, [
			['observe', descriptor],
			['get', descriptor.id],
			['evidence', descriptor],
			['send', 'desktop:open-project', descriptor],
		]);
	}
});

test('desktop Scape smoke receives descriptor-only read-capability evidence', async (context) => {
	const source = await readFile(MAIN_PATH, 'utf8');
	const deliverySource = sourceSection(
		source,
		'const pendingOpenProjects = new PendingProjectQueue',
		'const applicationShutdown = new DesktopApplicationShutdown',
	);
	const match = deliverySource.match(/send:\s*(\(descriptor\)\s*=>\s*\{[\s\S]*?\n\t\}),\n\treportError/u);
	assert.ok(match, 'pending project delivery must expose a block-bodied send callback');
	const createSend = Function(
		'desktopSmokeProbe',
		'sendToRenderer',
		'IPC',
		'readCapabilities',
		`"use strict"; return (${match[1]});`,
	);

	const selectedPath = '/private/read-authority/session.scape';
	const store = new ReadCapabilityStore({
		openImpl: async (filePath) => {
			assert.equal(filePath, selectedPath);
			return fakeHandle({ size: 4_096, mtimeMs: 12_345 });
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerScapeRangePath(selectedPath, { owner: {} });
	let evidence = null;
	const send = createSend({
		observeProjectDescriptor(observed, readEvidence) {
			assert.equal(observed, descriptor);
			evidence = readEvidence(observed.id);
		},
	}, () => true, { openProject: 'desktop:open-project' }, store);
	assert.equal(send(descriptor), true);

	assert.deepEqual(evidence, descriptor);
	assert.deepEqual(Object.keys(evidence).sort(), [
		'id',
		'lastModified',
		'mimeType',
		'name',
		'readProfile',
		'size',
		'url',
	]);
	assert.doesNotMatch(JSON.stringify(evidence), /private|read-authority/u);
	for (const authority of ['path', 'filePath', 'handle', 'owner', 'createReadStream', 'close', 'retire']) {
		assert.equal(authority in evidence, false, `${authority} must not escape the capability store`);
	}
});

function sourceSection(source, startMarker, endMarker) {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
	return source.slice(start, end);
}

function fakeHandle({ size, mtimeMs }) {
	return {
		async close() {},
		async stat() {
			return { isFile: () => true, mtimeMs, size };
		},
	};
}
