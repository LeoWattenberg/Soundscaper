import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES,
	estimateProjectRevisionPublication,
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
