#!/usr/bin/env python3
"""
local-relay-shim.py — Python http.server implementation of the Onlook
Phase H/Q manifest endpoint. Used as a drop-in replacement for the Bun
shim because Bun's HTTP layer normalizes well-known headers to
PascalCase (Cache-Control, Content-Type, etc.) which crashes iOS Expo
Go's NSURLSession response handler with EXC_BREAKPOINT (SIGTRAP).

Real `expo start` returns lowercase header names (cache-control,
content-type) and Expo Go loads the manifest fine. Python's
BaseHTTPRequestHandler.send_header(name, value) preserves the exact
case provided — no normalization — so this script can match expo-cli's
wire format byte-for-byte.

PROXY MODE: when EXPO_PROXY_URL is set in env, the manifest endpoint
forwards the upstream expo-cli response 1:1 (status, headers, body).
Used as a debugging bisection — if the phone successfully loads a
manifest proxied from real `expo start`, we know our shim's HTTP layer
is the bug, not the URL or port.

Run via:
    LAN_IP=192.168.0.14 PORT=8787 STORE_DIR=/tmp/cf-builds python3 \\
        scripts/local-relay-shim.py
    LAN_IP=192.168.0.14 PORT=8787 EXPO_PROXY_URL=http://192.168.0.14:8082 \\
        python3 scripts/local-relay-shim.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError

PORT = int(os.environ.get('PORT', '8787'))
STORE_DIR = Path(os.environ.get('STORE_DIR', '/tmp/cf-builds'))
LAN_IP = os.environ.get('LAN_IP', '127.0.0.1')
EXPO_PROXY_URL = os.environ.get('EXPO_PROXY_URL', '')

print(f'[local-relay-shim-py] starting on port {PORT}', flush=True)
print(f'[local-relay-shim-py] store: {STORE_DIR}', flush=True)
print(f'[local-relay-shim-py] LAN URL: http://{LAN_IP}:{PORT}', flush=True)
print(f'[local-relay-shim-py] proxy upstream: {EXPO_PROXY_URL or "(disabled)"}', flush=True)


def bundle_hash_to_uuid_v4(bundle_hash: str) -> str:
    """Deterministic UUID v4 from a 64-char hex sha256 hash."""
    if len(bundle_hash) < 32:
        return bundle_hash
    h = bundle_hash.lower()[:32]
    variant_nibble = ((int(h[16], 16) & 0x3) | 0x8)
    v4 = h[:12] + '4' + h[13:16] + format(variant_nibble, 'x') + h[17:32]
    return f'{v4[0:8]}-{v4[8:12]}-{v4[12:16]}-{v4[16:20]}-{v4[20:32]}'


def build_patched_manifest(bundle_hash: str, fields: dict, built_at: str, platform: str) -> dict:
    """Construct the Expo manifest matching expo-cli's exact field set."""
    debugger_host = f'{LAN_IP}:{PORT}'
    slug = fields['extra']['expoClient']['slug']
    anonymous_id = bundle_hash_to_uuid_v4(bundle_hash)
    scope_key = f'@anonymous/{slug}-{anonymous_id}'

    # launchAsset.url matches expo-cli's exact query string EXCEPT we
    # embed the bundle hash in the entry filename so the relay's bundle
    # route can look it up:
    #   /<hash>.ts.bundle?platform=ios&dev=false&...&transform.bytecode=1
    # Expo Go just fetches whatever URL is here — the entry name doesn't
    # matter to it functionally, only the .bundle suffix.
    bundle_query = (
        f'platform={platform}&dev=false&hot=false&lazy=true&minify=true'
        f'&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app'
        f'&unstable_transformProfile=hermes-stable'
    )
    launch_asset_url = f'http://{debugger_host}/{bundle_hash}.ts.bundle?{bundle_query}'

    # Normalize createdAt to include milliseconds — strict ISO 8601
    # parsers (and Expo Go's manifest validator) may reject the
    # no-milliseconds form. expo-cli always emits "...Z" with .NNN.
    if isinstance(built_at, str) and built_at.endswith('Z') and '.' not in built_at:
        built_at = built_at[:-1] + '.000Z'

    # Strip fields that expo-cli doesn't include in expoClient
    cleaned_expo_client = {
        k: v for k, v in fields['extra']['expoClient'].items()
        if k not in ('icon', 'runtimeVersion', 'splash')
    }

    return {
        'id': bundle_hash_to_uuid_v4(bundle_hash),
        'createdAt': built_at,
        'runtimeVersion': fields['runtimeVersion'],
        'launchAsset': {
            'key': fields['launchAsset']['key'],
            'contentType': fields['launchAsset']['contentType'],
            'url': launch_asset_url,
        },
        'assets': [],
        'metadata': {},
        'extra': {
            'eas': {},
            'expoClient': {
                **cleaned_expo_client,
                '_internal': {
                    'isDebug': False,
                    'projectRoot': '/private/tmp/onlook-fixture',
                    'dynamicConfigPath': None,
                    'staticConfigPath': '/private/tmp/onlook-fixture/app.json',
                    'packageJsonPath': '/private/tmp/onlook-fixture/package.json',
                },
                'hostUri': debugger_host,
            },
            'expoGo': {
                'debuggerHost': debugger_host,
                'developer': {
                    'tool': 'expo-cli',
                    'projectRoot': '/private/tmp/onlook-fixture',
                },
                'packagerOpts': {'dev': False},
                'mainModuleName': 'index.ts',
            },
            'scopeKey': scope_key,
        },
    }


class RelayHandler(BaseHTTPRequestHandler):
    # Match expo-cli's protocol version (HTTP/1.1 with keep-alive)
    protocol_version = 'HTTP/1.1'
    # Override the default Server header so we don't reveal Python's version.
    server_version = 'expo-cli'
    sys_version = ''

    def log_message(self, format, *args):  # noqa: A002
        # Suppress the default per-request log line; we have our own.
        pass

    def _log_request(self):
        ua = self.headers.get('User-Agent', '?')
        plat = self.headers.get('Expo-Platform', '?')
        rtv = self.headers.get('Expo-Runtime-Version', '?')
        print(
            f'[local-relay-shim-py] {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} '
            f'{self.command} {self.path} expo-platform={plat} expo-rtv={rtv} '
            f'ua={ua[:100]}',
            flush=True,
        )
        if self.path.startswith('/manifest/'):
            all_headers = {k.lower(): v for k, v in self.headers.items()}
            print(f'[local-relay-shim-py] ALL headers: {json.dumps(all_headers)}', flush=True)

    def _send_lowercase_response(self, status, headers, body):
        """
        Send a response where header case is preserved EXACTLY as
        provided. send_response() adds Server + Date headers (with
        PascalCase). To prevent that, use send_response_only() which
        ONLY writes the status line, then we add headers manually.
        """
        body_bytes = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response_only(status, 'OK')
        for name, value in headers:
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def _proxy_to_expo(self):
        """Forward this request to the upstream expo-cli server, return its raw response."""
        if not EXPO_PROXY_URL:
            return False
        upstream = urlparse(EXPO_PROXY_URL)
        upstream_url = f'{EXPO_PROXY_URL}/'
        # Forward request headers — but rewrite Host to upstream's host:port
        fwd_headers = {k: v for k, v in self.headers.items() if k.lower() != 'host'}
        fwd_headers['Host'] = f'{upstream.hostname}:{upstream.port or 80}'
        try:
            req = Request(upstream_url, headers=fwd_headers, method='GET')
            with urlopen(req, timeout=10) as upstream_res:
                # Read raw headers — urllib gives us a list of (name, value)
                # tuples in upstream order with original case preserved.
                raw_headers = upstream_res.headers.items()
                body = upstream_res.read()
                print(
                    f'[local-relay-shim-py] PROXY: forwarded {len(body)} bytes '
                    f'from {upstream_url} (status={upstream_res.status})',
                    flush=True,
                )
                # Re-emit upstream's headers EXACTLY (case preserved)
                # via send_header. Skip Content-Length (we'll re-add).
                filtered = [(k, v) for k, v in raw_headers if k.lower() != 'content-length']
                self._send_lowercase_response(upstream_res.status, filtered, body)
                return True
        except URLError as err:
            print(f'[local-relay-shim-py] PROXY ERROR: {err}', flush=True)
            self._send_lowercase_response(
                502,
                [('Content-Type', 'text/plain')],
                f'relay proxy error: {err}'.encode('utf-8'),
            )
            return True

    def do_GET(self):  # noqa: N802
        self._log_request()

        url = urlparse(self.path)
        path = url.path

        if path == '/health':
            self._send_lowercase_response(
                200,
                [('content-type', 'application/json')],
                json.dumps({'ok': True, 'version': '0.1.0-local-shim-py'}),
            )
            return

        manifest_match = re.match(r'^/manifest/([a-f0-9]{64})$', path)
        if manifest_match:
            bundle_hash = manifest_match.group(1)

            # Proxy mode short-circuits everything
            if EXPO_PROXY_URL and self._proxy_to_expo():
                return

            fields_path = STORE_DIR / bundle_hash / 'manifest-fields.json'
            meta_path = STORE_DIR / bundle_hash / 'meta.json'
            if not fields_path.exists():
                self._send_lowercase_response(
                    404,
                    [('content-type', 'application/json')],
                    json.dumps({'error': f'manifest-fields.json not found for {bundle_hash}'}),
                )
                return

            fields = json.loads(fields_path.read_text())
            built_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text())
                    if isinstance(meta.get('builtAt'), str):
                        built_at = meta['builtAt']
                except json.JSONDecodeError:
                    pass

            # Resolve platform from Expo-Platform header
            header_platform = self.headers.get('Expo-Platform', 'ios')
            platform = 'ios' if header_platform == 'ios' else 'android'

            patched = build_patched_manifest(bundle_hash, fields, built_at, platform)
            manifest_json = json.dumps(patched, separators=(',', ':'))
            boundary = 'formdata-' + bundle_hash[:16]
            body = (
                f'--{boundary}\r\n'
                f'Content-Disposition: form-data; name="manifest"\r\n'
                f'Content-Type: application/json\r\n'
                f'\r\n'
                f'{manifest_json}\r\n'
                f'--{boundary}--\r\n'
            )

            # Headers in expo-cli's exact case + order. Python preserves
            # the case verbatim — no normalization.
            self._send_lowercase_response(
                200,
                [
                    ('expo-protocol-version', '0'),
                    ('expo-sfv-version', '0'),
                    ('cache-control', 'private, max-age=0'),
                    ('content-type', f'multipart/mixed; boundary={boundary}'),
                    ('Connection', 'keep-alive'),
                    ('Keep-Alive', 'timeout=5'),
                ],
                body,
            )
            return

        # Metro-style bundle URL with hash embedded in entry filename:
        # /<hash>.ts.bundle?platform=ios&...
        # Expo Go just sees /<entry>.bundle which is the standard Metro
        # URL pattern; the entry name happens to be the bundle hash.
        bundle_match = re.match(r'^/([a-f0-9]{64})(?:\.ts)?\.bundle$', path)
        if bundle_match:
            qs = parse_qs(url.query)
            query_hash = bundle_match.group(1)
            query_platform = (qs.get('platform') or [''])[0]
            plat = 'android' if query_platform == 'android' else 'ios'
            bundle_js_path = STORE_DIR / query_hash / f'index.{plat}.bundle.js'
            if not bundle_js_path.exists():
                self._send_lowercase_response(
                    404,
                    [('content-type', 'text/plain')],
                    f'relay: no bundle for {query_hash}/{plat}',
                )
                return
            body = bundle_js_path.read_bytes()
            print(
                f'[local-relay-shim-py] served Metro JS bundle '
                f'{query_hash[:12]}/{plat} ({len(body)} bytes)',
                flush=True,
            )
            self._send_lowercase_response(
                200,
                [
                    ('X-Content-Type-Options', 'nosniff'),
                    ('Surrogate-Control', 'no-store'),
                    ('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'),
                    ('Pragma', 'no-cache'),
                    ('Expires', '0'),
                    ('Content-Type', 'application/javascript; charset=UTF-8'),
                    ('Connection', 'keep-alive'),
                    ('Keep-Alive', 'timeout=5'),
                ],
                body,
            )
            return

        # No-op endpoints to absorb Expo Go dev-mode side connections
        if path in ('/logs', '/status', '/symbolicate'):
            self._send_lowercase_response(
                200,
                [('content-type', 'application/json')],
                '{}',
            )
            return

        self._send_lowercase_response(
            404,
            [('content-type', 'text/plain')],
            'not found',
        )

    def do_POST(self):  # noqa: N802
        self._log_request()
        # Absorb POSTs to /logs and /symbolicate from Expo Go dev mode
        if self.path in ('/logs', '/symbolicate'):
            content_length = int(self.headers.get('Content-Length', '0'))
            if content_length:
                self.rfile.read(content_length)
            self._send_lowercase_response(
                200,
                [('content-type', 'application/json')],
                '{}',
            )
            return
        self._send_lowercase_response(
            404,
            [('content-type', 'text/plain')],
            'not found',
        )

    def do_OPTIONS(self):  # noqa: N802
        self._log_request()
        self._send_lowercase_response(
            200,
            [
                ('Access-Control-Allow-Origin', '*'),
                ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
                ('Access-Control-Allow-Headers', '*'),
            ],
            b'',
        )


def main():
    server = ThreadingHTTPServer(('0.0.0.0', PORT), RelayHandler)
    print(f'[local-relay-shim-py] listening on 0.0.0.0:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[local-relay-shim-py] shutting down', flush=True)
        server.server_close()


if __name__ == '__main__':
    main()
