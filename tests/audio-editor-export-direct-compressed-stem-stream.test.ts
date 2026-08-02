/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { unzipSync } from 'fflate';

import { captureDirectCompressedStemArchiveContract } from '../src/common/editor/controller/direct-compressed-stem-archive-plan.ts';
import {
	commitPreparedDirectStemArchiveDestination,
	prepareDirectStemArchiveDestination,
	streamDirectStemArchive,
} from '../src/common/editor/controller/direct-stem-archive-export.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/zip32.ts';
import { createExportPlan } from '../src/common/editor/export.js';

test('streams variable compressed entries through one retained stem and commits their actual ZIP size', async () => {
	const plan = actualPlan();
	const contract = captureDirectCompressedStemArchiveContract(plan as never);
	assert.ok(contract);
	const entries = [
		new Uint8Array(contract.entryMaximumByteLength).fill(1),
		Uint8Array.of(2, 3, 4, 5, 6),
	];
	const events: string[] = [];
	const target = preparedStream({ events });
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => target }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	let retained = 0;
	let maximumRetained = 0;
	const cleaned: string[] = [];
	const result = await streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		async renderStem(output, index) {
			assert.equal(retained, 0, 'the preceding complete encoded stem must already be released');
			retained += 1;
			maximumRetained = Math.max(maximumRetained, retained);
			events.push(`render:${output.fileName}`);
			return {
				bytes: entries[index],
				byteLength: entries[index]!.byteLength,
				cleanup: async () => {
					retained -= 1;
					cleaned.push(output.fileName);
					events.push(`cleanup:${output.fileName}`);
				},
			};
		},
	});
	const actualLayout = inspectZip32Layout(contract.outputs.map(({ fileName }, index) => ({
		fileName,
		byteLength: entries[index]!.byteLength,
	})));
	assert.equal(result.byteLength, actualLayout.archiveByteLength);
	assert.ok(result.byteLength < contract.maximumZip32.archiveByteLength);
	assert.equal(maximumRetained, 1);
	assert.equal(retained, 0);
	assert.deepEqual(cleaned, contract.outputs.map(({ fileName }) => fileName));
	assert.ok(events.indexOf('open') < events.findIndex((event) => event.startsWith('render:')));
	assert.ok(events.indexOf(`cleanup:${contract.outputs[0]!.fileName}`)
		< events.indexOf(`render:${contract.outputs[1]!.fileName}`));
	assert.equal(events.at(-1), 'close');

	const archive = unzipSync(target.bytes());
	assert.deepEqual(Object.keys(archive), contract.outputs.map(({ fileName }) => fileName));
	assert.deepEqual(archive[contract.outputs[0]!.fileName], entries[0]);
	assert.deepEqual(archive[contract.outputs[1]!.fileName], entries[1]);
	const published = await commitPreparedDirectStemArchiveDestination(
		preparation.destination, plan, result.byteLength, () => { events.push('current:commit'); },
	);
	assert.equal(published.size, result.byteLength);
	assert.deepEqual(target.opened(), [[contract.maximumZip32.archiveByteLength, 'maximum']]);
	assert.ok(events.indexOf('close') < events.indexOf('commit'));
});

test('streams centrally admitted offline compressed entries under the same bounded contract', async () => {
	const plan = actualPlan(0);
	const contract = captureDirectCompressedStemArchiveContract(plan as never);
	assert.ok(contract);
	assert.equal(contract.renderStrategy, 'offline');
	const target = preparedStream();
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => target }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	let retained = 0;
	const result = await streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		async renderStem(_output, index) {
			assert.equal(retained, 0);
			retained += 1;
			const bytes = Uint8Array.of(index + 1, index + 2);
			return {
				bytes,
				byteLength: bytes.byteLength,
				cleanup: async () => { retained -= 1; },
			};
		},
	});
	assert.equal(retained, 0);
	assert.ok(result.byteLength < contract.maximumZip32.archiveByteLength);
	const archive = unzipSync(target.bytes());
	assert.deepEqual(Object.keys(archive), contract.outputs.map(({ fileName }) => fileName));
	await commitPreparedDirectStemArchiveDestination(
		preparation.destination, plan, result.byteLength, () => undefined,
	);
	assert.equal(target.commits(), 1);
	assert.equal(target.aborts(), 0);
});

test('offline admission fingerprint drift aborts before rendering an entry', async () => {
	const plan = structuredClone(actualPlan(0));
	const target = preparedStream();
	const preparation = await prepareDirectStemArchiveDestination(
		{ prepareSave: () => target }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	const admission = record(record(plan.render).offlineRenderAdmission);
	admission.peakUsefulBinaryBytes = Number(admission.peakUsefulBinaryBytes) + 1;
	let renders = 0;
	await assert.rejects(streamDirectStemArchive({
		destination: preparation.destination,
		plan,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderStem: async () => { renders += 1; return { bytes: Uint8Array.of(1) }; },
	}), /plan changed/iu);
	assert.equal(renders, 0);
	assert.equal(target.aborts(), 1);
	assert.equal(target.commits(), 0);
});

test('compressed entry admission accepts its exact ceiling and refuses zero, ceiling plus one, and false reports', async () => {
	const plan = actualPlan();
	const contract = captureDirectCompressedStemArchiveContract(plan as never);
	assert.ok(contract);
	const cases = [
		{ label: 'zero', bytes: new Uint8Array(0), report: 0 },
		{
			label: 'ceiling plus one',
			bytes: new Uint8Array(contract.entryMaximumByteLength + 1),
			report: contract.entryMaximumByteLength + 1,
		},
		{ label: 'false report', bytes: Uint8Array.of(1), report: 2 },
	];
	for (const entry of cases) {
		const target = preparedStream();
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => target }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		let cleanups = 0;
		await assert.rejects(streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			renderStem: async () => ({
				bytes: entry.bytes,
				byteLength: entry.report,
				cleanup: async () => { cleanups += 1; },
			}),
		}), /input byte length.*plan/iu, entry.label);
		assert.equal(cleanups, 1, entry.label);
		assert.equal(target.aborts(), 1, entry.label);
		assert.equal(target.commits(), 0, entry.label);
	}
});

test('plan hooks, cancellation, and stale generation abort once without retaining encoded output', async () => {
	for (const drift of ['unsafe hook', 'canonical filename'] as const) {
		const plan = structuredClone(actualPlan());
		const target = preparedStream();
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => target }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		let hooks = 0;
		if (drift === 'unsafe hook') {
			Object.setPrototypeOf(record(records(plan.outputs)[0]), {
				toJSON() { hooks += 1; throw new Error('output hook ran'); },
			});
		} else {
			record(records(plan.outputs)[0]).fileName = 'changed.mp3';
			record(records(record(plan.archive).entries)[0]).fileName = 'changed.mp3';
		}
		let renders = 0;
		await assert.rejects(streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			renderStem: async () => { renders += 1; return { bytes: Uint8Array.of(1) }; },
		}), /plan changed/iu);
		assert.equal(hooks, 0, drift);
		assert.equal(renders, 0, drift);
		assert.equal(target.aborts(), 1, drift);
	}

	for (const failure of ['cancelled', 'stale'] as const) {
		const plan = actualPlan();
		const target = preparedStream();
		const controller = new AbortController();
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => target }, plan, null, controller.signal,
		);
		assert.ok(preparation.destination);
		let stale = false;
		let cleanups = 0;
		await assert.rejects(streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: controller.signal,
			assertCurrent() { if (stale) throw new Error('stale generation'); },
			async renderStem() {
				if (failure === 'cancelled') controller.abort();
				else stale = true;
				return { bytes: Uint8Array.of(1), cleanup: async () => { cleanups += 1; } };
			},
		}), failure === 'cancelled' ? /abort/iu : /stale generation/iu);
		assert.equal(cleanups, 1, failure);
		assert.equal(target.aborts(), 1, failure);
		assert.equal(target.commits(), 0, failure);
	}
});

test('write, close, commit, byte-accounting, and cleanup failures preserve destination ownership', async () => {
	{
		const plan = actualPlan();
		const target = preparedStream({
			writeError: new Error('write failed'),
			abortError: new Error('abort failed'),
		});
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => target }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		const error = await streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			renderStem: async () => ({
				bytes: Uint8Array.of(1),
				cleanup: async () => { throw new Error('encoded cleanup failed'); },
			}),
		}).then(() => null, (caught: unknown) => caught);
		assert.match(flattenErrorMessages(error).join(' '), /write failed/iu);
		assert.match(flattenErrorMessages(error).join(' '), /encoded cleanup failed/iu);
		assert.match(flattenErrorMessages(error).join(' '), /abort failed/iu);
		assert.equal(target.aborts(), 1);
	}

	for (const failure of ['close', 'commit', 'reported bytes', 'published size'] as const) {
		const plan = actualPlan();
		const target = preparedStream({
			closeError: failure === 'close' ? new Error('close failed') : undefined,
			commitError: failure === 'commit' ? new Error('commit failed') : undefined,
			reportedByteDelta: failure === 'reported bytes' ? 1 : 0,
			publishedSizeDelta: failure === 'published size' ? 1 : 0,
		});
		const preparation = await prepareDirectStemArchiveDestination(
			{ prepareSave: () => target }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		const stream = streamDirectStemArchive({
			destination: preparation.destination,
			plan,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			renderStem: async (_output, index) => ({ bytes: Uint8Array.of(index + 1) }),
		});
		if (failure === 'close') {
			await assert.rejects(stream, /close failed/iu);
			assert.equal(target.aborts(), 1);
			continue;
		}
		const result = await stream;
		await assert.rejects(
			commitPreparedDirectStemArchiveDestination(
				preparation.destination, plan, result.byteLength, () => undefined,
			),
			failure === 'commit' ? /commit failed/iu
				: failure === 'reported bytes' ? /destination byte count/iu
					: /committed ZIP byte count/iu,
		);
		await preparation.destination.abort();
		if (failure === 'published size') {
			assert.equal(target.commits(), 1);
			assert.equal(target.aborts(), 0, 'a published destination has transferred ownership');
		} else {
			assert.equal(target.aborts(), 1);
		}
	}
});

function actualPlan(livePcmBytes = 2 * 1024 ** 3) {
	return createExportPlan(projectFixture(), {
		mode: 'stems', format: 'mp3', bitRate: 320, includeTail: false,
		livePcmBytes, date: '2026-08-02',
	}) as unknown as Record<string, unknown>;
}

function preparedStream(options: Readonly<{
	events?: string[];
	writeError?: Error;
	closeError?: Error;
	commitError?: Error;
	abortError?: Error;
	reportedByteDelta?: number;
	publishedSizeDelta?: number;
}> = {}) {
	const chunks: Uint8Array[] = [];
	const opens: Array<readonly [number, string]> = [];
	let byteLength = 0;
	let abortCount = 0;
	let commitCount = 0;
	return {
		mode: 'stream' as const,
		async createWritable(maximumByteLength: number, sizeMode: string) {
			opens.push([maximumByteLength, sizeMode]);
			options.events?.push('open');
			return new WritableStream<Uint8Array>({
				write(chunk) {
					if (options.writeError) throw options.writeError;
					chunks.push(chunk.slice());
					byteLength += chunk.byteLength;
				},
				close() {
					options.events?.push('close');
					if (options.closeError) throw options.closeError;
				},
			});
		},
		bytesWritten: () => byteLength + (options.reportedByteDelta ?? 0),
		commit() {
			commitCount += 1;
			options.events?.push('commit');
			if (options.commitError) throw options.commitError;
			return {
				method: 'memory', fileName: 'session-stems.zip',
				size: byteLength + (options.publishedSizeDelta ?? 0),
			};
		},
		abort: async () => {
			abortCount += 1;
			options.events?.push('abort');
			if (options.abortError) throw options.abortError;
		},
		opened: () => opens,
		aborts: () => abortCount,
		commits: () => commitCount,
		bytes: () => concatenate(chunks, byteLength),
	};
}

function concatenate(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function flattenErrorMessages(error: unknown): string[] {
	if (error instanceof AggregateError) {
		return [error.message, ...error.errors.flatMap(flattenErrorMessages)];
	}
	return [error instanceof Error ? error.message : String(error)];
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	assert.ok(Array.isArray(value));
	return value as Record<string, unknown>[];
}

function projectFixture() {
	return {
		schemaVersion: 9, id: 'compressed-stem-stream', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 1 },
		loop: { enabled: false, startFrame: 0, endFrame: 1 },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 1, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 1,
		}],
		tracks: [
			{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['clip'], effectsActive: true, effects: [] },
			{ id: 'music', type: 'audio', name: 'Music', clipIds: [], effectsActive: true, effects: [] },
		],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
