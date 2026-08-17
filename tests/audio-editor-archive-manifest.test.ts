/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createArchiveManifest,
	parseArchiveManifest,
	saveArchiveManifest,
	serializeArchiveManifest,
	verifyArchiveManifest,
} from '../src/common/editor/archive-manifest.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

function members() {
	return [
		{ id: 'media/cam-a.mp4', sourceId: 'src-a', bytes: bytes('camera a payload') },
		{ id: 'media/mix.wav', sourceId: 'src-b', bytes: bytes('mixdown payload') },
		{ id: 'project.scape', bytes: bytes('project document') },
	];
}

function manifest() {
	return createArchiveManifest(members(), {
		generatedAt: '2026-08-17T12:00:00.000Z', projectTitle: 'Reel one',
	});
}

/** Read from an archive whose contents the test controls. */
function archive(overrides: Record<string, Uint8Array | null> = {}) {
	const contents = new Map<string, Uint8Array>(members().map((member) => [member.id, member.bytes]));
	for (const [id, value] of Object.entries(overrides)) {
		if (value === null) contents.delete(id);
		else contents.set(id, value);
	}
	return {
		read: (member: { id: string }) => contents.get(member.id) ?? null,
		ids: () => [...contents.keys()],
	};
}

test('a manifest digests every member and sorts them for stable bytes', () => {
	const built = manifest();
	assert.deepEqual(built.members.map((member) => member.id), [
		'media/cam-a.mp4', 'media/mix.wav', 'project.scape',
	]);
	assert.equal(built.members[0].byteLength, bytes('camera a payload').byteLength);
	assert.match(built.members[0].sha256, /^[0-9a-f]{64}$/u);
	assert.equal(built.totalByteLength, members().reduce((sum, m) => sum + m.bytes.byteLength, 0));
});

test('an intact archive verifies clean', () => {
	const result = verifyArchiveManifest(manifest(), archive().read);
	assert.equal(result.ok, true);
	assert.equal(result.checked, 3);
	assert.deepEqual(result.mismatches, []);
});

test('a tampered member fails with that exact member named', () => {
	// The acceptance is specifically that the failing member is identified.
	// "The archive is corrupt" is not something a user can act on.
	const tampered = archive({ 'media/mix.wav': bytes('mixdown paylXad') });
	const result = verifyArchiveManifest(manifest(), tampered.read);
	assert.equal(result.ok, false);
	assert.equal(result.mismatches.length, 1);
	assert.equal(result.mismatches[0].member, 'media/mix.wav');
	assert.equal(result.mismatches[0].kind, 'digest');
	assert.match(result.mismatches[0].message, /media\/mix\.wav failed SHA-256/u);
});

test('truncation reports both size and digest, substitution only digest', () => {
	// They fail differently, and which one moved says what happened.
	const truncated = verifyArchiveManifest(
		manifest(), archive({ 'media/mix.wav': bytes('mixdown') }).read,
	);
	assert.deepEqual(
		truncated.mismatches.map((entry) => entry.kind),
		['size', 'digest'],
		'a shorter member is both wrong lengths and wrong bytes',
	);
	const substituted = verifyArchiveManifest(
		manifest(), archive({ 'media/mix.wav': bytes('mixdown paylXad') }).read,
	);
	assert.deepEqual(substituted.mismatches.map((entry) => entry.kind), ['digest']);
});

test('verification does not stop at the first failure', () => {
	// A damaged archive usually has more than one damaged member, and the caller
	// deciding between re-archiving and re-linking needs all of it.
	const result = verifyArchiveManifest(manifest(), archive({
		'media/cam-a.mp4': bytes('wrong'),
		'media/mix.wav': null,
		'project.scape': bytes('project documenX'),
	}).read);
	assert.equal(result.ok, false);
	assert.deepEqual(
		[...new Set(result.mismatches.map((entry) => entry.member))].sort(),
		['media/cam-a.mp4', 'media/mix.wav', 'project.scape'],
	);
	assert.ok(result.mismatches.some((entry) => entry.kind === 'missing'));
});

test('a member present but unlisted is reported, not ignored', () => {
	// The manifest and the archive disagreeing about what the archive contains
	// is a real finding, not a harmless extra.
	const result = verifyArchiveManifest(manifest(), archive().read, {
		presentIds: [...archive().ids(), 'media/stowaway.mov'],
	});
	assert.equal(result.ok, false);
	assert.equal(result.mismatches.length, 1);
	assert.equal(result.mismatches[0].kind, 'unlisted');
	assert.equal(result.mismatches[0].member, 'media/stowaway.mov');
});

test('the manifest round-trips through its serialized form', () => {
	const serialized = serializeArchiveManifest(manifest());
	assert.equal(serialized.fileName, 'Reel-one-archive-manifest-2026-08-17.json');
	assert.equal(serialized.mimeType, 'application/json');
	const reparsed = parseArchiveManifest(serialized.text);
	assert.deepEqual(reparsed, manifest());
	// A parsed manifest must verify exactly as the built one does.
	assert.equal(verifyArchiveManifest(reparsed, archive().read).ok, true);
});

test('serialization is deterministic, so a fixture can pin its bytes', () => {
	assert.equal(serializeArchiveManifest(manifest()).text, serializeArchiveManifest(manifest()).text);
	// Member order in the input must not change the output.
	const shuffled = createArchiveManifest([...members()].reverse(), {
		generatedAt: '2026-08-17T12:00:00.000Z', projectTitle: 'Reel one',
	});
	assert.equal(serializeArchiveManifest(shuffled).text, serializeArchiveManifest(manifest()).text);
});

test('the manifest saves through the reserved report purpose', async () => {
	const saved: Record<string, unknown>[] = [];
	await saveArchiveManifest(manifest(), { saveFile: (request) => { saved.push(request); } });
	assert.equal(saved[0].purpose, 'report');
	assert.equal(saved[0].suggestedName, 'Reel-one-archive-manifest-2026-08-17.json');
});

test('the manifest refuses to be built from claims rather than bytes', () => {
	assert.throws(
		() => createArchiveManifest([{ id: 'a', sha256: 'deadbeef' } as never]),
		/must supply its bytes/u,
		'a manifest repeating a digest it was handed proves only that it was handed one',
	);
	assert.throws(
		() => createArchiveManifest([
			{ id: 'dup', bytes: bytes('x') }, { id: 'dup', bytes: bytes('y') },
		]),
		/listed twice/u,
	);
	assert.throws(() => parseArchiveManifest('{"kind":"something-else"}'), /not an archive manifest/u);
	assert.throws(
		() => parseArchiveManifest('{"kind":"archive-manifest","manifestVersion":99}'),
		/Unsupported archive manifest version/u,
	);
});
