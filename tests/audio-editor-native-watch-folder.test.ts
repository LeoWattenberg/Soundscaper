/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createWatchRuleV1,
	watchRuleAdmitsEntry,
	watchRuleDescendsInto,
	watchRuleEntryRefusal,
	NATIVE_WATCH_MAXIMUM_DEPTH,
	NativeWatchRuleError,
	type WatchDirectoryEntryV1,
	type WatchRuleV1,
} from '../src/common/editor/native-watch-rule.ts';
import {
	decideWatchImport,
	nextWatchReconcileAtMs,
	observeWatchCandidate,
	trackWatchCandidate,
	watchCandidateHasSettled,
	watchDecisionIsPending,
	watchImportKey,
	NATIVE_WATCH_MAXIMUM_TRACKED_CANDIDATES,
	NATIVE_WATCH_RECONCILE_INTERVAL_MS,
	NATIVE_WATCH_STABILITY_INTERVAL_MS,
	NativeWatchReconciliationError,
	type WatchCandidateStateV1,
} from '../src/common/editor/native-watch-reconciliation.ts';

const RULE_ID = 'aa'.repeat(16);
const GRANT_ID = 'bb'.repeat(16);
const IDENTITY = 'dev:1|ino:42'.replace('|', '-');
const DIGEST = 'c'.repeat(64);

test('a watch rule links, stays shallow, and generates no proxies by default', () => {
	const rule = createWatchRuleV1({
		ruleId: RULE_ID, grantId: GRANT_ID, projectId: 'project-1',
		extensions: ['MP4', '.mov'], createdAtMs: 0,
	});

	assert.equal(rule.importMode, 'link');
	assert.equal(rule.recursive, false);
	assert.equal(rule.maximumDepth, 0);
	assert.equal(rule.generateProxies, false);
	assert.equal(rule.enabled, true);
	assert.equal(rule.binId, null);
	assert.deepEqual(rule.extensions, ['mp4', 'mov']);
});

test('a recursive rule is bounded and refuses an out-of-range depth', () => {
	assert.equal(rule({ recursive: true }).maximumDepth, 4);
	assert.equal(rule({ recursive: true, maximumDepth: 8 }).maximumDepth, NATIVE_WATCH_MAXIMUM_DEPTH);
	for (const maximumDepth of [0, 9, 1.5]) {
		assert.throws(
			() => rule({ recursive: true, maximumDepth }),
			NativeWatchRuleError,
			String(maximumDepth),
		);
	}
});

test('an import mode is explicit and an extension list is bounded and unique', () => {
	assert.equal(rule({ importMode: 'copy' }).importMode, 'copy');
	assert.throws(() => rule({ importMode: 'move' as never }), /explicitly link or copy/u);
	assert.throws(() => rule({ extensions: [] }), /at least one extension/u);
	assert.throws(() => rule({ extensions: ['mp4', 'MP4'] }), /same extension twice/u);
	assert.throws(() => rule({ extensions: ['mp 4'] }), /short alphanumeric suffix/u);
	assert.throws(
		() => rule({ extensions: Array.from({ length: 33 }, (_, index) => `e${String(index)}`) }),
		/extension ceiling/u,
	);
});

test('a directory symlink is never followed', () => {
	const recursive = rule({ recursive: true });
	const link: WatchDirectoryEntryV1 = {
		name: 'elsewhere', depth: 0, isDirectory: true, isSymbolicLink: true,
	};

	assert.equal(watchRuleEntryRefusal(recursive, link), 'symlink-not-followed');
	assert.equal(watchRuleDescendsInto(recursive, link), false);
	assert.equal(watchRuleDescendsInto(recursive, { ...link, isSymbolicLink: false }), true);
});

test('a hidden directory is refused exactly as a hidden file is', () => {
	const recursive = rule({ recursive: true });
	const hidden: WatchDirectoryEntryV1 = {
		name: '.Trashes', depth: 0, isDirectory: true, isSymbolicLink: false,
	};

	assert.equal(watchRuleEntryRefusal(recursive, hidden), 'hidden-entry');
	assert.equal(watchRuleAdmitsEntry(recursive, hidden), false);
	// A staging directory is where half-written files live; the walk stays out.
	assert.equal(watchRuleDescendsInto(recursive, hidden), false);
	assert.equal(watchRuleDescendsInto(recursive, { ...hidden, name: '.tmp', depth: 1 }), false);
	assert.equal(watchRuleDescendsInto(recursive, { ...hidden, name: 'Clips' }), true);
});

test('a non-recursive rule never descends and ignores nested entries', () => {
	const shallow = rule();

	assert.equal(watchRuleDescendsInto(shallow, {
		name: 'sub', depth: 0, isDirectory: true, isSymbolicLink: false,
	}), false);
	assert.equal(watchRuleEntryRefusal(shallow, {
		name: 'a.mp4', depth: 1, isDirectory: false, isSymbolicLink: false,
	}), 'recursion-disabled');
});

test('only watched, visible extensions are candidates', () => {
	const shallow = rule();

	assert.equal(watchRuleAdmitsEntry(shallow, file('a.mp4')), true);
	assert.equal(watchRuleAdmitsEntry(shallow, file('a.MOV')), true);
	assert.equal(watchRuleEntryRefusal(shallow, file('a.txt')), 'extension-not-watched');
	assert.equal(watchRuleEntryRefusal(shallow, file('noextension')), 'extension-not-watched');
	assert.equal(watchRuleEntryRefusal(shallow, file('.hidden.mp4')), 'hidden-entry');
	assert.equal(watchRuleEntryRefusal(rule({ enabled: false }), file('a.mp4')), 'rule-disabled');
});

test('a candidate settles only after agreeing with itself twice, two seconds apart', () => {
	let candidate = observeWatchCandidate(null, IDENTITY, { atMs: 0, sizeBytes: 100, modifiedAtMs: 0 });
	assert.equal(watchCandidateHasSettled(candidate), false);

	// Two observations too close together prove nothing about a slow copy.
	candidate = observeWatchCandidate(candidate, IDENTITY, { atMs: 500, sizeBytes: 100, modifiedAtMs: 0 });
	assert.equal(candidate.unchangedObservations, 2);
	assert.equal(watchCandidateHasSettled(candidate), false);

	candidate = observeWatchCandidate(candidate, IDENTITY, {
		atMs: NATIVE_WATCH_STABILITY_INTERVAL_MS, sizeBytes: 100, modifiedAtMs: 0,
	});
	assert.equal(watchCandidateHasSettled(candidate), true);
});

test('a file that is still growing restarts its stability count', () => {
	let candidate = observeWatchCandidate(null, IDENTITY, { atMs: 0, sizeBytes: 100, modifiedAtMs: 0 });
	candidate = observeWatchCandidate(candidate, IDENTITY, { atMs: 3_000, sizeBytes: 100, modifiedAtMs: 0 });
	assert.equal(watchCandidateHasSettled(candidate), true);

	candidate = observeWatchCandidate(candidate, IDENTITY, { atMs: 4_000, sizeBytes: 200, modifiedAtMs: 10 });
	assert.equal(candidate.unchangedObservations, 1);
	assert.equal(watchCandidateHasSettled(candidate), false);
});

test('a replaced file under the same identity starts over', () => {
	const first = observeWatchCandidate(null, IDENTITY, { atMs: 0, sizeBytes: 100, modifiedAtMs: 0 });
	const other = observeWatchCandidate(first, 'dev:1-ino:43', { atMs: 1_000, sizeBytes: 100, modifiedAtMs: 0 });

	assert.equal(other.fileIdentity, 'dev:1-ino:43');
	assert.equal(other.unchangedObservations, 1);
	assert.throws(
		() => observeWatchCandidate(first, IDENTITY, { atMs: -1, sizeBytes: 1, modifiedAtMs: 0 }),
		NativeWatchReconciliationError,
	);
});

test('tracked candidates stay under the ceiling and overflow is refused, not silent', () => {
	const tracked = new Map<string, WatchCandidateStateV1>();
	const first = trackWatchCandidate(tracked, IDENTITY, { atMs: 0, sizeBytes: 100, modifiedAtMs: 0 });

	assert.equal(first.outcome, 'tracked');
	assert.equal(first.candidate?.unchangedObservations, 1);
	assert.deepEqual(tracked.get(IDENTITY), first.candidate);

	const again = trackWatchCandidate(tracked, IDENTITY, { atMs: 3_000, sizeBytes: 100, modifiedAtMs: 0 });
	assert.equal(again.candidate?.unchangedObservations, 2);
	assert.equal(tracked.size, 1);

	while (tracked.size < NATIVE_WATCH_MAXIMUM_TRACKED_CANDIDATES) {
		tracked.set(`ino-${String(tracked.size)}`, settled(`ino-${String(tracked.size)}`));
	}
	const overflow = trackWatchCandidate(tracked, 'ino-new', { atMs: 4_000, sizeBytes: 100, modifiedAtMs: 0 });

	assert.equal(overflow.outcome, 'refused-tracking-ceiling');
	assert.equal(overflow.candidate, null);
	assert.equal(tracked.has('ino-new'), false);
	assert.equal(tracked.size, NATIVE_WATCH_MAXIMUM_TRACKED_CANDIDATES);
	// A candidate already being tracked keeps settling even at the ceiling.
	assert.equal(
		trackWatchCandidate(tracked, IDENTITY, { atMs: 5_000, sizeBytes: 100, modifiedAtMs: 0 }).outcome,
		'tracked',
	);
	// Forgetting an imported candidate makes room again.
	tracked.delete(IDENTITY);
	assert.equal(
		trackWatchCandidate(tracked, 'ino-new', { atMs: 6_000, sizeBytes: 100, modifiedAtMs: 0 }).outcome,
		'tracked',
	);
});

test('an unsettled or unreadable candidate is deferred before the project is consulted', () => {
	const growing = observeWatchCandidate(null, IDENTITY, { atMs: 0, sizeBytes: 100, modifiedAtMs: 0 });

	assert.equal(decideWatchImport(request({ candidate: growing, projectOpen: false })).decision, 'defer-unstable');
	assert.equal(decideWatchImport(request({ probeSucceeded: false })).decision, 'defer-probe');
	assert.equal(decideWatchImport(request({ contentSha256: null })).decision, 'defer-probe');
});

test('a settled, readable, new candidate imports', () => {
	const decision = decideWatchImport(request());

	assert.equal(decision.decision, 'import');
	assert.equal(decision.importKey, `${RULE_ID}|${IDENTITY}|${DIGEST}`);
	assert.equal(watchDecisionIsPending(decision.decision), false);
});

test('identity and content together suppress repeats, renames, and restarts', () => {
	const key = watchImportKey(rule(), IDENTITY, DIGEST);
	const imported = new Set([key]);

	assert.equal(decideWatchImport(request({ importedKeys: imported })).decision, 'skip-duplicate');
	// Same bytes at a different identity is a copy the user made; it imports.
	assert.equal(
		decideWatchImport(request({ importedKeys: imported, fileIdentity: 'dev:1-ino:99' })).decision,
		'import',
	);
	// Same identity with replaced bytes is a different file; it imports.
	assert.equal(
		decideWatchImport(request({ importedKeys: imported, contentSha256: 'd'.repeat(64) })).decision,
		'import',
	);
	// A different rule watching the same file keeps its own ledger.
	assert.equal(
		watchImportKey(rule({ ruleId: 'dd'.repeat(16) }), IDENTITY, DIGEST) === key,
		false,
	);
});

test('a closed or read-only project leaves the ingest pending rather than mutating it', () => {
	const closed = decideWatchImport(request({ projectOpen: false }));
	const readOnly = decideWatchImport(request({ projectWritable: false }));

	assert.equal(closed.decision, 'pending-project-closed');
	assert.equal(readOnly.decision, 'pending-project-read-only');
	assert.equal(watchDecisionIsPending(closed.decision), true);
	assert.equal(watchDecisionIsPending(readOnly.decision), true);
	// The key is still known, so the pending ingest cannot become a duplicate.
	assert.equal(closed.importKey, readOnly.importKey);
});

test('a disabled rule ingests nothing and is not walked', () => {
	assert.equal(
		decideWatchImport(request({ rule: rule({ enabled: false }) })).decision,
		'skip-rule-disabled',
	);
	assert.equal(watchRuleDescendsInto(rule({ enabled: false, recursive: true }), {
		name: 'Clips', depth: 0, isDirectory: true, isSymbolicLink: false,
	}), false);
});

test('an event only pulls the next sweep earlier, never later', () => {
	assert.equal(nextWatchReconcileAtMs(1_000, null), 1_000 + NATIVE_WATCH_RECONCILE_INTERVAL_MS);
	assert.equal(nextWatchReconcileAtMs(1_000, 2_000), 2_000);
	assert.equal(
		nextWatchReconcileAtMs(1_000, 10_000_000),
		1_000 + NATIVE_WATCH_RECONCILE_INTERVAL_MS,
	);
});

function file(name: string): WatchDirectoryEntryV1 {
	return { name, depth: 0, isDirectory: false, isSymbolicLink: false };
}

function rule(overrides: Record<string, unknown> = {}): WatchRuleV1 {
	return createWatchRuleV1({
		ruleId: RULE_ID,
		grantId: GRANT_ID,
		projectId: 'project-1',
		extensions: ['mp4', 'mov'],
		createdAtMs: 0,
		...overrides,
	} as Parameters<typeof createWatchRuleV1>[0]);
}

function settled(fileIdentity = IDENTITY): WatchCandidateStateV1 {
	const first = observeWatchCandidate(null, fileIdentity, { atMs: 0, sizeBytes: 100, modifiedAtMs: 0 });
	return observeWatchCandidate(first, fileIdentity, { atMs: 3_000, sizeBytes: 100, modifiedAtMs: 0 });
}

function request(overrides: Record<string, unknown> = {}) {
	const fileIdentity = (overrides.fileIdentity as string | undefined) ?? IDENTITY;
	return {
		rule: rule(),
		candidate: settled(fileIdentity),
		probeSucceeded: true,
		contentSha256: DIGEST,
		importedKeys: new Set<string>(),
		projectOpen: true,
		projectWritable: true,
		nowMs: 10_000,
		...overrides,
	} as Parameters<typeof decideWatchImport>[0];
}
