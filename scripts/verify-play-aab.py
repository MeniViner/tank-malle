"""Validate a signed Tank Malle release bundle before uploading it to Play."""

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile


PACKAGE = "com.meniviner.tankmalle"
ANDROID = "{http://schemas.android.com/apk/res/android}"
PAGE_SIZE = 16 * 1024
MIN_TARGET_SDK = 36
RESTRICTED_PERMISSIONS = {
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def call(*args, cwd):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    failure = result.stderr.strip() or result.stdout.strip()
    require(result.returncode == 0, failure or f"{Path(args[0]).name} exited with {result.returncode}")
    return result.stdout.strip()


def verify_manifest(xml, expected_version, previous_code):
    manifest = ET.fromstring(xml)
    require(manifest.get("package") == PACKAGE, f"Expected application ID {PACKAGE}")
    require(manifest.get(ANDROID + "versionName") == expected_version, "Unexpected versionName")
    code = int(manifest.get(ANDROID + "versionCode", "0"))
    require(code > previous_code, f"versionCode must be greater than {previous_code}")
    sdk = manifest.find("uses-sdk")
    target = int(sdk.get(ANDROID + "targetSdkVersion", "0")) if sdk is not None else 0
    require(target >= MIN_TARGET_SDK, f"Google Play requires target API {MIN_TARGET_SDK} or higher")
    application = manifest.find("application")
    require(application is not None, "The manifest has no application element")
    for flag in ("debuggable", "testOnly", "usesCleartextTraffic"):
        require(application.get(ANDROID + flag) not in ("true", "1"), f"Release manifest enables {flag}")
    permissions = {tag.get(ANDROID + "name") for tag in manifest if tag.tag.startswith("uses-permission")}
    restricted = sorted(RESTRICTED_PERMISSIONS.intersection(permissions))
    require(not restricted, f"Unexpected restricted permissions: {', '.join(restricted)}")
    return code, target


def verify_native_alignment(bundle, config):
    libs = {}
    for name in bundle.namelist():
        match = re.fullmatch(r"([^/]+)/lib/([^/]+)/([^/]+\.so)", name)
        if match:
            module, abi, library = match.groups()
            libs[module, abi, library] = name

    for module, abi, library in libs:
        counterpart = {"armeabi-v7a": "arm64-v8a", "x86": "x86_64"}.get(abi)
        if counterpart:
            require((module, counterpart, library) in libs, f"Missing {counterpart} counterpart for {library}")

    count = 0
    for (_, abi, _), name in libs.items():
        if abi not in ("arm64-v8a", "x86_64"):
            continue
        data = bundle.read(name)
        require(len(data) >= 64 and data[:6] == b"\x7fELF\x02\x01", f"Invalid ELF64 library: {name}")
        offset = struct.unpack_from("<Q", data, 32)[0]
        entry_size, entries = struct.unpack_from("<HH", data, 54)
        require(entry_size >= 56 and offset + entry_size * entries <= len(data), f"Invalid ELF headers: {name}")
        loads = 0
        for index in range(entries):
            start = offset + index * entry_size
            segment, _, file_offset, address, _, _, _, alignment = struct.unpack_from("<IIQQQQQQ", data, start)
            if segment == 1:  # PT_LOAD
                loads += 1
                aligned = alignment >= PAGE_SIZE and (file_offset - address) % PAGE_SIZE == 0
                require(aligned, f"ELF segment is incompatible with 16 KB pages: {name}")
        require(loads, f"No loadable segments: {name}")
        count += 1

    packaging = config.get("optimizations", {}).get("uncompressNativeLibraries", {})
    if count and packaging.get("enabled") is True:
        require(packaging.get("alignment") == "PAGE_ALIGNMENT_16K", "Bundle does not request 16 KB APK alignment")
    return count


def verify_capacitor(bundle, expected_version, expected_commit):
    assets = "base/assets/"
    config = json.loads(bundle.read(assets + "capacitor.config.json"))
    require(config.get("appId") == PACKAGE, "Unexpected Capacitor app ID")
    server = config.get("server", {})
    require(not server.get("url") and not server.get("cleartext"), "Bundle points Capacitor at a development server")
    app_plugin = config.get("plugins", {}).get("App", {})
    require(not app_plugin.get("disableBackButtonHandler"), "Capacitor App Back handling is disabled")
    plugins = json.loads(bundle.read(assets + "capacitor.plugins.json"))
    require(any(plugin.get("pkg") == "@capacitor/app" for plugin in plugins), "Capacitor App plugin is missing")

    build = json.loads(bundle.read(assets + "public/build-info.json"))
    require(build.get("version") == expected_version, "Embedded web version disagrees with the Android version")
    require(build.get("dirty") is False, "Embedded web build was not made from a clean tree")
    require(build.get("mode") in ("production", "native-personal", "native-play"), "Embedded web build is not a production mode")
    require(re.fullmatch(r"[0-9a-f]{40}", build.get("commit", "")), "Missing embedded Git commit")
    if expected_commit:
        require(build["commit"] == expected_commit, "Bundle was built from a different Git commit")
    return build


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(args, working):
    cert = args.upload_cert_sha256.replace(":", "").lower()
    require(re.fullmatch(r"[a-f0-9]{64}", cert), "Expected a SHA-256 certificate fingerprint")
    jdk = os.environ.get("JAVA_HOME")
    java = str(Path(jdk) / "bin" / ("java.exe" if os.name == "nt" else "java")) if jdk else "java"
    signature_checker = "VerifyAndroidBundleSignature.java"
    shutil.copyfile(Path(__file__).with_name(signature_checker), working / signature_checker)
    shutil.copyfile(args.bundle, working / "release.aab")
    shutil.copyfile(args.bundletool, working / "bundletool.jar")
    signer = call(java, signature_checker, "release.aab", cwd=working)
    require(signer == cert, f"Upload certificate mismatch (bundle signer is {signer})")

    bundletool = (java, "-Dfile.encoding=UTF-8", "-jar", "bundletool.jar")
    bundle_flag = "--bundle=release.aab"
    call(*bundletool, "validate", bundle_flag, cwd=working)
    xml = call(*bundletool, "dump", "manifest", bundle_flag, cwd=working)
    code, target = verify_manifest(xml, args.version, args.version_code_after)
    config = json.loads(call(*bundletool, "dump", "config", bundle_flag, cwd=working))
    with ZipFile(working / "release.aab") as bundle:
        count = verify_native_alignment(bundle, config)
        build = verify_capacitor(bundle, args.version, args.commit)

    return {
        "file": str(args.bundle), "package": PACKAGE, "version": args.version, "versionCode": code,
        "targetSdk": target, "signedByUploadCertificate": signer, "aligned64BitLibraries": count,
        "build": build, "sha256": sha256(working / "release.aab"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--bundletool", required=True, type=Path, help="Path to the official bundletool JAR")
    parser.add_argument("--upload-cert-sha256", required=True, help="Expected SHA-256 of the Play upload certificate")
    parser.add_argument("--version", required=True, help="Expected versionName")
    parser.add_argument("--version-code-after", type=int, default=2, help="Highest Android versionCode already distributed")
    parser.add_argument("--commit", help="Expected commit in the embedded web build")
    args = parser.parse_args()

    # Use relative tool arguments so a localized checkout path is not decoded
    # by the Windows Java launcher with the system ANSI code page.
    with TemporaryDirectory(prefix="tank-malle-play-") as directory:
        print(json.dumps(verify(args, Path(directory)), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (BadZipFile, ET.ParseError, KeyError, OSError, ValueError) as error:
        sys.exit(f"AAB verification failed: {error}")
