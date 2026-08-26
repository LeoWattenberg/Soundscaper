/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	AssistanceStagingRegistry,
	type AssistanceStagingRegistryOptions,
} from '../desktop/assistance-staging-registry.ts';

const ID = /^[a-f\d]{40}$/u;

async function fixture(
	t: TestContext,
	options: Omit<AssistanceStagingRegistryOptions, 'root'> = {},
): Promise<Readonly<{ registry: AssistanceStagingRegistry; root: string }>> {
	const temporary = await mkdtemp(join(tmpdir(), 'assistance-staging-test-'));
	const root = join(temporary, 'private');
	t.after(() => rm(temporary, { recursive: true, force: true }));
	return Object.freeze({ registry: new AssistanceStagingRegistry({ root, ...options }), root });
}

function bytes(...values: string[]): AsyncIterable<Uint8Array> {
	return Object.freeze({
		async *[Symbol.asyncIterator]() {
			for (const value of values) yield Buffer.from(value);
		},
	});
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

test('staging mints pathless claims while private custody uses exact modes and digests', async (t) => {
	const { registry, root } = await fixture(t);
	const jobId = await registry.createJob();
	const input = await registry.stageInput({
		jobId,
		role: 'audio',
		mediaType: 'audio/wav',
		byteLength: 6,
		bytes: bytes('abc', 'def'),
	});
	const reservation = await registry.reserveOutput({
		jobId,
		role: 'transcript',
		mediaType: 'application/json',
		maximumByteLength: 32,
	});
	assert.match(jobId, ID);
	assert.match(input.claimId, ID);
	assert.match(reservation.claimId, ID);
	assert.equal(input.sha256, sha256('abcdef'));
	for (const rendererValue of [input, reservation]) {
		assert.doesNotMatch(JSON.stringify(rendererValue), /path|assistance-staging-test|private/iu);
	}

	const inputPath = await registry.resolveInputPathForMain(jobId, input);
	const outputPath = await registry.resolveOutputReservationPathForMain(jobId, reservation);
	if (process.platform !== 'win32') {
		assert.equal((await lstat(root)).mode & 0o777, 0o700);
		assert.equal((await lstat(join(root, jobId))).mode & 0o777, 0o700);
		assert.equal((await lstat(inputPath)).mode & 0o777, 0o600);
		assert.equal((await lstat(outputPath)).mode & 0o777, 0o600);
	}
	await writeFile(outputPath, 'result', { flag: 'r+' });
	const output = await registry.authenticateOutput(jobId, reservation);
	assert.deepEqual(output, {
		claimVersion: 1,
		claimId: reservation.claimId,
		jobId,
		role: 'transcript',
		mediaType: 'application/json',
		byteLength: 6,
		sha256: sha256('result'),
	});
	assert.doesNotMatch(JSON.stringify(output), /path|assistance-staging-test|private/iu);
	assert.equal(await registry.resolveOutputClaimPathForMain(jobId, output), outputPath);
});

test('registered input paths refuse digest tamper and symbolic-link replacement', async (t) => {
	const { registry, root } = await fixture(t);
	const jobId = await registry.createJob();
	const claim = await registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 6, bytes: bytes('abcdef'),
	});
	const path = await registry.resolveInputPathForMain(jobId, claim);
	await writeFile(path, 'ghijkl');
	await assert.rejects(registry.resolveInputPathForMain(jobId, claim), /digest|changed|registered/iu);

	const outside = join(root, '..', 'outside.bin');
	await writeFile(outside, 'outside');
	await rm(path);
	await symlink(outside, path);
	await assert.rejects(
		registry.resolveInputPathForMain(jobId, claim),
		/identity|regular|symbolic|registered|ELOOP/iu,
	);
	assert.equal(await readFile(outside, 'utf8'), 'outside');
	await registry.releaseJob(jobId);
	assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('exact input, aggregate, claim-count, and output bounds fail before publication', async (t) => {
	const { registry, root } = await fixture(t, {
		maximumClaimsPerJob: 2,
		maximumBytesPerClaim: 8,
		maximumAggregateBytesPerJob: 10,
		maximumChunkBytes: 8,
	});
	const jobId = await registry.createJob();
	await assert.rejects(registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 4, bytes: bytes('12345'),
	}), /exact|length|exceed/iu);
	assert.deepEqual(await readdir(join(root, jobId)), []);
	await registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 6, bytes: bytes('123456'),
	});
	await assert.rejects(registry.reserveOutput({
		jobId, role: 'transcript', mediaType: 'application/json', maximumByteLength: 5,
	}), /aggregate|bytes/iu);
	const reservation = await registry.reserveOutput({
		jobId, role: 'transcript', mediaType: 'application/json', maximumByteLength: 4,
	});
	await assert.rejects(registry.reserveOutput({
		jobId, role: 'audio-tags', mediaType: 'application/json', maximumByteLength: 1,
	}), /claim|count/iu);
	const path = await registry.resolveOutputReservationPathForMain(jobId, reservation);
	await writeFile(path, '12345', { flag: 'r+' });
	await assert.rejects(registry.authenticateOutput(jobId, reservation), /maximum|bound|length/iu);
});

test('AbortSignal cancellation closes a pending source and rolls back its private file and capacity', async (t) => {
	const { registry, root } = await fixture(t, {
		maximumClaimsPerJob: 1,
		maximumBytesPerClaim: 8,
		maximumAggregateBytesPerJob: 8,
	});
	const jobId = await registry.createJob();
	let started!: () => void;
	const sourceStarted = new Promise<void>((resolve) => { started = resolve; });
	let returned = false;
	const source: AsyncIterable<Uint8Array> = Object.freeze({
		[Symbol.asyncIterator]() {
			return {
				next() {
					started();
					return new Promise<IteratorResult<Uint8Array>>(() => {});
				},
				return() {
					returned = true;
					return Promise.resolve<IteratorResult<Uint8Array>>({ done: true, value: undefined });
				},
			};
		},
	});
	const controller = new AbortController();
	const reason = new DOMException('Stop staging.', 'AbortError');
	const staging = registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 4, bytes: source,
		signal: controller.signal,
	});
	await sourceStarted;
	controller.abort(reason);
	await assert.rejects(staging, (error: unknown) => error === reason);
	assert.equal(returned, true);
	assert.deepEqual(await readdir(join(root, jobId)), []);
	const retried = await registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 1, bytes: bytes('x'),
	});
	assert.equal(retried.byteLength, 1);
});

test('claims and reservations cannot cross their owning job', async (t) => {
	const { registry } = await fixture(t);
	const firstJob = await registry.createJob();
	const secondJob = await registry.createJob();
	const input = await registry.stageInput({
		jobId: firstJob, role: 'audio', mediaType: 'audio/wav', byteLength: 1, bytes: bytes('x'),
	});
	const output = await registry.reserveOutput({
		jobId: firstJob, role: 'transcript', mediaType: 'application/json', maximumByteLength: 8,
	});
	assert.throws(() => registry.resolveInputPathForMain(secondJob, input), /job|own|registered/iu);
	assert.throws(
		() => registry.resolveOutputReservationPathForMain(secondJob, output),
		/job|own|registered/iu,
	);
	await assert.rejects(
		registry.resolveInputPathForMain(secondJob, { ...input, jobId: secondJob }),
		/claim|registered/iu,
	);
});

test('duplicate minted identities are skipped and an output grant and claim settle exactly once', async (t) => {
	const jobId = '10'.repeat(20);
	const inputId = '20'.repeat(20);
	const outputId = '30'.repeat(20);
	const identities = [jobId, inputId, inputId, outputId];
	const { registry } = await fixture(t, {
		mintId: () => identities.shift() ?? outputId,
	});
	assert.equal(await registry.createJob(), jobId);
	const input = await registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 1, bytes: bytes('x'),
	});
	assert.equal(input.claimId, inputId);
	const reservation = await registry.reserveOutput({
		jobId, role: 'transcript', mediaType: 'application/json', maximumByteLength: 8,
	});
	assert.equal(reservation.claimId, outputId);
	const path = await registry.resolveOutputReservationPathForMain(jobId, reservation);
	await assert.rejects(
		registry.resolveOutputReservationPathForMain(jobId, reservation),
		/already|duplicate|once/iu,
	);
	await writeFile(path, 'ok', { flag: 'r+' });
	await registry.authenticateOutput(jobId, reservation);
	await assert.rejects(registry.authenticateOutput(jobId, reservation), /already|duplicate|once/iu);
});

test('job release aborts active staging, removes all custody atomically, and is idempotent', async (t) => {
	const { registry, root } = await fixture(t);
	const jobId = await registry.createJob();
	let started!: () => void;
	const sourceStarted = new Promise<void>((resolve) => { started = resolve; });
	const source: AsyncIterable<Uint8Array> = Object.freeze({
		async *[Symbol.asyncIterator]() {
			started();
			await new Promise<never>(() => {});
		},
	});
	const staging = registry.stageInput({
		jobId, role: 'audio', mediaType: 'audio/wav', byteLength: 4, bytes: source,
	});
	await sourceStarted;
	const refused = assert.rejects(staging, /released|cancelled|AbortError/iu);
	const released = registry.releaseJob(jobId);
	await refused;
	assert.equal(await released, true);
	await assert.rejects(lstat(join(root, jobId)), /ENOENT/iu);
	assert.equal(await registry.releaseJob(jobId), false);
	assert.throws(
		() => registry.reserveOutput({
			jobId, role: 'transcript', mediaType: 'application/json', maximumByteLength: 1,
		}),
		/unknown|released|job/iu,
	);
});

/**
 * A release can fail for reasons that pass: on Windows a helper may still hold
 * the staged file open when the job is cancelled. Caching that rejection would
 * make the failure permanent — every later release returns the same settled
 * promise — so the directory could never be reclaimed and the job would count
 * against the admission bound for the rest of the process.
 */
test('a failed job release can be retried rather than cached forever', async (t) => {
	const { registry, root } = await fixture(t);
	const jobId = await registry.createJob();
	const jobPath = join(root, jobId);
	await lstat(jobPath);

	// Make the first removal fail the way a still-open handle would, by taking
	// away the parent's write permission.
	await chmod(root, 0o500);
	await assert.rejects(registry.releaseJob(jobId));
	await chmod(root, 0o700);

	assert.equal(await registry.releaseJob(jobId), true, 'the retry reclaims the job');
	await assert.rejects(lstat(jobPath), /ENOENT/iu);
});
