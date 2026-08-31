# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.28)
project(milestone5_native_isolation_launcher VERSION 1.0.0 LANGUAGES C CXX)

if(MSVC)
	set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 17)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_EXTENSIONS OFF)

if(NOT DEFINED SOUNDSCAPER_NATIVE_TARGET)
	message(FATAL_ERROR "SOUNDSCAPER_NATIVE_TARGET is required")
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	if(SOUNDSCAPER_NATIVE_TARGET STREQUAL "linux-x64")
		if(NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(AMD64|x86_64|x64)$")
			message(FATAL_ERROR "The isolation launcher is not configuring for Linux x64")
		endif()
	elseif(SOUNDSCAPER_NATIVE_TARGET STREQUAL "linux-arm64")
		if(NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(ARM64|aarch64|arm64)$")
			message(FATAL_ERROR "The isolation launcher is not configuring for Linux ARM64")
		endif()
	else()
		message(FATAL_ERROR "The isolation launcher target is not a supported Linux target")
	endif()
elseif(APPLE)
	if(NOT SOUNDSCAPER_NATIVE_TARGET STREQUAL "mac-arm64"
		OR NOT CMAKE_OSX_ARCHITECTURES STREQUAL "arm64")
		message(FATAL_ERROR "The isolation launcher supports only macOS ARM64")
	endif()
elseif(WIN32)
	if(SOUNDSCAPER_NATIVE_TARGET STREQUAL "win-x64")
		if(NOT CMAKE_GENERATOR_PLATFORM STREQUAL "x64")
			message(FATAL_ERROR "The isolation launcher is not configuring for Windows x64")
		endif()
	elseif(SOUNDSCAPER_NATIVE_TARGET STREQUAL "win-arm64")
		if(NOT CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
			message(FATAL_ERROR "The isolation launcher is not configuring for Windows ARM64")
		endif()
	else()
		message(FATAL_ERROR "The isolation launcher target is not a supported Windows target")
	endif()
endif()

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	add_executable(milestone5-native-isolation-launcher src/linux_launcher.c)
	target_compile_options(milestone5-native-isolation-launcher PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_link_options(milestone5-native-isolation-launcher PRIVATE -Wl,--build-id=none)
	set(ISOLATION_PROFILES profiles/linux-v1.json profiles/linux-broker-v1.json)
elseif(APPLE)
	enable_language(OBJCXX)
	add_executable(milestone5-native-isolation-launcher src/macos_launcher.mm)
	target_compile_options(milestone5-native-isolation-launcher PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_link_libraries(milestone5-native-isolation-launcher PRIVATE "-lproc")
	set(ISOLATION_PROFILES profiles/macos-v1.sb profiles/macos-broker-v1.json)
elseif(WIN32)
	add_executable(milestone5-native-isolation-launcher src/windows_launcher.cpp)
	target_compile_definitions(milestone5-native-isolation-launcher PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN)
	target_compile_options(milestone5-native-isolation-launcher PRIVATE /W4 /WX /permissive-)
	target_link_libraries(milestone5-native-isolation-launcher PRIVATE advapi32 onecoreuap userenv)
	set(ISOLATION_PROFILES profiles/windows-v1.json profiles/windows-broker-v1.json)
else()
	message(FATAL_ERROR "No native isolation launcher is implemented for this target")
endif()

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang" OR CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
	target_compile_options(milestone5-native-isolation-launcher PRIVATE
		-ffile-prefix-map=${CMAKE_SOURCE_DIR}=.
		-fdebug-prefix-map=${CMAKE_SOURCE_DIR}=.
		-fno-ident
	)
endif()
install(TARGETS milestone5-native-isolation-launcher RUNTIME DESTINATION bin)
install(FILES ${ISOLATION_PROFILES} DESTINATION profiles)
file(GENERATE
	OUTPUT "${CMAKE_BINARY_DIR}/soundscaper-isolation-toolchain.json"
	CONTENT "{\n\
\t\"cmakeVersion\":\"${CMAKE_VERSION}\",\n\
\t\"generator\":\"${CMAKE_GENERATOR}\",\n\
\t\"generatorPlatform\":\"${CMAKE_GENERATOR_PLATFORM}\",\n\
\t\"systemName\":\"${CMAKE_SYSTEM_NAME}\",\n\
\t\"systemProcessor\":\"${CMAKE_SYSTEM_PROCESSOR}\",\n\
\t\"osxArchitectures\":\"${CMAKE_OSX_ARCHITECTURES}\",\n\
\t\"cCompiler\":{\"id\":\"${CMAKE_C_COMPILER_ID}\",\"version\":\"${CMAKE_C_COMPILER_VERSION}\"},\n\
\t\"cxxCompiler\":{\"id\":\"${CMAKE_CXX_COMPILER_ID}\",\"version\":\"${CMAKE_CXX_COMPILER_VERSION}\"}\n\
}\n")
