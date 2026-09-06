/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The manifest's jump-list shortcuts, carried out.
 *
 * `?launch=new-project` and `?launch=open-project` are the two entries a
 * taskbar or dock offers before there is a window, and an entry labelled "New
 * project" that opens an empty editor is worse than no entry at all. These
 * tests are about what the query does and about the address it leaves behind.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	openWorkspaceProjectPicker,
	startWorkspaceLaunchIntent,
	takeWorkspaceLaunchIntent,
} from '../src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js';

const ROOT = new URL('../', import.meta.url);

/** The address bar, as far as this module is allowed to touch it. */
function addressBar(options: Readonly<{ refuse?: boolean }> = {}) {
	const replaced: string[] = [];
	return {
		replaced,
		replaceAddress(address: string): void {
			if (options.refuse) throw new Error('the document may not rewrite this history');
			replaced.push(address);
		},
	};
}

function fakeController(options: Readonly<{ ready?: PromiseLike<unknown> }> = {}) {
	const calls: string[] = [];
	return {
		calls,
		ready: options.ready ?? Promise.resolve(),
		actions: {
			project: {
				create(): Promise<void> {
					calls.push('create');
					return Promise.resolve();
				},
				list(): Promise<void> {
					calls.push('list');
					return Promise.resolve();
				},
			},
		},
	};
}

async function flush(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

test('the new-project shortcut creates a project, once the controller it outran is ready', async () => {
	let boot = (): void => undefined;
	const controller = fakeController({ ready: new Promise<void>((resolve) => { boot = resolve; }) });
	const address = addressBar();
	const errors: unknown[] = [];

	const intent = startWorkspaceLaunchIntent({
		controller,
		href: 'https://soundscaper.app/en/?launch=new-project',
		onError: (error: unknown) => { errors.push(error); },
		openProjectPicker: () => { throw new Error('the picker is not what New project asked for'); },
		replaceAddress: address.replaceAddress,
	});

	assert.equal(intent, 'new-project');
	assert.deepEqual(controller.calls, [], 'nothing is asked of a controller that is still booting');
	boot();
	await flush();
	assert.deepEqual(controller.calls, ['create']);
	assert.deepEqual(errors, []);
});

test('the open-project shortcut opens the picker and lists what is stored', async () => {
	const controller = fakeController();
	const opened: string[] = [];
	const intent = startWorkspaceLaunchIntent({
		controller,
		href: 'https://soundscaper.app/en/?launch=open-project',
		onError: () => undefined,
		openProjectPicker: () => openWorkspaceProjectPicker({
			controller,
			onError: () => undefined,
			setDialog: (dialog: string) => { opened.push(dialog); },
		}),
		replaceAddress: () => undefined,
	});

	assert.equal(intent, 'open-project');
	assert.deepEqual(opened, ['projects'], 'the dialog is up before the listing arrives');
	await flush();
	assert.deepEqual(controller.calls, ['list']);
});

test('a shortcut naming something this build does not offer still opens the editor', async () => {
	const controller = fakeController();
	const address = addressBar();
	const intent = startWorkspaceLaunchIntent({
		controller,
		href: 'https://soundscaper.app/en/?launch=record-something',
		onError: () => { throw new Error('a stale shortcut is not an error to show anyone'); },
		openProjectPicker: () => { throw new Error('an unknown shortcut opens no picker'); },
		replaceAddress: address.replaceAddress,
	});

	assert.equal(intent, 'record-something');
	await flush();
	assert.deepEqual(controller.calls, [], 'an unrecognized value is ignored, not refused');
	assert.deepEqual(address.replaced, ['/en/'], 'and it is still taken out of the address');
});

test('the launch parameter is taken out of the address and the rest of it is left alone', () => {
	const address = addressBar();
	const intent = takeWorkspaceLaunchIntent(
		'https://soundscaper.app/en/?launch=new-project&project=studio-take#timeline',
		address.replaceAddress,
	);

	assert.equal(intent, 'new-project');
	assert.deepEqual(
		address.replaced,
		['/en/?project=studio-take#timeline'],
		'a refresh must not repeat the shortcut, and must still open the project',
	);
});

test('an address that carries no shortcut is left exactly as it is', () => {
	const address = addressBar();
	assert.equal(takeWorkspaceLaunchIntent('https://soundscaper.app/en/', address.replaceAddress), null);
	assert.deepEqual(address.replaced, []);
	assert.equal(takeWorkspaceLaunchIntent('', address.replaceAddress), null);
	assert.equal(takeWorkspaceLaunchIntent(undefined, address.replaceAddress), null);
	assert.deepEqual(address.replaced, []);
});

test('an empty launch value is taken as a value the editor does not act on', () => {
	const address = addressBar();
	assert.equal(takeWorkspaceLaunchIntent('https://soundscaper.app/en/?launch=', address.replaceAddress), '');
	assert.deepEqual(address.replaced, ['/en/']);
});

test('a history the document may not rewrite still carries out the shortcut', async () => {
	const controller = fakeController();
	const intent = startWorkspaceLaunchIntent({
		controller,
		href: 'https://soundscaper.app/en/?launch=new-project',
		onError: () => undefined,
		openProjectPicker: () => undefined,
		replaceAddress: addressBar({ refuse: true }).replaceAddress,
	});

	assert.equal(intent, 'new-project');
	await flush();
	assert.deepEqual(controller.calls, ['create']);
});

test('a project that cannot be created is reported rather than left to reject unheard', async () => {
	const errors: unknown[] = [];
	const controller = {
		ready: Promise.resolve(),
		actions: { project: { create: () => Promise.reject(new Error('storage was full')) } },
	};

	startWorkspaceLaunchIntent({
		controller,
		href: 'https://soundscaper.app/en/?launch=new-project',
		onError: (error: unknown) => { errors.push(error); },
		openProjectPicker: () => undefined,
		replaceAddress: () => undefined,
	});
	await flush();

	assert.equal(errors.length, 1);
	assert.match(String((errors[0] as Error).message), /storage was full/u);
});

test('the workspace hands the lifecycle the dialog state its shortcut needs, and takes the launch once', async () => {
	const lifecycle = await readFile(
		new URL('src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js', ROOT),
		'utf8',
	);
	assert.match(lifecycle, /launchIntentTakenRef\.current = true;/u, 'the shortcut is taken once per document');
	assert.match(lifecycle, /startWorkspaceLaunchIntent\(\{/u);
	const workspace = await readFile(
		new URL('src/common/editor/ui/workspace/AudioEditorWorkspace.jsx', ROOT),
		'utf8',
	);
	const lifecycleCall = /useAudioEditorWorkspaceLifecycle\(\{([^}]*)\}\)/u.exec(workspace);
	assert.ok(lifecycleCall, 'the workspace calls the lifecycle hook');
	assert.match(lifecycleCall[1]!, /\bsetDialog,/u, 'the project picker needs the workspace dialog state');
});
