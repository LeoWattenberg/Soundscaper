/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperVideoProxyActionRuntime, registerFramescaperVideoProxyActionRuntime } from '../src/framescaper/editor-video-proxy-action-runtime.ts';
import { createDeterministicAvFixture } from './browser/fixtures/deterministic-av-media.js';
import { deferred } from './helpers/async-test-control.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const cancel of [false, true]) {
	test(`Attach existing ${cancel ? 'cancels' : 'completes'} after the native picker closes and file admission is pending`, async () => {
		const file = createDeterministicAvFixture('camera.webm');
		const admission = deferred<void>();
		let opening = false;
		const fixture = await nativeSidecarFixture(file.name, file.buffer, {
			openSelectedFile: async (path, flags, mode) => {
				opening = true;
				await admission.promise;
				return await open(path, flags, mode);
			},
		});
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
				assert.deepEqual(Buffer.from(await candidate.arrayBuffer()), file.buffer);
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
			await act(async () => {
				void reactProps(buttonWithText(dom.container, 'Attach existing')).onClick({});
				await Promise.resolve();
				await Promise.resolve();
			});
			assert.equal(fixture.calls.length, 1, 'the native picker has already returned its normal selection');
			assert.equal(opening, true, 'the main process is waiting for that ordinary file to open');
			assert.equal(running.length, 1);
			if (cancel) await act(async () => {
				void reactProps(buttonWithText(dom.container, 'Cancel')).onClick({});
			});
			let failure: unknown;
			await act(async () => {
				admission.resolve();
				await running[0].catch((error: unknown) => { failure = error; });
				await Promise.resolve();
				await Promise.resolve();
			});
			assert.equal(attached, !cancel);
			assert.equal(fixture.releases.length, 1, 'the admitted native selection is released even after Cancel');
			if (cancel) {
				assert.ok(failure instanceof DOMException && failure.name === 'AbortError');
				assert.match(dom.container.textContent, /Proxy work cancelled/u);
			} else {
				assert.equal(failure, undefined);
				assert.match(dom.container.textContent, /Existing proxy validated and attached/u);
			}
		} finally {
			admission.resolve();
			await act(async () => root.unmount());
			scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
			await fixture.close();
		}
	});
}

function buttonWithText(parent: ReactTestElement, text: string): ReactTestElement {
	const button = parent.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Button ${text} was rendered.`);
	return button;
}
