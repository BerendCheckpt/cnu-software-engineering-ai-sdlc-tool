#!/bin/sh
# Begin, build and end in one container: `begin` installs MSBuild hooks in $HOME, which a second container
# would not have. Usage: scan-dotnet <project-key> <server-url>
#
# The scan builds a copy in /tmp, never the mounted workspace: the test gate builds and runs the workspace at the
# same time, and two builds of one folder collide. The copy's paths are the same relative paths, so findings point
# at the repository's own files.
#
# The token comes from the SONAR_TOKEN environment variable, passed to the container by name. It stays inside
# this container: it is not written to the workspace.
set -eu

key="$1"
server="$2"

mkdir -p /tmp/src
tar -C /work --exclude=./.git --exclude='*/bin' --exclude='*/obj' --exclude=./.aisdlc --exclude=./.sonarqube -cf - . \
  | tar -C /tmp/src -xf -
cd /tmp/src

dotnet-sonarscanner begin /k:"$key" /d:sonar.host.url="$server" /d:sonar.token="$SONAR_TOKEN" \
  /d:sonar.qualitygate.wait=true /d:sonar.qualitygate.timeout=600 /d:sonar.scanner.skipJreProvisioning=true
dotnet build --no-incremental
dotnet-sonarscanner end /d:sonar.token="$SONAR_TOKEN"
