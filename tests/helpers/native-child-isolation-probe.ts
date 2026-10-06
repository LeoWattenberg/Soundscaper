/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createPrivateNativeFixtureArtifact } from './native-fixture-compiler.ts';

/** Compile one fresh probe per suite; every case receives its own executable copy. */
export function createNativeIsolationProbeFixture() {
	return createPrivateNativeFixtureArtifact({
		prefix: 'm5-native-isolation-probe-',
		fileName: 'sandbox-probe',
		build(outputPath) {
			const source = join(dirname(outputPath), 'sandbox-probe.c');
			writeFileSync(source, FIXTURE_SOURCE);
			execFileSync('cc', [
				'-std=c17', '-static', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', source, '-o', outputPath,
			]);
			chmodSync(outputPath, 0o700);
		},
	});
}

export const FIXTURE_SOURCE = String.raw`#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int exact_io(int fd, unsigned char *bytes, size_t length, int writing) {
	size_t offset = 0u;
	while (offset < length) {
		ssize_t count = writing ? write(fd, bytes + offset, length - offset) : read(fd, bytes + offset, length - offset);
		if (count <= 0) return 0;
		offset += (size_t)count;
	}
	return 1;
}

int main(int argc, char **argv) {
	if (argc == 2 && !strcmp(argv[1], "--extra-input")) {
		char bytes[32] = {0}; size_t offset = 0u;
		for (;;) {
			const ssize_t count = read(3, bytes + offset, sizeof(bytes) - 1u - offset);
			if (count < 0) return 28;
			if (count == 0) break;
			offset += (size_t)count;
			if (offset >= sizeof(bytes) - 1u) return 29;
		}
		int closed = 1;
		for (int fd = 4; fd < 64; ++fd) if (fcntl(fd, F_GETFD) >= 0 || errno != EBADF) closed = 0;
		printf("{\"body\":\"%s\",\"inheritedArtifactsClosed\":%s}\n", bytes, closed ? "true" : "false");
		return !strcmp(bytes, "audio-prefix") && closed ? 0 : 30;
	}
	if (argc == 2 && !strcmp(argv[1], "--frame-echo")) {
		unsigned char header[8];
		if (!exact_io(STDIN_FILENO, header, sizeof(header), 0) || memcmp(header, "M5F1", 4u) != 0) return 22;
		unsigned int length = (unsigned int)header[4] | ((unsigned int)header[5] << 8u)
			| ((unsigned int)header[6] << 16u) | ((unsigned int)header[7] << 24u);
		if (length == 0u || length > 4096u) return 23;
		unsigned char *body = malloc(length);
		if (body == NULL || !exact_io(STDIN_FILENO, body, length, 0)
			|| !exact_io(STDOUT_FILENO, header, sizeof(header), 1)
			|| !exact_io(STDOUT_FILENO, body, length, 1)) return 24;
		free(body); return 0;
	}
	if (argc == 2 && (!strcmp(argv[1], "--frame-malformed") || !strcmp(argv[1], "--frame-oversize"))) {
		unsigned char header[8] = {'M', '5', 'F', '1', 1, 0, 0, 0};
		if (!strcmp(argv[1], "--frame-malformed")) header[0] = 'X'; else { header[4] = 1; header[5] = 16; }
		if (!exact_io(STDOUT_FILENO, header, sizeof(header), 1)) return 25;
		for (;;) pause();
	}
	if (argc == 2 && (!strcmp(argv[1], "--frame-unsolicited") || !strcmp(argv[1], "--frame-no-answer"))) {
		unsigned char header[8], body[1];
		if (!exact_io(STDIN_FILENO, header, sizeof(header), 0)
			|| !exact_io(STDIN_FILENO, body, 1u, 0)) return 26;
		if (!strcmp(argv[1], "--frame-unsolicited")) {
			if (!exact_io(STDOUT_FILENO, header, sizeof(header), 1)
				|| !exact_io(STDOUT_FILENO, body, 1u, 1)
				|| !exact_io(STDOUT_FILENO, header, sizeof(header), 1)
				|| !exact_io(STDOUT_FILENO, body, 1u, 1)) return 27;
		}
		for (;;) pause();
	}
	if (argc == 2 && (!strcmp(argv[1], "--overflow-stdout") || !strcmp(argv[1], "--overflow-stderr"))) {
		char bytes[8192]; memset(bytes, 'x', sizeof(bytes));
		const int output = !strcmp(argv[1], "--overflow-stdout") ? STDOUT_FILENO : STDERR_FILENO;
		for (int index = 0; index < 256; ++index) if (write(output, bytes, sizeof(bytes)) < 0) return 20;
		for (;;) pause();
	}
	if (argc == 2 && !strcmp(argv[1], "--sleep")) for (;;) pause();
	if (argc == 2 && !strcmp(argv[1], "--rss")) {
		char *bytes = malloc(32u * 1024u * 1024u); if (bytes == NULL) return 21;
		for (size_t index = 0u; index < 32u * 1024u * 1024u; index += 4096u) bytes[index] = 1;
		for (;;) pause();
	}
	char body[32] = {0};
	if (argc != 3) return 10;
	int admitted = open(argv[1], O_RDONLY | O_CLOEXEC);
	if (admitted < 0 || read(admitted, body, sizeof(body) - 1u) < 1) return 11;
	close(admitted);
	int denied = open(argv[2], O_RDONLY | O_CLOEXEC);
	if (denied >= 0) { close(denied); return 12; }
	const int deniedFilesystem = errno == EACCES || errno == EPERM;
	int network = socket(AF_INET, SOCK_STREAM, 0);
	if (network >= 0) { close(network); return 13; }
	const int deniedNetwork = errno == EPERM;
	int local[2] = {-1, -1};
	if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, local) != 0) return 17;
	const int localSocketpair = close(local[0]) == 0 && close(local[1]) == 0;
	int nonLocal[2] = {-1, -1};
	if (socketpair(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0, nonLocal) == 0) return 18;
	const int deniedNonLocalSocketpair = errno == EPERM;
	pid_t child = fork();
	if (child == 0) _exit(14);
	if (child > 0) { waitpid(child, NULL, 0); return 15; }
	const int deniedChild = errno == EPERM;
	printf("{\"allowed\":\"%s\",\"deniedFilesystem\":%s,\"deniedNetwork\":%s,"
		"\"localSocketpair\":%s,\"deniedNonLocalSocketpair\":%s,"
		"\"deniedChild\":%s,\"pidNamespace\":%s,\"userNamespace\":%s}\n",
		body, deniedFilesystem ? "true" : "false", deniedNetwork ? "true" : "false",
		localSocketpair ? "true" : "false", deniedNonLocalSocketpair ? "true" : "false",
		deniedChild ? "true" : "false",
		getpid() == 1 ? "true" : "false",
		geteuid() == 0 ? "true" : "false");
	return deniedFilesystem && deniedNetwork && localSocketpair && deniedNonLocalSocketpair && deniedChild
		&& getpid() == 1 && geteuid() == 0 ? 0 : 16;
}
`;
