#!/usr/bin/env bash
# Gradle wrapper launcher
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v gradle >/dev/null 2>&1; then
  exec gradle "$@"
fi

WRAPPER_JAR="$DIR/gradle/wrapper/gradle-wrapper.jar"
if [ -f "$WRAPPER_JAR" ]; then
  exec java -jar "$WRAPPER_JAR" "$@"
fi

echo "Error: 'gradle' command not found on PATH." >&2
echo "Please install Gradle (https://gradle.org/install/), add it to your PATH, or open the 'android' folder in Android Studio." >&2
exit 1
