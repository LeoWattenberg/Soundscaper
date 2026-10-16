/* SPDX-License-Identifier: AGPL-3.0-only */

import { openFxTestFixtureArtifacts, prepareOpenFxTestFixture } from './lib/node-test-openfx-fixture.ts';

const [repositoryRoot, fixtureRoot, ...testFiles] = process.argv.slice(2);
if (!repositoryRoot || !fixtureRoot) throw new Error('Expected repository root and OpenFX fixture directory.');
await prepareOpenFxTestFixture({ repositoryRoot, fixtureRoot, artifacts: openFxTestFixtureArtifacts(testFiles) });
