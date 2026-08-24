import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { DesktopSettingsStore } from '../desktop/settings.js';

const SHA_A = '12'.repeat(32);
const SHA_B = '34'.repeat(32);
const SHA_C = '56'.repeat(32);
const SHA_D = '78'.repeat(32);

test('schema-1 desktop settings default external FFmpeg selection to null', async (context) => {
	const fixture = await settingsFixture(context, {
		schemaVersion: 1,
		locale: 'en',
		updatesEnabled: true,
	});
	assert.equal((await fixture.settings.load(['en'])).externalFfmpegSelection, null);
});

test('external FFmpeg selection and exact probe evidence persist atomically', async (context) => {
	const fixture = await settingsFixture(context);
	await fixture.settings.load(['en']);
	const executablePath = join(fixture.root, 'tools', '..', 'bin', 'ffmpeg');
	const selected = await fixture.settings.setExternalFfmpegSelection(executablePath);
	assert.deepEqual(selected, {
		executablePath: resolve(executablePath),
		identity: null,
		capabilities: null,
	});
	assert.ok(Object.isFrozen(selected));

	const probed = await fixture.settings.setExternalFfmpegProbeMetadata({
		executablePath,
		identity: {
			version: '9.0.1',
			ffmpegSha256: SHA_A,
			ffprobeSha256: SHA_B,
			dependencyClosureSha256: SHA_C,
		},
		capabilities: {
			digest: SHA_D,
			probedAtEpochMs: 1_787_605_200_000,
		},
	});
	assert.ok(Object.isFrozen(probed.identity));
	assert.ok(Object.isFrozen(probed.capabilities));

	const reopened = new DesktopSettingsStore(fixture.filePath);
	const durable = (await reopened.load(['en'])).externalFfmpegSelection;
	assert.deepEqual(durable, probed);
	assert.deepEqual(JSON.parse(await readFile(fixture.filePath, 'utf8')).externalFfmpegSelection, probed);
});

test('changing or clearing the executable invalidates all external FFmpeg probe evidence', async (context) => {
	const fixture = await settingsFixture(context);
	await fixture.settings.load(['en']);
	const first = join(fixture.root, 'first', 'ffmpeg');
	const second = join(fixture.root, 'second', 'ffmpeg');
	await fixture.settings.setExternalFfmpegSelection(first);
	const firstProbe = await fixture.settings.setExternalFfmpegProbeMetadata(probeMetadata(first));
	assert.deepEqual(
		await fixture.settings.setExternalFfmpegSelection(join(fixture.root, 'first', '..', 'first', 'ffmpeg')),
		firstProbe,
		'reselecting the same canonical executable retains its probe evidence',
	);

	assert.deepEqual(await fixture.settings.setExternalFfmpegSelection(second), {
		executablePath: resolve(second), identity: null, capabilities: null,
	});
	await assert.rejects(
		() => fixture.settings.setExternalFfmpegProbeMetadata(probeMetadata(first)),
		/currently selected/iu,
	);
	assert.deepEqual(fixture.settings.snapshot().externalFfmpegSelection, {
		executablePath: resolve(second), identity: null, capabilities: null,
	});
	await fixture.settings.setExternalFfmpegProbeMetadata(probeMetadata(second));
	assert.deepEqual(await fixture.settings.clearExternalFfmpegProbeMetadata(second), {
		executablePath: resolve(second), identity: null, capabilities: null,
	});

	assert.equal(await fixture.settings.clearExternalFfmpegSelection(), null);
	assert.equal(fixture.settings.snapshot().externalFfmpegSelection, null);
});

test('external FFmpeg settings reject malformed paths, identities, and capability metadata', async (context) => {
	const fixture = await settingsFixture(context);
	await fixture.settings.load(['en']);
	for (const path of [42, '', 'relative/ffmpeg', `/bin/ffmpeg\0other`, `/${'x'.repeat(4_097)}`]) {
		await assert.rejects(() => fixture.settings.setExternalFfmpegSelection(path), /FFmpeg executable/iu);
	}

	const executablePath = join(fixture.root, 'ffmpeg');
	await fixture.settings.setExternalFfmpegSelection(executablePath);
	for (const metadata of [
		probeMetadata(executablePath, { version: 9 }),
		probeMetadata(executablePath, { version: `9.0\0snapshot` }),
		probeMetadata(executablePath, { ffmpegSha256: 'not-a-digest' }),
		probeMetadata(executablePath, { ffprobeSha256: 'AB'.repeat(32) }),
		probeMetadata(executablePath, { dependencyClosureSha256: null }),
		{ ...probeMetadata(executablePath), capabilities: { digest: 'bad', probedAtEpochMs: 1 } },
		{ ...probeMetadata(executablePath), capabilities: { digest: SHA_D, probedAtEpochMs: 1.5 } },
		{ ...probeMetadata(executablePath), identity: null },
	]) await assert.rejects(() => fixture.settings.setExternalFfmpegProbeMetadata(metadata), /FFmpeg|identity|capabilit|digest|version|probe/iu);
	assert.deepEqual(fixture.settings.snapshot().externalFfmpegSelection, {
		executablePath: resolve(executablePath), identity: null, capabilities: null,
	});
});

test('loading corrupt external FFmpeg evidence preserves only a valid canonical selection', async (context) => {
	const executablePath = resolve('/opt/media/../bin/ffmpeg');
	const fixture = await settingsFixture(context, {
		schemaVersion: 1,
		locale: 'en',
		externalFfmpegSelection: {
			executablePath,
			identity: { version: '9.0.1', ffmpegSha256: 'bad' },
			capabilities: { digest: SHA_D, probedAtEpochMs: 1_787_605_200_000 },
		},
	});
	assert.deepEqual((await fixture.settings.load(['en'])).externalFfmpegSelection, {
		executablePath: resolve(executablePath), identity: null, capabilities: null,
	});
});

function probeMetadata(executablePath, identityOverride = {}) {
	return {
		executablePath,
		identity: {
			version: '9.0.1',
			ffmpegSha256: SHA_A,
			ffprobeSha256: SHA_B,
			dependencyClosureSha256: SHA_C,
			...identityOverride,
		},
		capabilities: { digest: SHA_D, probedAtEpochMs: 1_787_605_200_000 },
	};
}

async function settingsFixture(context, persisted = null) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-settings-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	if (persisted) await writeFile(filePath, `${JSON.stringify(persisted)}\n`, 'utf8');
	return { root, filePath, settings: new DesktopSettingsStore(filePath) };
}
