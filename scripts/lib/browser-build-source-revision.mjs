/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repositoryRevision } from './e2e-coverage-integrity.mjs';
const REVISION = /^[a-f\d]{40}$/u;

export async function expectedBrowserCoverageRevision(repositoryRoot, { requireStage = false } = {}) {
	try {
		const stage = JSON.parse(await readFile(resolve(repositoryRoot, 'stage-manifest.json'), 'utf8'));
		if (stage?.kind !== 'soundscaper-desktop-nightly-tests'
			|| !REVISION.test(stage.sourceRevision ?? '')) {
			throw new Error('The nightly test stage has no authenticated source revision.');
		}
		return stage.sourceRevision;
	} catch (error) {
		if (error?.code !== 'ENOENT' || requireStage) throw error;
		return repositoryRevision(repositoryRoot);
	}
}
