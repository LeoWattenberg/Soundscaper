/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AudiocomPanel, { type AudiocomPanelProps } from '../src/common/editor/ui/workspace/AudiocomPanel.tsx';
import AudiocomPublishDialog from '../src/common/editor/ui/workspace/AudiocomPublishDialog.tsx';
import AudiocomLink from '../src/common/editor/ui/workspace/AudiocomLink.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const COPY = {
	siteName: 'audio.com', searchLabel: 'Search audio.com', searchPlaceholder: 'Search audio.com',
	search: 'Search', searching: 'Searching…', searchPrompt: 'Search for audio.', noResults: 'No audio found.',
	results: 'Search results', resultsCount: '{count} results', searchError: 'Search failed',
	pageNumber: 'Page {page}', pagination: 'Search pages', previousPage: 'Previous', nextPage: 'Next',
	byInline: 'by', playPreview: 'Play preview', stopPreview: 'Stop preview', resultsProvidedBy: 'Results provided by',
	connect: 'Connect to audio.com', connecting: 'Connecting…', disconnect: 'Disconnect',
	checkingAccount: 'Checking account…', connectedAs: 'Connected as {username}', connected: 'Connected to audio.com',
	uploadHeading: 'Upload to audio.com', uploadDrop: 'Drop audio files here', chooseFiles: 'Choose audio files',
	uploadFileTypes: 'Audio files up to 1 GiB', uploadQueue: 'Upload queue', title: 'Title', description: 'Description',
	category: 'Category', license: 'License', visibility: 'Visibility', listed: 'Listed', unlisted: 'Unlisted',
	unlistedNotice: 'Anyone with the link can listen to unlisted audio.', downloadable: 'Allow downloads',
	publish: 'Publish', cancel: 'Cancel', retry: 'Retry', remove: 'Remove', openAudio: 'Open on audio.com',
	statusDraft: 'Ready to publish', statusQueued: 'Queued', statusUploading: 'Uploading', statusProcessing: 'Processing',
	statusComplete: 'Published', statusError: 'Failed', statusCancelled: 'Cancelled',
	uploadRights: 'Only upload audio you have permission to share.',
	uploadRightsConsent: 'I have permission to share this audio.',
	licenseCcBy: 'CC BY 4.0',
	projectApiUnavailable: 'Audacity project upload and retrieval are not exposed by the public audio.com API.',
};
const BASE: AudiocomPanelProps = {
	copy: COPY, disabled: false,
	state: {
		search: { query: '', page: 1, hasNext: false, status: 'idle', results: [] },
		previewingId: null, auth: { status: 'disconnected' }, uploadQueue: { items: [], active: false },
	},
	onSearch: () => undefined, onPreview: () => undefined, onStopPreview: () => undefined,
	onConnect: () => undefined, onDisconnect: () => undefined, onUploadFiles: () => undefined,
	onPublish: () => undefined, onRetry: () => undefined, onCancel: () => undefined, onRemove: () => undefined,
};

test('audio.com requests a connection before search and upload controls stay collapsed until connected', () => {
	const disconnected = renderToStaticMarkup(<AudiocomPanel {...BASE} />);
	assert.match(disconnected, /role="search"/u);
	assert.match(disconnected, /type="search"[^>]*disabled/u);
	assert.match(disconnected, /Connect to audio.com/u);
	assert.doesNotMatch(disconnected, /data-audiocom-uploads/u);
	const connected = renderToStaticMarkup(<AudiocomPanel {...BASE} state={{
		...BASE.state, auth: { status: 'connected', user: { username: 'field-recorder' } },
	}} />);
	assert.match(connected, /Connected as field-recorder/u);
	assert.match(connected, /<details[^>]*data-audiocom-uploads="true"(?![^>]*\bopen)/u);
	assert.match(connected, /Anyone with the link can listen/u);
	assert.doesNotMatch(connected, /accept="[^"]*aup/u);
	assert.doesNotMatch(connected, /<button[^>]*>[^<]*Audacity/u);
});

test('project archives are opt-in and visible only when the selected provider advertises whole-file support', () => {
	const state = { supported: true, formats: ['aup3', 'aup4'] as const, maximumBytes: 100000000,
		results: [{ id: 'p', name: 'Session', format: 'aup3' as const, snapshotId: 's', size: 24000 }],
		page: 1, hasNext: false, status: 'ready' as const, provider: { kind: 'audiocity' as const, webOrigin: 'http://127.0.0.1:8088' } };
	const archives = { state, onRefresh: () => {}, onUpload: () => {}, onDownload: () => {}, onCancel: () => {} };
	const props = { ...BASE, copy: { ...COPY, projectArchives: 'Project archives', providerServer: 'Storage server:',
		projectArchiveNotice: 'Use File → Open to edit the downloaded file.', projectArchiveLimit: 'Maximum {size} MB',
		projectArchiveSize: '{format} · {size} MB',
		chooseProjectArchive: 'Upload AUP3 or AUP4', refreshProjects: 'Refresh projects', downloadProject: 'Download project',
	}, state: { ...BASE.state, auth: { status: 'connected' as const } }, archives };
	const markup = renderToStaticMarkup(<AudiocomPanel {...props} />);
	assert.match(markup, /<details[^>]*data-audiocom-projects="true"(?![^>]*\bopen)/u);
	assert.match(markup, /accept="\.aup3,\.aup4"/u);
	assert.match(markup, /Download project/u); assert.match(markup, /Storage server:/u);
	assert.match(markup, /href="http:\/\/127\.0\.0\.1:8088"/u);
	assert.doesNotMatch(renderToStaticMarkup(<AudiocomPanel {...props} archives={{ ...archives, state: { ...state, supported: false } }} />), /data-audiocom-projects/u);
	assert.doesNotMatch(renderToStaticMarkup(<AudiocomPanel {...props} state={BASE.state} />), /data-audiocom-projects/u);
});

test('audio.com links preserve normal browser navigation and use an injected desktop opener', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const opened: string[] = [];
	let prevented = 0;
	const url = 'https://audio.com/recorder/audio/rain';
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudiocomLink href={url}>Rain</AudiocomLink>));
		reactProps(dom.one('a')).onClick({ preventDefault() { prevented += 1; } });
		assert.equal(prevented, 0);
		assert.equal(dom.one('a').getAttribute('target'), '_blank');
		await act(async () => root.render(<AudiocomLink href={url} onOpen={(value) => opened.push(value)}>Rain</AudiocomLink>));
		reactProps(dom.one('a')).onClick({ preventDefault() { prevented += 1; } });
		assert.equal(prevented, 1);
		assert.deepEqual(opened, [url]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('publication requires permission and explicitly sends unlisted non-downloadable defaults', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const submissions: unknown[] = [];
	let closes = 0;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudiocomPublishDialog copy={COPY}
			item={{ id: 'upload-a', fileName: 'rain.wav', title: 'Rain', status: 'draft' }}
			onPublish={(id, draft) => { submissions.push({ id, draft }); }} onClose={() => { closes += 1; }}
		/>));
		const form = dom.one('form');
		await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
		assert.deepEqual(submissions, []);
		const consent = dom.container.querySelectorAll('input').find((node) => node.name === 'rightsConfirmed');
		assert.ok(consent);
		await act(async () => reactProps(consent).onChange({ currentTarget: { checked: true } }));
		await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
		assert.deepEqual(submissions, [{ id: 'upload-a', draft: {
			title: 'Rain', description: '', category: 'recording', license: 'arr', visibility: 'unlisted',
			downloadable: false, rightsConfirmed: true,
		} }]);
		assert.equal(closes, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('the upload queue exposes cancellation, retry, and published links with file-specific labels', () => {
	const markup = renderToStaticMarkup(<AudiocomPanel {...BASE} state={{
		...BASE.state, auth: { status: 'connected' }, uploadQueue: { active: true, items: [
			{ id: 'uploading', fileName: 'rain.wav', title: 'Rain', status: 'uploading' },
			{ id: 'failed', fileName: 'wind.flac', title: 'Wind', status: 'error', errorMessage: 'Connection lost' },
			{ id: 'done', fileName: 'forest.mp3', title: 'Forest', status: 'complete', url: 'https://audio.com/field/audio/forest' },
		] },
	}} />);
	assert.match(markup, /Cancel<span class="kw-audio-editor-sr-only">: rain\.wav/u);
	assert.match(markup, /Retry<span class="kw-audio-editor-sr-only">: wind\.flac/u);
	assert.match(markup, /role="alert">Connection lost/u);
	assert.match(markup, /href="https:\/\/audio.com\/field\/audio\/forest"/u);
});

test('audio.com results expose licensed source links, duration, and preview controls without import actions', () => {
	const markup = renderToStaticMarkup(<AudiocomPanel {...BASE} state={{
		...BASE.state, previewingId: 'audio-a', search: {
			query: 'rain', page: 1, hasNext: true, status: 'ready', results: [{
				id: 'audio-a', title: 'Rain', authorName: 'Field recorder', username: 'field-recorder',
				url: 'https://audio.com/field/audio/rain', license: 'cc-by', description: 'Rain ambience.',
				durationSeconds: 65, previewUrl: '/api/audiocom/audio/audio-a/preview', isDownloadable: true,
			}],
		},
	}} />);
	assert.match(markup, /1:05/u);
	assert.match(markup, /Stop preview: Rain/u);
	assert.match(markup, /https:\/\/creativecommons.org\/licenses\/by\/4.0\//u);
	assert.match(markup, /Page 1/u);
	assert.doesNotMatch(markup, /Insert at playhead|Project Bin/u);
});

test('search submission trims the query, pagination preserves the executed query, and files reach the queue', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const searches: unknown[] = [];
	const files: File[][] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudiocomPanel {...BASE}
			state={{ ...BASE.state, auth: { status: 'connected' }, search: {
				...BASE.state.search, query: 'rain', hasNext: true, status: 'ready',
			} }}
			onSearch={(request) => searches.push(request)}
			onUploadFiles={(value) => files.push([...value])}
		/>));
		const searchInput = dom.container.querySelectorAll('input').find((node) => node.type === 'search');
		assert.ok(searchInput);
		await act(async () => reactProps(searchInput).onChange({ currentTarget: { value: '  wind  ' } }));
		await act(async () => reactProps(dom.one('[role="search"]')).onSubmit({ preventDefault() {} }));
		const next = dom.container.querySelectorAll('button').find((node) => node.textContent === 'Next');
		assert.ok(next);
		await act(async () => reactProps(next).onClick());
		assert.deepEqual(searches, [{ query: 'wind', page: 1 }, { query: 'rain', page: 2 }]);
		const first = new File(['rain'], 'rain.wav', { type: 'audio/wav' });
		const second = new File(['wind'], 'wind.flac', { type: 'audio/flac' });
		await act(async () => reactProps(dom.one('[data-audiocom-upload-drop="true"]')).onDrop({
			preventDefault() {}, dataTransfer: { files: [first, second] },
		}));
		assert.deepEqual(files, [[first, second]]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
