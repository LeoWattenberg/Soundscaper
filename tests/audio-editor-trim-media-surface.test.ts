/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { EXPORT_MENU_COPY_BY_LOCALE } from '../src/common/i18n/export-menu-copy.js';
import { createProjectMediaActionGroup } from '../src/common/editor/controller/project-media-action-group.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';

interface MenuItem {
	readonly id: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onClick?: () => unknown;
	readonly items?: readonly MenuItem[];
}

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const SEQUENCE = Object.freeze({ id: 'main', rate: Object.freeze({ num: 30, den: 1 }) });

test('trim is reachable from the File menu and blocked on a read-only project', () => {
	let invoked = 0;
	const menus = createApplicationMenus(menuInput({
		editBlocked: false,
		actions: actionPorts({ trimMedia: () => { invoked += 1; } }),
	})) as readonly MenuItem[];
	const item = fileItem(menus, 'trim-media');
	assert.ok(item, 'a feature nobody can reach is not a feature');
	assert.equal(item.label, EXPORT_MENU_COPY_BY_LOCALE.en.trimMedia);
	assert.equal(item.disabled, false);
	item.onClick?.();
	assert.equal(invoked, 1);

	// Trimming rewrites the project's media and its edits together, so a project
	// that cannot be edited cannot be trimmed either.
	const blocked = createApplicationMenus(menuInput({
		editBlocked: true, actions: actionPorts({}),
	})) as readonly MenuItem[];
	assert.equal(fileItem(blocked, 'trim-media')?.disabled, true);
});

test('both locales name the command and its outcomes', () => {
	for (const locale of ['en', 'de'] as const) {
		const copy = EXPORT_MENU_COPY_BY_LOCALE[locale];
		for (const key of ['trimMedia', 'trimmingMedia', 'trimmedMedia', 'trimmedMediaIncomplete']) {
			assert.equal(typeof copy[key], 'string', `${locale}.${key}`);
			assert.ok(copy[key].length > 0, `${locale}.${key}`);
			assert.equal(copy[key].includes('…'), false, `${locale}.${key} must not use an ellipsis`);
		}
	}
});

test('the action commits its batch, so the trim is one undo away from gone', async () => {
	const state: Record<string, unknown> = {};
	const statuses: [string, string | undefined][] = [];
	const committed: unknown[] = [];
	const group = createProjectMediaActionGroup({
		state,
		getProject: () => project(),
		store: createStore() as never,
		ffmpeg: createFfmpeg(),
		commit: (command) => { committed.push(command); },
		setStatus: (message, tone) => { statuses.push([message, tone]); },
		copy: EXPORT_MENU_COPY_BY_LOCALE.en,
	});

	const result = await group.trim();
	assert.equal(result?.run.trimmedSources, 1);
	// Through the project's own history, not applied behind its back: a rewrite
	// with no way back to the edit the user had is not an edit.
	assert.equal(committed.length, 1);
	assert.equal((committed[0] as { type: string }).type, 'batch');
	assert.equal(state.deliveryReport, result?.report);
	assert.deepEqual(statuses.map(([message]) => message), [
		EXPORT_MENU_COPY_BY_LOCALE.en.trimmingMedia,
		EXPORT_MENU_COPY_BY_LOCALE.en.trimmedMedia,
	]);
	assert.equal(statuses.at(-1)?.[1], 'success');
});

test('a reference that could not be moved is reported, and nothing is committed for it', async () => {
	// The writer here comes back with a copy that does not hold the clip's whole
	// span, so the source stays bound to what it had — and the surface says so
	// rather than reporting a trim that did not happen.
	const state: Record<string, unknown> = {};
	const statuses: [string, string | undefined][] = [];
	const committed: unknown[] = [];
	const group = createProjectMediaActionGroup({
		state,
		getProject: () => project(),
		store: createStore() as never,
		ffmpeg: createFfmpeg({ dropFrames: 30 }),
		commit: (command) => { committed.push(command); },
		setStatus: (message, tone) => { statuses.push([message, tone]); },
		copy: EXPORT_MENU_COPY_BY_LOCALE.en,
	});

	await group.trim();
	assert.equal(committed.length, 0);
	assert.equal(statuses.at(-1)?.[0], EXPORT_MENU_COPY_BY_LOCALE.en.trimmedMediaIncomplete);
	assert.equal(statuses.at(-1)?.[1], 'warning');
});

test('an edit made while the media is being cut refuses the commit', async () => {
	// A cut runs for as long as the media takes, and the editor stays writable
	// throughout. The batch is computed against the document the cut began with,
	// so committing it to a document that has moved on repoints clips whose
	// in-points changed at material they never referenced — and the rewrite
	// itself only checks that the same clip ids are still there.
	const state: Record<string, unknown> = {};
	const committed: unknown[] = [];
	let current = project();
	const group = createProjectMediaActionGroup({
		state,
		getProject: () => current,
		store: createStore() as never,
		ffmpeg: createFfmpeg({
			onCut: () => { current = { ...project(), revision: 7 } as never; },
		}),
		commit: (command) => { committed.push(command); },
		setStatus: () => undefined,
		copy: EXPORT_MENU_COPY_BY_LOCALE.en,
	});

	await assert.rejects(() => group.trim(), /changed while its media was being trimmed/u);
	assert.equal(committed.length, 0, 'nothing is bound to a document the cut never saw');
});

test('a project without a trim operation answers null rather than pretending', async () => {
	for (const ffmpeg of [null, {}]) {
		const group = createProjectMediaActionGroup({
			state: {}, getProject: () => project(), store: createStore() as never, ffmpeg,
		});
		assert.equal(await group.trim(), null);
		assert.equal(group.planTrim(), null);
	}
});

function project() {
	const source = createVideoSource({
		kind: 'video', id: 'vid', storageKey: 'vid', name: 'take.mp4', mimeType: 'video/mp4',
		frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, width: 640, height: 360,
		frameRate: SEQUENCE.rate, sourceFrameCount: 300, timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest', rate: SEQUENCE.rate,
			reason: 'timing-probe-unavailable', failures: [],
		},
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}, SAMPLE_RATE);
	const context = { projectSampleRate: SAMPLE_RATE, sequence: SEQUENCE, source };
	return createCurrentAudioEditorProject({
		id: 'trim-surface-project', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE], primarySequenceId: SEQUENCE.id,
		sources: [source],
		clips: [createVideoClip({
			id: 'v1', sourceId: 'vid', sequenceId: SEQUENCE.id,
			sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 120, sourceFrameCount: 60,
		}, context)],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: ['v1'] })],
		projectBin: { clips: [] },
	}) as unknown as Readonly<Record<string, unknown>>;
}

function createFfmpeg(options: { dropFrames?: number; onCut?: () => void } = {}) {
	const files = new Map<string, Uint8Array | string>();
	const lease = {
		async writeInput(bytes: Uint8Array) { files.set('in', bytes); return 'in'; },
		async writeText(path: string, text: string) { files.set(path, text); },
		async exec(args: readonly string[]) {
			if (args.some((value) => String(value).includes('showinfo'))) {
				return {
					exitCode: 0,
					logs: Array.from({ length: 300 }, (_value, index) => (
						`[Parsed_showinfo_0 @ 0x1] n:${index} pts:${index} iskey:${index % 10 === 0 ? 1 : 0}`
					)),
				};
			}
			files.set(args[args.length - 1]!, Uint8Array.of(7));
			return { exitCode: 0, logs: [] };
		},
		async readOutput(path: string) {
			const value = files.get(path);
			if (value === undefined) throw new Error(`missing ${path}`);
			return typeof value === 'string' ? new TextEncoder().encode(value) : value;
		},
		async deletePath(path: string) { files.delete(path); },
	};
	return {
		async runTrimMediaOperation<Output>(operation: (value: never) => Promise<Output>) {
			const result = await operation(lease as never) as Record<string, unknown>;
			options.onCut?.();
			if (!options.dropFrames) return result as Output;
			// Hand back a copy that stops short of what the clip reads, which is
			// the case the project edit must refuse rather than approximate.
			const runs = (result.runs as readonly { startFrame: number; endFrame: number }[]).map((run) => ({
				startFrame: run.startFrame,
				endFrame: run.endFrame - options.dropFrames!,
			}));
			return {
				...result,
				runs,
				frameCount: runs.reduce((sum, run) => sum + (run.endFrame - run.startFrame), 0),
			} as Output;
		},
	};
}

function createStore() {
	const written = new Map<string, Uint8Array>();
	return {
		written,
		async loadMediaAsset() {
			return { size: 8, async arrayBuffer() { return new ArrayBuffer(8); } };
		},
		async beginMediaAssetWrite(storageKey: string) {
			const parts: number[] = [];
			return {
				maximumChunkBytes: 1024,
				async write(bytes: Uint8Array) { parts.push(...bytes); },
				async commit() { written.set(storageKey, Uint8Array.from(parts)); return {}; },
				async abort() { /* nothing staged survives */ },
			};
		},
	};
}

function fileItem(menus: readonly MenuItem[], id: string): MenuItem | null {
	const file = menus.find((menu) => menu.id === 'file');
	return file?.items?.find((item) => item.id === id) ?? null;
}

function menuInput({ editBlocked, actions }: Readonly<{ editBlocked: boolean; actions: object }>) {
	return {
		productId: 'soundscaper' as const,
		aboutLabel: 'About',
		capabilities: {},
		locale: 'en',
		copy: copyValues(),
		project: {
			id: 'project', sampleRate: 48_000, sources: [], clips: [],
			tracks: [{ id: 'audio-track', type: 'audio', locked: false, clipIds: [], hidden: false }],
			selection: null, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		},
		snapshot: {
			selectedTrackId: 'audio-track',
			preferences: {
				workspace: {
					activeId: 'editing',
					custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
				},
				view: {},
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: false,
		selectedClip: null,
		playheadSample: 0,
		durationFrames: 0,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: {},
		actionRuntime: null,
		actions,
	};
}

function actionPorts(overrides: Readonly<Record<string, unknown>>): object {
	return new Proxy({ ...overrides }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
}

function copyValues(): object {
	return new Proxy({ ...EXPORT_MENU_COPY_BY_LOCALE.en }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}
