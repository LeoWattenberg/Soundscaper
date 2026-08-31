/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	FFMPEG_RUNTIME_MANIFEST_PATH,
	canonicalJson,
	repinFfmpegRuntimeEvidence,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function collectFilePins(value, pins = []) {
	if (Array.isArray(value)) {
		for (const entry of value) collectFilePins(entry, pins);
		return pins;
	}
	if (!value || typeof value !== 'object') return pins;
	const keys = Object.keys(value).sort();
	if (keys.length === 3 && keys[0] === 'byteLength' && keys[1] === 'path' && keys[2] === 'sha256') {
		pins.push(value);
		return pins;
	}
	for (const entry of Object.values(value)) collectFilePins(entry, pins);
	return pins;
}

async function createStaleFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-repin-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const manifest = JSON.parse(await readFile(join(ROOT, FFMPEG_RUNTIME_MANIFEST_PATH), 'utf8'));
	const pins = collectFilePins(manifest);
	assert.ok(pins.length >= 9, 'the checked-in manifest carries the expected file pins');
	for (const [index, pin] of pins.entries()) {
		const target = join(root, pin.path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, `fixture body ${index} for ${pin.path}\n`);
		pin.byteLength = 1;
		pin.sha256 = '0'.repeat(64);
	}
	manifest.integrity.payloadSha256 = '1'.repeat(64);
	const manifestPath = join(root, FFMPEG_RUNTIME_MANIFEST_PATH);
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	return { root, manifestPath, staleManifest: manifest };
}

test('repin reproduces the checked-in manifest byte for byte on a green tree', async () => {
	const checkedIn = await readFile(join(ROOT, FFMPEG_RUNTIME_MANIFEST_PATH), 'utf8');
	const result = await repinFfmpegRuntimeEvidence({ repositoryRoot: ROOT });
	assert.equal(result.changed, false, 'the committed manifest pins are current');
	assert.equal(result.manifestText, checkedIn);
});

test('repin refreshes every stale file pin and the manifest integrity digest', async (context) => {
	const { root, manifestPath, staleManifest } = await createStaleFixture(context);

	const result = await repinFfmpegRuntimeEvidence({ repositoryRoot: root });
	assert.equal(result.changed, true);
	const repinned = JSON.parse(result.manifestText);
	const pins = collectFilePins(repinned);
	assert.equal(pins.length, collectFilePins(staleManifest).length);
	for (const pin of pins) {
		const bytes = await readFile(join(root, pin.path));
		assert.equal(pin.byteLength, bytes.byteLength, `${pin.path} byteLength`);
		assert.equal(pin.sha256, sha256(bytes), `${pin.path} sha256`);
	}

	const payload = Object.fromEntries(Object.entries(repinned).filter(([key]) => key !== 'integrity'));
	assert.equal(repinned.integrity.payloadSha256, sha256(Buffer.from(canonicalJson(payload))));
	assert.deepEqual(Object.keys(repinned.integrity), ['payloadSha256']);
	assert.equal(result.manifestText, `${JSON.stringify(repinned, null, '\t')}\n`, 'tab-serialized with a trailing newline');

	await writeFile(manifestPath, result.manifestText);
	const second = await repinFfmpegRuntimeEvidence({ repositoryRoot: root });
	assert.equal(second.changed, false, 'repin is idempotent');
	assert.equal(second.manifestText, result.manifestText);
});

test('repin rejects when a pinned evidence file is missing instead of pinning nothing', async (context) => {
	const { root } = await createStaleFixture(context);
	await rm(join(root, 'docs/production-threat-model.md'));
	await assert.rejects(
		repinFfmpegRuntimeEvidence({ repositoryRoot: root }),
		/docs\/production-threat-model\.md/u,
	);
});
