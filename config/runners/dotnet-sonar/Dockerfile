# SonarScanner for .NET runner (ADR 0008). Build it once on the machine that runs the clean-up and migration gates:
#   docker build -t aisdlc/dotnet-sonar:1 config/runners/dotnet-sonar
#
# The .NET 10 SDK image, plus the .NET 9 SDK so .NET 9 projects build before and after a 9 -> 10 migration,
# a Java runtime for the scanner (SonarQube 26.x needs Java 21 or newer), and the scanner itself.
FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:de4fe90a98845d75910b9769662465c84de1a934665c431279d1382b2bddc02b

ARG SCANNER_VERSION=12.0.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
 && bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
 && rm /tmp/dotnet-install.sh \
 && dotnet tool install dotnet-sonarscanner --version "$SCANNER_VERSION" --tool-path /opt/sonar

COPY scan-dotnet.sh /opt/sonar/scan-dotnet
RUN chmod 755 /opt/sonar/scan-dotnet

ENV PATH="/opt/sonar:${PATH}" \
    DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1
