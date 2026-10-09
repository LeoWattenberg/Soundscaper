/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { canonicalMediaContentBlob } from '../src/common/editor/storage/media-content-digest.ts';
import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperVideoProxyActionRuntime, registerFramescaperVideoProxyActionRuntime } from '../src/framescaper/editor-video-proxy-action-runtime.ts';
import { createDeterministicAvFixture } from './browser/fixtures/deterministic-av-media.js';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('native Attach existing hands complete normal camera bytes to the proxy authority before releasing its scope', async () => {
	const file = createDeterministicAvFixture('camera.webm');
	const fixture = await nativeSidecarFixture(file.name, file.buffer);
	const service = createAudioEditorFileService({ bridge: fixture.bridge, fetch: fixture.fetch });
	const dom = installReactTestDom();
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = scope.IS_REACT_ACT_ENVIRONMENT;
	scope.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const running: Promise<unknown>[] = [];
	let attached = false;
	const owner = {};
	bindFramescaperVideoProxyActionRuntime(owner, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto', previewTrust: () => 'unverified', pressure: () => null,
		setMode: async () => undefined, reportPreviewPressure: async () => undefined,
		generate: async () => undefined, regenerate: async () => undefined, detach: async () => undefined,
		relinkOriginal: async () => 'relinked',
		attachExisting: async (_sourceId, candidate) => {
			const body = canonicalMediaContentBlob(candidate);
			assert.equal(body.size, file.buffer.byteLength, 'the proxy observer receives real native Blob bytes');
			assert.equal(body.type, file.mimeType);
			assert.deepEqual(Buffer.from(await body.arrayBuffer()), file.buffer);
			await Promise.resolve();
			assert.equal(fixture.releases.length, 0, 'the normal proxy publication still owns its read scope');
			attached = true;
		},
	}));
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		sources: [createVideoSource({
			id: 'camera', name: file.name, storageKey: file.name, mimeType: file.mimeType,
			contentSha256: createHash('sha256').update(file.buffer).digest('hex'),
			sampleFrameCount: 102_400, sourceFrameCount: 32, frameRate: { num: 15, den: 1 },
			width: 96, height: 54,
		})],
	});
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={owner} snapshot={{ project }} editingBlocked={false} copy={{}}
			fileService={service} onClose={() => undefined}
			run={(operation) => {
				const result = Promise.resolve(operation());
				running.push(result);
				return result;
			}}
		/>));
		let failure: unknown;
		await act(async () => {
			void reactProps(buttonWithText(dom.container, 'Attach existing')).onClick({});
			await Promise.resolve();
			assert.equal(running.length, 1);
			await running[0].catch((error: unknown) => { failure = error; });
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(failure, undefined, 'the ordinary native selection completes successfully');
		assert.equal(attached, true);
		assert.equal(fixture.releases.length, 1);
		assert.match(dom.container.textContent, /Existing proxy validated and attached/u);
	} finally {
		await act(async () => root.unmount());
		scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
		await fixture.close();
	}
});

function buttonWithText(parent: ReactTestElement, text: string): ReactTestElement {
	const button = parent.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Button ${text} was rendered.`);
	return button;
}
