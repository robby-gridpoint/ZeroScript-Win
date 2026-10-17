# SPDX-License-Identifier: GPL-3.0-or-later
"""Safe, project-scoped tools for local software development.

Independent from Roblox Studio/MCP. This module can be called directly by the
local bridge or wrapped by a dedicated MCP server.
"""
from __future__ import annotations

import difflib
import fnmatch
import json
import os
import re
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
        return {"root": str(self.root), "name": self.root.name or str(self.root), "exists": True}

    def list_files(self, path: str = ".", max_results: int = 200, include_hidden: bool = False) -> dict[str, Any]:
        base = self._resolve(path)
        if not base.exists() or not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        limit = max(1, min(int(max_results), MAX_RESULTS))
        files: list[dict[str, Any]] = []
        truncated = False
        for current, dirs, names in os.walk(base):
            dirs[:] = sorted(
                d for d in dirs
                if d not in DEFAULT_IGNORES and (include_hidden or not d.startswith("."))
                and not (Path(current) / d).is_symlink()
            )
            for name in sorted(names):
                if not include_hidden and name.startswith("."):
                    continue
                item = Path(current) / name
                if item.is_symlink():
                    continue
                try:
                    files.append({
                        "path": item.relative_to(self.root).as_posix(),
                        "size": item.stat().st_size,
                        "is_file": True,
                    })
                except OSError:
                    continue
                if len(files) >= limit:
                    truncated = True
                    break
            if truncated:
                break
        return {"root": str(self.root), "files": files, "truncated": truncated}

    def read_file(self, path: str, max_bytes: int = MAX_READ_BYTES) -> dict[str, Any]:
        target = self._resolve(path)
        if not target.is_file():
            raise WorkspaceError(f"Not a file: {path}")
        size = target.stat().st_size
        allowed = max(1, min(int(max_bytes), MAX_READ_BYTES))
        if size > allowed:
            raise WorkspaceError(f"File is {size} bytes; limit is {allowed}. Read a smaller file or split it.")
        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise WorkspaceError("File is not valid UTF-8 text.") from exc
        return {"path": target.relative_to(self.root).as_posix(), "content": content}

    def search(self, query: str, path: str = ".", max_results: int = 100,
               case_sensitive: bool = False, regex: bool = False) -> dict[str, Any]:
        if not isinstance(query, str) or not query:
            raise WorkspaceError("Search query must not be empty.")
        try:
            expression = re.compile(query if regex else re.escape(query),
                                    0 if case_sensitive else re.IGNORECASE)
        except re.error as exc:
            raise WorkspaceError(f"Invalid search regular expression: {exc}") from exc
        base = self._resolve(path)
        if not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        limit = max(1, min(int(max_results), MAX_RESULTS))
        matches: list[dict[str, Any]] = []
        visited = 0
        for current, dirs, names in os.walk(base):
            dirs[:] = sorted(d for d in dirs if d not in DEFAULT_IGNORES and not d.startswith(".")
                              and not (Path(current) / d).is_symlink())
            for name in sorted(names):
                if name.startswith("."):
                    continue
                candidate = Path(current) / name
                if candidate.is_symlink():
                    continue
                try:
                    if candidate.stat().st_size > MAX_READ_BYTES:
                        continue
                    content = candidate.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
                visited += 1
                for line_number, line in enumerate(content.splitlines(), 1):
                    found = expression.search(line)
                    if found:
                        matches.append({
                            "path": candidate.relative_to(self.root).as_posix(),
                            "line": line_number,
                            "column": found.start() + 1,
                            "text": line[:500],
                        })
                        if len(matches) >= limit:
                            return {"query": query, "case_sensitive": case_sensitive, "regex": regex,
                                    "matches": matches, "truncated": True, "files_scanned": visited}
        return {"query": query, "case_sensitive": case_sensitive, "regex": regex,
                "matches": matches, "truncated": False, "files_scanned": visited}

    def write_file(self, path: str, content: str) -> dict[str, Any]:
        target = self._resolve(path)
        if not isinstance(content, str):
            raise WorkspaceError("File content must be a string.")
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_READ_BYTES:
            raise WorkspaceError(f"File writes are limited to {MAX_READ_BYTES} bytes.")
        if target.exists() and not target.is_file():
            raise WorkspaceError("Target exists and is not a regular file.")
        existed = target.exists()
        previous = ""
        if existed:
            try:
                previous = target.read_text(encoding="utf-8")
            except UnicodeDecodeError as exc:
                raise WorkspaceError("Refusing to overwrite a non-UTF-8 file.") from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="")
        diff = "".join(difflib.unified_diff(
            previous.splitlines(keepends=True),
            content.splitlines(keepends=True),
            fromfile=f"a/{target.relative_to(self.root).as_posix()}",
            tofile=f"b/{target.relative_to(self.root).as_posix()}",
        ))
        return {
            "path": target.relative_to(self.root).as_posix(),
            "bytes_written": len(encoded),
            "created": not existed,
            "diff": diff[:MAX_OUTPUT_CHARS],
        }

    def find_files(self, pattern: str = "*", path: str = ".", max_results: int = 200, include_hidden: bool = False) -> dict[str, Any]:
        """Find files by glob against their workspace-relative path or filename."""
        if not isinstance(pattern, str) or not pattern.strip():
            raise WorkspaceError("A file glob pattern is required.")
        base = self._resolve(path)
        if not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        limit = max(1, min(int(max_results), MAX_RESULTS))
        matches: list[dict[str, Any]] = []
        truncated = False
        for current, dirs, names in os.walk(base):
            dirs[:] = sorted(
                d for d in dirs
                if d not in DEFAULT_IGNORES and (include_hidden or not d.startswith("."))
                and not (Path(current) / d).is_symlink()
            )
            for name in sorted(names):
                if not include_hidden and name.startswith("."):
                    continue
                item = Path(current) / name
                if item.is_symlink():
                    continue
                rel = item.relative_to(self.root).as_posix()
                rel_from_base = item.relative_to(base).as_posix()
                if not (fnmatch.fnmatchcase(rel, pattern) or fnmatch.fnmatchcase(rel_from_base, pattern)
                        or fnmatch.fnmatchcase(name, pattern)):
                    continue
                try:
                    matches.append({"path": rel, "size": item.stat().st_size})
                except OSError:
                    continue
                if len(matches) >= limit:
                    truncated = True
                    break
            if truncated:
                break
        return {"pattern": pattern, "path": base.relative_to(self.root).as_posix() or ".",
                "matches": matches, "truncated": truncated}

    def project_info(self) -> dict[str, Any]:
        """Summarize common project manifests, package scripts, source mix, and Git state."""
        root_files = sorted(p.name for p in self.root.iterdir() if not p.is_symlink() and p.is_file())
        manifests = [
            "package.json", "pnpm-workspace.yaml", "yarn.lock", "pnpm-lock.yaml",
            "package-lock.json", "pyproject.toml", "requirements.txt", "Pipfile",
            "Cargo.toml", "go.mod", "go.work", "pom.xml", "build.gradle",
            "build.gradle.kts", "settings.gradle", "composer.json", "Gemfile",
            "CMakeLists.txt", "Makefile", "justfile", "Dockerfile",
        ]
        present = [name for name in manifests if not (self.root / name).is_symlink() and (self.root / name).is_file()]
        scripts: dict[str, str] = {}
        package_path = self.root / "package.json"
        if not package_path.is_symlink() and package_path.is_file():
            try:
                package = json.loads(package_path.read_text(encoding="utf-8"))
                scripts = {str(k): str(v) for k, v in (package.get("scripts") or {}).items()}
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                scripts = {}
        inventory = self.list_files(max_results=MAX_RESULTS, include_hidden=False)
        extensions: dict[str, int] = {}
        for item in inventory["files"]:
            suffix = Path(item["path"]).suffix.lower() or "[no extension]"
            extensions[suffix] = extensions.get(suffix, 0) + 1
        if not package_path.is_symlink() and package_path.is_file():
            project_type = "Node.js / JavaScript / TypeScript"
        elif (self.root / "pyproject.toml").is_file() or (self.root / "requirements.txt").is_file():
            project_type = "Python"
        elif (self.root / "Cargo.toml").is_file():
            project_type = "Rust"
        elif (self.root / "go.mod").is_file():
            project_type = "Go"
        elif any(name.endswith((".sln", ".csproj")) for name in root_files):
            project_type = ".NET / C#"
        elif (self.root / "CMakeLists.txt").is_file():
            project_type = "C / C++ (CMake)"
        elif (self.root / "pom.xml").is_file() or (self.root / "build.gradle").is_file():
            project_type = "Java / JVM"
        else:
            project_type = "mixed or undetected"
        return {
            "root": str(self.root),
            "name": self.root.name or str(self.root),
            "project_type": project_type,
            "is_git_repository": (self.root / ".git").exists(),
            "manifest_files": present,
            "package_scripts": scripts,
            "source_file_count": len(inventory["files"]),
            "file_inventory_truncated": inventory["truncated"],
            "extension_counts": dict(sorted(extensions.items(), key=lambda item: (-item[1], item[0]))[:20]),
            "top_level_files": root_files[:100],
        }

    def symbols(self, query: str = "", path: str = ".", max_results: int = 200) -> dict[str, Any]:
        """Find likely function/type/variable declarations using language-neutral patterns."""
        base = self._resolve(path)
        if not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        limit = max(1, min(int(max_results), MAX_RESULTS))
        patterns = [
            ("function", re.compile(r"^\s*(?:(?:export|public|private|protected|static|async|local|pub|crate)\s+)*(?:function|def|fn)\s+([A-Za-z_$][\w$]*)")),
            ("type", re.compile(r"^\s*(?:(?:export|public|private|abstract|sealed|data)\s+)*(?:class|interface|type|enum|struct|trait|record)\s+([A-Za-z_$][\w$]*)")),
            ("variable", re.compile(r"^\s*(?:export\s+)?(?:const|let|var|local)\s+([A-Za-z_$][\w$]*)\s*(?:[:=])")),
        ]
        needle = query.casefold().strip()
        results: list[dict[str, Any]] = []
        scanned = 0
        for current, dirs, names in os.walk(base):
            dirs[:] = sorted(d for d in dirs if d not in DEFAULT_IGNORES and not d.startswith(".")
                              and not (Path(current) / d).is_symlink())
            for name in sorted(names):
                if name.startswith("."):
                    continue
                file_path = Path(current) / name
                if file_path.is_symlink():
                    continue
                try:
                    if file_path.stat().st_size > MAX_READ_BYTES:
                        continue
                    lines = file_path.read_text(encoding="utf-8").splitlines()
                except (OSError, UnicodeDecodeError):
                    continue
                scanned += 1
                for number, line in enumerate(lines, 1):
                    found = None
                    for kind, expression in patterns:
                        match = expression.search(line)
                        if match:
                            found = (kind, match.group(1))
                            break
                    if not found:
                        continue
                    kind, symbol = found
                    if needle and needle not in symbol.casefold() and needle not in line.casefold():
                        continue
                    results.append({
                        "name": symbol, "kind": kind,
                        "path": file_path.relative_to(self.root).as_posix(),
                        "line": number, "text": line.strip()[:500],
                    })
                    if len(results) >= limit:
                        return {"query": query, "symbols": results, "truncated": True, "files_scanned": scanned}
        return {"query": query, "symbols": results, "truncated": False, "files_scanned": scanned}

    def apply_patch(self, path: str, old_string: str, new_string: str, replace_all: bool = False) -> dict[str, Any]:
        """Apply an exact text replacement, refusing ambiguous matches by default."""
        target = self._resolve(path)
        if not target.is_file():
            raise WorkspaceError(f"Patch target is not an existing file: {path}")
        if target.stat().st_size > MAX_READ_BYTES:
            raise WorkspaceError(f"Patch target exceeds the {MAX_READ_BYTES}-byte edit limit.")
        if not isinstance(old_string, str) or not old_string:
            raise WorkspaceError("old_string must be a non-empty exact source fragment.")
        if not isinstance(new_string, str):
            raise WorkspaceError("new_string must be a string.")
        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise WorkspaceError("Refusing to patch a non-UTF-8 file.") from exc
        occurrences = content.count(old_string)
        if occurrences == 0:
            raise WorkspaceError("Exact old_string was not found. Re-read the file and use a smaller, exact patch.")
        if occurrences > 1 and not replace_all:
            raise WorkspaceError(f"Patch is ambiguous: old_string appears {occurrences} times. Include more context or set replace_all=true.")
        updated = content.replace(old_string, new_string) if replace_all else content.replace(old_string, new_string, 1)
        result = self.write_file(path, updated)
        result["replacements"] = occurrences if replace_all else 1
        return result

    def git_diff(self, staged: bool = False, path: str = ".") -> dict[str, Any]:
        """Return a bounded diff of staged or unstaged changes."""
        relative = self._resolve(path).relative_to(self.root).as_posix()
        command = ["git", "diff", "--no-ext-diff"]
        if staged:
            command.append("--cached")
        if relative not in ("", "."):
            command.extend(["--", relative])
        result = self._run(command, timeout=20)
        return {"staged": bool(staged), "path": relative or ".", **result}

    def git_log(self, limit: int = 10) -> dict[str, Any]:
        """Return recent commit summaries without changing the working tree."""
        count = max(1, min(int(limit), 30))
        return self._run(["git", "log", f"-{count}", "--oneline", "--decorate"], timeout=15)

    def tree(self, path: str = ".", max_depth: int = 4, max_results: int = 300, include_hidden: bool = False) -> dict[str, Any]:
        """Return a bounded, readable project tree without following directory symlinks."""
        base = self._resolve(path)
        if not base.is_dir():
            raise WorkspaceError(f"Not a directory: {path}")
        depth_limit = max(0, min(int(max_depth), 12))
        limit = max(1, min(int(max_results), MAX_RESULTS))
        entries: list[dict[str, Any]] = []
        truncated = False
        def walk(directory: Path, depth: int) -> None:
            nonlocal truncated
            if truncated or depth > depth_limit:
                return
            try:
                children = sorted(directory.iterdir(), key=lambda item: item.name.casefold())
            except OSError:
                return
            directories = []
            for item in children:
                if item.is_symlink():
                    continue
                if not include_hidden and item.name.startswith("."):
                    continue
                if item.is_dir():
                    if item.name in DEFAULT_IGNORES:
                        continue
                    directories.append(item)
                elif item.is_file():
                    pass
                else:
                    continue
                try:
                    relative = item.relative_to(self.root).as_posix()
                    size = item.stat().st_size if item.is_file() else None
                except OSError:
                    continue
                entries.append({"name": item.name, "path": relative,
                                "type": "directory" if item.is_dir() else "file",
                                "depth": depth, "size": size})
                if len(entries) >= limit:
                    truncated = True
                    return
            if depth < depth_limit:
                for child in directories:
                    walk(child, depth + 1)
                    if truncated:
                        return
        walk(base, 0)
        return {"root": str(base), "entries": entries, "max_depth": depth_limit, "truncated": truncated}

    def file_outline(self, path: str, max_results: int = 300) -> dict[str, Any]:
        """Extract likely imports, headings, types, and declarations from one text file."""
        target = self._resolve(path)
        if not target.is_file():
            raise WorkspaceError(f"Not a file: {path}")
        result = self.read_file(path)
        limit = max(1, min(int(max_results), MAX_RESULTS))
        lines = result["content"].splitlines()
        patterns = [
            ("heading", re.compile(r"^\s*(?:#{1,6}\s+.+|//[-=]{3,}.*)$")),
            ("import", re.compile(r"^\s*(?:import\s|from\s+\S+\s+import\s|require\s*\(|using\s+\S+|#include\s*[<\"]|local\s+\w+\s*=\s*require\s*\()")),
            ("declaration", re.compile(r"^\s*(?:(?:export|public|private|protected|static|async|local|pub|crate|abstract|sealed|data)\s+)*(?:function|def|fn|class|interface|type|enum|struct|trait|record)\s+[A-Za-z_$][\w$]*")),
            ("variable", re.compile(r"^\s*(?:export\s+)?(?:const|let|var|local)\s+[A-Za-z_$][\w$]*\s*(?:[:=])")),
        ]
        outline = []
        for number, line in enumerate(lines, 1):
            for kind, expression in patterns:
                if expression.search(line):
                    outline.append({"line": number, "kind": kind, "text": line.strip()[:500]})
                    break
            if len(outline) >= limit:
                break
        return {"path": target.relative_to(self.root).as_posix(), "total_lines": len(lines),
                "outline": outline, "truncated": len(outline) >= limit}

    def git_branches(self) -> dict[str, Any]:
        """List local and remote Git refs without changing repository state."""
        return self._run(["git", "branch", "--all", "--no-color"], timeout=15)
    def git_status(self) -> dict[str, Any]:
        result = self._run(["git", "status", "--short", "--branch"], timeout=15)
        return {"exit_code": result["exit_code"], "output": result["output"]}

    def run_command(self, command: list[str], timeout: int = 60) -> dict[str, Any]:
        """Run an argv array inside the project. Shell expansion is disabled."""
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise WorkspaceError("Command must be a non-empty array of strings.")
        if len(command) > 100 or any("\x00" in item for item in command):
            raise WorkspaceError("Invalid command arguments.")
        return self._run(command, timeout=timeout)

    def _run(self, command: list[str], timeout: int = 60) -> dict[str, Any]:
        timeout = max(1, min(int(timeout), 300))
        try:
            completed = subprocess.run(
                command, cwd=self.root, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                timeout=timeout, shell=False, check=False,
            )
            return {
                "command": command, "exit_code": completed.returncode,
                "output": completed.stdout[-MAX_OUTPUT_CHARS:], "timed_out": False,
            }
        except FileNotFoundError:
            return {
                "command": command, "exit_code": 127,
                "output": f"Command not found: {command[0]}", "timed_out": False,
            }
        except subprocess.TimeoutExpired as exc:
            output = exc.stdout or ""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            return {
                "command": command, "exit_code": None,
                "output": str(output)[-MAX_OUTPUT_CHARS:] + f"\nCommand timed out after {timeout}s.",
                "timed_out": True,
            }
