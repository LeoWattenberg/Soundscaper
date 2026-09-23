/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FreesoundPanel, {
	type FreesoundPanelState,
} from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import {
	AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE,
	clearActiveTimelineClipDragPayload,
	createProjectBinDragPayload,
	writeTimelineClipDragPayload,
} from '../src/common/editor/project-bin-dnd.js';
import FreesoundOriginalFallbackDialog from '../src/common/editor/ui/workspace/FreesoundOriginalFallbackDialog.tsx';
import FreesoundPublishDialog from '../src/common/editor/ui/workspace/FreesoundPublishDialog.tsx';
import { useTimelineClipUploadDrag } from '../src/common/editor/ui/timeline/useTimelineClipUploadDrag.ts';
import { freesoundClipUploadReference } from '../src/common/editor/ui/workspace/freesound-clip-upload-command.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const COPY = FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en;
const STATE: FreesoundPanelState = {
	query: '', license: 'all', sort: 'relevance', page: 1, pageCount: 0,
	totalResults: 0, status: 'idle', previewingSoundId: null, previewPaused: false, results: [],
};
const NOOP_PROPS = {
	onSearch: () => undefined,
	onPreview: () => undefined,
	onPausePreview: () => undefined,
	onResumePreview: () => undefined,
	onSeekPreview: () => undefined,
	onInsertAtPlayhead: () => undefined,
	onAddToProjectBin: () => undefined,
};

test('the OAuth action sits beside attribution and uploads stay hidden while signed out', () => {
	const markup = renderToStaticMarkup(<FreesoundPanel
		copy={COPY} state={STATE} disabled={false} {...NOOP_PROPS}
		auth={{ status: 'disconnected' }}
		onConnect={() => undefined}
	/>);
	const credit = markup.match(/<p class="kw-audio-editor__freesound-credit">[\s\S]*?<\/p>/u)?.[0];
	assert.ok(credit);
	assert.match(credit, /Results provided by/u);
	assert.match(credit, /Connect to Freesound/u);
	assert.doesNotMatch(markup, /data-freesound-uploads/u);
});

test('a connected account gains a collapsed upload drop area with queue status', () => {
	const markup = renderToStaticMarkup(<FreesoundPanel
		copy={COPY} state={STATE} disabled={false} {...NOOP_PROPS}
		auth={{ status: 'connected', user: { username: 'field-recorder' } }}
		uploadQueue={{ active: true, items: [{
			id: 'upload-a', sourceKind: 'file', fileName: 'forest.wav', byteLength: 2048,
			status: 'ready-to-publish', title: 'forest', description: 'Forest ambience', tags: [],
			uploadFilename: 'remote.wav',
		}] }}
		onDisconnect={() => undefined}
		onUploadFiles={() => undefined}
		onUploadProjectClip={() => undefined}
		onPublishUpload={() => Promise.resolve()}
		onRetryUpload={() => undefined}
		onCancelUpload={() => undefined}
		onRemoveUpload={() => undefined}
	/>);
	assert.match(markup, /Connected as field-recorder/u);
	assert.match(markup, /<details[^>]*data-freesound-uploads="true"(?![^>]*\bopen)/u);
	assert.match(markup, /<summary>Upload to Freesound<\/summary>/u);
	assert.ok(markup.indexOf('kw-audio-editor__freesound-credit') < markup.indexOf('data-freesound-uploads'));
	assert.match(markup, /Drop clips or audio files here/u);
	assert.match(markup, /Ready to publish/u);
	assert.match(markup, /role="status" aria-live="polite"/u);
	assert.match(markup, /Ready to publish<span class="kw-audio-editor-sr-only">: forest\.wav<\/span>/u);
});

test('the upload area accepts files plus Project Bin and timeline audio clips, but rejects video clips', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const files: File[][] = [];
	const clips: Array<{ projectId: string; clipId: string }> = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FreesoundPanel
			copy={COPY} state={STATE} disabled={false} {...NOOP_PROPS}
			auth={{ status: 'connected', user: { username: 'field-recorder' } }}
			uploadQueue={{ active: false, items: [] }}
			onUploadFiles={(value) => files.push([...value])}
			onUploadProjectClip={(value) => clips.push(value)}
		/>));
		const drop = dom.one('[data-freesound-upload-drop]');
		const first = new File(['a'], 'a.wav', { type: 'audio/wav' });
		const second = new File(['b'], 'b.flac', { type: 'audio/flac' });
		await act(async () => reactProps(drop).onDrop({
			preventDefault() {},
			dataTransfer: { files: [first, second], getData: () => '', types: ['Files'], dropEffect: 'none' },
		}));
		assert.deepEqual(files, [[first, second]]);

		await act(async () => reactProps(drop).onDrop({
			preventDefault() {},
			dataTransfer: {
				files: [], types: ['application/x-soundscaper-project-bin-clip'], dropEffect: 'none',
				getData: () => createProjectBinDragPayload('project-a', 'clip-a'),
			},
		}));
		assert.deepEqual(clips, [{ projectId: 'project-a', clipId: 'clip-a' }]);

		const values = new Map<string, string>();
		const types: string[] = [];
		const timelineTransfer = {
			files: [], types, dropEffect: 'none', effectAllowed: 'all' as DataTransfer['effectAllowed'],
			setData(type: string, value: string) {
				values.set(type, value);
				if (!types.includes(type)) types.push(type);
			},
			getData: (type: string) => values.get(type) ?? '',
		};
		assert.equal(writeTimelineClipDragPayload(timelineTransfer, 'project-a', {
			id: 'timeline-a', kind: 'audio', title: 'Timeline audio',
		}), true);
		assert.ok(types.includes(AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE));
		await act(async () => reactProps(drop).onDrop({
			preventDefault() {}, dataTransfer: timelineTransfer,
		}));
		assert.deepEqual(clips.at(-1), { projectId: 'project-a', clipId: 'timeline-a' });
		clearActiveTimelineClipDragPayload();

		const videoValues = new Map<string, string>();
		const videoTypes: string[] = [];
		const videoTransfer = {
			files: [], types: videoTypes, dropEffect: 'none', effectAllowed: 'all' as DataTransfer['effectAllowed'],
			setData(type: string, value: string) { videoValues.set(type, value); videoTypes.push(type); },
			getData: (type: string) => videoValues.get(type) ?? '',
		};
		assert.equal(writeTimelineClipDragPayload(videoTransfer, 'project-a', {
			id: 'video-a', kind: 'video', title: 'Timeline video',
		}), false);
		await act(async () => reactProps(drop).onDrop({
			preventDefault() {}, dataTransfer: videoTransfer,
		}));
		assert.equal(clips.some(({ clipId }) => clipId === 'video-a'), false);
	} finally {
		clearActiveTimelineClipDragPayload();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('timeline audio clip menu handles export a drop payload without changing video clip pointer surfaces', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<TimelineUploadDragHarness />));
		const harness = dom.one('[data-timeline-upload-harness="true"]');
		const audioClip = dom.one('[data-clip-id="audio-a"]');
		const videoClip = dom.one('[data-clip-id="video-a"]');
		const audioHandle = audioClip.querySelector('.clip-header__menu-button');
		const videoHandle = videoClip.querySelector('.clip-header__menu-button');
		assert.ok(audioHandle);
		assert.ok(videoHandle);
		assert.equal((audioHandle as unknown as { draggable?: boolean }).draggable, true);
		assert.equal(audioHandle.getAttribute('data-timeline-clip-upload-drag'), 'true');
		assert.notEqual((videoHandle as unknown as { draggable?: boolean }).draggable, true);
		assert.equal(videoHandle.getAttribute('data-timeline-clip-upload-drag'), null);

		const values = new Map<string, string>();
		await act(async () => reactProps(harness).onDragStart({
			target: audioHandle,
			preventDefault: () => assert.fail('audio clips must remain exportable'),
			dataTransfer: {
				effectAllowed: 'all',
				setData: (type: string, value: string) => values.set(type, value),
			},
		}));
		assert.deepEqual(JSON.parse(values.get(AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE) ?? ''), {
			projectId: 'project-a', clipId: 'audio-a', mediaKind: 'audio',
		});
	} finally {
		clearActiveTimelineClipDragPayload();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('Freesound clip commands admit audio and reject visual Project Bin media', () => {
	const project = {
		id: 'project-a', clips: [], sources: [{ id: 'source-a' }], projectBin: { clips: [
			{ id: 'audio-a', sourceId: 'source-a', kind: 'audio', title: 'Audio' },
			{ id: 'missing-a', sourceId: 'missing', kind: 'audio', title: 'Missing' },
			{ id: 'video-a', sourceId: 'source-a', kind: 'video', title: 'Video' },
			{ id: 'still-a', sourceId: 'source-a', kind: 'still', title: 'Still' },
			{ id: 'image-a', sourceId: 'source-a', kind: 'image', title: 'Image' },
			{ id: 'generator-a', sourceId: 'source-a', kind: 'generator', title: 'Generator' },
		] },
	};
	assert.deepEqual(freesoundClipUploadReference(project, 'audio-a'), {
		projectId: 'project-a', clipId: 'audio-a', clipTitle: 'Audio',
	});
	assert.equal(freesoundClipUploadReference(project, 'audio-a', ['source-a']), null);
	for (const clipId of ['missing-a', 'video-a', 'still-a', 'image-a', 'generator-a']) {
		assert.equal(freesoundClipUploadReference(project, clipId), null);
	}
});

test('ready uploads open an editable publish dialog with CC BY selected', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const submissions: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FreesoundPanel
			copy={COPY} state={STATE} disabled={false} {...NOOP_PROPS}
			auth={{ status: 'connected', user: { username: 'field-recorder' } }}
			uploadQueue={{ active: false, items: [{
				id: 'upload-a', sourceKind: 'clip', fileName: 'clip.wav', byteLength: 200,
				status: 'ready-to-publish', title: 'Clip name', description: 'Device: Field microphone',
				tags: ['field-recording'], uploadFilename: 'remote.wav',
			}] }}
			onPublishUpload={async (id, draft) => { submissions.push({ id, draft }); }}
		/>));
		const readyButton = dom.container.querySelectorAll('button')
			.find((element) => element.textContent?.startsWith('Ready to publish')) as ReactTestElement;
		assert.ok(readyButton);
		await act(async () => reactProps(readyButton).onClick());
		const publishDialog = (document.body as unknown as ReactTestElement)
			.querySelector('[data-freesound-publish-dialog="true"]');
		assert.ok(publishDialog);
		const title = publishDialog.querySelectorAll('input').find((element) => element.name === 'title');
		const description = publishDialog.querySelectorAll('textarea').find((element) => element.name === 'description');
		assert.equal(title?.value, 'Clip name');
		assert.equal(description && (reactProps(description) as Readonly<Record<string, unknown>>).value,
			'Device: Field microphone');
		const license = publishDialog.querySelectorAll('select').find((element) => element.name === 'license');
		assert.equal(license && (reactProps(license) as Readonly<Record<string, unknown>>).value, 'cc-by');
		const category = publishDialog.querySelectorAll('select').find((element) => element.name === 'categoryId');
		assert.equal(category?.options.length, 28);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('closing after a publish failure restores focus to the remounted queue action', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<PublishFailureFocusHarness />));
		const ready = () => dom.container.querySelectorAll('button')
			.find((element) => element.textContent?.startsWith('Ready to publish')) as ReactTestElement;
		await act(async () => reactProps(ready()).onClick());
		const publishDialog = (document.body as unknown as ReactTestElement)
			.querySelector('[data-freesound-publish-dialog="true"]');
		assert.ok(publishDialog);
		await act(async () => {
			const publishForm = publishDialog.querySelector('form');
			assert.ok(publishForm);
			reactProps(publishForm).onSubmit({ preventDefault() {} });
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		});
		assert.ok(publishDialog.textContent.includes('Publish rejected'));
		const cancel = publishDialog.querySelectorAll('button')
			.find((element) => element.textContent === 'Cancel') as ReactTestElement;
		await act(async () => {
			reactProps(cancel).onClick();
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		});
		assert.equal(document.activeElement, ready());
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function PublishFailureFocusHarness() {
	const [status, setStatus] = React.useState<'ready-to-publish' | 'publishing'>('ready-to-publish');
	return <FreesoundPanel
		copy={COPY} state={STATE} disabled={false} {...NOOP_PROPS}
		auth={{ status: 'connected', user: { username: 'field-recorder' } }}
		uploadQueue={{ active: status === 'publishing', items: [{
			id: 'focus-upload', sourceKind: 'file', fileName: 'focus.wav', byteLength: 200,
			status, title: 'Focus', description: 'Focus test', tags: ['focus', 'queue', 'audio'],
			uploadFilename: 'focus.wav',
		}] }}
		onPublishUpload={async () => {
			setStatus('publishing');
			await Promise.resolve();
			setStatus('ready-to-publish');
			throw new Error('Publish rejected');
		}}
	/>;
}

test('publish taxonomy options use the selected locale', () => {
	const markup = renderToStaticMarkup(<FreesoundPublishDialog
		copy={{ ...FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.de, cancel: 'Abbrechen' }}
		item={{
			id: 'upload-a', sourceKind: 'file', fileName: 'wald.wav', byteLength: 4,
			status: 'ready-to-publish', title: 'Wald', description: 'Waldaufnahme', tags: [],
			uploadFilename: 'remote.wav', license: 'cc-by',
		}}
		onClose={() => undefined}
		onPublish={() => undefined}
	/>);
	assert.match(markup, /Klanglandschaften — Natur/u);
	assert.doesNotMatch(markup, />Soundscapes — Nature</u);
});

test('the original-size fallback requires an explicit confirm or decline', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: string[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FreesoundOriginalFallbackDialog
			copy={{ ...COPY, cancel: 'Cancel' }}
			onCancel={() => calls.push('cancel')}
			onConfirm={() => calls.push('confirm')}
		/>));
		const button = (label: string) => dom.container.querySelectorAll('button')
			.find((candidate) => candidate.textContent === label);
		const confirm = button('Import HQ preview');
		const cancel = button('Cancel');
		assert.ok(confirm);
		assert.ok(cancel);
		await act(async () => reactProps(confirm).onClick());
		await act(async () => reactProps(cancel).onClick());
		assert.deepEqual(calls, ['confirm', 'cancel']);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function TimelineUploadDragHarness() {
	const rootRef = React.useRef<HTMLDivElement | null>(null);
	const handlers = useTimelineClipUploadDrag({
		project: { id: 'project-a', clips: [
			{ id: 'audio-a', kind: 'audio', title: 'Audio A' },
			{ id: 'video-a', kind: 'video', title: 'Video A' },
		] },
		rootRef,
		viewportRevision: '0:100',
	});
	return <div ref={rootRef} data-timeline-upload-harness="true"
		onDragStart={handlers.onDragStart} onDragEnd={handlers.onDragEnd}>
		<div data-clip-id="audio-a"><button className="clip-header__menu-button" /></div>
		<div data-clip-id="video-a"><button className="clip-header__menu-button" /></div>
	</div>;
}
