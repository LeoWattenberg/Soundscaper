/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { applyFramescaperOwnedFinishingCommandFinishing, snapshotFramescaperOwnedFinishingCommandFinishing } from '../src/framescaper/editor-project-finishing-finishing-command.ts';
import type { FramescaperDialogueChainAddCommandFinishing } from '../src/framescaper/editor-audio-dialogue-chain-finishing.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('each production Dialogue Chain application owns fresh replay-stable rack identities', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let project = { schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', effects: [] as readonly unknown[] }] };
	const original = structuredClone(project);
	const commands: FramescaperDialogueChainAddCommandFinishing[] = [];
	const controller = { actions: { edit: { commit(value: unknown) {
		const command = snapshotFramescaperOwnedFinishingCommandFinishing(value);
		assert.equal(command.type, 'framescaper/audio-dialogue-chain-add');
		if (command.type !== 'framescaper/audio-dialogue-chain-add') throw new Error('Wrong command');
		const next = structuredClone(project);
		applyFramescaperOwnedFinishingCommandFinishing(next, command);
		project = next;
		commands.push(command);
	} } } };
	const render = (): void => { root.render(<FramescaperFinishingDialog surface="dialogue-chain"
		controller={controller} project={project} selectedTrackId="voice"
		fileService={{}} editingBlocked={false} readOnly={false}
		run={operation => operation()} onClose={() => {}} />); };
	const apply = async (): Promise<void> => {
		await act(async () => { reactProps(dom.one('[data-dialogue-chain-apply]').querySelector('button')!).onClick?.(); });
		await act(async () => { render(); });
	};
	try {
		await act(async () => { render(); });
		await apply();
		assert.equal(commands.length, 1);
		const firstRack = structuredClone(project.tracks[0]!.effects);
		assert.equal(firstRack.length, 5);
		await apply();
		assert.equal(commands.length, 2, 'a second deliberate application must reach the real rack command');
		assert.equal(project.tracks[0]!.effects.length, 10);
		assert.deepEqual(project.tracks[0]!.effects.slice(0, 5), firstRack);
		assert.notEqual(commands[0]!.chain.id, commands[1]!.chain.id);
		assert.equal(new Set(commands.flatMap(command => command.chain.effects.map(effect => effect.id))).size, 10);
		const replay = structuredClone(original);
		for (const command of commands) applyFramescaperOwnedFinishingCommandFinishing(replay, command);
		assert.deepEqual(replay, project, 'replay uses the allocated command IDs without allocating again');
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
