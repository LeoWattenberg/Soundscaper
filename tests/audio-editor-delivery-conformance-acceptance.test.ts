/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import { createFixture, defaultPlan } from './helpers/export-service-fixture.ts';
import { countUnreportedDeliveryConversions } from '../src/common/editor/delivery-conversion-inventory.ts';

/**
 * The 6A-4 acceptance, through the real export path: a delivery is conformed
 * from the bytes it produced, and a deliberately corrupted output fails its
 * reopen check with a report that says why.
 */

test('an ordinary delivery conforms, and says which checks it passed', async () => {
	const fixture = createFixture();
	const output = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(output.fileName, 'mix.wav');
	const report = fixture.state.deliveryReport as {
		items: readonly { code: string; severity: string; data: Record<string, unknown> }[];
	};
	const conformance = report.items.filter(({ code }) => code.startsWith('delivery.conformance-'));
	assert.deepEqual(conformance.map(({ code }) => code), [
		'delivery.conformance-duration',
		'delivery.conformance-channel-count',
		'delivery.conformance-sample-rate',
		'delivery.conformance-sample-format',
		'delivery.conformance-channel-map',
	]);
	assert.ok(conformance.every(({ severity }) => severity === 'info'));
	assert.equal(conformance[0].data.errorSamples, 0, 'delivery.audioDurationErrorSamples');
	assert.equal(
		conformance.find(({ code }) => code === 'delivery.conformance-channel-map')?.data.channelMapErrors,
		0,
		'delivery.channelMapErrors',
	);
});

test('a deliberately corrupted output fails its reopen check and the report says why', async () => {
	const fixture = createFixture();
	fixture.setCorruptOutput(true);
	const output = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(output, undefined, 'a conformance failure is a failed delivery, not a warning');
	assert.equal(fixture.downloads.length, 0, 'and nothing was published');
	assert.match(String(fixture.errors.at(-1)), /DeliveryConformanceError/u);

	// The report is published before the failure is thrown, so the delivery that
	// failed can still say why.
	const report = fixture.state.deliveryReport as {
		items: readonly { code: string; severity: string; message?: string }[];
	};
	const failure = report.items.find(({ severity }) => severity === 'error');
	assert.ok(failure, 'the report carries the finding that failed the delivery');
	assert.match(failure.code, /^delivery\.conformance-/u);
	assert.match(String(failure.message), /reopened|planned/u);
});

test('a delivery that fails conformance does not strand the file it staged', async () => {
	// The staged output's cleanup used to be registered after the conformance
	// assert, so a failed delivery threw straight past it and left the staging
	// file — up to the whole size of the export — in origin storage with no owner.
	const fixture = createFixture();
	const staged = defaultPlan();
	staged.render = { strategy: 'realtime-stream' };
	fixture.setPlan(staged);
	fixture.setCorruptOutput(true);

	const output = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(output, undefined, 'a conformance failure is a failed delivery');
	assert.equal(fixture.downloads.length, 0, 'and nothing was published');
	assert.ok(fixture.calls.includes('sink-remove'), 'the staged file is removed rather than orphaned');
});

test('a stems delivery conforms every stem instead of reporting nothing', async () => {
	// Conformance ran only in the mix branch, so a stems delivery's report carried
	// no conformance items at all — neither findings nor the unverified marker —
	// and a silent report reads as a clean one. A corrupt stem published inside
	// the archive under a report that never claimed to have looked.
	const fixture = createFixture();
	const stems = defaultPlan();
	stems.mode = 'stems';
	stems.outputs = [
		{ kind: 'stem', fileName: '01-drums.wav', trackId: 'track-1' },
		{ kind: 'stem', fileName: '02-bass.wav', trackId: 'track-2' },
	];
	stems.archive = {
		format: 'zip', fileName: 'session-stems.zip', mimeType: 'application/zip', entries: [],
	};
	fixture.setPlan(stems);

	await createEditorExportService(fixture.runtime).handleExportAction('export');

	const report = fixture.state.deliveryReport as { items: readonly { code: string }[] };
	const conformance = report.items.filter(({ code }) => code.startsWith('delivery.conformance-'));
	assert.ok(conformance.length > 0, 'a stems delivery must say what it checked');
	assert.equal(
		conformance.some(({ code }) => code === 'delivery.conformance-duration'),
		true,
		'each stem is reopened, because each one is a file the reader can read',
	);
});

test('a stems delivery whose stem does not reopen fails rather than publishing', async () => {
	const fixture = createFixture();
	const stems = defaultPlan();
	stems.mode = 'stems';
	stems.outputs = [{ kind: 'stem', fileName: '01-drums.wav', trackId: 'track-1' }];
	stems.archive = {
		format: 'zip', fileName: 'session-stems.zip', mimeType: 'application/zip', entries: [],
	};
	fixture.setPlan(stems);
	fixture.setCorruptOutput(true);

	const output = await createEditorExportService(fixture.runtime).handleExportAction('export');

	assert.equal(output, undefined, 'a corrupt stem is a failed delivery, not a published archive');
	assert.equal(fixture.downloads.length, 0);
});

test('conformance items join the report the delivery gate already counts', async () => {
	const fixture = createFixture();
	await createEditorExportService(fixture.runtime).handleExportAction('export');
	const report = fixture.state.deliveryReport as { items: readonly { code: string }[] };
	assert.equal(
		countUnreportedDeliveryConversions(defaultPlan() as never, { sampleRate: 48_000 }, report),
		0,
	);
});

test('a delivery streamed straight to its destination is reported unverified, never assumed good', async () => {
	const fixture = createFixture();
	const compressed = defaultPlan();
	compressed.format = 'mp3';
	compressed.mimeType = 'audio/mpeg';
	fixture.setPlan(compressed);
	await createEditorExportService(fixture.runtime).handleExportAction('export');

	const report = fixture.state.deliveryReport as {
		items: readonly { code: string; disposition: string; severity: string }[];
	};
	const unverified = report.items.find(({ code }) => code === 'delivery.conformance-unverified');
	assert.equal(unverified?.disposition, 'omitted');
	assert.equal(unverified?.severity, 'warning');
	assert.equal(
		report.items.some(({ code }) => code.startsWith('delivery.conformance-') && code !== 'delivery.conformance-unverified'),
		false,
		'nothing was reopened, so nothing may claim to have been checked',
	);
});
