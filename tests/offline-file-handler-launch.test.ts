/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act, createElement } from 'react';

import { SCAPE_MIME_TYPE } from '../src/common/editor/scape-project-format.ts';
import {
	useLaunchedFileImports,
	type LaunchedFileImportsInput,
} from '../src/common/editor/ui/workspace/useLaunchedFileImports.ts';
import {
	bufferedLaunchedFiles,
	installFileHandlerLaunchConsumer,
	subscribeLaunchedFiles,
	type FileHandlerLaunchParams,
	type InstallFileHandlerLaunchConsumerOptions,
	type LaunchedFiles,
} from '../src/common/offline/file-handler-launch.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type LaunchConsumer = (params: FileHandlerLaunchParams) => void;

interface FakeLaunchQueue {
	readonly consumers: readonly LaunchConsumer[];
	setConsumer(consumer: LaunchConsumer): void;
	launch(files: readonly unknown[]): void;
	dispatch(params: FileHandlerLaunchParams): void;
}

function fakeLaunchQueue(): FakeLaunchQueue {
	const consumers: LaunchConsumer[] = [];
	return {
		consumers,
		setConsumer(consumer: LaunchConsumer): void { consumers.push(consumer); },
		launch(files: readonly unknown[]): void { this.dispatch({ files }); },
		dispatch(params: FileHandlerLaunchParams): void {
			for (const consumer of [...consumers]) consumer(params);
		},
	};
}

function fileHandle(file: File): { kind: 'file'; getFile: () => Promise<File> } {
	return { kind: 'file', getFile: () => Promise.resolve(file) };
}

function scapeFile(name: string): File {
	return new File([new Uint8Array([80, 75, 3, 4])], name, { type: SCAPE_MIME_TYPE });
}

function mediaFile(name: string, type = 'audio/wav'): File {
	return new File([new Uint8Array([0, 1, 2, 3])], name, { type });
}

function names(files: readonly File[]): string[] {
	return files.map((file) => file.name);
}

/** Installs a consumer that is always released, so module state never leaks between tests. */
function install(
	t: TestContext,
	options: InstallFileHandlerLaunchConsumerOptions,
): ReturnType<typeof installFileHandlerLaunchConsumer> {
	const installation = installFileHandlerLaunchConsumer(options);
	t.after(() => { installation.release(); });
	return installation;
}

test('a browser without a launch queue leaves the document with nothing to consume', async (t) => {
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, { desktop: false, deliver: (files) => { delivered.push(files); } });

	assert.equal(installation.status, 'unsupported');
	await installation.settled();
	assert.deepEqual(delivered, []);
	assert.deepEqual(bufferedLaunchedFiles(), []);
});

test('the desktop build leaves the launch queue to its own file handling', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: true,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	assert.equal(installation.status, 'unsupported');
	assert.deepEqual(queue.consumers, []);
	queue.launch([fileHandle(scapeFile('Mix.sscape'))]);
	await installation.settled();
	assert.deepEqual(delivered, []);
});

test('a launch that carries no files delivers nothing', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
		onError: (error) => { errors.push(error); },
	});

	assert.equal(installation.status, 'consuming');
	assert.equal(queue.consumers.length, 1);
	queue.launch([]);
	queue.dispatch({});
	await installation.settled();
	assert.deepEqual(delivered, []);
	assert.deepEqual(errors, []);
});

test('a launched project archive is routed to the project opener', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.launch([fileHandle(scapeFile('Field Session.sscape'))]);
	await installation.settled();

	assert.equal(delivered.length, 1);
	assert.deepEqual(names(delivered[0].projects), ['Field Session.sscape']);
	assert.deepEqual(names(delivered[0].imports), []);
});

test('a launched media file is imported into the open project', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.launch([fileHandle(mediaFile('take-one.wav'))]);
	await installation.settled();

	assert.equal(delivered.length, 1);
	assert.deepEqual(names(delivered[0].projects), []);
	assert.deepEqual(names(delivered[0].imports), ['take-one.wav']);
});

test('a mixed launch keeps each file on its own side in the order the system listed them', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.launch([
		fileHandle(mediaFile('take-one.wav')),
		fileHandle(scapeFile('Cut.fscape')),
		fileHandle(mediaFile('take-two.mp3', 'audio/mpeg')),
		fileHandle(scapeFile('Legacy.scape')),
	]);
	await installation.settled();

	assert.equal(delivered.length, 1);
	assert.deepEqual(names(delivered[0].files), [
		'take-one.wav', 'Cut.fscape', 'take-two.mp3', 'Legacy.scape',
	]);
	assert.deepEqual(names(delivered[0].projects), ['Cut.fscape', 'Legacy.scape']);
	assert.deepEqual(names(delivered[0].imports), ['take-one.wav', 'take-two.mp3']);
});

test('the file name decides what a launched file is, never the type the system guessed', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.launch([
		fileHandle(mediaFile('session.zip', SCAPE_MIME_TYPE)),
		fileHandle(mediaFile('Mix.sscape.zip', SCAPE_MIME_TYPE)),
		fileHandle(mediaFile('Mix.sscape', '')),
	]);
	await installation.settled();

	assert.equal(delivered.length, 1);
	assert.deepEqual(names(delivered[0].projects), ['Mix.sscape']);
	assert.deepEqual(names(delivered[0].imports), ['session.zip', 'Mix.sscape.zip']);
});

test('a launch that lists its files as an iterable is routed the same way', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.dispatch({ files: new Set([fileHandle(scapeFile('Mix.sscape'))]) });
	await installation.settled();

	assert.deepEqual(names(delivered[0].projects), ['Mix.sscape']);
});

test('a handle that is not a file is reported and the rest of the launch still opens', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
		onError: (error) => { errors.push(error); },
	});

	queue.launch([
		{ kind: 'directory', name: 'Takes' },
		{ kind: 'file' },
		null,
		fileHandle(mediaFile('take-one.wav')),
	]);
	await installation.settled();

	assert.equal(errors.length, 3);
	for (const error of errors) {
		assert.ok(error instanceof TypeError);
		assert.match(error.message, /cannot read as a file/u);
	}
	assert.equal(delivered.length, 1);
	assert.deepEqual(names(delivered[0].files), ['take-one.wav']);
	assert.deepEqual(names(delivered[0].imports), ['take-one.wav']);
});

test('a file the system cannot hand over is reported and the rest of the launch still opens', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
		onError: (error) => { errors.push(error); },
	});

	queue.launch([
		{ kind: 'file', getFile: () => Promise.reject(new DOMException('not allowed', 'NotAllowedError')) },
		{ kind: 'file', getFile: () => Promise.resolve(null) },
		fileHandle(scapeFile('Mix.sscape')),
	]);
	await installation.settled();

	assert.equal(errors.length, 2);
	assert.equal((errors[0] as DOMException).name, 'NotAllowedError');
	assert.match(String((errors[1] as TypeError).message), /is not a file/u);
	assert.deepEqual(names(delivered[0].projects), ['Mix.sscape']);
});

test('a launch that resolves nothing at all delivers nothing', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
		onError: (error) => { errors.push(error); },
	});

	queue.launch([{ kind: 'directory' }]);
	await installation.settled();

	assert.equal(errors.length, 1);
	assert.deepEqual(delivered, []);
});

test('a second launch reaches the consumer the document already installed', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.launch([fileHandle(scapeFile('First.sscape'))]);
	queue.launch([fileHandle(mediaFile('take-two.wav'))]);
	await installation.settled();

	assert.equal(delivered.length, 2);
	assert.deepEqual(names(delivered[0].projects), ['First.sscape']);
	assert.deepEqual(names(delivered[1].imports), ['take-two.wav']);
});

test('a document claims the launch queue at most once', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const second: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});
	const repeat = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { second.push(files); },
	});

	assert.equal(installation.status, 'consuming');
	assert.equal(repeat.status, 'already-consuming');
	assert.equal(queue.consumers.length, 1);
	queue.launch([fileHandle(scapeFile('Mix.sscape'))]);
	await installation.settled();
	await repeat.settled();

	assert.equal(delivered.length, 1);
	assert.deepEqual(second, []);
});

test('launches that arrive before the editor exists are replayed to the first subscriber', async (t) => {
	const queue = fakeLaunchQueue();
	const installation = install(t, { desktop: false, launchQueue: queue });

	queue.launch([fileHandle(scapeFile('Opened.sscape'))]);
	await installation.settled();
	assert.equal(bufferedLaunchedFiles().length, 1);
	assert.deepEqual(names(bufferedLaunchedFiles()[0].projects), ['Opened.sscape']);

	const received: LaunchedFiles[] = [];
	const unsubscribe = subscribeLaunchedFiles((files) => { received.push(files); });
	t.after(unsubscribe);

	assert.equal(received.length, 1);
	assert.deepEqual(names(received[0].projects), ['Opened.sscape']);
	assert.deepEqual(bufferedLaunchedFiles(), []);

	queue.launch([fileHandle(mediaFile('take-three.wav'))]);
	await installation.settled();
	assert.equal(received.length, 2);
	assert.deepEqual(names(received[1].imports), ['take-three.wav']);
	assert.deepEqual(bufferedLaunchedFiles(), []);
});

test('a subscriber that fails is reported instead of rejecting inside the launch handler', async (t) => {
	const queue = fakeLaunchQueue();
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		onError: (error) => { errors.push(error); },
	});
	const unsubscribe = subscribeLaunchedFiles(() => { throw new Error('the workspace was not ready'); });
	t.after(unsubscribe);

	queue.launch([fileHandle(scapeFile('Mix.sscape'))]);
	await installation.settled();

	assert.equal(errors.length, 1);
	assert.match(String((errors[0] as Error).message), /the workspace was not ready/u);
});

test('a subscriber whose open fails is reported instead of rejecting inside the launch handler', async (t) => {
	const queue = fakeLaunchQueue();
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		onError: (error) => { errors.push(error); },
	});
	const unsubscribe = subscribeLaunchedFiles(() => Promise.reject(new Error('the archive was unreadable')));
	t.after(unsubscribe);

	queue.launch([fileHandle(scapeFile('Mix.sscape'))]);
	await installation.settled();
	await Promise.resolve();

	assert.equal(errors.length, 1);
	assert.match(String((errors[0] as Error).message), /the archive was unreadable/u);
});

test('a released consumer ignores the launches that follow it', async (t) => {
	const queue = fakeLaunchQueue();
	const delivered: LaunchedFiles[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		deliver: (files) => { delivered.push(files); },
	});

	queue.launch([fileHandle(scapeFile('First.sscape'))]);
	await installation.settled();
	installation.release();
	queue.launch([fileHandle(scapeFile('Second.sscape'))]);
	await installation.settled();

	assert.equal(delivered.length, 1);
	assert.deepEqual(names(delivered[0].projects), ['First.sscape']);
	assert.deepEqual(bufferedLaunchedFiles(), []);
});

test('a launch that arrived before the workspace mounted is routed through the workspace import', async (t) => {
	const queue = fakeLaunchQueue();
	const installation = install(t, { desktop: false, launchQueue: queue });
	queue.launch([fileHandle(mediaFile('take-one.wav')), fileHandle(scapeFile('Mix.sscape'))]);
	await installation.settled();
	assert.equal(bufferedLaunchedFiles().length, 1);

	let openTheProject = (): void => undefined;
	const workspace = await mountedLaunchedFileWorkspace({
		ready: new Promise<void>((resolve) => { openTheProject = resolve; }),
	});
	t.after(workspace.cleanup);
	await workspace.mount();
	assert.deepEqual(workspace.imported, [], 'a launch waits for the controller instead of racing its boot');
	assert.deepEqual(bufferedLaunchedFiles(), [], 'the mounted workspace has taken the launch');

	openTheProject();
	await workspace.settle();
	assert.deepEqual(workspace.imported, [['take-one.wav', 'Mix.sscape']]);
	assert.deepEqual(workspace.errors, []);
});

test('a launch that arrives while the workspace is mounted takes the same routed import', async (t) => {
	const queue = fakeLaunchQueue();
	const installation = install(t, { desktop: false, launchQueue: queue });
	const workspace = await mountedLaunchedFileWorkspace();
	t.after(workspace.cleanup);
	await workspace.mount();

	queue.launch([fileHandle(scapeFile('Second.sscape'))]);
	await installation.settled();
	await workspace.settle();

	assert.deepEqual(workspace.imported, [['Second.sscape']]);
	assert.deepEqual(bufferedLaunchedFiles(), []);
});

test('the unmounted workspace leaves a launch buffered for whatever reads it next', async (t) => {
	const queue = fakeLaunchQueue();
	const installation = install(t, { desktop: false, launchQueue: queue });
	const workspace = await mountedLaunchedFileWorkspace();
	t.after(workspace.cleanup);
	await workspace.mount();
	await workspace.unmount();

	queue.launch([fileHandle(scapeFile('After.sscape'))]);
	await installation.settled();
	await workspace.settle();

	assert.deepEqual(workspace.imported, [], 'the unmounted workspace opens nothing');
	assert.equal(bufferedLaunchedFiles().length, 1);
	assert.deepEqual(names(bufferedLaunchedFiles()[0]!.files), ['After.sscape']);
});

test('an import the workspace cannot complete is reported to the workspace, not to the launch handler', async (t) => {
	const queue = fakeLaunchQueue();
	const errors: unknown[] = [];
	const installation = install(t, {
		desktop: false,
		launchQueue: queue,
		onError: (error) => { errors.push(error); },
	});
	const workspace = await mountedLaunchedFileWorkspace({
		importFiles: () => Promise.reject(new Error('the project archive was unreadable')),
	});
	t.after(workspace.cleanup);
	await workspace.mount();

	queue.launch([fileHandle(scapeFile('Broken.sscape'))]);
	await installation.settled();
	await workspace.settle();

	assert.deepEqual(workspace.imported, [['Broken.sscape']]);
	assert.equal(workspace.errors.length, 1);
	assert.match(String((workspace.errors[0] as Error).message), /the project archive was unreadable/u);
	assert.deepEqual(errors, [], 'the launch handler is told nothing it could not act on');
});

/*
 * The claim lives with the workspace rather than the document entry: a module
 * both the entry and the shell import statically is owned by the entry chunk,
 * and the shell then imports the entry that imported it, which the startup
 * graph refuses as a cycle. launchQueue is a queue, so claiming it at mount
 * loses no launch.
 */
test('the workspace claims the launch queue itself', async (t) => {
	const claims: boolean[] = [];
	const workspace = await mountedLaunchedFileWorkspace({
		claim: ({ desktop }) => { claims.push(desktop); },
	});
	t.after(workspace.cleanup);

	await workspace.mount();

	assert.deepEqual(claims, [false]);
});

test('a desktop workspace claims no launch queue of its own', async (t) => {
	const claims: boolean[] = [];
	const workspace = await mountedLaunchedFileWorkspace({
		claim: ({ desktop }) => { claims.push(desktop); }, desktop: true,
	});
	t.after(workspace.cleanup);

	await workspace.mount();

	assert.deepEqual(claims, [true], 'the claim is made but declines itself for desktop');
});

function LaunchedFileImportsHarness(input: LaunchedFileImportsInput): null {
	useLaunchedFileImports(input);
	return null;
}

/** A mounted stand-in for the workspace: the hook, its routed import and its error sink. */
async function mountedLaunchedFileWorkspace(options: Readonly<{
	ready?: PromiseLike<unknown>;
	importFiles?: (files: readonly File[]) => unknown;
	claim?: (options: Readonly<{ desktop: boolean }>) => unknown;
	desktop?: boolean;
}> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const imported: string[][] = [];
	const errors: unknown[] = [];
	const controller = { ready: options.ready ?? Promise.resolve() };
	const importFiles = (files: readonly File[]): unknown => {
		imported.push(names([...files]));
		return options.importFiles ? options.importFiles(files) : files.length;
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let mounted = false;
	const settle = async (): Promise<void> => {
		await act(async () => { await Promise.resolve(); await Promise.resolve(); });
	};
	return {
		imported,
		errors,
		mount: async (): Promise<void> => {
			mounted = true;
			await act(async () => {
				root.render(createElement(LaunchedFileImportsHarness, {
					controller,
					importFiles,
					onError: (error: unknown) => { errors.push(error); },
					...(options.claim ? { claim: options.claim } : {}),
					...(options.desktop === undefined ? {} : { desktop: options.desktop }),
				}));
			});
		},
		unmount: async (): Promise<void> => {
			mounted = false;
			await act(async () => { root.unmount(); });
		},
		settle,
		cleanup: async (): Promise<void> => {
			if (mounted) await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
