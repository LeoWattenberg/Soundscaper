/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureComposition } from '../src/common/editor/controller/capture/capture-composition.ts';
import { adaptFramescaperRecordingControllerFactory } from '../src/common/editor/controller/capture/framescaper-recording-factory-adapter.ts';
import {
	createFramescaperCaptureDocumentPorts,
	createFramescaperCaptureProxyDocumentInstaller,
} from '../src/common/editor/controller/capture/framescaper-capture-document-ports.ts';
import { FRAMESCAPER_EDITOR_CAPTURE_RUNTIME } from '../src/framescaper/editor-capture-runtime.ts';

test('capture document admission is supplied by the selected product runtime', () => {
	assert.equal(FRAMESCAPER_EDITOR_CAPTURE_RUNTIME.adaptRecordingControllerFactory, adaptFramescaperRecordingControllerFactory);
	assert.equal(FRAMESCAPER_EDITOR_CAPTURE_RUNTIME.createDocumentPorts, createFramescaperCaptureDocumentPorts);
	assert.equal(FRAMESCAPER_EDITOR_CAPTURE_RUNTIME.createProxyDocumentInstaller, createFramescaperCaptureProxyDocumentInstaller);
	const reached = new Error('Product runtime reached dependency construction.');
	assert.throws(() => createCaptureComposition(FRAMESCAPER_EDITOR_CAPTURE_RUNTIME, runtime => {
		assert.equal(runtime, FRAMESCAPER_EDITOR_CAPTURE_RUNTIME);
		throw reached;
	}), error => error === reached);
});

test('a product without capture does not construct capture dependencies or proxy resources', () => {
	const result = createCaptureComposition(null, () => { throw new Error('Capture dependencies were evaluated.'); });
	assert.equal(result.binding, null);
	assert.equal(result.proxyScheduler, null);
});
