/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import LocalAssistanceDialogSurface from '../src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx';
import type { LocalModelManagerBridge, LocalModelManagerModel } from
	'../src/common/editor/ui/local-model-manager-bridge.ts';
import type { AssistanceGuidedWorkflowId } from '../src/common/editor/assistance/workflow-recipes.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function model(modelId: string, version: string, task: string,
	availability: LocalModelManagerModel['availability']): LocalModelManagerModel {
	return { modelId, version, task, availability, downloadBytes: 4096,
		installedBytes: availability === 'installed' ? 4096 : null, attributionRequired: false };
}

const SILERO = model('silero-vad-v6', '6.2.1', 'voice-activity-detection', 'installed');
const PARAKEET = model('parakeet-tdt-0.6b-v3', '3.0.0', 'speech-recognition', 'installable');
const WHISPER = model('whisper-large-v3-turbo-ggml', '1.0.0', 'speech-recognition', 'installed');
const ALIGNMENT = model('wav2vec2-base-960h', '1.0.0', 'word-alignment', 'installable');

async function mounted(workflowId: AssistanceGuidedWorkflowId,
	initialModels: readonly LocalModelManagerModel[], run: (
		dom: ReturnType<typeof installReactTestDom>, installs: readonly string[],
	) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = scope.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	scope.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let models = [...initialModels];
	const installs: string[] = [];
	const bridge: LocalModelManagerBridge = {
		listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models }),
		installAssistanceModel: async (modelId) => {
			installs.push(modelId);
			models = models.map(value => value.modelId === modelId
				? { ...value, availability: 'installed', installedBytes: 4096 } : value);
			return models.find(value => value.modelId === modelId);
		},
		cancelAssistanceModelInstall: async modelId => ({ contractVersion: 1, modelId, outcome: 'not-active' }),
		installPreseededAssistanceModel: async () => null,
		reconcileAssistanceModels: async () => ({ installedModelIds: [], incompleteModelIds: [], rejected: [] }),
		collectAssistanceModelGarbage: async () => ({}), listAssistanceModelNotices: async () => [],
		relocateAssistanceModels: async () => ({}), removeAssistanceModel: async () => 0,
		onAssistanceInstallProgress: () => () => undefined,
	};
	try {
		await act(async () => root.render(<LocalAssistanceDialogSurface bridgeScope={bridge}
			request={{ mode: 'task', workflowId }} projectId="project" preparation={null}
			copy={{}} onClose={() => undefined} />));
		await run(dom, installs);
	} finally {
		await act(async () => root.unmount());
		scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

test('Transcribe Captions keeps missing required recognizer downloads ahead of runtime activation', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET], async (dom, installs) => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'),
			'installed speech detection alone must not bypass the missing recognizer');
		assert.match(dom.container.textContent, /Parakeet TDT/u);
		assert.equal(dom.find('[data-local-assistance]'), null);
		const download = dom.one('[data-assistance-model-prerequisites]').querySelectorAll('button')
			.find(button => button.textContent === 'Download all');
		assert.ok(download);
		await act(async () => { await reactProps(download).onClick(); });
		assert.deepEqual(installs, [PARAKEET.modelId]);
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
	});
});

test('an installed alternative recognizer can satisfy the explicitly selected task before downloads', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET, WHISPER, ALIGNMENT], async (dom, installs) => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.match(dom.container.textContent, /Parakeet TDT/u);
		const recognizer = dom.container.querySelectorAll('select')
			.find(select => select.getAttribute('aria-label') === 'Speech recognizer');
		assert.ok(recognizer, 'the existing recognizer choice must remain reachable before its download');
		await act(async () => { await reactProps(recognizer).onChange({ currentTarget: { value: 'whisper' } }); });
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
		assert.deepEqual(installs, []);
		const selected = dom.container.querySelectorAll('[role="group"]')
			.find(group => group.getAttribute('aria-label') === 'Speech recognizer');
		assert.ok(selected);
		assert.match(selected.querySelector('button')?.textContent ?? '', /^Whisper/u);
	});
});

test('optional alignment alone does not replace the required task recognizer', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET, { ...ALIGNMENT, availability: 'installed' }], async dom => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.equal(dom.find('[data-local-assistance]'), null);
	});
});

test('Identify Speakers waits for both required model roles', async () => {
	const segmentation = model('pyannote-segmentation-3.0', '3.0.0', 'speaker-segmentation', 'installed');
	const embedding = model('speech-3d-speaker-eres2net', '1.0.0', 'speaker-embedding', 'installable');
	await mounted('identify-speakers', [segmentation, embedding], async dom => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.equal(dom.find('[data-local-assistance]'), null);
	});
});

test('a ready default transcript task admits without requiring optional models or alternate recognizers', async () => {
	await mounted('transcribe-captions', [SILERO, { ...PARAKEET, availability: 'installed' },
		{ ...WHISPER, availability: 'installable' }, ALIGNMENT], async dom => {
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
	});
});
