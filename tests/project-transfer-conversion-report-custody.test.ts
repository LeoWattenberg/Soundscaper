/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_TRANSFER_PROTOCOL_ID,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	admitProjectTransferMessage,
} from '../src/common/transfer/project-transfer-handshake.ts';
import {
	createCrossProductHandoffReportSidecar,
	createCrossProductHandoffReportSidecarFromBinding,
	CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES,
	decodeCrossProductHandoffReportSidecar,
	encodeCrossProductHandoffReportSidecar,
	boundCrossProductHandoffArchiveFileName,
	crossProductHandoffReportSidecarFileName,
	type CrossProductHandoffReportSidecarV1,
} from '../src/common/transfer/cross-product-handoff-report-sidecar.ts';
import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
} from '../src/common/transfer/project-transfer-bundle.ts';
import {
	downloadTransferArchives,
	importTransferArchiveFiles,
	receiveTransferArchives,
	type TransferRuntime,
} from '../src/common/transfer/transfer-session.ts';
import {
	describeTransferDownload,
	describeTransferImport,
} from '../src/common/transfer/transfer-report-rows.ts';
import type { CrossProductHandoffConversionReportV1 } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import { crossProductHandoffRootNames } from
	'../src/common/transfer/cross-product-handoff-root-contract.ts';
import {
	CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY,
	crossProductHandoffProvenanceMatchesReport,
	crossProductHandoffReportClaimsSha256,
	createCrossProductHandoffProvenanceFromReport,
} from '../src/common/transfer/cross-product-handoff-provenance.ts';

const ARCHIVE = new TextEncoder().encode('destination-family archive');
const ENTRY_ID = 'destination-project';

function report(entryId = ENTRY_ID): CrossProductHandoffConversionReportV1 {
	const destinationRoots = new Set(crossProductHandoffRootNames('soundscaper'));
	return {
		kind: 'cross-product-editable-copy-report',
		version: 1,
		invocationId: 'handoff-invocation',
		refused: false,
		source: {
			projectId: 'source-project', schemaFamily: 'framescaper', schemaVersion: 1,
			sha256: '1'.repeat(64),
		},
		destination: {
			projectId: entryId, schemaFamily: 'soundscaper', schemaVersion: 1,
			sha256: '2'.repeat(64),
		},
		roots: crossProductHandoffRootNames('framescaper').map((root) => ({
			root,
			disposition: destinationRoots.has(root) ? 'copy' : 'omit-with-report',
			reason: !destinationRoots.has(root)
				? 'Visual-only adjustment layers are omitted.' : 'Shared family-v1 authority is copied.',
			sourceRef: `framescaper:source-project#/${root}`,
			destinationRef: destinationRoots.has(root) ? `soundscaper:${entryId}#/${root}` : null,
			sourceSha256: '3'.repeat(64),
			destinationSha256: destinationRoots.has(root) ? '3'.repeat(64) : null,
		})),
	};
}

function destinationRootDigests(): Readonly<Record<string, string>> {
	return Object.freeze(Object.fromEntries(report().roots.flatMap(({ root, destinationSha256 }) => (
		destinationSha256 === null ? [] : [[root, destinationSha256]]
	))));
}

function sidecar(bytes = ARCHIVE): CrossProductHandoffReportSidecarV1 {
	return createCrossProductHandoffReportSidecar({
		entryId: ENTRY_ID,
		archive: bytes,
		report: report(),
	});
}

function provenance(value = report()) {
	return createCrossProductHandoffProvenanceFromReport(value);
}

function wireEntry(conversionReportSidecar: CrossProductHandoffReportSidecarV1 | null) {
	return {
		protocol: PROJECT_TRANSFER_PROTOCOL_ID,
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		sessionId: 'session',
		kind: 'entry' as const,
		sequence: 1,
		entryId: ENTRY_ID,
		name: 'Destination.sscape',
		byteLength: ARCHIVE.byteLength,
		payload: ARCHIVE,
		conversionReportSidecar,
	};
}

test('a conversion sidecar is closed, bounded, and cryptographically bound to one archive entry', () => {
	const created = sidecar();
	assert.equal(created.entryId, ENTRY_ID);
	assert.equal(created.archiveByteLength, ARCHIVE.byteLength);
	assert.match(created.archiveSha256, /^[0-9a-f]{64}$/u);
	assert.deepEqual(createCrossProductHandoffReportSidecarFromBinding({
		entryId: created.entryId,
		archiveByteLength: created.archiveByteLength,
		archiveSha256: created.archiveSha256,
		report: created.report,
	}), created);
	assert.deepEqual(decodeCrossProductHandoffReportSidecar(
		encodeCrossProductHandoffReportSidecar(created),
		{ entryId: ENTRY_ID, archive: ARCHIVE },
	), created);

	const unknown = { ...created, surprise: true };
	assert.throws(
		() => decodeCrossProductHandoffReportSidecar(
			new TextEncoder().encode(JSON.stringify(unknown)),
			{ entryId: ENTRY_ID, archive: ARCHIVE },
		),
		/unknown field|closed/u,
	);
	assert.throws(
		() => decodeCrossProductHandoffReportSidecar(
			encodeCrossProductHandoffReportSidecar(created),
			{ entryId: ENTRY_ID, archive: new TextEncoder().encode('tampered') },
		),
		/archive|digest|byte length/u,
	);
	assert.throws(
		() => createCrossProductHandoffReportSidecar({
			entryId: ENTRY_ID,
			archive: ARCHIVE,
			report: report('another-project'),
		}),
		/destination|entry/u,
	);
	assert.throws(() => createCrossProductHandoffReportSidecar({
		entryId: ENTRY_ID,
		archive: ARCHIVE,
		report: { ...report(), roots: report().roots.slice(1) },
	}), /every|root|exhaustive/iu);
	assert.throws(() => createCrossProductHandoffReportSidecar({
		entryId: ENTRY_ID,
		archive: ARCHIVE,
		report: {
			...report(),
			roots: report().roots.map((row, index) => index === 0
				? { ...row, disposition: 'refuse' as const } : row),
		},
	}), /refuse|successful/iu);
	assert.throws(() => createCrossProductHandoffReportSidecar({
		entryId: ENTRY_ID,
		archive: ARCHIVE,
		report: {
			...report(),
			roots: report().roots.map((row, index) => index === 0
				? { ...row, destinationSha256: '4'.repeat(64) } : row),
		},
	}), /copy|digest/iu);
});

test('resident provenance commits every source and root claim in the exposed ledger', () => {
	const original = report();
	const marker = provenance(original);
	const root = original.roots[0]!;
	for (const replacement of [
		{ ...root, disposition: 'materialize-fallback' as const },
		{ ...root, reason: 'A forged root account.' },
		{ ...root, sourceRef: 'framescaper:another-source#/schemaFamily' },
		{ ...root, destinationRef: 'soundscaper:another-destination#/schemaFamily' },
		{ ...root, sourceSha256: 'f'.repeat(64) },
	]) {
		const forged = { ...original, roots: [replacement, ...original.roots.slice(1)] };
		assert.equal(crossProductHandoffProvenanceMatchesReport(marker, forged), false);
	}
});

test('the resident report commitment excludes circular destination digests', () => {
	const original = report();
	const destination = { ...original.destination!, sha256: 'e'.repeat(64) };
	const roots = original.roots.map((root) => ({
		...root,
		destinationSha256: root.destinationSha256 === null ? null : 'd'.repeat(64),
	}));
	assert.equal(
		crossProductHandoffReportClaimsSha256({ ...original, destination, roots }),
		crossProductHandoffReportClaimsSha256(original),
	);
});

test('archive/report companion names stay paired inside a 255-byte UTF-8 filename budget', () => {
	const archive = boundCrossProductHandoffArchiveFileName(`${'🎵'.repeat(300)}: mix.fscape`);
	const companion = crossProductHandoffReportSidecarFileName(archive);
	assert.ok(new TextEncoder().encode(archive).byteLength <= 232);
	assert.ok(new TextEncoder().encode(companion).byteLength <= 255);
	assert.ok(archive.endsWith('.fscape'));
	assert.equal(companion, `${archive}.conversion-report.json`);
	assert.doesNotMatch(archive, /:/u);
	assert.throws(
		() => crossProductHandoffReportSidecarFileName(`${'x'.repeat(250)}.fscape`),
		/filename budget|bounded/iu,
	);
});

test('protocol v2 requires a nullable sidecar and refuses a sidecar that does not bind its payload', () => {
	assert.equal(PROJECT_TRANSFER_PROTOCOL_VERSION, 2);
	assert.equal(admitProjectTransferMessage(wireEntry(null))?.kind, 'entry');
	const missing = { ...wireEntry(null) } as Record<string, unknown>;
	delete missing.conversionReportSidecar;
	assert.throws(() => admitProjectTransferMessage(missing), /conversionReportSidecar.*required/u);

	const tampered = wireEntry(sidecar());
	tampered.payload = new Uint8Array(ARCHIVE);
	tampered.payload[0] ^= 0xff;
	assert.equal(tampered.payload.byteLength, ARCHIVE.byteLength);
	assert.throws(() => admitProjectTransferMessage(tampered), /sidecar|archive|digest/u);
});

test('bundle export turns an editable-copy report into a sidecar without changing archive bytes', async () => {
	const longTitle = `${'🎧'.repeat(200)} destination`;
	const events = exportProjectTransferBundle({
		store: { listProjects: () => [{ id: 'source-project', title: 'Source' }] },
		exportProject: () => ({
			blob: new Blob([ARCHIVE]),
			projectId: ENTRY_ID,
			title: longTitle,
			fileExtension: '.sscape',
			conversionReport: report(),
		}),
	});
	const first = await events.next();
	assert.equal(first.done, false);
	assert.equal(first.value?.kind, 'entry');
	if (first.value?.kind !== 'entry') return;
	assert.deepEqual(first.value.entry.bytes, ARCHIVE);
	assert.deepEqual(first.value.entry.conversionReportSidecar, sidecar());
	assert.ok(new TextEncoder().encode(first.value.entry.fileName).byteLength <= 232);
	assert.ok(new TextEncoder().encode(
		crossProductHandoffReportSidecarFileName(first.value.entry.fileName),
	).byteLength <= 255);
});

test('download fallback saves the identical JSON sidecar beside its native archive', async () => {
	const held = sidecar();
	const saved: string[] = [];
	let savedSidecar: Uint8Array | null = null;
	const result = await downloadTransferArchives({
		collection: {
			entries: [{
				projectId: ENTRY_ID,
				title: 'Destination',
				fileName: 'Destination.sscape',
				mimeType: 'application/vnd.kw.scape+zip',
				byteLength: ARCHIVE.byteLength,
				bytes: ARCHIVE,
				conversionReportSidecar: held,
			}],
			failures: [], total: 1, byteLength: ARCHIVE.byteLength,
		},
		save: (entry) => { saved.push(entry.fileName); },
		saveSidecar: (file) => {
			saved.push(file.fileName);
			savedSidecar = file.bytes;
		},
	});
	assert.deepEqual(saved, [
		'Destination.sscape',
		crossProductHandoffReportSidecarFileName('Destination.sscape'),
	]);
	assert.deepEqual(savedSidecar, encodeCrossProductHandoffReportSidecar(held));
	assert.equal(result.saved, 1);
	assert.equal(result.records[0].conversionReportFileName, saved[1]);

	const silentlyDropped = await downloadTransferArchives({
		collection: {
			entries: [{
				projectId: ENTRY_ID, title: 'Destination', fileName: 'Destination.sscape',
				mimeType: 'application/vnd.kw.scape+zip', byteLength: ARCHIVE.byteLength,
				bytes: ARCHIVE, conversionReportSidecar: held,
			}],
			failures: [], total: 1, byteLength: ARCHIVE.byteLength,
		},
		save: () => undefined,
	});
	assert.equal(silentlyDropped.saved, 0);
	assert.equal(silentlyDropped.partial, 1);
	assert.equal(silentlyDropped.failed, 0);
	assert.equal(silentlyDropped.records[0].outcome, 'partial');
	assert.match(silentlyDropped.records[0].reason ?? '', /sidecar|conversion report/u);
	const described = describeTransferDownload(silentlyDropped);
	assert.equal(described.complete, false);
	assert.match(described.summary, /archive without its confirmed companion/u);
	assert.match(described.rows[0].detail, /saved archive.*companion/iu);
});

test('manual import pairs a bounded sidecar with its archive and exposes it only after recognized import', async () => {
	const held = sidecar();
	const runtime = importRuntime('imported');
	const result = await importTransferArchiveFiles({
		runtime,
		store: importStore(),
		files: [
			file(crossProductHandoffReportSidecarFileName('Destination.sscape'),
				encodeCrossProductHandoffReportSidecar(held)),
			file('Destination.sscape', ARCHIVE),
		],
	});
	assert.equal(result.entries[0].outcome, 'imported');
	assert.deepEqual(result.entries[0].conversionReport, report());
	assert.match(describeTransferImport(result).summary, /Conversion ledger: 1 invocation/u);
	assert.equal(describeTransferImport(result).rows.length, 1 + report().roots.length);

	const failed = await importTransferArchiveFiles({
		runtime: importRuntime('failed'),
		store: importStore(),
		files: [
			file('Destination.sscape', ARCHIVE),
			file(crossProductHandoffReportSidecarFileName('Destination.sscape'),
				encodeCrossProductHandoffReportSidecar(held)),
		],
	});
	assert.equal(failed.entries[0].outcome, 'failed');
	assert.equal(failed.entries[0].conversionReport, null);
	assert.equal(describeTransferImport(failed).rows.length, 1);
});

test('an already-present report needs exact archive evidence and matching resident invocation provenance', async () => {
	const held = sidecar();
	const entry = {
		projectId: ENTRY_ID, title: 'Destination', fileName: 'Destination.sscape',
		mimeType: 'application/vnd.kw.scape+zip', byteLength: ARCHIVE.byteLength,
		bytes: ARCHIVE, conversionReportSidecar: held,
	};
	const matching = await importProjectTransferBundle({
		store: importStore(), entries: [entry],
		inspectProject: () => ({
			id: ENTRY_ID, title: 'Destination', schemaFamily: 'soundscaper', schemaVersion: 1,
			featureRequirementsCompatibility: { compatible: true },
			exists: true, projectCanonicalRootSha256: destinationRootDigests(),
			projectCanonicalSha256: held.report.destination?.sha256,
			existingProjectCanonicalSha256: '9'.repeat(64),
			projectCrossProductHandoffProvenance: provenance(),
			existingProjectCrossProductHandoffProvenance: provenance(),
		}),
		importProject: () => assert.fail('an exact retry must not overwrite the resident project'),
	});
	assert.equal(matching.entries[0].reasonCode, 'already-present');
	assert.deepEqual(matching.entries[0].conversionReport, held.report);

	const collision = await importProjectTransferBundle({
		store: importStore(), entries: [entry],
		inspectProject: () => ({
			id: ENTRY_ID, title: 'Destination', schemaFamily: 'soundscaper', schemaVersion: 1,
			featureRequirementsCompatibility: { compatible: true },
			exists: true, projectCanonicalRootSha256: destinationRootDigests(),
			projectCanonicalSha256: held.report.destination?.sha256,
			existingProjectCanonicalSha256: '4'.repeat(64),
			projectCrossProductHandoffProvenance: provenance(),
			existingProjectCrossProductHandoffProvenance: provenance({
				...report(), invocationId: 'another-invocation',
			}),
		}),
		importProject: () => assert.fail('an identity collision must not overwrite the resident project'),
	});
	assert.equal(collision.entries[0].outcome, 'failed');
	assert.equal(collision.entries[0].reasonCode, 'archive-identity');
	assert.equal(collision.entries[0].conversionReport, null);

	const wrongFamily = await importProjectTransferBundle({
		store: importStore(), entries: [entry],
		inspectProject: () => ({
			id: ENTRY_ID, title: 'Destination', schemaFamily: 'framescaper', schemaVersion: 1,
			featureRequirementsCompatibility: { compatible: true },
			exists: false, projectCanonicalRootSha256: destinationRootDigests(),
			projectCanonicalSha256: held.report.destination?.sha256,
			existingProjectCanonicalSha256: null,
			projectCrossProductHandoffProvenance: provenance(),
			existingProjectCrossProductHandoffProvenance: null,
		}),
		importProject: () => assert.fail('a report for the wrong family must not import'),
	});
	assert.equal(wrongFamily.entries[0].outcome, 'failed');
	assert.equal(wrongFamily.entries[0].reasonCode, 'archive-identity');
	assert.equal(wrongFamily.entries[0].conversionReport, null);
});

test('manual import refuses declared oversize and length mismatches before trusting file content', async () => {
	let oversizedRead = false;
	const oversized = await importTransferArchiveFiles({
		runtime: importRuntime('imported'),
		store: importStore(),
		files: [{
			name: crossProductHandoffReportSidecarFileName('Destination.sscape'),
			byteLength: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES + 1,
			read: async () => {
				oversizedRead = true;
				return new Uint8Array();
			},
		}, file('Destination.sscape', ARCHIVE)],
	});
	assert.equal(oversized.stopped?.code, 'entry-too-large');
	assert.equal(oversizedRead, false, 'declared oversize is refused before arrayBuffer()-equivalent read');

	const encoded = encodeCrossProductHandoffReportSidecar(sidecar());
	const mismatched = await importTransferArchiveFiles({
		runtime: importRuntime('imported'),
		store: importStore(),
		files: [file('Destination.sscape', ARCHIVE), {
			...file(crossProductHandoffReportSidecarFileName('Destination.sscape'), encoded),
			byteLength: encoded.byteLength - 1,
		}],
	});
	assert.equal(mismatched.stopped?.code, 'malformed-entry');
	assert.match(mismatched.stopped?.reason ?? '', /declared.*but read/u);
});

test('manual import refuses two companion names that collapse onto one archive', async () => {
	const encoded = encodeCrossProductHandoffReportSidecar(sidecar());
	let reads = 0;
	const tracked = (name: string) => ({
		name,
		byteLength: encoded.byteLength,
		read: async () => { reads += 1; return encoded; },
	});
	const result = await importTransferArchiveFiles({
		runtime: importRuntime('imported'),
		store: importStore(),
		files: [
			file('Destination.sscape', ARCHIVE),
			tracked('Destination.sscape.conversion-report.json'),
			tracked('Destination.sscape.CONVERSION-REPORT.JSON'),
		],
	});
	assert.equal(result.stopped?.code, 'malformed-entry');
	assert.match(result.stopped?.reason ?? '', /two|duplicate|companion/iu);
	assert.equal(reads, 0, 'ambiguous companions are refused before either sidecar is read');
});

test('live receiving verifies custody and exposes reports only on imported or already-present records', async () => {
	for (const outcome of ['imported', 'already-present', 'failed'] as const) {
		const runtime = receiveRuntime(outcome, sidecar());
		const received = await receiveTransferArchives({
			runtime,
			store: importStore(),
			port: inertPort(),
			sessionId: 'session',
			targetOrigin: 'https://soundscaper.org',
			allowedOrigins: ['https://soundscaper.org', 'https://framescaper.org'],
		});
		const recognized = outcome !== 'failed';
		assert.deepEqual(received.records[0].conversionReport, recognized ? report() : null);
		assert.equal(describeTransferImport({
			entries: received.records,
			total: 1,
			imported: outcome === 'imported' ? 1 : 0,
			skipped: outcome === 'already-present' ? 1 : 0,
			failed: outcome === 'failed' ? 1 : 0,
			completed: true,
			stopped: null,
		}).rows.length, recognized ? 1 + report().roots.length : 1);
	}
});

test('live receiving never elevates an unverified sidecar over the importer result', async () => {
	const runtime = receiveRuntime('already-present', sidecar(), false);
	const received = await receiveTransferArchives({
		runtime,
		store: importStore(),
		port: inertPort(),
		sessionId: 'session',
		targetOrigin: 'https://soundscaper.org',
		allowedOrigins: ['https://soundscaper.org', 'https://framescaper.org'],
	});
	assert.equal(received.records[0].reasonCode, 'already-present');
	assert.equal(received.records[0].conversionReport, null);
});

function file(name: string, bytes: Uint8Array) {
	return { name, byteLength: bytes.byteLength, read: async () => bytes };
}

function importStore() {
	return { loadProject: () => null };
}

function importRuntime(outcome: 'imported' | 'failed'): TransferRuntime {
	return {
		exportProject: () => ({ blob: new Blob() }),
		inspectProject: () => ({
			id: ENTRY_ID, title: 'Destination', schemaFamily: 'soundscaper', schemaVersion: 1,
			featureRequirementsCompatibility: { compatible: true },
			exists: false, projectCanonicalRootSha256: destinationRootDigests(),
			projectCanonicalSha256: report().destination?.sha256,
			existingProjectCanonicalSha256: null,
			projectCrossProductHandoffProvenance: provenance(),
			existingProjectCrossProductHandoffProvenance: null,
		}),
		importProject: () => outcome === 'imported'
			? ({ project: {
				id: ENTRY_ID,
				title: 'Destination',
				opaqueExtensions: { [CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY]: provenance() },
			} })
			: Promise.reject(new Error('import refused')),
		exportBundle: exportProjectTransferBundle,
		importBundle: importProjectTransferBundle,
		sendTransfer: async () => emptyProtocolReport(),
		receiveTransfer: async () => emptyProtocolReport(),
	};
}

function receiveRuntime(
	outcome: 'imported' | 'already-present' | 'failed',
	reportSidecar: CrossProductHandoffReportSidecarV1,
	verified = true,
): TransferRuntime {
	const runtime = importRuntime('imported');
	return {
		...runtime,
		importBundle: (async () => ({
			entries: [{
				index: 0,
				outcome: outcome === 'already-present' ? 'skipped' : outcome,
				projectId: ENTRY_ID,
				title: 'Destination',
				byteLength: ARCHIVE.byteLength,
				reasonCode: outcome === 'already-present' ? 'already-present'
					: outcome === 'failed' ? 'import-failed' : null,
				reason: outcome === 'imported' ? null : outcome,
				residue: 'none',
				conversionReport: verified && outcome !== 'failed' ? reportSidecar.report : null,
			}],
			total: 1,
			imported: outcome === 'imported' ? 1 : 0,
			skipped: outcome === 'already-present' ? 1 : 0,
			failed: outcome === 'failed' ? 1 : 0,
			completed: true,
			stopped: null,
		})) as TransferRuntime['importBundle'],
		receiveTransfer: (async (options) => {
			try {
				await options.acceptEntry({
					entryId: ENTRY_ID,
					name: 'Destination.sscape',
					byteLength: ARCHIVE.byteLength,
					payload: ARCHIVE,
					conversionReportSidecar: reportSidecar,
				});
			} catch {
				// The real receiver converts one rejected entry into a failed outcome.
			}
			return {
				...emptyProtocolReport(),
				entryCount: 1,
				storedCount: outcome === 'failed' ? 0 : 1,
				failedCount: outcome === 'failed' ? 1 : 0,
			};
		}) as TransferRuntime['receiveTransfer'],
	};
}

function emptyProtocolReport() {
	return {
		sessionId: 'session',
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		entryCount: 0,
		storedCount: 0,
		failedCount: 0,
		entries: [],
	};
}

function inertPort() {
	return {
		post: () => undefined,
		subscribe: () => () => undefined,
		close: () => undefined,
	};
}
