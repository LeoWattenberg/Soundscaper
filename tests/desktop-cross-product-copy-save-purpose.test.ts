/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCEPTED_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from '../desktop/constants.js';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { validateSaveChoice } from '../desktop/validation.js';
import { createCrossProductHandoffLaunchIntent } from '../src/common/cross-product-handoff-intent.ts';
import { saveCrossProductEditableCopy } from
	'../src/common/editor/controller/cross-product-handoff-action.ts';
import { convertCrossProductEditableCopy } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-09-05T09:00:00.000Z';

interface NativeSaveFilter {
	readonly name: string;
	readonly extensions: readonly string[];
}

interface NativeSaveChoice {
	readonly purpose: string;
	readonly suggestedName: string;
	readonly filters: readonly NativeSaveFilter[];
}

interface NativeSaveRequest {
	readonly purpose: string;
	readonly suggestedName: string;
}

function nativeSaveChoice(request: NativeSaveRequest): NativeSaveChoice {
	return validateSaveChoice(request) as NativeSaveChoice;
}

function offeredExtensions(choice: NativeSaveChoice): ReadonlySet<string> {
	return new Set(choice.filters.flatMap((filter) => [...filter.extensions]));
}

test('the copy save purpose keeps a destination-family name and offers every project suffix', () => {
	const choice = nativeSaveChoice({ purpose: 'project-copy', suggestedName: 'Session.fscape' });
	assert.equal(choice.suggestedName, 'Session.fscape');
	const offered = offeredExtensions(choice);
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.ok(offered.has(extension.slice(1)), `${extension} is not offered by the copy filter`);
	}
});

test('saving the project itself still offers only the suffix this build writes', () => {
	const choice = nativeSaveChoice({ purpose: 'project', suggestedName: 'Session' });
	assert.equal(choice.suggestedName, `Session${PROJECT_FILE_EXTENSION}`);
	assert.deepEqual(choice.filters, [{
		name: 'Scape project', extensions: [PROJECT_FILE_EXTENSION.slice(1)],
	}]);
});

test('the desktop handoff asks for a purpose whose native filter admits the copy it names', async () => {
	const source = createSoundscaperProject({ id: 'handoff-source', title: 'Session', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'framescaper',
		invocationId: 'handoff-invocation',
		destinationProjectId: 'handoff-copy',
	});
	const requests: NativeSaveRequest[] = [];
	await saveCrossProductEditableCopy({
		getProject: () => source,
		assertProjectHandoffAllowed: () => undefined,
		flushProject: () => undefined,
		store: {},
		fileService: {
			saveFile: (request) => {
				requests.push({ purpose: request.purpose, suggestedName: request.suggestedName });
				return { cancelled: false, fileName: request.suggestedName };
			},
		},
	}, intent, {
		signal: new AbortController().signal,
		loadRuntime: () => ({
			exportEditableCopy: async (project: unknown) => {
				const converted = convertCrossProductEditableCopy({ intent, sourceProject: project });
				return {
					blob: new Blob(['destination']),
					conversionReport: converted.report,
					projectId: converted.project.id,
					title: String(converted.project.title),
					fileExtension: '.fscape' as const,
				};
			},
		} as never),
	});
	const archive = requests[0];
	assert.ok(archive, 'the handoff asked for an archive save');
	assert.equal(archive.suggestedName, 'Session.fscape');
	const choice = nativeSaveChoice(archive);
	assert.equal(choice.suggestedName, 'Session.fscape');
	assert.ok(
		offeredExtensions(choice).has('fscape'),
		`the '${archive.purpose}' save panel refuses the destination suffix it was handed: `
			+ JSON.stringify(choice.filters),
	);
});

test('the native save panel titles a project and its cross-product copy as saves', async () => {
	const panels: { readonly title: string; readonly filters: readonly NativeSaveFilter[] }[] = [];
	const handlers = new Map<unknown, (event: unknown, value: unknown) => unknown>();
	registerFileCapabilityIpc({
		channels: { chooseSaveTarget: 'choose-save-target' },
		desktopSmokeProbe: {
			resolveOpenPaths: () => null,
			resolveSavePath: () => Promise.resolve(null),
		},
		dialog: {
			showSaveDialog: (
				_window: unknown,
				options: { readonly title: string; readonly filters: readonly NativeSaveFilter[] },
			) => {
				panels.push({ title: options.title, filters: options.filters });
				return Promise.resolve({ canceled: true, filePath: '' });
			},
		},
		handle: (channel: unknown, handler: (event: unknown, value: unknown) => unknown) => {
			handlers.set(channel, handler);
		},
		opaqueId: (value: unknown) => String(value),
		ownerFor: () => 'owner',
		pendingOpenProjects: {},
		readCapabilities: {},
		saves: {},
		saveTargets: { registerPath: () => null },
		windowFor: () => null,
	} as never);
	const chooseSaveTarget = handlers.get('choose-save-target');
	assert.ok(chooseSaveTarget, 'the save-target handler registered');
	for (const purpose of ['project', 'project-copy', 'audio']) {
		await chooseSaveTarget({}, { purpose, suggestedName: 'Session' });
	}
	assert.deepEqual(panels.map((panel) => panel.title), [
		'Save project', 'Save project copy', 'Export',
	]);
	assert.ok(
		offeredExtensions({ purpose: 'project-copy', suggestedName: '', filters: panels[1]?.filters ?? [] })
			.has('fscape'),
		'the copy panel offers the destination-family suffix',
	);
});
