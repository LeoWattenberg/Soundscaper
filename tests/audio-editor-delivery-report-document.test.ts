/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import {
	DELIVERY_REPORT_DOCUMENT_VERSION,
	deliveryReportFileName,
	saveDeliveryReport,
	serializeDeliveryReport,
} from '../src/common/editor/delivery-report-document.ts';

const RANGE = { startFrame: 0, endFrame: 48_000 };
const CONTEXT = {
	generatedAt: '2026-08-17T09:30:00.000Z',
	productName: 'Soundscaper',
	projectTitle: 'Night Session',
};

function report(options: Record<string, unknown> = { format: 'mp3' }) {
	const plan = createExportPlan({
		id: 'doc', title: 'Night Session', sampleRate: 48_000, masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [], clips: [],
		tracks: [{
			type: 'audio', id: 't', name: 'A', clipIds: [], mute: false, solo: false,
			hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	}, { ...options, range: RANGE });
	return createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
}

test('the same report always serializes to the same bytes', () => {
	const value = report();
	assert.equal(
		serializeDeliveryReport(value, CONTEXT).text,
		serializeDeliveryReport(value, CONTEXT).text,
		'a report saved twice must produce identical evidence',
	);
	const parsed = JSON.parse(serializeDeliveryReport(value, CONTEXT).text);
	assert.equal(parsed.documentVersion, DELIVERY_REPORT_DOCUMENT_VERSION);
	assert.equal(parsed.kind, 'delivery-report');
	assert.equal(parsed.generatedAt, CONTEXT.generatedAt);
	assert.equal(parsed.projectTitle, 'Night Session');
});

test('the document carries every item and count the report held', () => {
	const value = report({ format: 'wav', sampleRate: 44_100 });
	const parsed = JSON.parse(serializeDeliveryReport(value, CONTEXT).text);
	assert.deepEqual(
		parsed.items.map((item: { code: string }) => item.code),
		value.items.map(({ code }) => code),
		'no item may be dropped on the way to disk',
	);
	assert.deepEqual(parsed.counts, { ...value.counts });
	const resample = parsed.items.find((item: { code: string }) => item.code === 'delivery.resample');
	assert.deepEqual(resample.data, { fromSampleRate: 48_000, toSampleRate: 44_100 });
});

test('item data is written in a fixed key order regardless of insertion order', () => {
	const scrambled = {
		schemaVersion: 1 as const,
		format: 'delivery' as const,
		direction: 'export' as const,
		subject: {
			format: 'wav', container: 'WAV', codec: 'PCM',
			sampleRate: 48_000, channelCount: 2, lossless: true,
		},
		items: Object.freeze([Object.freeze({
			code: 'delivery.resample',
			severity: 'info' as const,
			disposition: 'converted' as const,
			scope: Object.freeze({ kind: 'delivery' }),
			data: Object.freeze({ toSampleRate: 44_100, fromSampleRate: 48_000 }),
		})]),
		counts: Object.freeze({ preserved: 0, converted: 1, missing: 0, omitted: 0 }),
	};
	const text = serializeDeliveryReport(scrambled, CONTEXT).text;
	assert.ok(
		text.indexOf('"fromSampleRate"') < text.indexOf('"toSampleRate"'),
		'keys sort so two runs of the same delivery compare byte for byte',
	);
});

test('the file name is derived from the project and the supplied date', () => {
	assert.equal(deliveryReportFileName(CONTEXT), 'Night-Session-delivery-report-2026-08-17.json');
	assert.equal(deliveryReportFileName({}), 'project-delivery-report.json');
	assert.equal(
		deliveryReportFileName({ projectTitle: '../../etc/passwd', generatedAt: '2026-01-02T00:00:00Z' }),
		'etc-passwd-delivery-report-2026-01-02.json',
		'a hostile title cannot escape into the path',
	);
});

test('saving uses the reserved report purpose', async () => {
	const requests: Array<Record<string, unknown>> = [];
	const serialized = await saveDeliveryReport(report(), CONTEXT, {
		saveFile: (request) => { requests.push(request); return true; },
	});
	assert.equal(requests.length, 1);
	assert.equal(requests[0].purpose, 'report');
	assert.equal(requests[0].suggestedName, serialized.fileName);
	assert.equal(requests[0].mimeType, 'application/json');
	assert.ok(requests[0].blob instanceof Blob);
});

test('a host without a file service returns the document rather than doing nothing', async () => {
	const serialized = await saveDeliveryReport(report(), CONTEXT, null);
	assert.ok(serialized.text.includes('"delivery-report"'));
	assert.match(serialized.fileName, /\.json$/u);
});

test('an unsealed or foreign report is refused', async () => {
	assert.throws(() => serializeDeliveryReport({ format: 'aup4' } as never), /sealed delivery report/u);
	await assert.rejects(
		() => saveDeliveryReport(null as never, CONTEXT, null),
		/sealed delivery report/u,
	);
});

test('the save action writes the session report and no-ops before any delivery', async () => {
	const { saveCurrentDeliveryReport } = await import(
		'../src/common/editor/controller/delivery-report-action.ts'
	);
	const requests: Array<Record<string, unknown>> = [];
	const fileService = { saveFile: (request: Record<string, unknown>) => { requests.push(request); } };

	assert.equal(
		await saveCurrentDeliveryReport({ state: {}, fileService }),
		null,
		'nothing to save before a delivery has produced a report',
	);
	assert.equal(requests.length, 0);

	await saveCurrentDeliveryReport({
		state: { deliveryReport: report() },
		productName: 'Soundscaper',
		projectTitle: 'Night Session',
		fileService,
	});
	assert.equal(requests.length, 1);
	assert.equal(requests[0].purpose, 'report');
	assert.match(String(requests[0].suggestedName), /^Night-Session-delivery-report-\d{4}-\d{2}-\d{2}\.json$/u);
});
