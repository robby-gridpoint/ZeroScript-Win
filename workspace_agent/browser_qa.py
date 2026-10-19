# SPDX-License-Identifier: GPL-3.0-or-later
"""Static and optional Playwright QA for a local browser restoration."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from workspace_agent.unity_recovery import UnityRecoveryError, _directory, _safe_workspace_path

MAX_HTML_BYTES = 2_000_000
MAX_REFERENCES = 500


class _ReferenceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references: list[dict[str, str]] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag.lower() == "script" and values.get("src"):
            self.references.append({"kind": "script", "url": values["src"]})
        elif tag.lower() == "link" and values.get("href"):
            rel = (values.get("rel") or "").lower()
            if any(item in rel for item in ("stylesheet", "icon", "preload", "modulepreload")):
                self.references.append({"kind": "link", "url": values["href"]})


def inspect_browser_port(workspace_root: str, port_path: str = "browser-port") -> dict[str, Any]:
    """Audit the entry point and referenced local scripts/styles without execution."""
    root = _directory(workspace_root, "workspace")
    port = _safe_workspace_path(root, port_path)
    if not port.is_dir():
        raise UnityRecoveryError(f"Browser-port directory not found: {port}")
    index = port / "index.html"
    if not index.is_file():
        raise UnityRecoveryError(f"Browser-port entry point not found: {index}")
    raw = index.read_bytes()
    if len(raw) > MAX_HTML_BYTES:
        raise UnityRecoveryError(f"index.html exceeds the {MAX_HTML_BYTES}-byte inspection limit.")
    parser = _ReferenceParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    refs = []
    for item in parser.references[:MAX_REFERENCES]:
        url = item["url"].strip()
        parsed = urllib.parse.urlparse(url)
        external = bool(parsed.scheme or parsed.netloc or url.startswith(("#", "data:")))
        record: dict[str, Any] = {"kind": item["kind"], "url": url, "external": external}
        if not external:
            relative = urllib.parse.unquote(parsed.path).replace("\\", "/").lstrip("/")
            target = (port / relative).resolve()
            if target != port and port not in target.parents:
                record.update({"exists": False, "error": "reference escapes browser-port directory"})
            else:
                record["exists"] = target.is_file()
                if target.is_file():
                    record["size_bytes"] = target.stat().st_size
        refs.append(record)
    package = None
    package_path = port / "package.json"
    if package_path.is_file():
        try:
            package = json.loads(package_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            package = {"parse_error": str(exc)}
    missing = [r for r in refs if not r["external"] and not r.get("exists", False)]
    return {
        "workspace": str(root),
        "browser_port": str(port),
        "entry_point": str(index),
        "entry_bytes": len(raw),
        "script_and_style_reference_count": len(parser.references),
        "references": refs,
        "missing_local_references": missing,
        "package_json": package,
        "package_scripts": (package or {}).get("scripts", {}) if isinstance(package, dict) else {},
        "status": "pass" if not missing else "fail",
        "limitations": ["Static reference audit only; it does not execute JavaScript or prove gameplay parity."],
    }


def run_browser_qa(
    workspace_root: str,
    url: str,
    port_path: str = "browser-port",
    screenshot_path: str = "recovery/browser-qa.png",
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """HTTP smoke test plus Playwright console/network/screenshot checks when installed."""
    root = _directory(workspace_root, "workspace")
    if not isinstance(url, str) or not url.startswith(("http://127.0.0.1:", "http://localhost:", "https://")):
        raise UnityRecoveryError("Use a local http://127.0.0.1 or http://localhost URL, or an explicit HTTPS test URL.")
    timeout_seconds = max(1, min(int(timeout_seconds), 60))
    static = inspect_browser_port(str(root), port_path)
    started = time.monotonic()
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "ArcScript-Browser-QA/1.0"})
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body = response.read(MAX_HTML_BYTES + 1)
            status_code = response.status
            content_type = response.headers.get("Content-Type", "")
            final_url = response.geturl()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "status": "fail", "url": url, "http_error": str(exc),
            "static_audit": static, "playwright": {"available": False, "reason": "URL could not be loaded"},
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }
    result: dict[str, Any] = {
        "status": "pass" if 200 <= status_code < 400 and static["status"] == "pass" else "fail",
        "url": url, "final_url": final_url, "http_status": status_code,
        "content_type": content_type, "response_bytes_captured": min(len(body), MAX_HTML_BYTES),
        "static_audit": static, "elapsed_seconds": round(time.monotonic() - started, 3),
        "playwright": {"available": False, "reason": "Python Playwright package or Chromium is not installed"},
    }
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return result
    errors: list[dict[str, str]] = []
    failed_requests: list[dict[str, str]] = []
    browser = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1365, "height": 768})
            page.on("pageerror", lambda error: errors.append({"kind": "pageerror", "message": str(error)[:1000]}))
            page.on("console", lambda msg: errors.append({"kind": "console", "message": msg.text[:1000]}) if msg.type == "error" else None)
            page.on("requestfailed", lambda req: failed_requests.append({
                "url": req.url[:1000], "error": str(req.failure or "request failed")[:500],
            }))
            response = page.goto(url, wait_until="networkidle", timeout=timeout_seconds * 1000)
            if response is not None:
                result["browser_http_status"] = response.status
            result["page_title"] = page.title()[:500]
            result["page_url"] = page.url
            screenshot = _safe_workspace_path(root, screenshot_path)
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(screenshot), full_page=True, timeout=timeout_seconds * 1000)
            result["screenshot_path"] = str(screenshot)
            result["playwright"] = {"available": True, "console_errors": errors[:100], "failed_requests": failed_requests[:100]}
            result["status"] = "pass" if (
                result["status"] == "pass" and (response is None or 200 <= response.status < 400)
                and not errors and not failed_requests
            ) else "fail"
    except Exception as exc:
        result["status"] = "fail"
        result["playwright"] = {
            "available": True, "error": str(exc)[:2000],
            "console_errors": errors[:100], "failed_requests": failed_requests[:100],
        }
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return result
