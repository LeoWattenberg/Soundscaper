/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_SCAPE_OPEN_FIXTURE,
	decodeDesktopScapeOpenSmokePlan,
	formatDesktopScapeOpenSmokeResult,
} from '../scripts/lib/desktop-scape-open-smoke.mjs';
import {
	DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
	DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX,
	createDesktopScapeReopenSmokeInvocation,
	createDesktopScapeReopenSmokePlan,
	decodeDesktopScapeReopenSmokePlan,
	formatDesktopScapePersistenceSmokeResult,
	formatDesktopScapeReopenSmokeResult,
	parseDesktopScapeReopenSmokeOutput,
	runDesktopScapePersistenceSmoke,
} from '../scripts/lib/desktop-scape-reopen-smoke.mjs';

const TOKEN = '0123456789abcdef0123456789abcdef';

test('Scape-reopen plan and invocation reuse isolated roots without an archive argument', () => {
	const plan = createDesktopScapeReopenSmokePlan({ token: TOKEN });
	assert.deepEqual(plan, {
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
		productId: 'soundscaper',
		token: TOKEN,
		project: expectedProject(),
	});
	assert.equal(Object.isFrozen(plan.project), true);

	const invocation = createDesktopScapeReopenSmokeInvocation({
		arch: 'x64',
		outputRoot: '/release/desktop',
		platform: 'linux',
		profileRoot: '/tmp/scape-reopen-profile',
		token: TOKEN,
	});
	assert.deepEqual(decodeDesktopScapeReopenSmokePlan(invocation.encodedPlan), plan);
	assert.equal(invocation.userDataPath, '/tmp/scape-reopen-profile/profile');
	assert.equal(invocation.sharedAppDataPath, '/tmp/scape-reopen-profile/application-data');
	assert.ok(invocation.executableCandidates.includes('/release/desktop/linux-unpacked/soundscaper'));
	assert.deepEqual(invocation.appArguments, [
		'--user-data-dir=/tmp/scape-reopen-profile/profile',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_SCAPE_REOPEN_SMOKE_MODE}`,
		`--soundscaper-smoke-plan=${invocation.encodedPlan}`,
		'--soundscaper-smoke-app-data=/tmp/scape-reopen-profile/application-data',
		'--lang=en',
		'--mute-audio',
		'--autoplay-policy=no-user-gesture-required',
	]);
	assert.equal(invocation.appArguments.some((argument) => argument.endsWith('.scape')), false);
	assert.equal(Object.hasOwn(invocation, 'scapePath'), false);
});

test('Scape-reopen output parser accepts exactly one sanitized plan-bound result', () => {
	const invocation = createDesktopScapeReopenSmokeInvocation({
		arch: 'x64', outputRoot: '/release/desktop', platform: 'linux',
		profileRoot: '/tmp/scape-reopen-profile', token: TOKEN,
	});
	const payload = validReopenResult(invocation.plan);
	const line = formatDesktopScapeReopenSmokeResult(payload);
	assert.equal(line, `${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} ${JSON.stringify(payload)}`);
	assert.deepEqual(parseDesktopScapeReopenSmokeOutput(`diagnostic\n${line}\n`, invocation), payload);
	assert.throws(() => parseDesktopScapeReopenSmokeOutput(`${line}\n${line}`, invocation), /exactly one/iu);
	assert.throws(() => parseDesktopScapeReopenSmokeOutput('x'.repeat(1024 * 1024 + 1), invocation), /1 MiB/iu);
	assert.throws(
		() => formatDesktopScapeReopenSmokeResult({ ...payload, path: '/private/project.scape' }),
		/field|closed|unsupported/iu,
	);
	assert.throws(
		() => formatDesktopScapeReopenSmokeResult({
			...payload,
			playback: { ...payload.playback, audioDeviceId: 'private-device' },
		}),
		/field|closed|playback|unsupported/iu,
	);
	const missingPlayback = { ...payload };
	delete missingPlayback.playback;
	assert.throws(
		() => formatDesktopScapeReopenSmokeResult(missingPlayback),
		/field|closed|playback|unsupported/iu,
	);
	for (const field of ['transportEntered', 'playheadAdvanced', 'meterAboveFloor', 'transportStopped']) {
		assert.throws(
			() => formatDesktopScapeReopenSmokeResult({
				...payload,
				playback: { ...payload.playback, [field]: false },
			}),
			/playback|transport|playhead|meter|renderer/iu,
		);
	}
	assert.throws(
		() => parseDesktopScapeReopenSmokeOutput(
			`${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} ${JSON.stringify({
				...payload,
				token: 'f'.repeat(32),
			})}`,
			invocation,
		),
		/does not match its plan/iu,
	);
	assert.doesNotMatch(line, /(?:\/tmp|soundscaper-app:|_[Dd]esktop\/read|application-data|\.scape)/u);
	assert.doesNotMatch(line, /audioDevice|deviceId|currentTime|duration|sample|path/iu);
});

test('persistence runner opens, removes the archive, then reopens from the same profile', async () => {
	let profile;
	const calls = [];
	const result = await runDesktopScapePersistenceSmoke({
		repositoryRoot: process.cwd(),
		outputRoot: resolve('unused-scape-package'),
		arch: 'x64',
		platform: 'linux',
		environment: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SCAPE_PRODUCT: 'soundscaper' },
		token: TOKEN,
		async createProfile(prefix) {
			profile = await mkdtemp(prefix);
			return profile;
		},
		async findExecutable() { return '/fake/packaged/soundscaper'; },
		async runChild(command, args, options) {
			calls.push({ command, args, options });
			assert.equal(command, '/fake/packaged/soundscaper');
			assert.equal(options.environment.ELECTRON_RUN_AS_NODE, undefined);
			assert.equal(options.environment.SCAPE_PRODUCT, undefined);
			const encoded = args.find((value) => value.startsWith('--soundscaper-smoke-plan='))
				?.slice('--soundscaper-smoke-plan='.length);
			if (calls.length === 1) {
				const plan = decodeDesktopScapeOpenSmokePlan(encoded);
				assert.equal(args.at(-1), join(profile, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName));
				await access(args.at(-1));
				return { code: 0, stdout: formatDesktopScapeOpenSmokeResult(validOpenResult(plan)), stderr: '' };
			}
			const plan = decodeDesktopScapeReopenSmokePlan(encoded);
			assert.deepEqual(plan.project, expectedProject());
			assert.equal(args.some((argument) => argument.endsWith('.scape')), false);
			await assert.rejects(access(join(profile, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName)), /ENOENT/iu);
			return { code: 0, stdout: formatDesktopScapeReopenSmokeResult(validReopenResult(plan)), stderr: '' };
		},
	});

	assert.equal(calls.length, 2);
	assert.equal(calls[0].args[0], calls[1].args[0]);
	assert.equal(calls[0].args[4], calls[1].args[4]);
	assert.deepEqual(result, {
		open: validOpenResult(result.open),
		reopen: validReopenResult(result.reopen),
	});
	assert.equal(Object.isFrozen(result), true);
	const formatted = formatDesktopScapePersistenceSmokeResult(result);
	assert.equal(formatted.split('\n').length, 2);
	assert.match(formatted, new RegExp(`^SOUNDSCAPER_DESKTOP_SCAPE_OPEN_SMOKE .+\\n${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} `, 'u'));
	await assert.rejects(access(profile), /ENOENT/iu);
});

test('persistence runner rejects archive mutation before removal and skips reopen', async () => {
	let profile;
	let calls = 0;
	await assert.rejects(() => runDesktopScapePersistenceSmoke({
		repositoryRoot: process.cwd(), outputRoot: resolve('unused-scape-package'),
		arch: 'x64', platform: 'linux', environment: process.env, token: TOKEN,
		async createProfile(prefix) { profile = await mkdtemp(prefix); return profile; },
		async findExecutable() { return '/fake/packaged/soundscaper'; },
		async runChild(_command, args) {
			calls += 1;
			const path = args.at(-1);
			const bytes = await readFile(path);
			bytes[0] ^= 0xff;
			await writeFile(path, bytes);
			const encoded = args.find((value) => value.startsWith('--soundscaper-smoke-plan='))
				?.slice('--soundscaper-smoke-plan='.length);
			const plan = decodeDesktopScapeOpenSmokePlan(encoded);
			return { code: 0, stdout: formatDesktopScapeOpenSmokeResult(validOpenResult(plan)), stderr: '' };
		},
	}), /changed its fixture archive/iu);
	assert.equal(calls, 1);
	await assert.rejects(access(profile), /ENOENT/iu);
});

test('persistence runner refuses an injected non-temporary profile before recursive cleanup', async () => {
	let removed = false;
	await assert.rejects(() => runDesktopScapePersistenceSmoke({
		repositoryRoot: process.cwd(), outputRoot: resolve('unused-scape-package'),
		arch: 'x64', platform: 'linux', environment: process.env, token: TOKEN,
		async createProfile() { return process.cwd(); },
		async removeProfile() { removed = true; },
	}), /direct scape-reopen-.*temporary directory/iu);
	assert.equal(removed, false);
});

test('persistence runner reports a failing reopen child and still cleans the shared profile', async () => {
	let profile;
	let calls = 0;
	await assert.rejects(() => runDesktopScapePersistenceSmoke({
		repositoryRoot: process.cwd(), outputRoot: resolve('unused-scape-package'),
		arch: 'x64', platform: 'linux', environment: process.env, token: TOKEN,
		async createProfile(prefix) { profile = await mkdtemp(prefix); return profile; },
		async findExecutable() { return '/fake/packaged/soundscaper'; },
		async runChild(_command, args) {
			calls += 1;
			if (calls === 2) {
				return { code: 7, stdout: '', stderr: 'injected reopen diagnostic' };
			}
			const encoded = args.find((value) => value.startsWith('--soundscaper-smoke-plan='))
				?.slice('--soundscaper-smoke-plan='.length);
			const plan = decodeDesktopScapeOpenSmokePlan(encoded);
			return { code: 0, stdout: formatDesktopScapeOpenSmokeResult(validOpenResult(plan)), stderr: '' };
		},
	}), /reopen smoke exited with code 7[\s\S]*injected reopen diagnostic/iu);
	assert.equal(calls, 2);
	await assert.rejects(access(profile), /ENOENT/iu);
});

test('persistence runner preserves child and profile-cleanup failures together', async () => {
	const childError = new Error('injected packaged child failure');
	const cleanupError = new Error('injected profile cleanup failure');
	let profile;
	await assert.rejects(
		() => runDesktopScapePersistenceSmoke({
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

function expectedProject() {
	const project = DESKTOP_SCAPE_OPEN_FIXTURE.project;
	return {
		id: project.id,
		title: project.title,
		revision: project.revision,
		sourceId: project.sourceId,
		trackId: project.trackId,
		clipId: project.clipId,
	};
}

function validOpenResult(plan) {
	return {
		schemaVersion: 1,
		mode: plan.mode,
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

function validReopenResult(plan) {
	return {
		schemaVersion: 1,
		mode: plan.mode,
		productId: plan.productId,
		token: plan.token,
		project: plan.project,
		sharedProject: {
			schemaVersion: 9,
			revision: plan.project.revision,
			sourceCount: 1,
			trackCount: 1,
			clipCount: 1,
		},
		renderer: {
			projectId: plan.project.id,
			trackCount: 1,
			clipCount: 1,
			activeTabTitle: plan.project.title,
			trackId: plan.project.trackId,
			clipId: plan.project.clipId,
			waveformRenderer: 'audacity',
			waveformSource: 'pcm',
			waveformError: false,
			statusState: 'success',
			alertCount: 0,
			dialogCount: 0,
		},
		playback: {
			transportEntered: true,
			playheadAdvanced: true,
			meterAboveFloor: true,
			transportStopped: true,
		},
	};
}
