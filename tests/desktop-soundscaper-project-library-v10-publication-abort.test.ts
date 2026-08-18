/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts';
import { SoundscaperDesktopProjectLibraryV10Main } from '../desktop/soundscaper-project-library-v10-main.ts';
import {
	soundscaperDesktopProjectLibraryV10PublicationRefusalCode,
	type SoundscaperDesktopProjectLibraryV10PublicationCheckpoint,
} from '../desktop/soundscaper-project-library-v10-publication-contract.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

const PROJECT_ID = 'soundscaper-v10-publication-abort';

test('a publication abandoned after its prepared checkpoint rolls back rather than becoming canonical', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-abandon-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const phases: SoundscaperDesktopProjectLibraryV10PublicationCheckpoint[] = [];
	let abandon: (() => void) | null = null;
	const main = await start(root, 'soundscaper-abandon-first', (phase) => {
		phases.push(phase);
		if (phase !== 'prepared') return;
		const pending = abandon;
		abandon = null;
		pending?.();
	});
	const lost = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	abandon = () => { void lost.close(); };
	await assert.rejects(
		publish(lost, projectAt(1, 'Abandoned'), 0, null, '01'.repeat(24)),
		/session is closed/u,
	);
	assert.deepEqual(phases, ['prepared']);
	assert.equal(main.snapshot().activePublication, false);

	// The abandoned publication left nothing canonical and nothing pending, so
	// the reloaded renderer creates the same project against the same base.
	const reloaded = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	assert.equal(await reloaded.readProjectBundle(PROJECT_ID), null);
	const catalog = await reloaded.listProjects();
	assert.equal(catalog.metadataRevision, 0);
	assert.deepEqual(catalog.projects, []);
	const republished = await publish(reloaded, projectAt(1, 'Republished'), 0, null, '02'.repeat(24));
	assert.equal(republished.metadataRevision, 1);
	assert.equal(republished.project.projectRevision, 1);
	await reloaded.close();
	await main.close();

	const restarted = await start(root, 'soundscaper-abandon-second', () => {});
	context.after(() => restarted.close());
	assert.equal(restarted.snapshot().writer.recovery.outcome, 'clean');
	const survivor = restarted.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => survivor.close());
	const bundle = await survivor.readProjectBundle(PROJECT_ID);
	assert.ok(bundle);
	assert.equal(bundle.project.sha256, republished.project.sha256);
	assert.equal((await survivor.listProjects()).metadataRevision, 1);
});

test('Soundscaper V10 publication refusals carry a stable typed code', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-refusal-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const main = await start(root, 'soundscaper-refusal', null);
	context.after(() => main.close());
	const session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => session.close());
	const published = await publish(session, projectAt(1, 'Seed'), 0, null, '01'.repeat(24));
	const base = {
		projectRevision: published.project.projectRevision,
		projectSha256: published.project.sha256,
	};

	const absent = await refusal(
		publish(session, projectAt(2, 'Absent'), published.metadataRevision, null, '02'.repeat(24)),
	);
	assert.equal(absent.code, 'destination-presence');
	assert.match(absent.message, /expected an absent project/u);

	const stale = await refusal(publish(
		session, projectAt(2, 'Stale'), published.metadataRevision,
		{ ...base, projectSha256: 'ff'.repeat(32) }, '03'.repeat(24),
	));
	assert.equal(stale.code, 'compare-and-swap');
	assert.match(stale.message, /expected project failed compare-and-swap/u);

	const lower = await refusal(
		publish(session, projectAt(1, 'Lower'), published.metadataRevision, base, '04'.repeat(24)),
	);
	assert.equal(lower.code, 'revision-order');
	assert.match(lower.message, /strictly higher project revision/u);

	const metadata = await refusal(
		publish(session, projectAt(2, 'Metadata'), published.metadataRevision + 1, base, '05'.repeat(24)),
	);
	assert.equal(metadata.code, 'compare-and-swap');
	assert.match(metadata.message, /metadata revision failed compare-and-swap/u);

	// A renderer receives only the message text, so the code has to survive the
	// wrapping Electron applies to an error raised by a main handler.
	assert.equal(soundscaperDesktopProjectLibraryV10PublicationRefusalCode(new Error(
		"Error invoking remote method 'soundscaper:v10:projects:publication:begin': "
		+ `Error: ${absent.message}`,
	)), 'destination-presence');
	assert.equal(soundscaperDesktopProjectLibraryV10PublicationRefusalCode(
		new Error('Soundscaper V10 main session is closed'),
	), null);
	assert.equal((await session.listProjects()).metadataRevision, published.metadataRevision);
});

test('a publication abandoned after its commit checkpoint still settles rather than rolling back', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-late-abandon-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const phases: SoundscaperDesktopProjectLibraryV10PublicationCheckpoint[] = [];
	let abandon: (() => void) | null = null;
	const main = await start(root, 'soundscaper-late-abandon', (phase) => {
		phases.push(phase);
		if (phase !== 'committed') return;
		const pending = abandon;
		abandon = null;
		pending?.();
	});
	context.after(() => main.close());
	const lost = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	abandon = () => { void lost.close(); };
	await assert.rejects(
		publish(lost, projectAt(1, 'Committed'), 0, null, '01'.repeat(24)),
		/session is closed/u,
	);
	assert.deepEqual(phases, ['prepared', 'materialized', 'committed', 'complete']);

	const survivor = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => survivor.close());
	const bundle = await survivor.readProjectBundle(PROJECT_ID);
	assert.ok(bundle);
	assert.equal(bundle.project.projectRevision, 1);
	assert.equal((await survivor.listProjects()).metadataRevision, 1);
});

async function refusal(pending: Promise<unknown>): Promise<Readonly<{ code: unknown; message: string }>> {
	try { await pending; } catch (error) {
		assert.ok(error instanceof Error);
		return Object.freeze({ code: (error as { readonly code?: unknown }).code, message: error.message });
	}
	throw new Error('Soundscaper V10 admitted a publication it must have refused');
}

function start(
	appDataPath: string,
	instanceId: string,
	checkpoint: ((phase: SoundscaperDesktopProjectLibraryV10PublicationCheckpoint) => void) | null,
) {
	return SoundscaperDesktopProjectLibraryV10Main.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 911, instanceId },
		handshake: createSoundscaperDesktopProjectLibraryV10Handshake(),
		qualification: checkpoint === null ? null : { leaseTtlMs: 5_000, renewIntervalMs: 1_000, checkpoint },
	});
}

async function publish(
	session: ReturnType<SoundscaperDesktopProjectLibraryV10Main['openSession']>,
	project: ReturnType<typeof projectAt>,
	expectedMetadataRevision: number,
	expectedProject: Readonly<{ projectRevision: number; projectSha256: string }> | null,
	publicationId: string,
) {
	await session.beginPublication({
		publicationId, expectedMetadataRevision, expectedProject, project, bodies: [],
	});
	return session.finishPublication({ publicationId });
}

function projectAt(revision: number, title: string) {
	const base = createSoundscaperProjectV23({ id: PROJECT_ID, title });
	return { ...base, revision, metadata: { ...base.metadata, title } };
}
