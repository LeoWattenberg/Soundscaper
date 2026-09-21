/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';

import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const RESULT = Object.freeze({
	id: 42,
	name: 'Rain.ogg',
	creator: Object.freeze({
		username: 'field-recorder',
		pageUrl: 'https://freesound.org/people/field-recorder/',
	}),
	pageUrl: 'https://freesound.org/s/42/',
	license: Object.freeze({
		name: 'Attribution 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
	}),
	durationSeconds: 12,
	preview: Object.freeze({ available: true }),
});

test('the grouped Freesound panel forwards activity state to its preview owner', () => {
	const source = readFileSync(new URL(
		'../src/common/editor/ui/workspace/WorkspacePanelContent.jsx', import.meta.url,
	), 'utf8');
	assert.match(
		source,
		/<FreesoundPanelContainer\b[^>]*\bpanelActive=\{panelActive\}[^>]*\/>/u,
	);
});

test('Freesound preview audio stops when its grouped panel becomes inactive', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorAudio = globalThis.Audio;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const audioInstances: MockAudio[] = [];
	globalThis.Audio = class extends MockAudio {
		constructor(source?: string) {
			super(source);
			audioInstances.push(this);
		}
	} as unknown as typeof Audio;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const controller = {
		actions: {
			freesound: {
				search: async () => ({
					query: 'rain', page: 1, totalCount: 1, totalPages: 1, results: [RESULT],
				}),
				importSound: async () => undefined,
				previewUrl: (soundId: number) => `https://soundscaper.org/api/freesound/sounds/${String(soundId)}/preview`,
			},
		},
	};
	const props = {
		controller,
		snapshot: { locale: 'en', project: { tracks: [] } },
		copy: ENGLISH_COPY,
	};

	try {
		await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive />));
		await act(async () => {
			reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } });
		});
		await act(async () => {
			reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await Promise.resolve();
		});
		const previewButton = dom.container.querySelectorAll('button')
			.find((candidate) => candidate.textContent.startsWith('Preview'));
		assert.ok(previewButton, 'the search result exposes its preview action');
		await act(async () => reactProps(previewButton).onClick());
		assert.equal(audioInstances.length, 1);
		assert.equal(audioInstances[0]?.playCount, 1);

		await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive={false} />));

		assert.equal(audioInstances[0]?.pauseCount, 1);
		assert.equal(audioInstances[0]?.loadCount, 1);
		assert.equal(audioInstances[0]?.src, '');
	} finally {
		await act(async () => root.unmount());
		globalThis.Audio = priorAudio;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

class MockAudio {
	src: string;
	preload = '';
	playCount = 0;
	pauseCount = 0;
	loadCount = 0;
	constructor(source = '') { this.src = source; }
	addEventListener(): void {}
	play(): Promise<void> { this.playCount += 1; return Promise.resolve(); }
	pause(): void { this.pauseCount += 1; }
	load(): void { this.loadCount += 1; }
}
