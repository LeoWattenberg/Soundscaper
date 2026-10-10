/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperCaptionFileService } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const mode of ['healthy', 'closed', 'new-project', 'retargeted'] as const) test(`pending caption file belongs to its original dialog and project (${mode})`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = createFramescaperProject(PROFILE, { id: 'original' });
	const original = current;
	let resolveChoice: (value: readonly unknown[]) => void = () => undefined;
	const choosing = new Promise<readonly unknown[]>(resolve => { resolveChoice = resolve; });
	let opened = 0;
	let released = 0;
	let commits = 0;
	const controller = { actions: { edit: { commit(command: unknown) {
		commits += 1;
		current = applyFramescaperProjectCommand(PROFILE, current, command);
	} } } };
	const fileService: FramescaperCaptionFileService = {
		isDesktop: true, chooseFiles: () => choosing,
		async withReadDescriptors(_descriptors, _options, consume) {
			opened += 1;
			try {
				return await consume([new File(['1\n00:00:00,100 --> 00:00:00,500\nOriginal dialogue\n\n'], 'dialogue.srt')]);
			} finally { released += 1; }
		},
	};
	const render = () => root.render(<FramescaperFinishingDialog surface="captions"
		controller={controller} project={current} editingBlocked={false} readOnly={false}
		fileService={fileService} run={operation => operation()} onClose={() => root.unmount()} />);
	try {
		await act(async () => { render(); });
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(button);
		await act(async () => { void reactProps(button).onClick({}); });
		if (mode === 'closed' || mode === 'new-project') {
			const close = dom.container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Close');
			assert.ok(close);
			await act(async () => { void reactProps(close).onClick({}); });
		}
		if (mode === 'new-project' || mode === 'retargeted') {
			current = createFramescaperProject(PROFILE, { id: 'new-project' });
			assert.equal(current.primarySequenceId, original.primarySequenceId);
			if (mode === 'retargeted') await act(async () => { render(); });
		}
		await act(async () => {
			resolveChoice([{ id: 'selected-caption' }]);
			await new Promise<void>(resolve => { setImmediate(resolve); });
		});
		assert.equal(opened, 1, 'the selected sidecar has completed its ordinary scoped read');
		assert.equal(released, 1, 'cancelled publication still releases the selected read scope');
		assert.equal(commits, mode === 'healthy' ? 1 : 0);
		assert.equal((current.videoCaptionTracks as readonly unknown[]).length, mode === 'healthy' ? 1 : 0);
	} finally {
		resolveChoice([]);
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
