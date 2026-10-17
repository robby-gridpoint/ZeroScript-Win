// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  workspace: null,
  folder: ".",
  currentFile: null,
  savedContent: "",
  dirty: false,
  currentView: "explorer",
  busy: false,
  fileWorkspaceRoot: null,
  outputs: {
    output: "ZeroScript local workspace ready. Select a folder to begin.",
    problems: "No reported problems.",
  },
  activeOutput: "output",
};
const VIEW_TITLES = {
  explorer: "EXPLORER",
  search: "SEARCH",
  source: "SOURCE CONTROL",
  project: "PROJECT",
  terminal: "TERMINAL",
};

function parseText(response) {
  if (!response || typeof response.text !== "string") return null;
  try { return JSON.parse(response.text); } catch { return response.text; }
}

function callTool(name, args = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "call_tool", name, arguments: args, timeout },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : "The local bridge did not return a result."));
          return;
        }
        resolve(parseText(response));
      }
    );
  });
}

function setBusy(busy, label) {
  state.busy = busy;
  document.body.classList.toggle("is-busy", busy);
  if (label) $("connectionLabel").textContent = label;
  renderDirty();
}

function renderOutputBuffer() {
  for (const tab of document.querySelectorAll(".output-tab")) {
    tab.classList.toggle("active", tab.dataset.output === state.activeOutput);
  }
  $("outputText").textContent = state.outputs[state.activeOutput] || "";
}

function writeOutput(title, value, type = "output") {
  $("outputDrawer").classList.remove("hidden");
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  state.outputs[type] = title ? `[${title}]\n${text}` : text;
  state.activeOutput = type;
  $("outputText").classList.remove("error-text");
  renderOutputBuffer();
}

function errorOutput(title, error) {
  writeOutput(title, error instanceof Error ? error.message : String(error), "problems");
}

function updateWorkspaceHeader() {
  const ws = state.workspace;
  $("projectName").textContent = ws && ws.root ? ws.name || ws.root : "No workspace selected";
  $("statusWorkspace").textContent = ws && ws.root ? ws.name || ws.root : "No workspace";
  $("rootRowName").textContent = ws && ws.name ? ws.name : "Workspace";
  $("statusWorkspace").title = ws && ws.root ? ws.root : "";
  if (ws && ws.configured) {
    $("connectionLabel").textContent = "Workspace ready";
  } else if (ws) {
    $("connectionLabel").textContent = "Workspace selection required";
  }
}

function showWelcome() {
  $("welcomeScreen").classList.remove("hidden");
  $("codeEditor").classList.add("hidden");
  $("infoView").classList.add("hidden");
  $("activeFileName").textContent = "Welcome";
  $("breadcrumb").textContent = "ZeroScript / Workspace";
  $("saveFile").disabled = true;
  $("dirtyDot").classList.add("hidden");
  $("statusFile").textContent = "No file open";
  $("languageStatus").textContent = "Plain Text";
}

function setEditorMode() {
  $("welcomeScreen").classList.add("hidden");
  $("infoView").classList.add("hidden");
  $("codeEditor").classList.remove("hidden");
}

function setInfoMode(title, data, path = "") {
  $("welcomeScreen").classList.add("hidden");
  $("codeEditor").classList.add("hidden");
  const info = $("infoView");
  info.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  info.append(h, pre);
  info.classList.remove("hidden");
  $("activeFileName").textContent = title;
  $("breadcrumb").textContent = path ? `ZeroScript / ${path}` : `ZeroScript / ${title}`;
  $("saveFile").disabled = true;
  $("dirtyDot").classList.add("hidden");
  $("statusFile").textContent = path || title;
}

function renderDirty() {
  $("dirtyDot").classList.toggle("hidden", !state.dirty);
  $("saveFile").disabled = !state.currentFile || !state.dirty || state.busy;
  $("renamePath").disabled = !state.currentFile || state.busy;
  $("deleteFile").disabled = !state.currentFile || state.busy;
  $("activeFileName").textContent = state.currentFile
    ? state.currentFile.split("/").pop() + (state.dirty ? " •" : "")
    : "Welcome";
}

function languageForPath(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const names = {
    js: "JavaScript", jsx: "JavaScript React", mjs: "JavaScript", cjs: "JavaScript",
    ts: "TypeScript", tsx: "TypeScript React", py: "Python", pyw: "Python",
    lua: "Lua", luau: "Luau", json: "JSON", jsonc: "JSON with Comments",
    html: "HTML", css: "CSS", scss: "SCSS", md: "Markdown", markdown: "Markdown",
    yml: "YAML", yaml: "YAML", xml: "XML", sql: "SQL", sh: "Shell Script",
    ps1: "PowerShell", bat: "Batch", cmd: "Batch", cs: "C#", cpp: "C++",
    h: "C / C++ Header", hpp: "C++ Header", c: "C", java: "Java", go: "Go",
    rs: "Rust", toml: "TOML", txt: "Plain Text", log: "Log",
  };
  return names[ext] || (path.toLowerCase().endsWith("dockerfile") ? "Dockerfile" : "Plain Text");
}

function updateCursorStatus() {
  const text = $("codeEditor").value.slice(0, $("codeEditor").selectionStart || 0);
  const lines = text.split("\n");
  $("cursorStatus").textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

function selectFileInTree(path) {
  for (const item of $("fileTree").querySelectorAll(".tree-item")) {
    item.classList.toggle("selected", item.dataset.path === path && item.dataset.type === "file");
  }
}

async function openFile(path, jumpLine = 1) {
  if (state.dirty && !window.confirm("Discard unsaved changes to the current file?")) return;
  setBusy(true, `Opening ${path}…`);
  try {
    const result = await callTool("workspace_read_file", { path });
    state.currentFile = result.path || path;
    state.fileWorkspaceRoot = state.workspace && state.workspace.root;
    state.savedContent = result.content || "";
    state.dirty = false;
    $("codeEditor").value = state.savedContent;
    setEditorMode();
    $("activeFileName").textContent = state.currentFile.split("/").pop();
    $("breadcrumb").textContent = `ZeroScript / ${state.currentFile}`;
    $("statusFile").textContent = state.currentFile;
    $("languageStatus").textContent = languageForPath(state.currentFile);
    $("encodingStatus").textContent = "UTF-8";
    $("eolStatus").textContent = state.savedContent.includes("\r\n") ? "CRLF" : "LF";
    renderDirty();
    selectFileInTree(state.currentFile);
    updateCursorStatus();
    writeOutput("File opened", `${state.currentFile}\n${state.savedContent.split("\n").length} lines`);
    if (jumpLine > 1) {
      const lines = state.savedContent.split("\n");
      const index = lines.slice(0, jumpLine - 1).join("\n").length + (jumpLine > 1 ? 1 : 0);
      $("codeEditor").focus();
      $("codeEditor").setSelectionRange(index, index);
      updateCursorStatus();
    }
  } catch (error) {
    errorOutput("Open file failed", error);
  } finally {
    setBusy(false);
    updateWorkspaceHeader();
  }
}

async function saveFile() {
  if (!state.currentFile || !state.dirty || state.busy) return;
  if (!state.workspace || state.workspace.root !== state.fileWorkspaceRoot) {
    errorOutput("Save blocked", "The selected workspace changed after this file was opened. Reopen the file from the current workspace before saving to avoid writing the wrong project.");
    return;
  }
  const content = $("codeEditor").value;
  setBusy(true, `Saving ${state.currentFile}…`);
  try {
    const result = await callTool("workspace_write_file", { path: state.currentFile, content });
    state.savedContent = content;
    state.dirty = false;
    renderDirty();
    writeOutput("File saved", result);
    await refreshTree();
  } catch (error) {
    errorOutput("Save failed", error);
  } finally {
    setBusy(false);
    updateWorkspaceHeader();
  }
}

function formatBytes(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function refreshTree() {
  if (!state.workspace || !state.workspace.configured) {
    $("fileTree").replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Choose a project folder before browsing files.";
    $("fileTree").append(empty);
    return;
  }
  try {
    const result = await callTool("workspace_tree", {
      path: state.folder, max_depth: 6, max_results: 400, include_hidden: false,
    });
    const tree = $("fileTree");
    tree.replaceChildren();
    if (!result.entries || result.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "This folder is empty, or contains only ignored/generated files.";
      tree.append(empty);
      return;
    }
    for (const entry of result.entries) {
      const button = document.createElement("button");
      button.className = "tree-item";
      button.dataset.path = entry.path;
      button.dataset.type = entry.type;
      button.style.paddingLeft = `${7 + entry.depth * 13}px`;
      if (entry.type === "file" && entry.path === state.currentFile) button.classList.add("selected");
      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = entry.type === "directory" ? "▸" : "·";
      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = entry.name;
      button.append(icon, label);
      if (entry.type === "file" && entry.size != null) {
        const size = document.createElement("span");
        size.className = "tree-size";
        size.textContent = formatBytes(entry.size);
        button.append(size);
      }
      tree.append(button);
    }
    if (result.truncated) {
      const truncated = document.createElement("div");
      truncated.className = "empty-state";
      truncated.textContent = "Tree limit reached. Open a folder to inspect it more deeply.";
      tree.append(truncated);
    }
  } catch (error) {
    errorOutput("Project tree failed", error);
  }
}

async function createFile() {
  if (!state.workspace || !state.workspace.configured) {
    writeOutput("Create file", "Choose a project workspace first.");
    return;
  }
  const suggestion = state.folder && state.folder !== "." ? state.folder + "/new-file.txt" : "new-file.txt";
  const path = window.prompt("New file path, relative to the selected workspace:", suggestion);
  if (!path || !path.trim()) return;
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
    writeOutput("Create file", "Enter a workspace-relative path (for example src/new-file.ts).");
    return;
  }
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Creating file…");
  try {
    const result = await callTool("workspace_create_file", { path: path.trim(), content: "" });
    state.folder = path.trim().split("/").slice(0, -1).join("/") || ".";
    await refreshTree();
    await openFile(path.trim());
    writeOutput("File created", result);
  } catch (error) {
    errorOutput("Create file failed", error);
  } finally {
    setBusy(false);
  }
}

async function createFolder() {
  if (!state.workspace || !state.workspace.configured) {
    writeOutput("Create folder", "Choose a project workspace first.");
    return;
  }
  const suggestion = state.folder && state.folder !== "." ? state.folder + "/new-folder" : "new-folder";
  const path = window.prompt("New folder path, relative to the selected workspace:", suggestion);
  if (!path || !path.trim()) return;
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Creating folder…");
  try {
    const result = await callTool("workspace_create_directory", { path: path.trim() });
    state.folder = path.trim().split("/").slice(0, -1).join("/") || ".";
    await refreshTree();
    writeOutput("Folder created", result);
  } catch (error) {
    errorOutput("Create folder failed", error);
  } finally {
    setBusy(false);
  }
}

async function renameCurrentFile() {
  if (!state.currentFile || state.busy) return;
  const source = state.currentFile;
  const destination = window.prompt("New workspace-relative path:", source);
  if (!destination || !destination.trim() || destination.trim() === source) return;
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Moving file…");
  try {
    const result = await callTool("workspace_move_path", { source, destination: destination.trim() });
    state.folder = destination.trim().split("/").slice(0, -1).join("/") || ".";
    await refreshTree();
    await openFile(destination.trim());
    writeOutput("File moved", result);
  } catch (error) {
    errorOutput("Rename / move failed", error);
  } finally {
    setBusy(false);
  }
}

async function deleteCurrentFile() {
  if (!state.currentFile || state.busy) return;
  const path = state.currentFile;
  if (!window.confirm(`Delete ${path}? This removes the file from disk and cannot be undone by ZeroScript.`)) return;
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Deleting file…");
  try {
    const result = await callTool("workspace_delete_file", { path });
    state.currentFile = null;
    state.fileWorkspaceRoot = null;
    state.savedContent = "";
    state.dirty = false;
    $("codeEditor").value = "";
    showWelcome();
    renderDirty();
    await refreshTree();
    writeOutput("File deleted", result);
  } catch (error) {
    errorOutput("Delete failed", error);
  } finally {
    setBusy(false);
  }
}

async function chooseWorkspace() {
  setBusy(true, "Opening folder picker…");
  try {
    const picked = await callTool("workspace_browse", {});
    if (!picked || picked.cancelled || !picked.selected_path) {
      writeOutput("Folder picker", "Selection cancelled. The active workspace was not changed.");
      return;
    }
    if (state.dirty && !window.confirm("Discard unsaved changes and switch workspaces?")) {
      writeOutput("Workspace switch cancelled", "Your open file and unsaved edits were kept. The selected folder was not activated.");
      return;
    }
    const activated = await callTool("workspace_set_root", { path: picked.selected_path });
    state.workspace = activated;
    state.folder = ".";
    state.currentFile = null;
    state.fileWorkspaceRoot = null;
    state.savedContent = "";
    state.dirty = false;
    $("codeEditor").value = "";
    showWelcome();
    renderDirty();
    updateWorkspaceHeader();
    await loadWorkspaceDetails();
    writeOutput("Workspace selected", activated);
  } catch (error) {
    errorOutput("Could not choose workspace", error);
  } finally {
    setBusy(false);
    updateWorkspaceHeader();
  }
}

async function loadWorkspaceDetails() {
  updateWorkspaceHeader();
  if (!state.workspace || !state.workspace.configured) {
    state.folder = ".";
    await refreshTree();
    showWelcome();
    $("projectName").textContent = "Choose a workspace folder";
    return;
  }
  setBusy(true, "Loading project…");
  try {
    const [info, project] = await Promise.all([
      callTool("workspace_info", {}),
      callTool("workspace_project_info", {}),
    ]);
    state.workspace = { ...info, ...project, root: info.root, configured: info.configured };
    updateWorkspaceHeader();
    await refreshTree();
    writeOutput("Workspace loaded", `${state.workspace.root}\n${project.project_type || "Project type not detected"} · ${project.source_file_count || 0} source files`);
    if (!state.currentFile) showWelcome();
  } catch (error) {
    errorOutput("Workspace initialization failed", error);
  } finally {
    setBusy(false);
    updateWorkspaceHeader();
  }
}

async function initialize() {
  try {
    const info = await callTool("workspace_info", {});
    state.workspace = info;
    updateWorkspaceHeader();
    if (!info.configured) {
      showWelcome();
      $("projectName").textContent = "Choose a workspace folder";
      writeOutput("Workspace setup required", "Pick the folder you want the AI agent to work in. The installation directory is not assumed to be your project.");
      await refreshTree();
      return;
    }
    await loadWorkspaceDetails();
  } catch (error) {
    $("connectionDot").classList.add("warn");
    $("connectionLabel").textContent = "Bridge unavailable";
    errorOutput("Could not connect to local workspace", error);
    showWelcome();
  }
}

function setView(view) {
  state.currentView = view;
  for (const button of document.querySelectorAll(".activity-button")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  for (const name of ["explorer", "search", "source", "project", "terminal"]) {
    const section = $(name + "View");
    if (section) section.classList.toggle("hidden", name !== view);
  }
  $("sideTitle").textContent = VIEW_TITLES[view] || view.toUpperCase();
  if (view === "source") loadGitStatus();
  if (view === "project") loadProjectInfo();
  if (view === "terminal") $("commandInput").focus();
}

async function runSearch() {
  const query = $("searchQuery").value.trim();
  if (!query) return;
  setBusy(true, "Searching project…");
  try {
    const result = await callTool("workspace_search", {
      query, path: ".", max_results: 250,
      case_sensitive: $("searchCase").checked, regex: $("searchRegex").checked,
    });
    const list = $("searchResults");
    list.replaceChildren();
    if (!result.matches || result.matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No matches found.";
      list.append(empty);
    } else {
      for (const match of result.matches) {
        const button = document.createElement("button");
        button.className = "search-result";
        const path = document.createElement("span");
        path.className = "search-result-path";
        path.textContent = `${match.path} · ${match.line}:${match.column || 1}`;
        const line = document.createElement("span");
        line.className = "search-result-line";
        line.textContent = match.text;
        button.append(path, line);
        button.addEventListener("click", () => openFile(match.path, match.line));
        list.append(button);
      }
    }
    writeOutput("Search completed", `${result.matches ? result.matches.length : 0} match(es) across ${result.files_scanned || 0} scanned file(s)${result.truncated ? " (results truncated)" : ""}`);
  } catch (error) {
    errorOutput("Search failed", error);
  } finally {
    setBusy(false);
  }
}

async function loadGitStatus() {
  setBusy(true, "Reading Git status…");
  try {
    const result = await callTool("workspace_git_status", {});
    $("gitSummary").textContent = result.output || "(No Git output)";
    writeOutput("Git status", result.output || result);
  } catch (error) {
    $("gitSummary").textContent = error.message;
    errorOutput("Git status failed", error);
  } finally { setBusy(false); }
}

function mayReplaceEditorView() {
  if (!state.dirty) return true;
  if (!window.confirm("Discard unsaved changes to the open file?")) return false;
  state.dirty = false;
  $("codeEditor").value = state.savedContent;
  renderDirty();
  return true;
}

async function loadGitDiff(staged = false) {
  if (!mayReplaceEditorView()) return;
  setBusy(true, staged ? "Reading staged changes…" : "Reading unstaged changes…");
  try {
    const result = await callTool("workspace_git_diff", { staged });
    setInfoMode(staged ? "Staged diff" : "Unstaged diff", result.output || "(No diff)", "Source Control");
    writeOutput("Git diff", result.output || "(No diff)");
  } catch (error) { errorOutput("Git diff failed", error); }
  finally { setBusy(false); }
}

async function loadGitBranches() {
  setBusy(true, "Reading Git branches…");
  try {
    const result = await callTool("workspace_git_branches", {});
    $("gitSummary").textContent = result.output || "(No branches reported)";
    writeOutput("Git branches", result.output || result);
  } catch (error) {
    $("gitSummary").textContent = error.message;
    errorOutput("Git branches failed", error);
  } finally { setBusy(false); }
}

async function loadProjectInfo() {
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Inspecting project…");
  try {
    const result = await callTool("workspace_project_info", {});
    $("projectSummary").textContent = [
      result.project_type || "Type: undetected",
      `${result.source_file_count || 0} source files`,
      result.is_git_repository ? "Git repository" : "No Git repository at the root",
      `Manifests: ${(result.manifest_files || []).join(", ") || "none detected"}`,
      `Scripts: ${Object.keys(result.package_scripts || {}).join(", ") || "none detected"}`,
    ].join("\n");
    setInfoMode("Project Overview", result, "Project");
    writeOutput("Project metadata", result);
  } catch (error) {
    $("projectSummary").textContent = error.message;
    errorOutput("Project inspection failed", error);
  } finally { setBusy(false); }
}

async function loadOutline() {
  if (!mayReplaceEditorView()) return;
  if (!state.currentFile) {
    writeOutput("Outline", "Open a source file first.");
    return;
  }
  setBusy(true, "Building file outline…");
  try {
    const result = await callTool("workspace_file_outline", { path: state.currentFile });
    setInfoMode("Outline · " + state.currentFile, result, state.currentFile);
    writeOutput("File outline", result);
  } catch (error) { errorOutput("Outline failed", error); }
  finally { setBusy(false); }
}

async function runCommand() {
  let command;
  try {
    command = JSON.parse($("commandInput").value);
  } catch (error) {
    errorOutput("Invalid command JSON", "Enter a JSON array such as [\"npm\",\"test\"]. Shell command strings are not accepted.");
    return;
  }
  if (!Array.isArray(command) || command.length === 0 || !command.every((item) => typeof item === "string")) {
    errorOutput("Invalid command", "The command must be a non-empty JSON array of strings, for example [\"git\",\"status\",\"--short\"].");
    return;
  }
  const timeout = Math.max(1, Math.min(300, Number.parseInt($("commandTimeout").value, 10) || 60));
  setBusy(true, `Running ${command[0]}…`);
  try {
    const result = await callTool("workspace_run_command", { command, timeout }, timeout * 1000 + 15000);
    const summary = result.timed_out ? "Timed out" : `Exit code: ${result.exit_code}`;
    writeOutput(`Command · ${summary}`, result.output || "(No output)");
    if (result.exit_code !== 0) {
      document.getElementById("outputText").classList.add("error-text");
    } else {
      document.getElementById("outputText").classList.remove("error-text");
    }
  } catch (error) {
    errorOutput("Command failed", error);
  } finally { setBusy(false); }
}

async function createFile() {
  if (!state.workspace || !state.workspace.configured) {
    writeOutput("Create file", "Choose a project workspace first.");
    return;
  }
  if (!mayReplaceEditorView()) return;
  const path = window.prompt("New file path, relative to the selected workspace:");
  if (!path || !path.trim()) return;
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
    writeOutput("Create file", "Enter a workspace-relative path (for example src/new-file.ts).");
    return;
  }
  setBusy(true, "Creating file…");
  try {
    const result = await callTool("workspace_write_file", { path: path.trim(), content: "" });
    await refreshTree();
    await openFile(path.trim());
    writeOutput("File created", result);
  } catch (error) { errorOutput("Create file failed", error); }
  finally { setBusy(false); }
}

$("chooseWorkspace").addEventListener("click", chooseWorkspace);
$("welcomeOpen").addEventListener("click", chooseWorkspace);
$("refreshWorkspace").addEventListener("click", loadWorkspaceDetails);
$("welcomeSearch").addEventListener("click", () => { setView("search"); $("searchQuery").focus(); });
$("welcomeGit").addEventListener("click", () => setView("source"));
$("newFile").addEventListener("click", createFile);
$("newFolder").addEventListener("click", createFolder);
$("renamePath").addEventListener("click", renameCurrentFile);
$("deleteFile").addEventListener("click", deleteCurrentFile);
$("collapseTree").addEventListener("click", () => { state.folder = "."; refreshTree(); });
$("rootRow").addEventListener("click", () => { state.folder = "."; refreshTree(); });
$("treeReload").addEventListener("click", refreshTree);
$("treeUp").addEventListener("click", () => {
  if (state.folder === "." || !state.folder) return;
  const parts = state.folder.split("/");
  parts.pop();
  state.folder = parts.join("/") || ".";
  refreshTree();
});
$("fileTree").addEventListener("click", (event) => {
  const item = event.target.closest(".tree-item");
  if (!item) return;
  const path = item.dataset.path;
  if (item.dataset.type === "directory") {
    state.folder = path;
    refreshTree();
  } else {
    openFile(path);
  }
});
$("codeEditor").addEventListener("input", () => {
  state.dirty = $("codeEditor").value !== state.savedContent;
  renderDirty();
});
$("codeEditor").addEventListener("keyup", updateCursorStatus);
$("codeEditor").addEventListener("click", updateCursorStatus);
$("saveFile").addEventListener("click", saveFile);
$("showOutline").addEventListener("click", loadOutline);
$("showProjectInfo").addEventListener("click", loadProjectInfo);
$("searchQuery").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
$("runSearch").addEventListener("click", runSearch);
$("loadGitStatus").addEventListener("click", loadGitStatus);
$("loadGitDiff").addEventListener("click", () => loadGitDiff(false));
$("loadStagedDiff").addEventListener("click", () => loadGitDiff(true));
$("loadGitBranches").addEventListener("click", loadGitBranches);
$("loadProjectInfo").addEventListener("click", loadProjectInfo);
$("runCommand").addEventListener("click", runCommand);
$("clearOutput").addEventListener("click", () => {
  state.outputs[state.activeOutput] = "";
  renderOutputBuffer();
});
for (const button of document.querySelectorAll(".activity-button")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}
for (const tab of document.querySelectorAll(".output-tab")) {
  tab.addEventListener("click", () => {
    state.activeOutput = tab.dataset.output;
    renderOutputBuffer();
  });
}
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveFile();
  } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    setView("search");
    $("searchQuery").focus();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    setView("explorer");
    $("searchQuery").focus();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "zs-status") return;
  $("connectionDot").classList.toggle("on", !!message.connected);
  $("connectionDot").classList.toggle("warn", !message.connected);
  if (!message.connected) $("connectionLabel").textContent = "Bridge offline";
  if (message.workspace && message.workspace.root) {
    const previousRoot = state.workspace && state.workspace.root;
    const nextRoot = message.workspace.root;
    state.workspace = { ...(state.workspace || {}), ...message.workspace };
    updateWorkspaceHeader();
    if (previousRoot && previousRoot !== nextRoot && !state.dirty) {
      state.currentFile = null;
      state.fileWorkspaceRoot = null;
      state.folder = ".";
      showWelcome();
      loadWorkspaceDetails();
    }
  }
});

initialize();
