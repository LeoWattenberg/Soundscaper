/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	TextWriter,
	Uint8ArrayReader,
	ZipReader,
} from '@zip.js/zip.js';

import {
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	validateSoundscaperProjectV29,
} from '../src/soundscaper/editor-project-v29.ts';
import {
	DESKTOP_SCAPE_OPEN_ARCHIVE_MAXIMUM_BYTES,
	DESKTOP_SCAPE_OPEN_ARCHIVE_MINIMUM_BYTES,
	DESKTOP_SCAPE_OPEN_FIXTURE,
	DESKTOP_SCAPE_OPEN_SMOKE_MODE,
	DESKTOP_SCAPE_OPEN_SMOKE_PREFIX,
	MAX_DESKTOP_SCAPE_OPEN_PLAN_BYTES,
	createDesktopScapeOpenFixture,
	createDesktopScapeOpenSmokeInvocation,
	createDesktopScapeOpenSmokePlan,
	decodeDesktopScapeOpenSmokePlan,
	encodeDesktopScapeOpenSmokePlan,
	formatDesktopScapeOpenSmokeResult,
	parseDesktopScapeOpenSmokeOutput,
	runBoundedDesktopScapeOpenChild,
	runDesktopScapeOpenSmoke,
} from '../scripts/lib/desktop-scape-open-smoke.mjs';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ARCHIVE_BYTES = 70_000;
const EXPORTED_FIXTURE_BYTES = 70_647;

test('Scape-open fixture is a production-exported exact Soundscaper V29 mono project with bounded range geometry', async (t) => {
	const profile = await mkdtemp(join(tmpdir(), 'scape-open-fixture-test-'));
	t.after(() => rm(profile, { recursive: true, force: true }));
	const fixture = await createDesktopScapeOpenFixture(profile);
	assert.equal(fixture.path, join(profile, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName));
	assert.equal(fixture.assetBytes, 65_540);
	assert.equal(fixture.byteLength, EXPORTED_FIXTURE_BYTES);
	assert.match(fixture.sha256, /^[a-f\d]{64}$/u);
	assert.ok(fixture.byteLength > DESKTOP_SCAPE_OPEN_ARCHIVE_MINIMUM_BYTES);
	assert.ok(fixture.byteLength <= DESKTOP_SCAPE_OPEN_ARCHIVE_MAXIMUM_BYTES);
	assert.deepEqual(fixture.project, {
		id: 'packaged-scape-open-project',
		title: 'Packaged Scape Open',
		revision: 7,
		sourceId: 'packaged-source',
		trackId: 'packaged-track',
		clipId: 'packaged-clip',
	});

	const bytes = await readFile(fixture.path);
	assert.equal(bytes.byteLength, fixture.byteLength);
	const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
	try {
		const entries = await reader.getEntries();
		const projectEntry = entries.find(({ filename }) => filename === 'project.json');
		assert.ok(projectEntry);
		const project = JSON.parse(await projectEntry.getData(new TextWriter()));
		assert.equal(validateSoundscaperProjectV29(project), true);
		assert.equal(project.schemaVersion, SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION);
		assert.equal(project.createdAt, DESKTOP_SCAPE_OPEN_FIXTURE.project.createdAt);
		assert.equal(project.updatedAt, DESKTOP_SCAPE_OPEN_FIXTURE.project.updatedAt);
		assert.equal(project.sampleRate, 48_000);
		assert.equal(project.sources.length, 1);
		assert.deepEqual(project.sources[0], {
			id: 'packaged-source',
			name: 'Packaged source.wav',
			mimeType: 'audio/wav',
			storageKey: 'packaged-source',
			frameCount: 16_384,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: 16_384,
			opaqueExtensions: {},
			kind: 'audio',
		});
		assert.deepEqual(project.tracks.map(({ id, clipIds }) => ({ id, clipIds })), [
			{ id: 'packaged-track', clipIds: ['packaged-clip'] },
		]);
		assert.deepEqual(project.clips.map(({ id, sourceId, durationFrames }) => ({ id, sourceId, durationFrames })), [
			{ id: 'packaged-clip', sourceId: 'packaged-source', durationFrames: 16_384 },
		]);
	} finally {
		await reader.close();
	}
});

test('Scape-open plan and invocation bind the exact positional fixture to isolated data roots', () => {
	const plan = createDesktopScapeOpenSmokePlan({ archiveByteLength: ARCHIVE_BYTES, token: TOKEN });
	assert.deepEqual(plan, {
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_OPEN_SMOKE_MODE,
		productId: 'soundscaper',
		token: TOKEN,
		archive: { name: 'packaged-current-schema.sscape', byteLength: ARCHIVE_BYTES },
		project: {
			id: 'packaged-scape-open-project', title: 'Packaged Scape Open', revision: 7,
			sourceId: 'packaged-source', trackId: 'packaged-track', clipId: 'packaged-clip',
		},
	});
	assert.equal(Object.isFrozen(plan.archive), true);
	const encoded = encodeDesktopScapeOpenSmokePlan(plan);
	assert.ok(Buffer.byteLength(encoded) <= MAX_DESKTOP_SCAPE_OPEN_PLAN_BYTES);
	assert.deepEqual(decodeDesktopScapeOpenSmokePlan(encoded), plan);

	const invocation = invocationFixture();
	assert.deepEqual(invocation.plan, plan);
	assert.equal(invocation.scapePath, '/tmp/scape-open-profile/packaged-current-schema.sscape');
	assert.equal(invocation.userDataPath, '/tmp/scape-open-profile/profile');
	assert.equal(invocation.sharedAppDataPath, '/tmp/scape-open-profile/application-data');
	assert.ok(invocation.executableCandidates.includes('/release/desktop/linux-unpacked/soundscaper'));
	assert.deepEqual(invocation.appArguments, [
		'--user-data-dir=/tmp/scape-open-profile/profile',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_SCAPE_OPEN_SMOKE_MODE}`,
		`--soundscaper-smoke-plan=${invocation.encodedPlan}`,
		'--soundscaper-smoke-app-data=/tmp/scape-open-profile/application-data',
		'--lang=en',
		'--mute-audio',
		'--autoplay-policy=no-user-gesture-required',
		'/tmp/scape-open-profile/packaged-current-schema.sscape',
	]);
	assert.throws(() => createDesktopScapeOpenSmokePlan({
		archiveByteLength: DESKTOP_SCAPE_OPEN_ARCHIVE_MINIMUM_BYTES,
		token: TOKEN,
	}), /larger than 65,557/iu);
	assert.throws(() => createDesktopScapeOpenSmokePlan({
		archiveByteLength: DESKTOP_SCAPE_OPEN_ARCHIVE_MAXIMUM_BYTES + 1,
		token: TOKEN,
	}), /96 KiB/iu);
	assert.throws(() => createDesktopScapeOpenSmokeInvocation({
		arch: 'x64', archiveByteLength: ARCHIVE_BYTES, outputRoot: '/release/desktop',
		platform: 'linux', profileRoot: '/tmp/scape-open-profile',
		scapePath: '/tmp/outside/packaged-current-schema.sscape', token: TOKEN,
	}), /inside its isolated profile/iu);
});

test('Scape-open output parser accepts exactly one sanitized plan-bound result', () => {
	const invocation = invocationFixture();
	const payload = validResult(invocation.plan);
	const line = formatDesktopScapeOpenSmokeResult(payload);
	assert.equal(line, `${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
	assert.deepEqual(parseDesktopScapeOpenSmokeOutput(`diagnostic\n${line}\n`, invocation), payload);
	assert.throws(() => parseDesktopScapeOpenSmokeOutput(`${line}\n${line}`, invocation), /exactly one/iu);
	assert.throws(() => parseDesktopScapeOpenSmokeOutput('x'.repeat(1024 * 1024 + 1), invocation), /1 MiB/iu);
	assert.throws(() => formatDesktopScapeOpenSmokeResult({ ...payload, path: '/private/project.scape' }), /field/iu);
	assert.throws(() => parseDesktopScapeOpenSmokeOutput(
		`${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} ${JSON.stringify({ ...payload, path: '/private/project.scape' })}`,
		invocation,
	), /field|key|result/iu);
	assert.throws(() => parseDesktopScapeOpenSmokeOutput(
		`${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} ${JSON.stringify({
			...payload,
			descriptor: { ...payload.descriptor, retiredAfterOpen: false },
		})}`,
		invocation,
	), /retired|descriptor/iu);
	assert.doesNotMatch(line, /(?:\/tmp|soundscaper-app:|_[Dd]esktop\/read|application-data)/u);
});

test('bounded Scape-open child runner caps combined output and elapsed time', async () => {
	const success = await runBoundedDesktopScapeOpenChild(process.execPath, ['--version'], {
		cwd: process.cwd(), environment: process.env, maximumOutputBytes: 64, timeoutMs: 2_000,
	});
	assert.equal(success.code, 0);
	assert.match(success.stdout, /^v\d+/u);
	assert.equal(success.stderr, '');
	await assert.rejects(
		() => runBoundedDesktopScapeOpenChild(process.execPath, ['--v8-options'], {
			cwd: process.cwd(), environment: process.env, maximumOutputBytes: 64, timeoutMs: 2_000,
		}),
		/output.*64 bytes/iu,
	);
	await assert.rejects(
		() => runBoundedDesktopScapeOpenChild(process.execPath, [
			'-e', 'setInterval(() => {}, 1_000)',
		], {
			cwd: process.cwd(), environment: process.env, maximumOutputBytes: 64, timeoutMs: 20,
		}),
		/timed out.*20 milliseconds/iu,
	);
});

test('Scape-open runner uses a fake packaged child and always removes its isolated profile', async () => {
	let profile;
	let receivedArgs;
	const result = await runDesktopScapeOpenSmoke({
		repositoryRoot: process.cwd(),
		outputRoot: resolve('unused-scape-package'),
		arch: 'x64',
		platform: 'linux',
		environment: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		token: TOKEN,
		async createProfile(prefix) {
			profile = await mkdtemp(prefix);
			return profile;
		},
		async findExecutable() { return '/fake/packaged/soundscaper'; },
		async runChild(command, args, options) {
			assert.equal(command, '/fake/packaged/soundscaper');
			assert.equal(options.environment.ELECTRON_RUN_AS_NODE, undefined);
			receivedArgs = args;
			const encoded = args.find((value) => value.startsWith('--soundscaper-smoke-plan='))
				?.slice('--soundscaper-smoke-plan='.length);
			const plan = decodeDesktopScapeOpenSmokePlan(encoded);
			return { code: 0, stdout: formatDesktopScapeOpenSmokeResult(validResult(plan)), stderr: '' };
		},
	});
	assert.equal(result.renderer.statusState, 'success');
	assert.equal(receivedArgs.at(-1), join(profile, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName));
	await assert.rejects(access(profile), /ENOENT/iu);
});

test('Scape-open runner detects same-length fixture mutation before cleanup', async () => {
	let profile;
	await assert.rejects(() => runDesktopScapeOpenSmoke({
		repositoryRoot: process.cwd(), outputRoot: resolve('unused-scape-package'),
		arch: 'x64', platform: 'linux', environment: process.env, token: TOKEN,
		async createProfile(prefix) { profile = await mkdtemp(prefix); return profile; },
		async findExecutable() { return '/fake/packaged/soundscaper'; },
		async runChild(_command, args) {
			const path = args.at(-1);
			const bytes = await readFile(path);
			bytes[0] ^= 0xff;
			await writeFile(path, bytes);
			const encoded = args.find((value) => value.startsWith('--soundscaper-smoke-plan='))
				?.slice('--soundscaper-smoke-plan='.length);
			const plan = decodeDesktopScapeOpenSmokePlan(encoded);
			return { code: 0, stdout: formatDesktopScapeOpenSmokeResult(validResult(plan)), stderr: '' };
		},
	}), /changed its fixture archive/iu);
	await assert.rejects(access(profile), /ENOENT/iu);
});

test('Scape-open runner refuses an injected non-temporary profile before recursive cleanup', async () => {
	let removed = false;
	await assert.rejects(() => runDesktopScapeOpenSmoke({
		repositoryRoot: process.cwd(), outputRoot: resolve('unused-scape-package'),
		arch: 'x64', platform: 'linux', environment: process.env, token: TOKEN,
		async createProfile() { return process.cwd(); },
		async removeProfile() { removed = true; },
	}), /direct scape-open-.*temporary directory/iu);
	assert.equal(removed, false);
});

test('Scape-open runner preserves fake child and cleanup failures together', async () => {
	const childError = new Error('injected packaged child failure');
	const cleanupError = new Error('injected profile cleanup failure');
	let profile;
	await assert.rejects(
		() => runDesktopScapeOpenSmoke({
			repositoryRoot: process.cwd(), outputRoot: resolve('unused-scape-package'),
			arch: 'x64', platform: 'linux', environment: process.env, token: TOKEN,
			async createProfile(prefix) { profile = await mkdtemp(prefix); return profile; },
			async findExecutable() { return '/fake/packaged/soundscaper'; },
			async runChild() { throw childError; },
			async removeProfile(...args) { await rm(...args); throw cleanupError; },
		}),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors[0], childError);
			assert.equal(error.errors[1], cleanupError);
			return true;
		},
	);
	await assert.rejects(access(profile), /ENOENT/iu);
});

test('Scape-open CLI remains a thin persistence-result wrapper', async () => {
	const source = await readFile(resolve('scripts/desktop-scape-open-smoke.mjs'), 'utf8');
	assert.match(source, /runDesktopScapePersistenceSmoke/u);
	assert.match(source, /formatDesktopScapePersistenceSmokeResult/u);
	assert.doesNotMatch(source, /spawn\(|exportScapeProject|createAudioEditorProject/u);
});

function invocationFixture() {
	return createDesktopScapeOpenSmokeInvocation({
		arch: 'x64',
		archiveByteLength: ARCHIVE_BYTES,
		outputRoot: '/release/desktop',
		platform: 'linux',
		profileRoot: '/tmp/scape-open-profile',
		scapePath: '/tmp/scape-open-profile/packaged-current-schema.sscape',
		token: TOKEN,
	});
}

function validResult(plan) {
	return {
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_OPEN_SMOKE_MODE,
		productId: plan.productId,
		token: plan.token,
		archive: plan.archive,
		project: plan.project,
		descriptor: {
			readProfile: 'scape-range-v1',
			name: plan.archive.name,
			size: plan.archive.byteLength,
			mimeType: 'application/vnd.soundscaper.scape+zip',
			liveBeforeDelivery: true,
			retiredAfterOpen: true,
		},
		renderer: {
			projectId: plan.project.id,
			trackCount: 1,
			clipCount: 1,
			activeTabTitle: plan.project.title,
			trackId: plan.project.trackId,
			clipId: plan.project.clipId,
			statusState: 'success',
			alertCount: 0,
			dialogCount: 0,
		},
	};
}
