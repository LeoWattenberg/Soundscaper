# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.28)
project(milestone5_native_isolation_launcher VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 17)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_EXTENSIONS OFF)

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	add_executable(milestone5-native-isolation-launcher src/linux_launcher.c)
	target_compile_options(milestone5-native-isolation-launcher PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_link_options(milestone5-native-isolation-launcher PRIVATE -Wl,--build-id=none)
	set(ISOLATION_PROFILES profiles/linux-v1.json profiles/linux-broker-v1.json)
elseif(APPLE)
	enable_language(OBJCXX)
	add_executable(milestone5-native-isolation-launcher src/macos_launcher.mm)
	target_compile_options(milestone5-native-isolation-launcher PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_link_libraries(milestone5-native-isolation-launcher PRIVATE "-lsandbox")
	set(ISOLATION_PROFILES profiles/macos-v1.sb profiles/macos-broker-v1.json)
elseif(WIN32)
	add_executable(milestone5-native-isolation-launcher src/windows_launcher.cpp)
	target_compile_definitions(milestone5-native-isolation-launcher PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN)
	target_compile_options(milestone5-native-isolation-launcher PRIVATE /W4 /WX /permissive-)
	target_link_libraries(milestone5-native-isolation-launcher PRIVATE advapi32 userenv)
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
