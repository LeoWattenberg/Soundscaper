/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperPlaybackProjectServiceV18,
} from '../src/framescaper/editor-project-playback-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { archiveProject } from './helpers/framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('V18 playback authenticates the exact profile before observing a project', () => {
	let reads = 0;
	const hostile = new Proxy({}, {
		get() { reads += 1; throw new Error('project get'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('project descriptor'); },
		ownKeys() { reads += 1; throw new Error('project keys'); },
	});
	assert.throws(
		() => createFramescaperPlaybackProjectServiceV18({}).projectForPlayback(hostile),
		/exact Framescaper V18/iu,
	);
	assert.equal(reads, 0);
});

test('all-null V18 playback stays writable-compatible through a V17 engine foundation', () => {
	const service = createFramescaperPlaybackProjectServiceV18(PROFILE);
	const project = createFramescaperProjectV18(PROFILE, {
		id: 'playback-v18',
		title: 'Playback V18',
		now: '2026-08-13T12:00:00.000Z',
	});
	const projection = service.projectForPlayback(project);
	assert.equal(projection.project.schemaVersion, 17);
	assert.equal(projection.featureRequirementsReport?.compatible ?? true, true);
	assert.deepEqual(projection.requiredAudioSourceIds, []);
	assert.deepEqual(projection.requiredVideoSourceIds, []);
});

test('attached V18 reports a provided feature and still strips proxy authority from playback input', () => {
	const service = createFramescaperPlaybackProjectServiceV18(PROFILE);
	const project = archiveProject();
	const projection = service.projectForPlayback(project);
	const proxyItem = projection.featureRequirementsReport?.items.find(
		(item) => item.displayName === 'Video proxy attachments',
	);
	// The feature is one Framescaper provides, so an attached project is
	// compatible. What playback does with the attachment is unchanged: the
	// projection it runs on is V17 and has no concept of one, and which picture a
	// preview shows is decided by re-attestation rather than by this report.
	assert.equal(projection.featureRequirementsReport?.compatible, true);
	assert.equal(proxyItem?.availability ?? 'available', 'available');
	assert.deepEqual(projection.requiredVideoSourceIds, []);
	assert.equal(projection.project.schemaVersion, 17);
	assert.equal(Object.hasOwn(projection.project.sources[0] ?? {}, 'proxyAttachment'), false);
	assert.equal(
		projection.project.featureRequirements.requirements.some(
			(requirement) => requirement.id === 'framescaper.video-proxy',
		),
		false,
	);
	assert.equal(projection.project.sources[0]?.storageKey, project.sources[0]?.storageKey);
});

test('future Framescaper projects stay opaque and produce no body requirements', () => {
	const service = createFramescaperPlaybackProjectServiceV18(PROFILE);
	let nestedReads = 0;
	const project = {
		schemaVersion: 19,
		id: 'future-v19',
		title: 'Future',
		sources: new Proxy([], {
			get() { nestedReads += 1; throw new Error('nested source read'); },
		}),
	};
	const projection = service.projectForPlayback(project);
	assert.equal(projection.project, project);
	assert.equal(projection.featureRequirementsReport, null);
	assert.deepEqual(projection.requiredAudioSourceIds, []);
	assert.deepEqual(projection.requiredVideoSourceIds, []);
	assert.equal(nestedReads, 0);
});
