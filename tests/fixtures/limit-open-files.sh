#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

set -e
ulimit -n 32
exec "$@"
