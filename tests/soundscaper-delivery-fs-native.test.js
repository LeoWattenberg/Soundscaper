/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_ROOT = join(ROOT, 'native/soundscaper-professional-host/src');
const MAGIC = Buffer.from('SDF1');
const REQUEST = Object.freeze({
	init: 0x01, data: 0x02, seal: 0x03, publish: 0x04, abort: 0x05, patchPrefix: 0x06,
});
const RESPONSE = Object.freeze({
	ready: 0x81, ack: 0x82, sealed: 0x83, published: 0x84, aborted: 0x85, error: 0xff,
});

let temporary;
let executable;

before(async () => {
	temporary = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-fs-native-'));
	executable = join(temporary, 'soundscaper_delivery_fs');
	if (process.platform !== 'linux') return;
	const result = spawnSync('g++', [
		'-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread',
		join(SOURCE_ROOT, 'delivery_fs_main.cpp'),
		join(SOURCE_ROOT, 'delivery_fs_protocol.cpp'),
		join(SOURCE_ROOT, 'delivery_fs_sha256.cpp'),
		join(SOURCE_ROOT, 'delivery_fs_linux.cpp'),
		'-o', executable,
	], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

after(async () => {
	if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('the target-native delivery helper source admits only handle-anchored publication primitives', async () => {
	const [cmake, protocol, linux, windows, macos, manifest] = await Promise.all([
		readFile(join(ROOT, 'native/soundscaper-professional-host/CMakeLists.txt'), 'utf8'),
		readFile(join(SOURCE_ROOT, 'delivery_fs_protocol.hpp'), 'utf8'),
		readFile(join(SOURCE_ROOT, 'delivery_fs_linux.cpp'), 'utf8'),
		readFile(join(SOURCE_ROOT, 'delivery_fs_windows.cpp'), 'utf8'),
		readFile(join(SOURCE_ROOT, 'delivery_fs_macos.mm'), 'utf8'),
		readFile(join(ROOT, 'config/soundscaper-professional-native-payload-manifest.json'), 'utf8'),
	]);
	assert.match(cmake, /add_executable\(soundscaper_delivery_fs/u);
	assert.match(cmake, /install\(TARGETS soundscaper_delivery_fs RUNTIME DESTINATION \.\)/u);
	assert.match(protocol, /SDF1/u);
	for (const opcode of ['init = 0x01', 'data = 0x02', 'seal = 0x03', 'publish = 0x04',
		'abort = 0x05', 'patch_prefix = 0x06', 'recover = 0x07', 'inspect_final = 0x08']) {
		assert.match(protocol, new RegExp(opcode, 'u'));
	}
	assert.match(linux, /O_TMPFILE/u);
	assert.match(linux, /AT_EMPTY_PATH/u);
	assert.match(linux, /\/proc\/self\/fd/u);
	assert.match(linux, /AT_SYMLINK_FOLLOW/u);
	assert.doesNotMatch(linux, /O_CREAT/u);
	assert.match(windows, /CreateFileW/u);
	assert.match(windows, /FileLinkInfo/u);
	assert.match(windows, /FileDispositionInfo/u);
	assert.doesNotMatch(windows, /CreateHardLinkW/u);
	assert.match(macos, /NSItemReplacementDirectory/u);
	const macosPublish = macos.slice(
		macos.indexOf('\tpublication_result publish() override'), macos.indexOf('\n\tvoid abort()'),
	);
	assert.match(macosPublish, /::linkat\(replacement_\.get\(\), stage_name_\.c_str\(\), root_\.get\(\),/u);
	assert.match(macosPublish, /::unlinkat\(replacement_\.get\(\), stage_name_\.c_str\(\), 0\)/u);
	assert.match(macosPublish, /st_nlink/u);
	assert.match(macosPublish, /::fsync\(replacement_\.get\(\)\)/u);
	assert.match(macosPublish, /::fsync\(root_\.get\(\)\)/u);
	assert.doesNotMatch(macos, /renameatx_np|RENAME_EXCL|copyfile/u);
	const parsed = JSON.parse(manifest);
	assert.deepEqual(parsed.deliveryFilesystem, {
		payloadName: 'soundscaper_delivery_fs', protocol: 'SDF1', license: 'AGPL-3.0-only',
	});
});

test('linux SDF1 keeps its unnamed handle through patched sealing and journal-authorized publication', {
	skip: process.platform !== 'linux',
}, async () => {
	const root = await mkdtemp(join(temporary, 'publish-'));
	const identity = await rootIdentity(root);
	const initial = Buffer.concat([Buffer.alloc(32), Buffer.from('authenticated delivery bytes')]);
	const prefix = Buffer.from('0123456789abcdef0123456789abcdef');
	const finalBytes = Buffer.concat([prefix, initial.subarray(32)]);
	const session = runHelper();
	await session.send(REQUEST.init, json({
		schemaVersion: 1, sessionId: '11'.repeat(24), rootPath: root, finalName: 'mix.wav',
		expectedRootIdentity: identity,
		limits: { maxBytes: initial.byteLength, maxChunkBytes: 1024, finalPrefixByteLength: 32 },
	}));
	assert.equal((await session.next()).opcode, RESPONSE.ready);
	await session.send(REQUEST.data, initial);
	assert.equal((await session.next()).opcode, RESPONSE.ack);
	await session.send(REQUEST.patchPrefix, prefix);
	assert.equal((await session.next()).opcode, RESPONSE.ack);
	await session.send(REQUEST.seal, json({ byteLength: finalBytes.byteLength }));
	const sealed = parseJson(await session.next(), RESPONSE.sealed);
	assert.equal(sealed.byteLength, finalBytes.byteLength);
	assert.equal(sealed.sha256, sha256(finalBytes));
	assert.deepEqual(await readdir(root), [], 'O_TMPFILE must remain unnamed before journal preparation');
	await session.send(REQUEST.publish, json({ journalId: '22'.repeat(24) }));
	const published = parseJson(await session.next(), RESPONSE.published);
	assert.equal(published.journalId, '22'.repeat(24));
	assert.equal(published.sha256, sealed.sha256);
	assert.deepEqual(published.fileIdentity, sealed.fileIdentity);
	assert.deepEqual(published.finalIdentity, sealed.fileIdentity);
	assert.deepEqual(await readFile(join(root, 'mix.wav')), finalBytes);
	assert.deepEqual(await readdir(root), ['mix.wav']);
	assert.equal(await session.exit, 0);
});

test('linux SDF1 refuses destination swaps and existing final names without a mutable staging fallback', {
	skip: process.platform !== 'linux',
}, async () => {
	const root = await mkdtemp(join(temporary, 'refusal-'));
	const identity = await rootIdentity(root);
	const invalidName = runHelper();
	await invalidName.send(REQUEST.init, json({
		schemaVersion: 1, sessionId: '22'.repeat(24), rootPath: root, finalName: 'mix\n.wav',
		expectedRootIdentity: identity,
		limits: { maxBytes: 4, maxChunkBytes: 4, finalPrefixByteLength: 0 },
	}));
	assert.equal(parseJson(await invalidName.next(), RESPONSE.error).code, 'invalid-final-name');
	assert.notEqual(await invalidName.exit, 0);

	const mismatch = runHelper();
	await mismatch.send(REQUEST.init, json({
		schemaVersion: 1, sessionId: '33'.repeat(24), rootPath: root, finalName: 'mix.wav',
		expectedRootIdentity: { ...identity, directoryIdentity: `${identity.directoryIdentity}-wrong` },
		limits: { maxBytes: 4, maxChunkBytes: 4, finalPrefixByteLength: 0 },
	}));
	assert.equal(parseJson(await mismatch.next(), RESPONSE.error).code, 'destination-identity-mismatch');
	assert.notEqual(await mismatch.exit, 0);

	await writeFile(join(root, 'mix.wav'), 'foreign', { flag: 'wx' });
	const conflict = runHelper();
	await conflict.send(REQUEST.init, json({
		schemaVersion: 1, sessionId: '44'.repeat(24), rootPath: root, finalName: 'mix.wav',
		expectedRootIdentity: identity,
		limits: { maxBytes: 4, maxChunkBytes: 4, finalPrefixByteLength: 0 },
	}));
	assert.equal((await conflict.next()).opcode, RESPONSE.ready);
	await conflict.send(REQUEST.data, Buffer.from('ours'));
	await conflict.next();
	await conflict.send(REQUEST.seal, json({ byteLength: 4 }));
	await conflict.next();
	await conflict.send(REQUEST.publish, json({ journalId: '55'.repeat(24) }));
	assert.equal(parseJson(await conflict.next(), RESPONSE.error).code, 'publication-conflict');
	assert.notEqual(await conflict.exit, 0);
	assert.equal(await readFile(join(root, 'mix.wav'), 'utf8'), 'foreign');
	assert.deepEqual(await readdir(root), ['mix.wav']);
});

test('linux SDF1 abort closes an unnamed session without leaving media behind', {
	skip: process.platform !== 'linux',
}, async () => {
	const root = await mkdtemp(join(temporary, 'abort-'));
	const session = runHelper();
	await session.send(REQUEST.init, json({
		schemaVersion: 1, sessionId: '66'.repeat(24), rootPath: root, finalName: 'mix.wav',
		expectedRootIdentity: await rootIdentity(root),
		limits: { maxBytes: 16, maxChunkBytes: 16, finalPrefixByteLength: 0 },
	}));
	await session.next();
	await session.send(REQUEST.data, Buffer.from('partial'));
	await session.next();
	await session.send(REQUEST.abort, Buffer.alloc(0));
	assert.equal((await session.next()).opcode, RESPONSE.aborted);
	assert.equal(await session.exit, 0);
	assert.deepEqual(await readdir(root), []);
});

function runHelper() {
	const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
	let buffered = Buffer.alloc(0);
	const waiting = [];
	const queued = [];
	child.stdout.on('data', (chunk) => {
		buffered = Buffer.concat([buffered, chunk]);
		for (;;) {
			if (buffered.byteLength < 16) return;
			const length = buffered.readUInt32BE(12);
			if (buffered.byteLength < 16 + length) return;
			const frame = {
				opcode: buffered[5], requestId: buffered.readUInt32BE(8),
				payload: buffered.subarray(16, 16 + length),
			};
			buffered = buffered.subarray(16 + length);
			const waiter = waiting.shift();
			if (waiter) waiter.resolve(frame);
			else queued.push(frame);
		}
	});
	const exit = new Promise((resolveExit, reject) => {
		child.once('error', reject);
		child.once('exit', (code) => resolveExit(code));
	});
	let requestId = 0;
	return {
		exit,
		send(opcode, payload) {
		requestId += 1;
		const header = Buffer.alloc(16);
		MAGIC.copy(header);
		header[4] = 1; header[5] = opcode;
		header.writeUInt32BE(requestId, 8); header.writeUInt32BE(payload.byteLength, 12);
		return new Promise((resolveWrite, reject) => {
			child.stdin.write(Buffer.concat([header, payload]), (error) => error ? reject(error) : resolveWrite());
		});
	},
		next() {
			if (queued.length > 0) return Promise.resolve(queued.shift());
			return new Promise((resolveFrame, reject) => waiting.push({ resolve: resolveFrame, reject }));
		},
	};
}

async function rootIdentity(path) {
	const details = await stat(path, { bigint: true });
	return {
		volumeIdentity: `device:${details.dev.toString(16)}`,
		directoryIdentity: `device:${details.dev.toString(16)}:inode:${details.ino.toString(16)}`,
	};
}

function parseJson(frame, opcode) {
	assert.equal(frame.opcode, opcode);
	return JSON.parse(frame.payload.toString('utf8'));
}

function json(value) { return Buffer.from(JSON.stringify(value)); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
