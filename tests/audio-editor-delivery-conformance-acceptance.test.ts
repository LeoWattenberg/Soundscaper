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
