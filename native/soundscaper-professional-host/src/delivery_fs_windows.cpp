/* SPDX-License-Identifier: AGPL-3.0-only */

#include "delivery_fs_platform.hpp"
#include "delivery_fs_sha256.hpp"

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winternl.h>

#include <algorithm>
#include <array>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cwctype>
#include <cstring>
#include <memory>
#include <new>
#include <span>
#include <string>

namespace soundscaper::delivery_fs {
namespace {

class owned_handle final {
public:
	explicit owned_handle(HANDLE value = INVALID_HANDLE_VALUE) noexcept : value_(value) {}
	~owned_handle() { reset(); }
	owned_handle(const owned_handle&) = delete;
	owned_handle& operator=(const owned_handle&) = delete;
	owned_handle(owned_handle&& other) noexcept : value_(other.release()) {}
	owned_handle& operator=(owned_handle&& other) noexcept {
		if (this != &other) reset(other.release());
		return *this;
	}
	HANDLE get() const noexcept { return value_; }
	HANDLE release() noexcept { const auto output = value_; value_ = INVALID_HANDLE_VALUE; return output; }
	void reset(HANDLE value = INVALID_HANDLE_VALUE) noexcept {
		if (value_ != INVALID_HANDLE_VALUE && value_ != nullptr) CloseHandle(value_);
		value_ = value;
	}
private:
	HANDLE value_;
};

[[noreturn]] void fail_windows(const char* code, const char* phase, bool retryable = false,
	DWORD error = GetLastError()) {
	throw protocol_error(code, phase, retryable, "Windows error " + std::to_string(error) + ".");
}

bool unsupported(DWORD error) {
	return error == ERROR_NOT_SUPPORTED || error == ERROR_INVALID_FUNCTION
		|| error == ERROR_INVALID_PARAMETER;
}

using nt_create_file = NTSTATUS (NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
	PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using nt_set_information_file = NTSTATUS (NTAPI*)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG,
	FILE_INFORMATION_CLASS);
using rtl_status_to_error = ULONG (WINAPI*)(NTSTATUS);

// The desktop Windows SDK does not expose the kernel FILE_LINK_INFORMATION
// declaration. Keep this wire-compatible layout local to the one native call.
struct file_link_information {
	union {
		BOOLEAN replace_if_exists;
		ULONG flags;
	};
	HANDLE root_directory;
	ULONG file_name_length;
	WCHAR file_name[1];
};

constexpr auto file_link_information_class = static_cast<FILE_INFORMATION_CLASS>(11);

DWORD status_error(NTSTATUS status) {
	const auto module = GetModuleHandleW(L"ntdll.dll");
	const auto convert = module == nullptr ? nullptr : reinterpret_cast<rtl_status_to_error>(
		GetProcAddress(module, "RtlNtStatusToDosError"));
	return convert == nullptr ? ERROR_GEN_FAILURE : convert(status);
}

owned_handle open_relative(HANDLE root, std::wstring& leaf, ACCESS_MASK access,
	ULONG disposition, ULONG options, ULONG attributes, ULONG sharing, const char* phase,
	bool allow_missing = false) {
	const auto module = GetModuleHandleW(L"ntdll.dll");
	const auto create = module == nullptr ? nullptr : reinterpret_cast<nt_create_file>(
		GetProcAddress(module, "NtCreateFile"));
	if (create == nullptr) fail_windows("unsupported-filesystem", phase);
	if (leaf.size() > USHRT_MAX / sizeof(wchar_t)) {
		throw protocol_error("invalid-final-name", phase, false, "The Windows relative leaf is too long.");
	}
	UNICODE_STRING name {};
	name.Buffer = leaf.data();
	name.Length = static_cast<USHORT>(leaf.size() * sizeof(wchar_t));
	name.MaximumLength = name.Length;
	OBJECT_ATTRIBUTES object {};
	InitializeObjectAttributes(&object, &name, OBJ_CASE_INSENSITIVE, root, nullptr);
	IO_STATUS_BLOCK status_block {};
	HANDLE handle = INVALID_HANDLE_VALUE;
	const auto status = create(&handle, access, &object, &status_block, nullptr, attributes, sharing,
		disposition, options, nullptr, 0);
	if (status < 0) {
		const auto error = status_error(status);
		SetLastError(error);
		if (allow_missing && (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)) {
			return owned_handle();
		}
		if (unsupported(error)) fail_windows("unsupported-filesystem", phase, false, error);
		fail_windows("staging-unavailable", phase, true, error);
	}
	return owned_handle(handle);
}

std::wstring utf16(const std::string& value) {
	const auto size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
		static_cast<int>(value.size()), nullptr, 0);
	if (size <= 0) fail_windows("malformed-control", "utf8-decode");
	std::wstring output(static_cast<std::size_t>(size), L'\0');
	if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
		static_cast<int>(value.size()), output.data(), size) != size) {
		fail_windows("malformed-control", "utf8-decode");
	}
	return output;
}

std::uint64_t file_index(const BY_HANDLE_FILE_INFORMATION& details) {
	return (static_cast<std::uint64_t>(details.nFileIndexHigh) << 32U) | details.nFileIndexLow;
}

root_identity directory_identity(const BY_HANDLE_FILE_INFORMATION& details) {
	const auto volume = "device:" + hex_value(details.dwVolumeSerialNumber);
	return {volume, volume + ":inode:" + hex_value(file_index(details))};
}

file_identity regular_file_identity(const BY_HANDLE_FILE_INFORMATION& details) {
	return {"device:" + hex_value(details.dwVolumeSerialNumber), "inode:" + hex_value(file_index(details))};
}

bool same(const root_identity& left, const root_identity& right) {
	return left.volume_identity == right.volume_identity
		&& left.directory_identity == right.directory_identity;
}

bool same(const file_identity& left, const file_identity& right) {
	return left.volume_identity == right.volume_identity
		&& left.file_identity_value == right.file_identity_value;
}

BY_HANDLE_FILE_INFORMATION handle_information(HANDLE handle, const char* phase) {
	BY_HANDLE_FILE_INFORMATION output {};
	if (!GetFileInformationByHandle(handle, &output)) fail_windows("filesystem-stat-failed", phase, true);
	return output;
}

owned_handle open_authenticated_root(const std::wstring& path, const root_identity& expected) {
	owned_handle root(CreateFileW(path.c_str(),
		FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
		FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
		FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
	if (root.get() == INVALID_HANDLE_VALUE) fail_windows("destination-unavailable", "root-open", true);
	const auto details = handle_information(root.get(), "root-stat");
	if ((details.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
		throw protocol_error("destination-unavailable", "root-stat", false,
			"The authorized delivery root is not a directory.");
	}
	if (!same(directory_identity(details), expected)) {
		throw protocol_error("destination-identity-mismatch", "root-stat", false,
			"The opened delivery root is not the authorized physical directory.");
	}
	return root;
}

void validate_windows_leaf(const std::wstring& value) {
	if (value.empty() || value.back() == L'.' || value.back() == L' ') {
		throw protocol_error("invalid-final-name", "init", false,
			"Windows final names cannot end in a dot or space.");
	}
	auto stem = value.substr(0, value.find(L'.'));
	for (auto& character : stem) character = static_cast<wchar_t>(towupper(character));
	const auto reserved = stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL"
		|| (stem.size() == 4 && (stem.starts_with(L"COM") || stem.starts_with(L"LPT"))
			&& stem[3] >= L'1' && stem[3] <= L'9');
	if (reserved) throw protocol_error("invalid-final-name", "init", false,
		"Windows device names cannot be delivery final names.");
}

class windows_session final : public platform_session {
public:
	explicit windows_session(const init_request& request)
		: final_name_(utf16(request.final_name)),
		root_(open_authenticated_root(utf16(request.root_path), request.expected_root_identity)),
		root_identity_(request.expected_root_identity),
		staging_reference_("windows-delete-on-close-v1:" + request.session_id) {
		validate_windows_leaf(final_name_);
		auto staging_name = utf16(".soundscaper-delivery-" + request.session_id + ".native-stage");
		file_ = open_relative(root_.get(), staging_name,
			FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE | SYNCHRONIZE,
			FILE_CREATE, FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT
				| FILE_DELETE_ON_CLOSE | FILE_OPEN_REPARSE_POINT | FILE_WRITE_THROUGH,
			FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY, 0, "stage-open");
		const auto details = handle_information(file_.get(), "stage-stat");
		if ((details.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) {
			throw protocol_error("unsupported-filesystem", "stage-stat", false,
				"Windows did not create one direct regular delivery file.");
		}
		file_identity_ = regular_file_identity(details);
		if (file_identity_.volume_identity != root_identity_.volume_identity) {
			throw protocol_error("unsupported-filesystem", "stage-stat", false,
				"Windows staging is not on the authorized destination volume.");
		}
	}

	~windows_session() override { abort(); }
	const root_identity& root() const noexcept override { return root_identity_; }
	const file_identity& file() const noexcept override { return file_identity_; }
	const std::string& staging_reference() const noexcept override { return staging_reference_; }

	void write_at(std::uint64_t offset, std::span<const std::byte> bytes) override {
		seek(offset, "write-seek");
		std::size_t written = 0;
		while (written < bytes.size()) {
			DWORD count = 0;
			const auto amount = static_cast<DWORD>(std::min<std::size_t>(
				bytes.size() - written, static_cast<std::size_t>(MAXDWORD)));
			if (!WriteFile(file_.get(), bytes.data() + written, amount, &count, nullptr)) {
				fail_windows("staging-write-failed", "write", true);
			}
			if (count == 0) throw protocol_error("staging-write-failed", "write", true,
				"The Windows delivery file accepted a zero-byte write.");
			written += count;
		}
	}

	std::size_t read_at(std::uint64_t offset, std::span<std::byte> bytes) override {
		seek(offset, "read-seek");
		DWORD count = 0;
		const auto amount = static_cast<DWORD>(std::min<std::size_t>(bytes.size(), MAXDWORD));
		if (!ReadFile(file_.get(), bytes.data(), amount, &count, nullptr)) {
			fail_windows("staging-read-failed", "seal-read", true);
		}
		return count;
	}

	std::uint64_t size() const override {
		LARGE_INTEGER value {};
		if (!GetFileSizeEx(file_.get(), &value) || value.QuadPart < 0) {
			fail_windows("filesystem-stat-failed", "stage-size", true);
		}
		assert_file_identity("stage-stat");
		return static_cast<std::uint64_t>(value.QuadPart);
	}

	void flush_file() override {
		if (!FlushFileBuffers(file_.get())) fail_windows("staging-sync-failed", "seal-sync", true);
	}

	publication_result publish() override {
		assert_root_identity();
		const auto name_bytes = final_name_.size() * sizeof(wchar_t);
		const auto storage_size = std::max(sizeof(file_link_information),
			offsetof(file_link_information, file_name) + name_bytes);
		auto storage = std::make_unique<std::byte[]>(storage_size);
		auto* link = new (storage.get()) file_link_information {};
		link->replace_if_exists = FALSE;
		link->root_directory = root_.get();
		link->file_name_length = static_cast<ULONG>(name_bytes);
		std::memcpy(link->file_name, final_name_.data(), name_bytes);
		const auto module = GetModuleHandleW(L"ntdll.dll");
		const auto set_information = module == nullptr ? nullptr
			: reinterpret_cast<nt_set_information_file>(
				GetProcAddress(module, "NtSetInformationFile"));
		if (set_information == nullptr) {
			fail_windows("unsupported-filesystem", "publish-link", false, ERROR_PROC_NOT_FOUND);
		}
		IO_STATUS_BLOCK status_block {};
		const auto status = set_information(file_.get(), &status_block, link,
			static_cast<ULONG>(storage_size), file_link_information_class);
		if (status < 0) {
			const auto error = status_error(status);
			if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) {
				fail_windows("publication-conflict", "publish-link", false, error);
			}
			if (unsupported(error)) fail_windows("unsupported-filesystem", "publish-link", false, error);
			fail_windows("publication-failed", "publish-link", true, error);
		}
		FILE_STANDARD_INFO linked {};
		if (!GetFileInformationByHandleEx(file_.get(), FileStandardInfo, &linked, sizeof(linked))
			|| linked.NumberOfLinks < 2) {
			fail_windows("publication-verification-failed", "publish-link-count", true);
		}
		FILE_DISPOSITION_INFO_EX disposition {};
		disposition.Flags = FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS
			| FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE;
		if (!SetFileInformationByHandle(file_.get(), FileDispositionInfoEx, &disposition,
			sizeof(disposition))) {
			const auto error = GetLastError();
			if (unsupported(error)) fail_windows("unsupported-filesystem", "stage-retire", false, error);
			fail_windows("publication-failed", "stage-retire", true, error);
		}
		if (!FlushFileBuffers(file_.get())) {
			const auto error = GetLastError();
			if (unsupported(error)) fail_windows("unsupported-filesystem", "publish-metadata-sync", false, error);
			fail_windows("publication-sync-failed", "publish-metadata-sync", true, error);
		}
		FILE_STANDARD_INFO retired {};
		if (!GetFileInformationByHandleEx(file_.get(), FileStandardInfo, &retired, sizeof(retired))
			|| retired.NumberOfLinks != linked.NumberOfLinks - 1) {
			throw protocol_error("publication-verification-failed", "stage-retire-count", false,
				"Windows did not retire exactly one staging hard link.");
		}
		return {file_identity_};
	}

	void abort() noexcept override {
		file_.reset();
		root_.reset();
	}

private:
	void seek(std::uint64_t offset, const char* phase) {
		LARGE_INTEGER position {};
		position.QuadPart = static_cast<LONGLONG>(offset);
		if (!SetFilePointerEx(file_.get(), position, nullptr, FILE_BEGIN)) {
			fail_windows("filesystem-seek-failed", phase, true);
		}
	}

	void assert_file_identity(const char* phase) const {
		if (!same(regular_file_identity(handle_information(file_.get(), phase)), file_identity_)) {
			throw protocol_error("staging-identity-mismatch", phase, false,
				"The retained Windows delivery handle changed identity.");
		}
	}

	void assert_root_identity() const {
		if (!same(directory_identity(handle_information(root_.get(), "publish-root-stat")), root_identity_)) {
			throw protocol_error("destination-identity-mismatch", "publish-root-stat", false,
				"The retained Windows destination handle changed identity.");
		}
	}

	std::wstring final_name_;
	owned_handle root_;
	owned_handle file_;
	root_identity root_identity_;
	file_identity file_identity_;
	std::string staging_reference_;
};

} // namespace

std::unique_ptr<platform_session> create_platform_session(const init_request& request) {
	return std::make_unique<windows_session>(request);
}

recovery_result recover_platform_session(const recovery_request& request) {
	auto root = open_authenticated_root(utf16(request.root_path), request.expected_root_identity);
	(void)root;
	return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
}

recovery_result inspect_platform_final(const final_inspection_request& request) {
	auto root = open_authenticated_root(utf16(request.root_path), request.expected_root_identity);
	auto name = utf16(request.final_name);
	validate_windows_leaf(name);
	auto file = open_relative(root.get(), name, FILE_GENERIC_READ | SYNCHRONIZE,
		FILE_OPEN, FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
		FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
		"inspect-final-open", true);
	if (file.get() == INVALID_HANDLE_VALUE) {
		return {.status = "missing", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	const auto before = handle_information(file.get(), "inspect-final-stat");
	if ((before.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	const auto identity = regular_file_identity(before);
	if (identity.volume_identity != request.expected_root_identity.volume_identity) {
		return {.status = "foreign", .byte_length = 0, .sha256 = {}, .identity = std::nullopt};
	}
	LARGE_INTEGER size {};
	if (!GetFileSizeEx(file.get(), &size) || size.QuadPart < 0) {
		fail_windows("final-inspection-failed", "inspect-final-size", true);
	}
	LARGE_INTEGER beginning {};
	if (!SetFilePointerEx(file.get(), beginning, nullptr, FILE_BEGIN)) {
		fail_windows("final-inspection-failed", "inspect-final-seek", true);
	}
	sha256 digest;
	std::array<std::byte, 1024U * 1024U> buffer{};
	std::uint64_t offset = 0;
	const auto length = static_cast<std::uint64_t>(size.QuadPart);
	while (offset < length) {
		const auto amount = static_cast<DWORD>(
			std::min<std::uint64_t>(buffer.size(), length - offset));
		DWORD count = 0;
		if (!ReadFile(file.get(), buffer.data(), amount, &count, nullptr)) {
			fail_windows("final-inspection-failed", "inspect-final-read", true);
		}
		if (count == 0) throw protocol_error("final-inspection-failed", "inspect-final-read", true,
			"The Windows final delivery file returned an early end of file.");
		digest.update(std::span(buffer).first(count));
		offset += count;
	}
	LARGE_INTEGER after_size {};
	const auto after = handle_information(file.get(), "inspect-final-stat");
	if (!GetFileSizeEx(file.get(), &after_size) || after_size.QuadPart != size.QuadPart
		|| !same(regular_file_identity(after), identity)) {
		throw protocol_error("final-identity-mismatch", "inspect-final-stat", false,
			"The Windows final delivery file changed while it was inspected.");
	}
	return {.status = "inspection", .byte_length = length,
		.sha256 = digest.finish_hex(), .identity = identity};
}

} // namespace soundscaper::delivery_fs
