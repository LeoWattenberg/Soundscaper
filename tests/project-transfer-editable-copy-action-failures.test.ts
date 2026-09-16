/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCrossProductHandoffLaunchIntent } from '../src/common/cross-product-handoff-intent.ts';
import {
	CrossProductHandoffPartialSaveError,
	saveCrossProductEditableCopy,
	type CrossProductHandoffActionScope,
} from '../src/common/editor/controller/document/internal/cross-product-handoff-action.ts';
import { convertCrossProductEditableCopy } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import type { TransferRuntime } from '../src/common/transfer/transfer-session.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

type SaveRequest = Parameters<CrossProductHandoffActionScope['fileService']['saveFile']>[0];

function unusedRuntimePath(): never {
	throw new Error('An editable-copy save must not invoke another transfer transport.');
}

function handoffFixture(options: Readonly<{
	blob?: unknown;
	saveFile?: (request: SaveRequest) => unknown;
}> = {}) {
	const source = createSoundscaperProject({
		id: 'failure-source', title: 'Editable copy', now: '2026-09-16T10:00:00.000Z',
	});
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'failure-invocation', destinationProjectId: 'failure-destination',
	});
	const conversion = convertCrossProductEditableCopy({ intent, sourceProject: source });
	const cancellation = new AbortController();
	const calls: string[] = [];
	const requests: SaveRequest[] = [];
	const store = { id: 'source-store' };
	const runtime: TransferRuntime = {
		exportProject: unusedRuntimePath,
		inspectProject: unusedRuntimePath,
		importProject: unusedRuntimePath,
		exportBundle: unusedRuntimePath,
		importBundle: unusedRuntimePath,
		sendTransfer: unusedRuntimePath,
		receiveTransfer: unusedRuntimePath,
		exportEditableCopy: async (project, suppliedStore, exportOptions) => {
			calls.push('export');
			assert.equal(project, source);
			assert.equal(suppliedStore, store);
			assert.equal(exportOptions.signal, cancellation.signal);
			assert.equal(exportOptions.maximumBlobBytes, 512 * 1024 * 1024);
			assert.deepEqual(exportOptions.intent, intent);
			return {
				blob: Object.hasOwn(options, 'blob') ? options.blob : new Blob(['abc']),
				conversionReport: conversion.report,
				projectId: 'failure-destination', title: 'Editable copy', fileExtension: '.fscape',
			};
		},
	};
	const scope: CrossProductHandoffActionScope = {
		getProject: () => { calls.push('project'); return source; },
		assertProjectHandoffAllowed: () => { calls.push('guard'); },
		flushProject: () => { calls.push('flush'); },
		store,
		fileService: {
			saveFile: (request) => {
				requests.push(request);
				calls.push(request.purpose);
				return options.saveFile ? options.saveFile(request) : { fileName: request.suggestedName };
			},
		},
	};
	return {
		source, intent, cancellation, calls, requests, scope, runtime, report: conversion.report,
		run: (overrides: Partial<CrossProductHandoffActionScope> = {}, loadedRuntime = runtime) =>
			saveCrossProductEditableCopy({ ...scope, ...overrides }, intent, {
				signal: cancellation.signal,
				loadRuntime: () => { calls.push('runtime'); return loadedRuntime; },
			}),
	};
}

test('a handoff refuses an active project replaced or removed while flushing', async () => {
	for (const replacement of [null, { id: 'other-project' }]) {
		const fixture = handoffFixture();
		let current: unknown = fixture.source;
		await assert.rejects(fixture.run({
			flushProject: () => { current = replacement; },
			getProject: () => current,
		}), { name: 'RangeError', message: /active project no longer matches/u });
		assert.deepEqual(fixture.calls, ['guard']);
		assert.deepEqual(fixture.requests, []);
	}
});

test('a missing editable-copy runtime capability is refused before saving', async () => {
	const fixture = handoffFixture();
	await assert.rejects(fixture.run({}, { ...fixture.runtime, exportEditableCopy: undefined }), {
		name: 'TypeError', message: /runtime cannot export editable/u,
	});
	assert.deepEqual(fixture.calls, ['guard', 'flush', 'project', 'runtime']);
	assert.deepEqual(fixture.requests, []);
});

test('a runtime archive must be a Blob before a file picker is opened', async () => {
	const fixture = handoffFixture({ blob: new Uint8Array([1, 2, 3]) });
	await assert.rejects(fixture.run(), {
		name: 'TypeError', message: /did not produce an archive Blob/u,
	});
	assert.deepEqual(fixture.calls, ['guard', 'flush', 'project', 'runtime', 'export']);
	assert.deepEqual(fixture.requests, []);
});

test('archive save cancellation returns an immutable result without saving a report', async () => {
	const saved = { cancelled: true, fileName: 'Unused choice.fscape' };
	const fixture = handoffFixture({ saveFile: () => saved });
	const result = await fixture.run();
	assert.equal(Object.isFrozen(result), true);
	assert.deepEqual(result, {
		saved, reportSaved: null, report: fixture.report,
		fileName: 'Editable copy.fscape', reportFileName: null,
	});
	assert.deepEqual(fixture.requests.map((request) => request.purpose), ['project-copy']);
});

test('report cancellation and a renamed report expose the confirmed archive as a partial save', async () => {
	for (const reportSave of [
		{ cancelled: true },
		{ fileName: 'Unpaired report.json' },
	]) {
		const fixture = handoffFixture({
			saveFile: (request) => request.purpose === 'project-copy'
				? { fileName: 'Confirmed archive.fscape' } : reportSave,
		});
		await assert.rejects(fixture.run(), (error: unknown) => {
			assert.ok(error instanceof CrossProductHandoffPartialSaveError);
			assert.equal(error.code, 'cross-product-handoff-partial-save');
			assert.equal(error.archiveFileName, 'Confirmed archive.fscape');
			assert.equal(error.reportFileName, 'Confirmed archive.fscape.conversion-report.json');
			assert.ok(error.cause instanceof Error);
			assert.match(error.cause.message, reportSave.cancelled
				? /report save was cancelled/u : /no longer pairs with its archive/u);
			return true;
		});
		assert.deepEqual(fixture.requests.map((request) => request.purpose), ['project-copy', 'report']);
	}
});

test('an abort after the archive is committed identifies that archive without opening the report picker', async () => {
	const reason = new DOMException('Stopped after saving the archive.', 'AbortError');
	const fixture = handoffFixture({ saveFile: () => {
		fixture.cancellation.abort(reason);
		return { fileName: 'Already saved.fscape' };
	} });
	await assert.rejects(fixture.run(), (error: unknown) => {
		assert.ok(error instanceof CrossProductHandoffPartialSaveError);
		assert.equal(error.archiveFileName, 'Already saved.fscape');
		assert.equal(error.reportFileName, null);
		assert.equal(error.cause, reason);
		assert.match(error.message, /Already saved\.fscape was saved.*report was not confirmed/u);
		return true;
	});
	assert.equal(fixture.requests.length, 1);
});

test('a noncanonical confirmed archive name reports a partial save before creating its companion', async () => {
	const fixture = handoffFixture({ saveFile: () => ({ fileName: 'Invalid/name.fscape' }) });
	await assert.rejects(fixture.run(), (error: unknown) => {
		assert.ok(error instanceof CrossProductHandoffPartialSaveError);
		assert.equal(error.archiveFileName, 'Invalid/name.fscape');
		assert.equal(error.reportFileName, null);
		assert.ok(error.cause instanceof RangeError);
		return true;
	});
	assert.equal(fixture.requests.length, 1);
});

test('unavailable save receipt filenames use the archive and report suggestions', async () => {
	for (const receipt of [undefined, null, false, 'downloaded', {}, { fileName: '' }, { fileName: 4 }]) {
		const fixture = handoffFixture({ saveFile: () => receipt });
		const result = await fixture.run();
		assert.equal(result.fileName, 'Editable copy.fscape');
		assert.equal(result.reportFileName, 'Editable copy.fscape.conversion-report.json');
		assert.equal(result.saved, receipt);
		assert.equal(result.reportSaved, receipt);
		assert.equal(fixture.requests.length, 2);
	}
});

test('save receipts do not execute accessor or inherited cancellation and filename properties', async () => {
	const accessorReceipt = Object.defineProperties({}, {
		cancelled: { get: () => { throw new Error('Cancellation accessor must not run.'); } },
		fileName: { get: () => { throw new Error('Filename accessor must not run.'); } },
	});
	const inheritedReceipt: unknown = Object.create({ cancelled: true, fileName: 'Inherited.fscape' });
	for (const receipt of [accessorReceipt, inheritedReceipt]) {
		const fixture = handoffFixture({ saveFile: () => receipt });
		const result = await fixture.run();
		assert.equal(result.fileName, 'Editable copy.fscape');
		assert.equal(result.reportFileName, 'Editable copy.fscape.conversion-report.json');
		assert.equal(fixture.requests.length, 2);
	}
});

class StreamArchiveBlob extends Blob {
	constructor(readonly observedStream: ReadableStream<Uint8Array<ArrayBuffer>>) {
		super(['abc']);
	}

	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		return this.observedStream;
	}
}

test('an archive stream larger than its Blob is cancelled and unlocked without saving', async () => {
	const cancelled: unknown[] = [];
	const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start: (controller) => { controller.enqueue(new Uint8Array([1, 2, 3, 4])); },
		cancel: (reason: unknown) => {
			cancelled.push(reason);
			throw new Error('Reader cancellation itself failed.');
		},
	});
	const fixture = handoffFixture({ blob: new StreamArchiveBlob(stream) });
	await assert.rejects(fixture.run(), /archive stream exceeded its Blob size/u);
	assert.equal(stream.locked, false);
	assert.equal(cancelled.length, 1);
	assert.ok(cancelled[0] instanceof Error);
	assert.match(cancelled[0].message, /archive stream exceeded/u);
	assert.deepEqual(fixture.requests, []);
});

test('an archive stream shorter than its Blob is unlocked and refused before saving', async () => {
	const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start: (controller) => {
			controller.enqueue(new Uint8Array([1, 2]));
			controller.close();
		},
	});
	const fixture = handoffFixture({ blob: new StreamArchiveBlob(stream) });
	await assert.rejects(fixture.run(), /stream ended before its complete Blob size/u);
	assert.equal(stream.locked, false);
	assert.deepEqual(fixture.requests, []);
});

test('an abort while reading the archive cancels and unlocks its stream before saving', async () => {
	let readerStarted!: () => void;
	const started = new Promise<void>((resolve) => { readerStarted = resolve; });
	let streamController!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
	const cancelled: unknown[] = [];
	const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start: (controller) => { streamController = controller; },
		pull: () => { readerStarted(); },
		cancel: (reason: unknown) => { cancelled.push(reason); },
	}, { highWaterMark: 0 });
	const fixture = handoffFixture({ blob: new StreamArchiveBlob(stream) });
	const pending = fixture.run();
	await started;
	const reason = new DOMException('Stop hashing the archive.', 'AbortError');
	fixture.cancellation.abort(reason);
	streamController.enqueue(new Uint8Array([1, 2, 3]));
	await assert.rejects(pending, (error: unknown) => { assert.equal(error, reason); return true; });
	assert.deepEqual(cancelled, [reason]);
	assert.equal(stream.locked, false);
	assert.deepEqual(fixture.requests, []);
});
