/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <filesystem>
#include <cstdlib>
#include <stdexcept>
#include <string>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <cerrno>
#include <chrono>
#include <csignal>
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#ifdef __APPLE__
#include <crt_externs.h>
#else
extern char** environ;
#endif
#endif

// Driver discovery runs in a separate executable because some Dawn callbacks
// terminate their process instead of returning an error for a missing adapter.
inline void ScapeRunWebGpuProbe(const std::filesystem::path& executable) {
#ifdef _WIN32
	std::wstring arguments = L"\"" + executable.native() + L"\" " + std::to_wstring(GetCurrentProcessId());
	STARTUPINFOW startup{};
	startup.cb = sizeof(startup);
	PROCESS_INFORMATION child{};
	if (!CreateProcessW(executable.c_str(), arguments.data(), nullptr, nullptr, FALSE,
		CREATE_NO_WINDOW, nullptr, nullptr, &startup, &child)) {
		throw std::runtime_error("The authenticated WebGPU device probe could not start.");
	}
	CloseHandle(child.hThread);
	const auto wait = WaitForSingleObject(child.hProcess, 6000);
	DWORD exit_code = 1;
	if (wait == WAIT_OBJECT_0) GetExitCodeProcess(child.hProcess, &exit_code);
	else {
		TerminateProcess(child.hProcess, 125);
		if (WaitForSingleObject(child.hProcess, 2000) != WAIT_OBJECT_0) {
			// Do not resume CPU inference while an unobserved probe might remain.
			std::_Exit(125);
		}
	}
	CloseHandle(child.hProcess);
	if (wait != WAIT_OBJECT_0 || exit_code != 0) {
		throw std::runtime_error("No compatible WebGPU adapter passed the isolated device probe.");
	}
#else
	const std::string path = executable.string(), parent = std::to_string(getpid());
	char* arguments[] = {const_cast<char*>(path.c_str()), const_cast<char*>(parent.c_str()), nullptr};
	posix_spawn_file_actions_t actions;
	if (posix_spawn_file_actions_init(&actions) != 0) {
		throw std::runtime_error("The authenticated WebGPU device probe could not initialize.");
	}
	posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
	posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
	posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
	pid_t child = 0;
#ifdef __APPLE__
	char** environment = *_NSGetEnviron();
#else
	char** environment = environ;
#endif
	const int spawned = posix_spawn(&child, path.c_str(), &actions, nullptr, arguments, environment);
	posix_spawn_file_actions_destroy(&actions);
	if (spawned != 0) throw std::runtime_error("The authenticated WebGPU device probe could not start.");
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(6);
	int status = 0;
	while (true) {
		const pid_t result = waitpid(child, &status, WNOHANG);
		if (result == child) break;
		if (result < 0 && errno != EINTR) {
			kill(child, SIGKILL);
			while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
			throw std::runtime_error("The isolated WebGPU device probe could not be observed.");
		}
		if (std::chrono::steady_clock::now() >= deadline) {
			kill(child, SIGKILL);
			while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
			throw std::runtime_error("The isolated WebGPU device probe timed out.");
		}
		std::this_thread::sleep_for(std::chrono::milliseconds(10));
	}
	if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
		throw std::runtime_error("No compatible WebGPU adapter passed the isolated device probe.");
	}
#endif
}
