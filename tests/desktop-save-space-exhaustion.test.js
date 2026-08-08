/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const OWNER = Object.freeze({ name: 'space-owner' });

test('a chunk write that runs out of space discards the staged file with a typed refusal', async () => {
	const fixture = createFixture({
		writeImpl: () => { throw spaceError('ENOSPC'); },
	});
	const session = await fixture.manager.begin({ owner: OWNER, targetId: fixture.target.id, size: 4 });

	await assert.rejects(
		fixture.manager.writeChunk({ owner: OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(4) }),
		(error) => /ran out of space.*staged file was discarded/iu.test(error.message)
			&& error.cause?.code === 'ENOSPC',
	);

	assert.deepEqual(fixture.closed, ['handle'], 'the temporary handle closes during cleanup');
	assert.deepEqual(fixture.unlinked.length, 1, 'the staged temporary file is removed');
	assert.match(fixture.unlinked[0], /\.soundscaper-part$/u);
	assert.deepEqual(fixture.renamed, [], 'the committed target is never replaced');
	await assert.rejects(
		fixture.manager.writeChunk({ owner: OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(1) }),
		/unknown save session/iu,
	);
	await assert.rejects(
		fixture.manager.finish(session.writeId, { owner: OWNER }),
		/unknown save session/iu,
	);
	const replacement = fixture.registerTarget('/tmp/space-replacement.scape');
	const retry = await fixture.manager.begin({ owner: OWNER, targetId: replacement.id, size: 1 });
	assert.ok(retry.writeId, 'released capacity admits a fresh session after the refusal');
	await fixture.manager.abort(retry.writeId, { owner: OWNER });
	await fixture.dispose();
});

test('a final-prefix patch that runs out of space discards the staged file with a typed refusal', async () => {
	let prefixAttempts = 0;
	const fixture = createFixture({
		writeImpl: (length, position) => {
			if (position === 0 && prefixAttempts > 0) throw spaceError('EDQUOT');
			return { bytesWritten: length };
		},
	});
	const session = await fixture.manager.begin({
		owner: OWNER, targetId: fixture.target.id, size: 32, finalPrefixByteLength: 32,
	});
	await fixture.manager.writeChunk({
		owner: OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(32),
	});
	prefixAttempts = 1;

	await assert.rejects(
		fixture.manager.patchFinalPrefix({ owner: OWNER, writeId: session.writeId, bytes: new Uint8Array(32) }),
		(error) => /ran out of space.*staged file was discarded/iu.test(error.message)
			&& error.cause?.code === 'EDQUOT',
	);

	assert.equal(fixture.unlinked.length, 1);
	assert.deepEqual(fixture.renamed, []);
	await assert.rejects(
		fixture.manager.finish(session.writeId, { owner: OWNER }),
		/unknown save session/iu,
	);
	await fixture.dispose();
});

test('a commit sync that runs out of space cleans staging and names the exhausted destination', async () => {
	const fixture = createFixture({
		syncImpl: () => { throw spaceError('ENOSPC'); },
	});
	const session = await fixture.manager.begin({ owner: OWNER, targetId: fixture.target.id, size: 2 });
	await fixture.manager.writeChunk({
		owner: OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(2),
	});

	await assert.rejects(
		fixture.manager.finish(session.writeId, { owner: OWNER }),
		(error) => /could not commit the saved file: the destination ran out of space/iu.test(error.message)
			&& error.cause?.code === 'ENOSPC',
	);

	assert.equal(fixture.unlinked.length, 1);
	assert.deepEqual(fixture.renamed, [], 'the previous committed file survives the failed commit');
	await fixture.dispose();
});

test('an unrelated write failure keeps the session open for retry or abort', async () => {
	let failures = 0;
	const fixture = createFixture({
		writeImpl: (length) => {
			if (failures === 0) {
				failures = 1;
				throw new Error('transient device hiccup');
			}
			return { bytesWritten: length };
		},
	});
	const session = await fixture.manager.begin({ owner: OWNER, targetId: fixture.target.id, size: 2 });

	await assert.rejects(
		fixture.manager.writeChunk({ owner: OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(2) }),
		/transient device hiccup/u,
	);

	assert.deepEqual(fixture.unlinked, [], 'a non-space failure does not discard the staged file');
	const written = await fixture.manager.writeChunk({
		owner: OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(2),
	});
	assert.equal(written.nextOffset, 2);
	const finished = await fixture.manager.finish(session.writeId, { owner: OWNER });
	assert.equal(finished.byteLength, 2);
	await fixture.dispose();
});

function createFixture({ writeImpl, syncImpl } = {}) {
	const closed = [];
	const unlinked = [];
	const renamed = [];
	const targets = new SaveTargetStore();
	const registerTarget = (path) => targets.registerPath(path, { owner: OWNER, purpose: 'project' });
	const target = registerTarget('/tmp/space-target.scape');
	const manager = new AtomicSaveManager({
		targets,
		statfsImpl: async () => ({ bavail: 1024n, bsize: 1024n }),
		openImpl: async () => ({
			async close() { closed.push('handle'); },
			async sync() {
				if (syncImpl) return syncImpl();
				return undefined;
			},
			async write(_buffer, _offset, length, position) {
				if (writeImpl) return writeImpl(length, position);
				return { bytesWritten: length };
			},
		}),
		renameImpl: async (from, to) => { renamed.push([from, to]); },
		unlinkImpl: async (path) => { unlinked.push(path); },
	});
	return {
		closed,
		manager,
		registerTarget,
		renamed,
		target,
		targets,
		unlinked,
		async dispose() {
			await manager.dispose?.();
			targets.dispose();
		},
	};
}

function spaceError(code) {
	const error = new Error(`fault injection: ${code}`);
	error.code = code;
	return error;
}
