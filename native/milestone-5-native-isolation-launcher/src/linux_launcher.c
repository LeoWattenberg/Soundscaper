/* SPDX-License-Identifier: AGPL-3.0-only */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

#define MAXIMUM_GRANTS 64u
#define MAXIMUM_ARGUMENTS 128u
#define MAXIMUM_POLICY_BYTES 4096u
#define MAXIMUM_DURATION_MS 86400000ULL
#define MAXIMUM_RSS_BYTES 1073741824ULL
#define CHILD_FAILURE 125
#define FILTER_STMT(code, value) ((struct sock_filter)BPF_STMT(code, value))
#define FILTER_JUMP(code, value, yes, no) ((struct sock_filter)BPF_JUMP(code, value, yes, no))

static const char expected_profile[] =
	"{\"schemaVersion\":1,\"id\":\"milestone5-linux-native-child-isolation-v1\","
	"\"namespaces\":[\"user\",\"mount\",\"pid\",\"network\",\"ipc\",\"uts\"],"
	"\"filesystem\":\"landlock-fd-grants\",\"network\":\"namespace-and-seccomp-denied\","
	"\"childProcesses\":\"seccomp-thread-only\",\"dynamicCode\":\"read-execute-grants-only\","
	"\"resourceCeilings\":\"outer-pid-duration-rss-v1\","
	"\"attestation\":\"pre-exec-pipe-v1\"}\n";
static const char expected_broker[] =
	"{\"schemaVersion\":1,\"id\":\"milestone5-native-child-broker-v1\",\"maximumGrants\":64,"
	"\"readOnly\":\"no-follow-fd\",\"readExecute\":\"no-follow-fd\","
	"\"writeOnly\":\"no-follow-fd\",\"inheritedDescriptors\":\"closed\","
	"\"environment\":\"fixed-empty\"}\n";
static const char enforcement_frame[] = "M5_NATIVE_ISOLATION_ENFORCED_V1\n";

enum grant_access { GRANT_READ_ONLY, GRANT_READ_EXECUTE, GRANT_WRITE_ONLY };

struct grant {
	int fd;
	enum grant_access access;
};

struct launch_request {
	int attestation_fd;
	int profile_fd;
	int broker_fd;
	int executable_fd;
	int extra_input_fd;
	struct grant grants[MAXIMUM_GRANTS];
	size_t grant_count;
	uint64_t maximum_duration_ms;
	uint64_t maximum_rss_bytes;
	char **child_argv;
};

static volatile sig_atomic_t isolated_child = -1;

static void forward_signal(int signal_number)
{
	if (isolated_child > 0) (void)kill((pid_t)isolated_child, signal_number);
}

static int parse_fd(const char *value)
{
	char *end = NULL;
	errno = 0;
	const long parsed = strtol(value, &end, 10);
	return errno == 0 && end != value && *end == '\0' && parsed >= 3 && parsed <= 4095
		? (int)parsed : -1;
}

static bool option_fd(const char *argument, const char *prefix, int *output)
{
	const size_t length = strlen(prefix);
	if (strncmp(argument, prefix, length) != 0) return false;
	*output = parse_fd(argument + length);
	return true;
}

static bool option_u64(const char *argument, const char *prefix, uint64_t *output)
{
	const size_t length = strlen(prefix);
	if (strncmp(argument, prefix, length) != 0) return false;
	char *end = NULL;
	errno = 0;
	const unsigned long long parsed = strtoull(argument + length, &end, 10);
	if (errno != 0 || end == argument + length || *end != '\0' || parsed == 0u) return false;
	*output = (uint64_t)parsed;
	return true;
}

static bool duplicate_fd(const struct launch_request *request, int candidate)
{
	if (candidate == request->attestation_fd || candidate == request->profile_fd
		|| candidate == request->broker_fd || candidate == request->executable_fd
		|| candidate == request->extra_input_fd) return true;
	for (size_t index = 0u; index < request->grant_count; ++index) {
		if (request->grants[index].fd == candidate) return true;
	}
	return false;
}

static bool append_grant(struct launch_request *request, int fd, enum grant_access access)
{
	if (fd < 0 || request->grant_count >= MAXIMUM_GRANTS || duplicate_fd(request, fd)) return false;
	request->grants[request->grant_count++] = (struct grant){ .fd = fd, .access = access };
	return true;
}

static bool assign_once(int *slot, int fd)
{
	if (*slot >= 0 || fd < 0) return false;
	*slot = fd;
	return true;
}

static bool assign_u64_once(uint64_t *slot, uint64_t value, uint64_t maximum)
{
	if (*slot != 0u || value == 0u || value > maximum) return false;
	*slot = value;
	return true;
}

static bool request_fds_unique(const struct launch_request *request)
{
	const int core[] = { request->attestation_fd, request->profile_fd, request->broker_fd,
		request->executable_fd, request->extra_input_fd };
	for (size_t left = 0u; left < sizeof(core) / sizeof(core[0]); ++left) {
		if (core[left] < 3) {
			if (left == sizeof(core) / sizeof(core[0]) - 1u && core[left] == -1) continue;
			return false;
		}
		for (size_t right = left + 1u; right < sizeof(core) / sizeof(core[0]); ++right) {
			if (core[left] == core[right]) return false;
		}
		for (size_t grant = 0u; grant < request->grant_count; ++grant) {
			if (core[left] == request->grants[grant].fd) return false;
		}
	}
	return true;
}

static bool parse_request(int argc, char **argv, struct launch_request *request)
{
	*request = (struct launch_request){ .attestation_fd = -1, .profile_fd = -1,
		.broker_fd = -1, .executable_fd = -1, .extra_input_fd = -1 };
	int index = 1;
	for (; index < argc && strcmp(argv[index], "--") != 0; ++index) {
		int fd = -1;
		if (option_fd(argv[index], "--attestation-fd=", &fd)) {
			if (!assign_once(&request->attestation_fd, fd)) return false;
		} else if (option_fd(argv[index], "--profile-fd=", &fd)) {
			if (!assign_once(&request->profile_fd, fd)) return false;
		} else if (option_fd(argv[index], "--broker-policy-fd=", &fd)) {
			if (!assign_once(&request->broker_fd, fd)) return false;
		} else if (option_fd(argv[index], "--executable-fd=", &fd)) {
			if (!assign_once(&request->executable_fd, fd)) return false;
		} else if (option_fd(argv[index], "--extra-input-fd=", &fd)) {
			if (!assign_once(&request->extra_input_fd, fd)) return false;
		} else {
			uint64_t limit = 0u;
			if (option_u64(argv[index], "--maximum-duration-ms=", &limit)) {
				if (!assign_u64_once(&request->maximum_duration_ms, limit, MAXIMUM_DURATION_MS)) return false;
			} else if (option_u64(argv[index], "--maximum-rss-bytes=", &limit)) {
				if (!assign_u64_once(&request->maximum_rss_bytes, limit, MAXIMUM_RSS_BYTES)) return false;
			} else if (option_fd(argv[index], "--read-only-fd=", &fd)) {
				if (!append_grant(request, fd, GRANT_READ_ONLY)) return false;
			} else if (option_fd(argv[index], "--read-execute-fd=", &fd)) {
				if (!append_grant(request, fd, GRANT_READ_EXECUTE)) return false;
			} else if (option_fd(argv[index], "--write-only-fd=", &fd)) {
				if (!append_grant(request, fd, GRANT_WRITE_ONLY)) return false;
			} else return false;
		}
	}
	if (index >= argc || argc - index - 1 < 1 || argc - index - 1 > (int)MAXIMUM_ARGUMENTS) return false;
	request->child_argv = &argv[index + 1];
	return request->maximum_duration_ms > 0u && request->maximum_rss_bytes > 0u
		&& request_fds_unique(request);
}

static bool exact_file(int fd, const char *expected)
{
	struct stat metadata;
	if (fstat(fd, &metadata) != 0 || !S_ISREG(metadata.st_mode)) return false;
	const size_t length = strlen(expected);
	if (length > MAXIMUM_POLICY_BYTES || metadata.st_size != (off_t)length) return false;
	char bytes[MAXIMUM_POLICY_BYTES];
	const ssize_t read_count = pread(fd, bytes, length, 0);
	return read_count == (ssize_t)length && memcmp(bytes, expected, length) == 0;
}

static bool valid_grants(const struct launch_request *request)
{
	struct stat metadata;
	if (!exact_file(request->profile_fd, expected_profile)
		|| !exact_file(request->broker_fd, expected_broker)
		|| fstat(request->executable_fd, &metadata) != 0 || !S_ISREG(metadata.st_mode)
		|| (metadata.st_mode & 0111) == 0) return false;
	for (size_t index = 0u; index < request->grant_count; ++index) {
		if (fstat(request->grants[index].fd, &metadata) != 0
			|| (!S_ISREG(metadata.st_mode) && !S_ISDIR(metadata.st_mode))) return false;
	}
	if (request->extra_input_fd >= 0 && (fstat(request->extra_input_fd, &metadata) != 0
		|| (!S_ISFIFO(metadata.st_mode) && !S_ISSOCK(metadata.st_mode)))) return false;
	return true;
}

static bool write_text_file(const char *path, const char *contents)
{
	const int fd = open(path, O_WRONLY | O_CLOEXEC);
	if (fd < 0) return false;
	const size_t length = strlen(contents);
	const bool written = write(fd, contents, length) == (ssize_t)length;
	return close(fd) == 0 && written;
}

static bool create_namespaces(void)
{
	const uid_t outside_uid = getuid();
	const gid_t outside_gid = getgid();
	if (unshare(CLONE_NEWUSER) != 0) return false;
	(void)write_text_file("/proc/self/setgroups", "deny");
	char mapping[64];
	if (snprintf(mapping, sizeof(mapping), "0 %lu 1\n", (unsigned long)outside_uid) < 1
		|| !write_text_file("/proc/self/uid_map", mapping)
		|| snprintf(mapping, sizeof(mapping), "0 %lu 1\n", (unsigned long)outside_gid) < 1
		|| !write_text_file("/proc/self/gid_map", mapping)
		|| setresgid(0, 0, 0) != 0 || setresuid(0, 0, 0) != 0) return false;
	if (unshare(CLONE_NEWNS | CLONE_NEWNET | CLONE_NEWIPC | CLONE_NEWUTS | CLONE_NEWPID) != 0
		|| mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0
		|| sethostname("m5-native-child", 15u) != 0) return false;
	return true;
}

static uint64_t handled_filesystem_access(void)
{
	return LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE
		| LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE
		| LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG
		| LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK
		| LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER | LANDLOCK_ACCESS_FS_TRUNCATE;
}

static uint64_t allowed_access(int fd, enum grant_access access)
{
	struct stat metadata;
	if (fstat(fd, &metadata) != 0) return 0u;
	const bool directory = S_ISDIR(metadata.st_mode);
	if (access == GRANT_READ_ONLY) return LANDLOCK_ACCESS_FS_READ_FILE
		| (directory ? LANDLOCK_ACCESS_FS_READ_DIR : 0u);
	if (access == GRANT_READ_EXECUTE) return LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE
		| (directory ? LANDLOCK_ACCESS_FS_READ_DIR : 0u);
	return LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE
		| (directory ? LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE
			| LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK
			| LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER : 0u);
}

static bool add_landlock_rule(int ruleset, int fd, enum grant_access access)
{
	const struct landlock_path_beneath_attr rule = {
		.allowed_access = allowed_access(fd, access), .parent_fd = fd,
	};
	return rule.allowed_access != 0u
		&& syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0u) == 0;
}

static bool restrict_filesystem(const struct launch_request *request)
{
	const int abi = (int)syscall(SYS_landlock_create_ruleset, NULL, 0u, LANDLOCK_CREATE_RULESET_VERSION);
	if (abi < 3) return false;
	const struct landlock_ruleset_attr rules = { .handled_access_fs = handled_filesystem_access() };
	const int ruleset = (int)syscall(SYS_landlock_create_ruleset, &rules, sizeof(rules), 0u);
	if (ruleset < 0 || !add_landlock_rule(ruleset, request->executable_fd, GRANT_READ_EXECUTE)) {
		if (ruleset >= 0) close(ruleset);
		return false;
	}
	for (size_t index = 0u; index < request->grant_count; ++index) {
		if (!add_landlock_rule(ruleset, request->grants[index].fd, request->grants[index].access)) {
			close(ruleset);
			return false;
		}
	}
	const bool restricted = prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0
		&& syscall(SYS_landlock_restrict_self, ruleset, 0u) == 0;
	close(ruleset);
	return restricted;
}

static void append_filter(struct sock_filter *filters, size_t *count, struct sock_filter value)
{
	filters[(*count)++] = value;
}

static void deny_syscall(struct sock_filter *filters, size_t *count, int syscall_number, int error_number)
{
	append_filter(filters, count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K,
		(uint32_t)syscall_number, 0u, 1u));
	append_filter(filters, count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (uint32_t)error_number));
}

static bool install_seccomp(void)
{
	struct sock_filter filters[128];
	size_t count = 0u;
#if defined(__x86_64__)
	const uint32_t architecture = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
	const uint32_t architecture = AUDIT_ARCH_AARCH64;
#else
	return false;
#endif
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, architecture, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socketpair, 0u, 3u));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0])));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
#define DENY(number) deny_syscall(filters, &count, number, EPERM)
	DENY(SYS_socket); DENY(SYS_connect); DENY(SYS_bind); DENY(SYS_listen);
	DENY(SYS_accept); DENY(SYS_accept4); DENY(SYS_sendto); DENY(SYS_recvfrom); DENY(SYS_sendmsg);
	DENY(SYS_recvmsg); DENY(SYS_shutdown); DENY(SYS_setsockopt); DENY(SYS_getsockopt);
#ifdef SYS_fork
	DENY(SYS_fork);
#endif
#ifdef SYS_vfork
	DENY(SYS_vfork);
#endif
#ifdef SYS_clone3
	deny_syscall(filters, &count, SYS_clone3, ENOSYS);
#endif
	DENY(SYS_unshare); DENY(SYS_setns); DENY(SYS_mount); DENY(SYS_umount2); DENY(SYS_pivot_root);
	DENY(SYS_chroot); DENY(SYS_ptrace); DENY(SYS_process_vm_readv); DENY(SYS_process_vm_writev);
	DENY(SYS_bpf); DENY(SYS_perf_event_open); DENY(SYS_keyctl); DENY(SYS_add_key); DENY(SYS_request_key);
	DENY(SYS_userfaultfd); DENY(SYS_open_by_handle_at); DENY(SYS_name_to_handle_at);
#undef DENY
	const uint32_t required = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD;
	const uint32_t allowed = required | CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID
		| CLONE_CHILD_CLEARTID | CLONE_CHILD_SETTID;
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0u, 11u));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0])));
	append_filter(filters, &count, FILTER_STMT(BPF_ALU | BPF_AND | BPF_K, required));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, required, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0])));
	append_filter(filters, &count, FILTER_STMT(BPF_ALU | BPF_AND | BPF_K, ~allowed));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0u, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0]) + sizeof(uint32_t)));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0u, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
	const struct sock_fprog program = { .len = (unsigned short)count, .filter = filters };
	return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) == 0;
}

static void close_unneeded_fds(const struct launch_request *request, bool preserve_extra_input)
{
	for (int fd = 3; fd < 4096; ++fd) {
		if (fd != request->executable_fd && (!preserve_extra_input || fd != 3)) (void)close(fd);
	}
}

static int execute_isolated(const struct launch_request *request)
{
	if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() == 1
		|| prctl(PR_SET_DUMPABLE, 0) != 0) return CHILD_FAILURE;
	const struct rlimit no_core = { .rlim_cur = 0u, .rlim_max = 0u };
	const struct rlimit no_files = { .rlim_cur = 1024u, .rlim_max = 1024u };
	if (setrlimit(RLIMIT_CORE, &no_core) != 0 || setrlimit(RLIMIT_NOFILE, &no_files) != 0
		|| !restrict_filesystem(request) || !install_seccomp()) return CHILD_FAILURE;
	if (write(request->attestation_fd, enforcement_frame, sizeof(enforcement_frame) - 1u)
		!= (ssize_t)(sizeof(enforcement_frame) - 1u)) return CHILD_FAILURE;
	const bool extra_input = request->extra_input_fd >= 0;
	if (close(request->attestation_fd) != 0
		|| (extra_input && (dup2(request->extra_input_fd, 3) != 3
			|| close(request->extra_input_fd) != 0))
		|| fcntl(request->executable_fd, F_SETFD, FD_CLOEXEC) != 0) return CHILD_FAILURE;
	close_unneeded_fds(request, extra_input);
	char *const environment[] = { "LANG=C", "LC_ALL=C", "PATH=", "HOME=/nonexistent", NULL };
	syscall(SYS_execveat, request->executable_fd, "", request->child_argv, environment, AT_EMPTY_PATH);
	return CHILD_FAILURE;
}

static uint64_t elapsed_milliseconds(const struct timespec *start, const struct timespec *now)
{
	const int64_t nanoseconds = (int64_t)(now->tv_sec - start->tv_sec) * 1000000000LL
		+ (int64_t)now->tv_nsec - (int64_t)start->tv_nsec;
	return nanoseconds > 0 ? (uint64_t)(nanoseconds / 1000000LL) : 0u;
}

static bool resident_set_bytes(pid_t child, uint64_t *bytes)
{
	char path[64];
	if (snprintf(path, sizeof(path), "/proc/%ld/statm", (long)child) < 1) return false;
	FILE *stream = fopen(path, "re");
	if (stream == NULL) return false;
	unsigned long long ignored = 0u;
	unsigned long long resident_pages = 0u;
	const bool parsed = fscanf(stream, "%llu %llu", &ignored, &resident_pages) == 2;
	const long page_size = sysconf(_SC_PAGESIZE);
	const bool closed = fclose(stream) == 0;
	if (!parsed || !closed || page_size < 1
		|| resident_pages > UINT64_MAX / (uint64_t)page_size) return false;
	*bytes = (uint64_t)resident_pages * (uint64_t)page_size;
	return true;
}

static int child_result(int status)
{
	if (WIFEXITED(status)) return WEXITSTATUS(status);
	if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
	return CHILD_FAILURE;
}

static int supervise_isolated_child(const struct launch_request *request)
{
	const pid_t child = fork();
	if (child < 0) return CHILD_FAILURE;
	if (child == 0) _exit(execute_isolated(request));
	(void)close(request->attestation_fd);
	(void)close(request->profile_fd);
	(void)close(request->broker_fd);
	(void)close(request->executable_fd);
	if (request->extra_input_fd >= 0) (void)close(request->extra_input_fd);
	for (size_t index = 0u; index < request->grant_count; ++index) (void)close(request->grants[index].fd);
	isolated_child = child;
	struct sigaction action = { .sa_handler = forward_signal };
	sigemptyset(&action.sa_mask);
	(void)sigaction(SIGTERM, &action, NULL);
	(void)sigaction(SIGINT, &action, NULL);
	(void)sigaction(SIGHUP, &action, NULL);
	struct timespec started;
	if (clock_gettime(CLOCK_MONOTONIC, &started) != 0) {
		(void)kill(child, SIGKILL);
		(void)waitpid(child, NULL, 0);
		return CHILD_FAILURE;
	}
	int status = 0;
	for (;;) {
		const pid_t waited = waitpid(child, &status, WNOHANG);
		if (waited == child) break;
		if (waited < 0 && errno != EINTR) return CHILD_FAILURE;
		struct timespec now;
		uint64_t rss = 0u;
		const bool sampled = clock_gettime(CLOCK_MONOTONIC, &now) == 0
			&& resident_set_bytes(child, &rss);
		if (!sampled || elapsed_milliseconds(&started, &now) > request->maximum_duration_ms
			|| rss > request->maximum_rss_bytes) {
			(void)kill(child, SIGKILL);
			while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
			isolated_child = -1;
			return CHILD_FAILURE;
		}
		const struct timespec interval = { .tv_sec = 0, .tv_nsec = 10000000 };
		(void)nanosleep(&interval, NULL);
	}
	isolated_child = -1;
	return child_result(status);
}

int main(int argc, char **argv)
{
	struct launch_request request;
	if (!parse_request(argc, argv, &request) || !valid_grants(&request)) return CHILD_FAILURE;
	if (!create_namespaces()) return CHILD_FAILURE;
	return supervise_isolated_child(&request);
}
