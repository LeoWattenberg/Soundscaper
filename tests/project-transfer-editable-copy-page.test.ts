/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	admitCrossProductHandoffLaunchIntent,
	createCrossProductHandoffLaunchIntent,
	serializeCrossProductHandoffLaunchIntent,
} from '../src/common/cross-product-handoff-intent.ts';
import { convertCrossProductEditableCopy } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import { exportProjectTransferBundle, importProjectTransferBundle } from
	'../src/common/transfer/project-transfer-bundle.ts';
import { sendProjectTransfer, receiveProjectTransfer } from
	'../src/common/transfer/project-transfer-handshake.ts';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import type { TransferRuntime } from '../src/common/transfer/transfer-session.ts';
import { FakeWindow, settle } from './project-transfer-page-fixture.ts';
import { saveCrossProductEditableCopy } from
	'../src/common/editor/controller/cross-product-handoff-action.ts';

const NOW = '2026-08-29T12:00:00.000Z';

test('an editable-copy intent refuses to reuse the source project id at its destination', () => {
	const source = createSoundscaperProject({ id: 'shared-project-id', now: NOW });
	assert.throws(() => createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'same-id-create', destinationProjectId: source.id,
	}), /destination project id|separately identified/iu);
	const valid = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'same-id-admission', destinationProjectId: 'fresh-project-id',
	});
	assert.throws(() => admitCrossProductHandoffLaunchIntent({
		...valid, destination: { ...valid.destination, projectId: source.id },
	}), /destination project id|separately identified/iu);
});

test('a launch-bound sender selects one source and downloads its destination-family editable copy', async () => {
	const source = createSoundscaperProject({ id: 'sound-source', title: 'Interview mix', now: NOW });
	const other = createSoundscaperProject({ id: 'other-source', title: 'Do not read', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'framescaper',
		invocationId: 'page-invocation',
		destinationProjectId: 'frame-copy',
	});
	const sender = new FakeWindow('https://soundscaper.org');
	sender.location.search = serializeCrossProductHandoffLaunchIntent(intent);
	const exported: string[] = [];
	const runtime: TransferRuntime = {
		exportProject: async () => ({ blob: new Blob(['ordinary']) }),
		exportEditableCopy: async (project) => {
			exported.push(project.id);
			const converted = convertCrossProductEditableCopy({ intent, sourceProject: project });
			return {
				blob: new Blob(['framescaper-copy']),
				conversionReport: converted.report,
				projectId: converted.project.id,
				title: String(converted.project.title),
				fileExtension: '.fscape',
			};
		},
		inspectProject: async () => ({}),
		importProject: async () => ({}),
		exportBundle: exportProjectTransferBundle,
		importBundle: importProjectTransferBundle,
		sendTransfer: sendProjectTransfer,
		receiveTransfer: receiveProjectTransfer,
	};
	await mountTransferPage({
		scope: sender as never,
		role: 'send',
		configuration: {
			selfOrigin: 'https://soundscaper.org',
			peerOrigin: 'https://framescaper.org',
			allowedOrigins: ['https://soundscaper.org', 'https://framescaper.org'],
			loopback: false,
		},
		dependencies: {
			loadRuntime: async () => runtime,
			openStore: async () => ({
				id: 'source', label: 'Source',
				store: { listProjects: async () => [source, other] },
				close: async () => undefined,
			}) as never,
		},
	});
	await settle();

	assert.deepEqual(sender.document.body.querySelectorAll('[data-transfer-choice]')
		.map(({ value, checked }) => [value, checked]), [
		['soundscaper:sound-source', true],
		['soundscaper:other-source', false],
	]);
	await sender.document.clickButton('Download the ticked archives');
	await settle();

	assert.deepEqual(exported, ['sound-source']);
	assert.deepEqual(sender.saved, [
		'Interview mix.fscape',
		'Interview mix.fscape.conversion-report.json',
	]);
	assert.equal(sender.blobs.peak, 2, 'one archive and its companion are one live download group');
	assert.equal(sender.blobs.live, 2);
	assert.equal(sender.blobs.revoked.length, 0);

	await sender.document.clickButton('Download the ticked archives');
	await settle();
	assert.deepEqual(exported, ['sound-source', 'sound-source']);
	assert.deepEqual(sender.saved, [
		'Interview mix.fscape',
		'Interview mix.fscape.conversion-report.json',
		'Interview mix.fscape',
		'Interview mix.fscape.conversion-report.json',
	]);
	assert.equal(sender.blobs.peak, 2);
	assert.equal(sender.blobs.live, 2);
	assert.equal(sender.blobs.revoked.length, 2, 'the next archive releases the previous archive/report pair');
	assert.doesNotMatch(sender.document.summaryText(), /Conversion ledger/u);
	assert.ok(sender.document.rowText().some((row) => /conversion-report\.json/u.test(row)));
});

test('the desktop fallback saves the converted archive with the destination suffix', async () => {
	const source = createSoundscaperProject({ id: 'desktop-source', title: 'Desktop mix', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'desktop-invocation', destinationProjectId: 'desktop-copy',
	});
	const calls: string[] = [];
	const savedRequests: Record<string, unknown>[] = [];
	const result = await saveCrossProductEditableCopy({
		getProject: () => source,
		assertProjectHandoffAllowed: () => { calls.push('assert'); },
		flushProject: () => { calls.push('flush'); },
		store: { id: 'desktop-store' },
		fileService: { saveFile: (request) => {
			calls.push(`save:${request.purpose}`);
			savedRequests.push(request as unknown as Record<string, unknown>);
			return request.purpose === 'project'
				? { cancelled: false, fileName: 'Desktop copy chosen.fscape' }
				: { cancelled: false, fileName: request.suggestedName };
		} },
	}, intent, {
		signal: new AbortController().signal,
		loadRuntime: () => ({
			exportEditableCopy: async (project: { readonly id: string }) => {
				calls.push(`export:${project.id}`);
				const converted = convertCrossProductEditableCopy({ intent, sourceProject: project });
				return {
					blob: new Blob(['destination']), conversionReport: converted.report,
					projectId: converted.project.id, title: String(converted.project.title),
					fileExtension: '.fscape' as const,
				};
			},
		} as never),
	});
	assert.deepEqual(calls, ['assert', 'flush', 'export:desktop-source', 'save:project', 'save:report']);
	assert.equal(savedRequests[0]?.suggestedName, 'Desktop mix.fscape');
	assert.equal(savedRequests[1]?.suggestedName, 'Desktop copy chosen.fscape.conversion-report.json');
	const sidecar = JSON.parse(await (savedRequests[1]?.blob as Blob).text()) as {
		readonly entryId: string; readonly archiveByteLength: number; readonly archiveSha256: string;
	};
	assert.equal(sidecar.entryId, 'desktop-copy');
	assert.equal(sidecar.archiveByteLength, 11);
	assert.equal(sidecar.archiveSha256, createHash('sha256').update('destination').digest('hex'));
	assert.equal(result.fileName, 'Desktop copy chosen.fscape');
	assert.equal(result.reportFileName, 'Desktop copy chosen.fscape.conversion-report.json');
	assert.equal((result.report as { destination: { projectId: string } }).destination.projectId, 'desktop-copy');
});

test('the desktop fallback names a confirmed archive when its companion save is partial', async () => {
	const source = createSoundscaperProject({ id: 'partial-source', title: 'Partial source', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'partial-invocation', destinationProjectId: 'partial-copy',
	});
	const calls: string[] = [];
	await assert.rejects(saveCrossProductEditableCopy({
		getProject: () => source,
		assertProjectHandoffAllowed: () => undefined,
		flushProject: () => undefined,
		store: {},
		fileService: { saveFile: (request) => {
			calls.push(request.purpose);
			if (request.purpose === 'project') {
				return { cancelled: false, fileName: 'Chosen partial.fscape' };
			}
			throw new Error('report picker failed');
		} },
	}, intent, {
		signal: new AbortController().signal,
		loadRuntime: () => ({
			exportEditableCopy: async (project: unknown) => {
				const converted = convertCrossProductEditableCopy({ intent, sourceProject: project });
				return {
					blob: new Blob(['destination']), conversionReport: converted.report,
					projectId: converted.project.id, title: String(converted.project.title),
					fileExtension: '.fscape' as const,
				};
			},
		} as never),
	}), (error: unknown) => {
		assert.equal((error as { code?: unknown }).code, 'cross-product-handoff-partial-save');
		assert.equal((error as { archiveFileName?: unknown }).archiveFileName, 'Chosen partial.fscape');
		assert.equal(
			(error as { reportFileName?: unknown }).reportFileName,
			'Chosen partial.fscape.conversion-report.json',
		);
		assert.match(String((error as Error).message), /Chosen partial\.fscape.*saved.*report.*not confirmed/iu);
		return true;
	});
	assert.deepEqual(calls, ['project', 'report']);
});

test('the desktop fallback propagates caller cancellation without saving or releasing ownership', async () => {
	const source = createSoundscaperProject({ id: 'cancel-source', title: 'Cancel source', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'cancel-invocation', destinationProjectId: 'cancel-copy',
	});
	const cancellation = new AbortController();
	const calls: string[] = [];
	let exportStarted!: () => void;
	const started = new Promise<void>((resolve) => { exportStarted = resolve; });
	const pending = saveCrossProductEditableCopy({
		getProject: () => source,
		assertProjectHandoffAllowed: () => { calls.push('assert'); },
		flushProject: () => { calls.push('flush'); },
		store: {},
		fileService: { saveFile: () => { calls.push('save'); } },
	}, intent, {
		signal: cancellation.signal,
		loadRuntime: () => ({
			exportEditableCopy: async (_project: unknown, _store: unknown, options: { signal: AbortSignal }) => {
				calls.push('export');
				assert.equal(options.signal, cancellation.signal);
				exportStarted();
				await new Promise<never>((_resolve, reject) => {
					options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
				});
				throw new Error('unreachable');
			},
		} as never),
	});
	await started;
	cancellation.abort(new DOMException('Cancelled by the File menu.', 'AbortError'));
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(calls, ['assert', 'flush', 'export']);
});
