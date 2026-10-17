# SPDX-License-Identifier: GPL-3.0-or-later
"""Safe, project-scoped tools for local software development.

This module is intentionally independent from Roblox Studio and MCP. It can
be called directly by the bridge or exposed through a dedicated MCP adapter.
"""
from __future__ import annotations

import difflib
import os
import subprocess
from pathlib import Path
from typing import Any


DEFAULT_IGNORES = {
    ".git", ".hg", ".svn", ".next", ".nuxt", ".turbo", ".venv", "venv",
    "__pycache__", "node_modules", "bin", "obj", "dist", "build",
    ".idea", ".vscode", ".pytest_cache", ".mypy_cache",
}
MAX_READ_BYTES = 1_000_000
MAX_RESULTS = 500
MAX_OUTPUT_CHARS = 30_000


class WorkspaceError(RuntimeError):
    """Raised when a workspace request violates policy or cannot be completed."""


class Workspace:
    """A resolved project root with path traversal protection."""

    def __init__(self, root: str | os.PathLike[str]):
        resolved = Path(root).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise WorkspaceError(f"Workspace directory does not exist: {resolved}")
        self.root = resolved

    def _resolve(self, relative_path: str = ".") -> Path:
        if not isinstance(relative_path, str) or not relative_path.strip():
            relative_path = "."
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise WorkspaceError("Path escapes the selected workspace.") from exc
        return candidate

    def describe(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "name": self.root.name or str(self.root),
            "exists": True,
        }

    def list_files(
        self, path: str = ".", max_results: int = 200, include_hidden: bool = False
    ) -> dict[str, Any]:
        base = self._resolve(path)
        if not base.exists() or not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        limit = max(1, min(int(max_results), MAX_RESULTS))
        files: list[dict[str, Any]] = []
        skipped = 0
        for current, dirs, names in os.walk(base):
            dirs[:] = sorted(
                d for d in dirs
                if d not in DEFAULT_IGNORES and (include_hidden or not d.startswith("."))
            )
            for name in sorted(names):
                if not include_hidden and name.startswith("."):
                    continue
                item = Path(current) / name
                try:
                    rel = item.relative_to(self.root).as_posix()
                    stat = item.stat()
                except OSError:
                    continue
                files.append({
                    "path": rel,
                    "size": stat.st_size,
                    "is_file": True,
                })
                if len(files) >= limit:
                    skipped = 1
                    break
            if skipped:
                break
        return {"root": str(self.root), "files": files, "truncated": bool(skipped)}

    def read_file(self, path: str, max_bytes: int = MAX_READ_BYTES) -> dict[str, Any]:
        target = self._resolve(path)
        if not target.is_file():
            raise WorkspaceError(f"Not a file: {path}")
        size = target.stat().st_size
        if size > max(1, min(int(max_bytes), MAX_READ_BYTES)):
            raise WorkspaceError(
                f"File is {size} bytes; limit is {MAX_READ_BYTES}. Read a smaller file or split it."
            )
        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise WorkspaceError("File is not valid UTF-8 text.") from exc
        return {"path": target.relative_to(self.root).as_posix(), "content": content}

    def search(self, query: str, path: str = ".", max_results: int = 100) -> dict[str, Any]:
        if not isinstance(query, str) or not query:
            raise WorkspaceError("Search query must not be empty.")
        base = self._resolve(path)
        if not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        limit = max(1, min(int(max_results), MAX_RESULTS))
        matches: list[dict[str, Any]] = []
        visited = 0
        for current, dirs, names in os.walk(base):
            dirs[:] = sorted(
                d for d in dirs
                if d not in DEFAULT_IGNORES and not d.startswith(".")
            )
            for name in sorted(names):
                if name.startswith("."):
                    continue
                candidate = Path(current) / name
                try:
                    if candidate.stat().st_size > MAX_READ_BYTES:
                        continue
                    text = candidate.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
                visited += 1
                for line_number, line in enumerate(text.splitlines(), 1):
                    if query.casefold() in line.casefold():
                        matches.append({
                            "path": candidate.relative_to(self.root).as_posix(),
                            "line": line_number,
                            "text": line[:500],
                        })
                        if len(matches) >= limit:
                            return {"query": query, "matches": matches, "truncated": True, "files_scanned": visited}
        return {"query": query, "matches": matches, "truncated": False, "files_scanned": visited}

    def write_file(self, path: str, content: str) -> dict[str, Any]:
        target = self._resolve(path)
        if not isinstance(content, str):
            raise WorkspaceError("File content must be a string.")
        if len(content.encode("utf-8")) > MAX_READ_BYTES:
            raise WorkspaceError(f"File writes are limited to {MAX_READ_BYTES} bytes.")
        if target.exists() and not target.is_file():
            raise WorkspaceError("Target exists and is not a regular file.")
        target.parent.mkdir(parents=True, exist_ok=True)
        previous = ""
        if target.exists():
            try:
                previous = target.read_text(encoding="utf-8")
            except UnicodeDecodeError as exc:
                raise WorkspaceError("Refusing to overwrite a non-UTF-8 file.") from exc
        target.write_text(content, encoding="utf-8", newline="")
        diff = "".join(difflib.unified_diff(
            previous.splitlines(keepends=True),
            content.splitlines(keepends=True),
            fromfile=f"a/{target.relative_to(self.root).as_posix()}",
            tofile=f"b/{target.relative_to(self.root).as_posix()}",
        ))
        return {
            "path": target.relative_to(self.root).as_posix(),
            "bytes_written": len(content.encode("utf-8")),
            "created": not bool(previous) and not target.exists(),
            "diff": diff[:MAX_OUTPUT_CHARS],
        }

    def git_status(self) -> dict[str, Any]:
        result = self._run(["git", "status", "--short", "--branch"], timeout=15)
        return {"exit_code": result["exit_code"], "output": result["output"]}

    def run_command(self, command: list[str], timeout: int = 60) -> dict[str, Any]:
        """Run an explicitly supplied argv inside the workspace.

        Shell expansion is disabled: commands must be passed as an argument
        array. Product-level policy should still require approval for commands
        that install packages, modify files broadly, or access the network.
        """
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise WorkspaceError("Command must be a non-empty array of strings.")
        if len(command) > 100 or any("\x00" in x for x in command):
            raise WorkspaceError("Invalid command arguments.")
        return self._run(command, timeout=timeout)

    def _run(self, command: list[str], timeout: int = 60) -> dict[str, Any]:
        timeout = max(1, min(int(timeout), 300))
        try:
            completed = subprocess.run(
                command,
                cwd=self.root,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                shell=False,
                check=False,
            )
            return {
                "command": command,
                "exit_code": completed.returncode,
                "output": completed.stdout[-MAX_OUTPUT_CHARS:],
                "timed_out": False,
            }
        except FileNotFoundError:
            return {"command": command, "exit_code": 127, "output": f"Command not found: {command[0]}", "timed_out": False}
        except subprocess.TimeoutExpired as exc:
            output = exc.stdout or ""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            return {
                "command": command,
                "exit_code": None,
                "output": str(output)[-MAX_OUTPUT_CHARS:] + f"\nCommand timed out after {timeout}s.",
                "timed_out": True,
            }
