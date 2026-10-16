/* SPDX-License-Identifier: AGPL-3.0-only */

import { exactRetimeClosureAvailable } from '../tests/helpers/framescaper-boost-closure.js';
import { selectedNativeTestFixtures } from './lib/node-native-test-fixture-recipes.ts';
import { prepareNativeTestFixtures } from './lib/node-native-test-fixtures.ts';

const [repositoryRoot, fixtureRoot, ...testFiles] = process.argv.slice(2);
if (!repositoryRoot || !fixtureRoot) throw new Error('Expected repository root and native fixture directory.');
const possible = selectedNativeTestFixtures(testFiles, process.env, true);
const needsExactRetime = possible.includes('media-validator') || testFiles.some(file => file.endsWith('framescaper-media-host-native-adapters.test.js'));
prepareNativeTestFixtures({ repositoryRoot, fixtureRoot, kinds: selectedNativeTestFixtures(testFiles, process.env, needsExactRetime && exactRetimeClosureAvailable()) });
