import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES,
	PROJECT_PUBLICATION_QUOTA_ERROR_CODE,
	ProjectPublicationQuotaError,
	assertProjectRevisionPublicationCapacity,
	estimateProjectRevisionPublication,
	projectRevisionPublicationCapacityRequirement,
} from '../src/common/editor/project-publication-admission.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

test('project revision publication counts exact canonical UTF-8 payloads twice', () => {
	const project = {
		schemaVersion: 9,
		id: 'project-non-ascii',
		title: 'Grüße 🎛️',
		opaqueExtensions: {
			bytes: new Uint8Array([0, 1, 254, 255]),
			buffer: Uint8Array.of(2, 3, 4).buffer,
		},
	};
	const canonicalDocument = serializeScapeProjectDocument(project);
	const documentBytes = Buffer.byteLength(canonicalDocument, 'utf8');

	assert.notEqual(canonicalDocument, JSON.stringify(project));
	assert.match(canonicalDocument, /\$soundscaperOpaqueBinary/u);
	assert.ok(documentBytes > canonicalDocument.length);
	assert.deepEqual(estimateProjectRevisionPublication(project), {
		document: {
			bytes: documentBytes,
			certainty: 'exact',
			scope: 'canonical-project-document-payload',
		},
		currentAndRevision: {
			bytes: documentBytes * 2,
			certainty: 'exact',
			scope: 'current-and-revision-project-document-payload',
		},
		peakResidentBytes: null,
	});
});

test('project revision publication enforces a non-raiseable document ceiling with a lower-only seam', () => {
	assert.equal(MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES, 256 * 1024 * 1024);
	const project = {
		schemaVersion: 9,
		id: 'bounded-project',
		title: 'bounded',
	};
	const documentBytes = Buffer.byteLength(serializeScapeProjectDocument(project), 'utf8');

	assert.equal(estimateProjectRevisionPublication(project, {
		maximumDocumentBytes: documentBytes,
	}).document.bytes, documentBytes);
	assert.throws(
		() => estimateProjectRevisionPublication(project, {
			maximumDocumentBytes: documentBytes - 1,
		}),
		/exceeds its byte limit/u,
	);
	for (const maximumDocumentBytes of [
		0,
		1.5,
		Number.NaN,
		MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES + 1,
	]) {
		assert.throws(
			() => estimateProjectRevisionPublication(project, { maximumDocumentBytes }),
			/document byte limit is invalid/u,
		);
	}
});

test('project revision capacity adds exact ten-percent headroom with checked arithmetic', () => {
	for (const [publicationBytes, headroomBytes, requiredFreeBytes] of [
		[0, 0, 0],
		[1, 1, 2],
		[9, 1, 10],
		[10, 1, 11],
	] as const) {
		const requirement = projectRevisionPublicationCapacityRequirement(publicationBytes);
		assert.deepEqual(requirement, { publicationBytes, headroomBytes, requiredFreeBytes });
		assert.equal(Object.isFrozen(requirement), true);
	}

	for (const publicationBytes of [
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		assert.throws(
			() => projectRevisionPublicationCapacityRequirement(publicationBytes),
			/safe non-negative integer/iu,
		);
	}
	assert.throws(
		() => projectRevisionPublicationCapacityRequirement(Number.MAX_SAFE_INTEGER),
		/required free bytes.*safe integer/iu,
	);
});

test('project revision capacity admits its exact boundary and refuses one byte less', () => {
	assert.deepEqual(
		assertProjectRevisionPublicationCapacity(100, { usage: 890, quota: 1_000 }),
		{ publicationBytes: 100, headroomBytes: 10, requiredFreeBytes: 110 },
	);

	assert.throws(
		() => assertProjectRevisionPublicationCapacity(100, { usage: 891, quota: 1_000 }),
		(error: unknown) => {
			assert.ok(error instanceof ProjectPublicationQuotaError);
			assert.equal(error.name, 'ProjectPublicationQuotaError');
			assert.equal(error.code, PROJECT_PUBLICATION_QUOTA_ERROR_CODE);
			assert.deepEqual(error.details, {
				publicationBytes: 100,
				headroomBytes: 10,
				requiredFreeBytes: 110,
				usage: 891,
				quota: 1_000,
				availableBytes: 109,
			});
			assert.equal(Object.isFrozen(error.details), true);
			assert.equal(Reflect.set(error.details, 'availableBytes', 110), false);
			return true;
		},
	);
});

test('unknown project capacity estimates remain advisory while overused storage has zero free bytes', () => {
	const expected = { publicationBytes: 100, headroomBytes: 10, requiredFreeBytes: 110 };
	for (const estimate of [
		undefined,
		null,
		{},
		{ usage: null, quota: 1_000 },
		{ usage: 0, quota: null },
		{ usage: -1, quota: 1_000 },
		{ usage: 0, quota: -1 },
		{ usage: Number.NaN, quota: 1_000 },
		{ usage: 0, quota: Number.POSITIVE_INFINITY },
	] as const) {
		assert.deepEqual(assertProjectRevisionPublicationCapacity(100, estimate), expected);
	}

	assert.throws(
		() => assertProjectRevisionPublicationCapacity(1, { usage: 2, quota: 1 }),
		(error: unknown) => {
			assert.ok(error instanceof ProjectPublicationQuotaError);
			assert.equal(error.details.availableBytes, 0);
			return true;
		},
	);
});
