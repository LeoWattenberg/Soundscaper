/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import BextMetadataFields from '../src/common/editor/ui/BextMetadataFields.tsx';
import AdmMetadataFields from '../src/common/editor/ui/AdmMetadataFields.tsx';
import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createBextMetadataEditorValue } from '../src/common/editor/ui/bext-metadata-editor-model.ts';
import { MetadataEditorField } from '../src/common/editor/ui/workspace/LabelManagerRows.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = { title: 'Programme', masterChannels: 1, metadata: {}, mixer: { groups: [], sends: [], routes: {} },
	sources: [], clips: [], tracks: [] };

for (const kind of ['general', 'bext', 'adm'] as const) for (const key of ['Enter', 'Escape'] as const) {
	test(`${kind} metadata releases composing ${key} without publishing its unfinished text`, async () => {
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const commits: unknown[] = [];
		try {
			await act(async () => { root.render(kind === 'general'
				? <MetadataEditorField name="title" label="Title" value="Original" disabled={false}
					onCommit={(value: string) => { commits.push(value); }} />
				: kind === 'bext' ? <BextMetadataFields copy={ENGLISH_COPY} value={createBextMetadataEditorValue(project)}
					onCommit={value => { commits.push(value); }} />
					: <AdmMetadataFields copy={ENGLISH_COPY} project={project} value={createDefaultAdmMetadata(project)}
						onCommit={value => { commits.push(value); }} />); });
			const name = kind === 'general' ? 'title' : kind === 'bext' ? 'originator' : 'adm-programme-name';
			const input = dom.container.querySelectorAll('input').find(field => field.name === name);
			assert.ok(input);
			input.focus();
			Object.defineProperty(input, 'checkValidity', { configurable: true, value: () => true });
			Object.defineProperty(input, 'blur', { configurable: true, value: () => {
				input.ownerDocument.activeElement = input.ownerDocument.body;
				reactProps(input).onBlur({ currentTarget: input });
			} });
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'とう' } }); });
			let consumed = false;
			await act(async () => { reactProps(input).onKeyDown({ key, currentTarget: input,
				nativeEvent: { isComposing: true }, preventDefault: () => { consumed = true; },
				stopPropagation: () => { consumed = true; } }); });
			assert.equal(consumed, false);
			assert.equal(input.ownerDocument.activeElement, input);
			assert.equal(input.value, 'とう');
			assert.equal(commits.length, 0);
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '東京の録音' } }); });
			await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input,
				nativeEvent: { isComposing: false }, preventDefault: () => undefined, stopPropagation: () => undefined }); });
			assert.equal(commits.length, 1, 'ordinary Enter publishes the completed text');
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
