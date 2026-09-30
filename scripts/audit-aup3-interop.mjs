#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import initSqlJs from 'sql.js';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	commitAup3Autosave,
	initializeAup3Database,
	insertAup3SampleBlock,
	prepareAup3PortableExport,
	writeAup3Document,
} from '../src/common/editor/aup3-database.ts';
import {
	AUP3_APPLICATION_ID,
	AUP3_AUDACITY_VERSION,
	AUP3_BINARY_XML_VERSION,
	AUP3_PAGE_SIZE,
	AUP3_UPSTREAM_COMMIT,
	AUP3_USER_VERSION,
	createAup3ProjectDocument,
	createAup3SampleBlock,
	decodeAup3Float32Samples,
} from '../src/common/editor/aup3-profile.ts';

const EXPECTED_TABLE_NAMES = Object.freeze(['autosave', 'project', 'sampleblocks', 'sqlite_sequence']);
const EXPECTED_SERIALIZATION = Object.freeze({
	databaseByteLength: 327_680,
	databaseSha256: '63867d9e5b43169a130d2cc5860b213166b80ca17297a08ae8d09ebe763fd9a4',
	dictionarySha256: '5f12bc125e38f2257b54952a4fd99f45b1945553a63aa560bfaf46573354628c',
	documentSha256: 'bbc44e32929e20ac5db9387b61411a4307f32008ba5cbe249faed233ef5c54df',
	summary256Sha256: '23d8d67feb9532a3d1f07f26ca0b8d520b6b4e4d153c041f5c5b3d42e7ea92d2',
	summary64kSha256: '1a562f762e8cd61fc7f844d8805bff7af6c4784f10d758c8581f214049b78904',
	samplesSha256: 'c358a7b8fdc386af59b1e8b88f728a517f34bf4166f859f5638132d06916bc34',
});
const FIXTURE_SAMPLES = Float32Array.of(-1, -0.625, -0.25, 0, 0.375, 0.75, 1);

/**
 * Reproduce the maintained source-derived Audacity 3.7.9 database profile,
 * reopen it through a fresh SQLite connection, and verify the serialized PCM.
 * This does not execute Audacity's compiled native loader.
 */
export async function auditAup3ProfileInterop() {
	const SQL = await initSqlJs();
	const first = createAuditDatabase(SQL);
	const second = createAuditDatabase(SQL);
	assert.deepEqual(second.bytes, first.bytes, 'The AUP3 profile must serialize deterministically.');
	assert.deepEqual(second.omissions, first.omissions);

	const database = new SQL.Database(first.bytes);
	try {
		const validation = prepareAup3PortableExport(database);
		assert.equal(Number(sqlScalar(database, 'PRAGMA application_id')), AUP3_APPLICATION_ID);
		assert.equal(Number(sqlScalar(database, 'PRAGMA user_version')), AUP3_USER_VERSION);
		assert.equal(AUP3_PAGE_SIZE, 65_536);
		const pageSize = Number(sqlScalar(database, 'PRAGMA page_size'));
		assert.equal(pageSize, AUP3_PAGE_SIZE);
		const tableNames = sqlRows(database, `
			SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
		`).map(([name]) => String(name));
		assert.deepEqual(tableNames, EXPECTED_TABLE_NAMES);
		assert.equal(validation.source, 'project');
		assert.ok(validation.references);

		const [dictionaryValue, documentValue] = sqlRows(
			database,
			'SELECT dict, doc FROM project WHERE id = 1',
		)[0] ?? [];
		const dictionary = asBytes(dictionaryValue, 'project dictionary');
		const document = asBytes(documentValue, 'project document');
		const decoded = decodeAudacityBinaryXml(dictionary, document);
		assert.equal(audacityXmlAttribute(decoded.root, 'version'), AUP3_BINARY_XML_VERSION);
		assert.equal(audacityXmlAttribute(decoded.root, 'audacityversion'), AUP3_AUDACITY_VERSION);
		const tracks = audacityXmlChildren(decoded.root, 'wavetrack');
		const clipCount = tracks.reduce(
			(total, track) => total + audacityXmlChildren(track, 'waveclip').length,
			0,
		);

		const [summary256Value, summary64kValue, samplesValue] = sqlRows(
			database,
			'SELECT summary256, summary64k, samples FROM sampleblocks WHERE blockid = 1',
		)[0] ?? [];
		const summary256 = asBytes(summary256Value, '256-frame summary');
		const summary64k = asBytes(summary64kValue, '64K-frame summary');
		const sampleBytes = asBytes(samplesValue, 'sample block');
		assert.deepEqual(decodeAup3Float32Samples(sampleBytes), FIXTURE_SAMPLES);
		const serialization = {
			databaseByteLength: first.bytes.byteLength,
			databaseSha256: sha256(first.bytes),
			dictionarySha256: sha256(dictionary),
			documentSha256: sha256(document),
			summary256Sha256: sha256(summary256),
			summary64kSha256: sha256(summary64k),
			samplesSha256: sha256(sampleBytes),
		};
		assert.deepEqual(
			serialization,
			EXPECTED_SERIALIZATION,
			'The reviewed AUP3 serialization changed; inspect and repin it deliberately.',
		);

		return Object.freeze({
			schemaVersion: 1,
			audacity: Object.freeze({
				version: AUP3_AUDACITY_VERSION,
				commit: AUP3_UPSTREAM_COMMIT,
				nativeAudacityExecuted: false,
			}),
			profile: Object.freeze({
				applicationId: AUP3_APPLICATION_ID,
				userVersion: AUP3_USER_VERSION,
				pageSize,
				binaryXmlVersion: AUP3_BINARY_XML_VERSION,
				tableNames: Object.freeze(tableNames),
				databaseByteLength: serialization.databaseByteLength,
				databaseSha256: serialization.databaseSha256,
				dictionarySha256: serialization.dictionarySha256,
				documentSha256: serialization.documentSha256,
			}),
			project: Object.freeze({
				audioTrackCount: tracks.length,
				clipCount,
				distinctSampleBlockCount: validation.references.distinctSampleBlockCount,
				blobOmissionCount: first.omissions.blobCount,
				summary256Sha256: serialization.summary256Sha256,
				summary64kSha256: serialization.summary64kSha256,
				samplesSha256: serialization.samplesSha256,
			}),
		});
	} finally {
		database.close();
	}
}

function createAuditDatabase(SQL) {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const sampleBlockId = insertAup3SampleBlock(database, createAup3SampleBlock(FIXTURE_SAMPLES));
		assert.equal(sampleBlockId, 1);
		const result = createAup3ProjectDocument(auditProject(), new Map([
			['source:0', [{ blockId: sampleBlockId, sampleCount: FIXTURE_SAMPLES.length }]],
		]));
		assert.equal(result.omissions.blobCount, 1);
		writeAup3Document(database, encodeAudacityBinaryXml(result.document));
		assert.equal(commitAup3Autosave(database), true);
		prepareAup3PortableExport(database);
		return { bytes: database.export(), omissions: result.omissions };
	} finally {
		database.close();
	}
}

function auditProject() {
	return {
		id: 'aup3-profile-audit',
		title: 'AUP3 profile audit',
		sampleRate: 48_000,
		selection: {},
		metadata: {},
		clips: [{
			id: 'clip', sourceId: 'source', title: 'Profile tone', timelineStartFrame: 0,
			durationFrames: FIXTURE_SAMPLES.length, sourceDurationFrames: FIXTURE_SAMPLES.length,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Profile tone', clipIds: ['clip'], effects: [],
		}],
		sources: [{
			id: 'source', frameCount: FIXTURE_SAMPLES.length, channelCount: 1, sampleRate: 48_000,
		}],
		master: { effects: [] },
		opaqueExtensions: {
			aup4RootTemplate: {
				node: createAudacityXmlNode('project', [], [{
					kind: 'blob', name: 'aup4-only-audit-state', value: Uint8Array.of(3, 7, 9),
				}]),
			},
		},
	};
}

function sqlRows(database, sql) {
	return database.exec(sql)[0]?.values ?? [];
}

function sqlScalar(database, sql) {
	return sqlRows(database, sql)[0]?.[0];
}

function asBytes(value, label) {
	if (!(value instanceof Uint8Array)) throw new TypeError(`The AUP3 ${label} is not a byte array.`);
	return value;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function isMainModule() {
	return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMainModule()) {
	try {
		process.stdout.write(`${JSON.stringify(await auditAup3ProfileInterop(), null, 2)}\n`);
	} catch (error) {
		process.stderr.write(`${error?.stack || error}\n`);
		process.exitCode = 1;
	}
}
