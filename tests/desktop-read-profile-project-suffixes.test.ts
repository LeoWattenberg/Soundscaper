/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertDesktopMaterializedReadProfile,
	assertDesktopScapeReadProfile,
	DESKTOP_READ_PROFILE_MATERIALIZED,
	DESKTOP_READ_PROFILE_SCAPE_RANGE,
	DESKTOP_SCAPE_MIME_TYPE,
	DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES,
} from '../src/common/editor/desktop-read-profile.ts';
import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';

test('every accepted project suffix is admitted to the 65 GiB Scape range profile', () => {
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		for (const name of [`project${extension}`, `PROJECT${extension.toUpperCase()}`]) {
			assertDesktopScapeReadProfile({
				readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE,
				name,
				mimeType: DESKTOP_SCAPE_MIME_TYPE,
				size: DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES,
			}, DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES);
		}
	}
});

test('no accepted project suffix may fall back to bounded materialization', () => {
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.throws(() => assertDesktopMaterializedReadProfile({
			readProfile: DESKTOP_READ_PROFILE_MATERIALIZED,
			name: `project${extension}`,
			mimeType: 'application/zip',
			size: 1,
		}), /cannot use the materialized desktop read profile/u);
	}
	assertDesktopMaterializedReadProfile({
		readProfile: DESKTOP_READ_PROFILE_MATERIALIZED,
		name: 'disguised.sscape.zip',
		mimeType: 'application/zip',
		size: 1,
	});
});

test('a Scape range descriptor still requires the shared Scape MIME type', () => {
	assert.throws(() => assertDesktopScapeReadProfile({
		readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE,
		name: 'project.fscape',
		mimeType: 'application/zip',
		size: 1,
	}, DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES), /canonical desktop Scape range read profile/u);
	assert.throws(() => assertDesktopScapeReadProfile({
		readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE,
		name: 'project.sscape.zip',
		mimeType: DESKTOP_SCAPE_MIME_TYPE,
		size: 1,
	}, DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES), /canonical desktop Scape range read profile/u);
});
