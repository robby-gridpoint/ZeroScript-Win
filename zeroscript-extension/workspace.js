// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  workspace: null,
  folder: ".",
  currentFile: null,
  savedContent: "",
  dirty: false,
  openTabs: [],
  activeTabKey: null,
  currentView: "explorer",
  busy: false,
  fileWorkspaceRoot: null,
  treeEntries: [],
  projectInfo: null,
  modalMode: null,
  modalItems: [],
  modalFiltered: [],
  modalIndex: 0,
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
  $("codeEditor").readOnly = busy;
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

function tabKey(path, root = (state.workspace && state.workspace.root) || "") {
  return String(root) + "\u0000" + String(path);
}

function activeTab() {
  return state.openTabs.find((tab) => tab.key === state.activeTabKey) || null;
}

function syncActiveTabFromEditor() {
  const tab = activeTab();
  if (!tab) return;
  tab.content = $("codeEditor").value;
  tab.dirty = tab.content !== tab.savedContent;
  state.currentFile = tab.path;
  state.savedContent = tab.savedContent;
  state.dirty = tab.dirty;
  state.fileWorkspaceRoot = tab.root;
}

function renderOpenTabs() {
  const host = $("openTabs");
  host.replaceChildren();
  for (const tab of state.openTabs) {
    const item = document.createElement("div");
    item.className = "editor-tab" + (tab.key === state.activeTabKey ? " active" : "") + (tab.dirty ? " dirty" : "");
    item.title = tab.root ? tab.root + "\\" + tab.path.replace(/\//g, "\\") : tab.path;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "editor-tab-main";
    main.disabled = state.busy;
    main.title = "Open " + tab.path;
    const icon = document.createElement("span");
    icon.className = "file-tab-icon";
    icon.textContent = iconForFile(tab.path.split("/").pop());
    const name = document.createElement("span");
    name.className = "editor-tab-name";
    name.textContent = tab.path.split("/").pop();
    const marker = document.createElement("span");
    marker.className = "editor-tab-dirty";
    marker.textContent = tab.dirty ? "●" : "";
    main.append(icon, name, marker);
    main.addEventListener("click", () => switchToTab(tab.key));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "editor-tab-close";
    close.disabled = state.busy;
    close.title = "Close " + tab.path;
    close.setAttribute("aria-label", "Close " + tab.path);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.key);
    });
    item.append(main, close);
    host.append(item);
  }
}

function switchToTab(key) {
  if (state.busy) return;
  if (state.activeTabKey && state.activeTabKey !== key) syncActiveTabFromEditor();
  const tab = state.openTabs.find((item) => item.key === key);
  if (!tab) return;
  state.activeTabKey = tab.key;
  state.currentFile = tab.path;
  state.savedContent = tab.savedContent;
  state.dirty = tab.dirty;
  state.fileWorkspaceRoot = tab.root;
  $("codeEditor").value = tab.content;
  setEditorMode();
  $("activeFileName").textContent = tab.path.split("/").pop();
  $("breadcrumb").textContent = "ZeroScript / " + tab.path;
  $("statusFile").textContent = tab.path;
  $("languageStatus").textContent = languageForPath(tab.path);
  $("encodingStatus").textContent = "UTF-8";
  $("eolStatus").textContent = tab.content.includes("\r\n") ? "CRLF" : "LF";
  selectFileInTree(tab.path);
  updateHighlight();
  updateCursorStatus();
  renderDirty();
  renderOpenTabs();
}

function closeTab(key) {
  if (state.busy) return;
  syncActiveTabFromEditor();
  const index = state.openTabs.findIndex((tab) => tab.key === key);
  if (index < 0) return;
  const tab = state.openTabs[index];
  if (tab.dirty && !window.confirm("Close " + tab.path + " with unsaved changes? The in-memory edits will be discarded.")) return;
  const wasActive = tab.key === state.activeTabKey;
  state.openTabs.splice(index, 1);
  if (!wasActive) {
    renderOpenTabs();
    return;
  }
  if (state.openTabs.length) {
    const next = state.openTabs[Math.min(index, state.openTabs.length - 1)];
    switchToTab(next.key);
  } else {
    state.activeTabKey = null;
    state.currentFile = null;
    state.fileWorkspaceRoot = null;
    state.savedContent = "";
    state.dirty = false;
    $("codeEditor").value = "";
    showWelcome();
    renderDirty();
    renderOpenTabs();
  }
}

function closeOtherTabs() {
  syncActiveTabFromEditor();
  const current = activeTab();
  if (!current) return;
  const others = state.openTabs.filter((tab) => tab.key !== current.key);
  if (others.some((tab) => tab.dirty) &&
      !window.confirm("Close " + others.length + " other tab(s) and discard any unsaved edits in them?")) return;
  state.openTabs = [current];
  state.activeTabKey = current.key;
  switchToTab(current.key);
}

function closeAllTabs() {
  syncActiveTabFromEditor();
  if (state.openTabs.some((tab) => tab.dirty) &&
      !window.confirm("Close all " + state.openTabs.length + " tabs and discard their unsaved edits?")) return;
  state.openTabs = [];
  state.activeTabKey = null;
  state.currentFile = null;
  state.fileWorkspaceRoot = null;
  state.savedContent = "";
  state.dirty = false;
  $("codeEditor").value = "";
  showWelcome();
  renderDirty();
  renderOpenTabs();
}

async function saveAllTabs() {
  syncActiveTabFromEditor();
  const activeRoot = state.workspace && state.workspace.root;
  const dirtyTabs = state.openTabs.filter((tab) => tab.dirty);
  if (!dirtyTabs.length) {
    writeOutput("Save All", "All open tabs are already saved.");
    return;
  }
  const blocked = dirtyTabs.filter((tab) => tab.root !== activeRoot);
  if (blocked.length) {
    errorOutput("Save All blocked", blocked.length + " tab(s) belong to a different workspace. Switch back to that folder before saving those buffers.");
  }
  setBusy(true, "Saving open files…");
  const saved = [];
  const failed = [];
  try {
    for (const tab of dirtyTabs) {
      if (tab.root !== activeRoot) continue;
      try {
        const currentContent = tab.content;
        await callTool("workspace_write_file", { path: tab.path, content: currentContent });
        tab.savedContent = currentContent;
        tab.dirty = tab.content !== currentContent;
        saved.push(tab.path);
      } catch (error) {
        failed.push(tab.path + ": " + error.message);
      }
    }
    const current = activeTab();
    if (current) {
      state.savedContent = current.savedContent;
      state.dirty = current.dirty;
    }
    renderDirty();
    renderOpenTabs();
    if (failed.length) {
      errorOutput("Save All partially completed", "Saved " + saved.length + " file(s).\n\nFailed:\n" + failed.join("\n"));
    } else {
      writeOutput("Save All", "Saved " + saved.length + " file(s):\n" + saved.join("\n"));
    }
    await refreshTree();
  } finally {
    setBusy(false);
  }
}

function closeTabsForWorkspaceSwitch() {
  const dirtyTabs = state.openTabs.filter((tab) => tab.dirty);
  if (dirtyTabs.length && !window.confirm("Switch workspaces and discard unsaved edits in " + dirtyTabs.length + " open tab(s)?")) return false;
  state.openTabs = [];
  state.activeTabKey = null;
  state.currentFile = null;
  state.fileWorkspaceRoot = null;
  state.savedContent = "";
  state.dirty = false;
  $("codeEditor").value = "";
  renderOpenTabs();
  renderDirty();
  return true;
}

function showWelcome() {
  $("welcomeScreen").classList.remove("hidden");
  $("codeSurface").classList.add("hidden");
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
  $("codeSurface").classList.remove("hidden");
  updateHighlight();
}

function setInfoMode(title, data, path = "") {
  $("welcomeScreen").classList.add("hidden");
  $("codeSurface").classList.add("hidden");
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
  $("statusFile").textContent = path || title;
  renderDirty();
}

function renderDirty() {
  $("dirtyDot").classList.toggle("hidden", !state.dirty);
  const tab = activeTab();
  $("saveFile").disabled = !tab || !tab.dirty || state.busy ||
    !state.workspace || state.workspace.root !== tab.root;
  const tabWorkspaceActive = !!tab && !!state.workspace && state.workspace.root === tab.root;
  $("renamePath").disabled = !tabWorkspaceActive || state.busy;
  $("deleteFile").disabled = !tabWorkspaceActive || state.busy;
  $("stageCurrentFile").disabled = !tabWorkspaceActive || state.busy;
  $("unstageCurrentFile").disabled = !tabWorkspaceActive || state.busy;
  $("commitStaged").disabled = !state.workspace || !state.workspace.configured || state.busy;
  $("activeFileName").textContent = state.currentFile
    ? state.currentFile.split("/").pop() + (state.dirty ? " •" : "")
    : "Welcome";
  renderOpenTabs();
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

function updateHighlight() {
  const editor = $("codeEditor");
  const code = editor.value;
  const ext = ((state.currentFile || "").split(".").pop() || "").toLowerCase();
  const keywords = {
    js: "async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
    jsx: "async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
    ts: "abstract any as asserts async await bigint boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import infer instanceof interface keyof let module namespace never new null number object of package private protected public readonly return static string super switch symbol this throw true type typeof undefined unknown var void while yield",
    tsx: "abstract any as asserts async await bigint boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import infer instanceof interface keyof let module namespace never new null number object of package private protected public readonly return static string super switch symbol this throw true type typeof undefined unknown var void while yield",
    py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield",
    pyw: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield",
    lua: "and break do else elseif end false for function if in local nil not or repeat return then true until while",
    luau: "and break continue do else elseif end false for function if in local nil not or repeat return then true until while type export",
    json: "false null true",
    jsonc: "false null true",
    go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
    rs: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while",
    cs: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while",
    sh: "case do done elif else esac fi for function if in select then time until while",
    ps1: "begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow",
    sql: "all alter and as asc begin between by case check column commit constraint create cross current_database current_date database declare default delete desc distinct drop else end escape except exists false fetch for foreign from full function grant group having if in index inner insert intersect into is join key left like limit not null offset on or order outer primary procedure references right rollback row select set table then to transaction trigger true union unique update use using values view when where with"
  };
  const words = (keywords[ext] || "async await break case catch class const continue default delete do else false finally for from function if import in let new null of return static switch this throw true try typeof var void while yield").split(/\s+/).join("|");
  const comments = ["py", "pyw", "sh", "ps1", "yaml", "yml", "toml", "rb", "r", "pl", "makefile"].includes(ext)
    ? "#.*$|//.*$|/\\*.*?\\*/"
    : ["lua", "luau", "sql"].includes(ext)
      ? "--.*$|//.*$|/\\*.*?\\*/"
      : ext === "html" || ext === "xml"
        ? "<!--.*?-->|//.*$|/\\*.*?\\*/"
        : "//.*$|/\\*.*?\\*/";
  const tokenPattern = new RegExp(
    '("(?:\\\\.|[^"\\\\])*"|\\x27(?:\\\\.|[^\\x27\\\\])*\\x27|\\x60(?:\\\\.|[^\\x60\\\\])*\\x60)|(' + comments + ')|(<\\/?[A-Za-z][^<>]*?>)|(\\b(?:' + words + ')\\b)|(\\b(?:0[xX][\\da-fA-F]+|\\d+(?:\\.\\d+)?)\\b)|(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())|(\\b[A-Z][\\w$]*\\b)',
    "g"
  );
  const sourceLines = code.split("\n");
  const rendered = sourceLines.map((line) => {
    let out = "";
    let last = 0;
    tokenPattern.lastIndex = 0;
    let match;
    while ((match = tokenPattern.exec(line)) !== null) {
      out += escapeHtml(line.slice(last, match.index));
      const token = escapeHtml(match[0]);
      const cls = match[1] ? "syntax-string"
        : match[2] ? "syntax-comment"
        : match[3] ? "syntax-tag"
        : match[4] ? "syntax-keyword"
        : match[5] ? "syntax-number"
        : match[6] ? "syntax-function"
        : "syntax-type";
      out += '<span class="' + cls + '">' + token + "</span>";
      last = match.index + match[0].length;
    }
    return out + escapeHtml(line.slice(last));
  });
  $("highlightCode").innerHTML = rendered.join("\n") || "&#8203;";
  $("lineNumbers").textContent = sourceLines.map((_, index) => String(index + 1)).join("\n") || "1";
  $("lineNumbers").scrollTop = editor.scrollTop;
  $("syntaxHighlight").scrollTop = editor.scrollTop;
  $("syntaxHighlight").scrollLeft = editor.scrollLeft;
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
  const root = state.workspace && state.workspace.root;
  if (!root || !state.workspace.configured) {
    writeOutput("Open file", "Choose a project workspace before opening files.");
    return;
  }
  const existing = state.openTabs.find((tab) => tab.key === tabKey(path, root) || (tab.root === root && tab.path === path));
  if (existing) {
    switchToTab(existing.key);
    if (jumpLine > 1) {
      const lines = existing.content.split("\n");
      const index = lines.slice(0, jumpLine - 1).join("\n").length + (jumpLine > 1 ? 1 : 0);
      $("codeEditor").focus();
      $("codeEditor").setSelectionRange(index, index);
      updateCursorStatus();
    }
    return;
  }
  setBusy(true, `Opening ${path}…`);
  try {
    const result = await callTool("workspace_read_file", { path });
    const filePath = result.path || path;
    const key = tabKey(filePath, root);
    const content = result.content || "";
    const tab = {
      key,
      path: filePath,
      root,
      content,
      savedContent: content,
      dirty: false,
    };
    state.openTabs.push(tab);
    state.activeTabKey = key;
    state.currentFile = filePath;
    state.fileWorkspaceRoot = root;
    state.savedContent = content;
    state.dirty = false;
    $("codeEditor").value = content;
    setEditorMode();
    $("activeFileName").textContent = filePath.split("/").pop();
    $("breadcrumb").textContent = `ZeroScript / ${filePath}`;
    $("statusFile").textContent = filePath;
    $("languageStatus").textContent = languageForPath(filePath);
    $("encodingStatus").textContent = "UTF-8";
    $("eolStatus").textContent = content.includes("\r\n") ? "CRLF" : "LF";
    renderDirty();
    renderOpenTabs();
    selectFileInTree(filePath);
    updateHighlight();
    updateCursorStatus();
    writeOutput("File opened", `${filePath}\n${content.split("\n").length} lines`);
    if (jumpLine > 1) {
      const lines = content.split("\n");
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
  const tab = activeTab();
  if (!tab || !tab.dirty || state.busy) return;
  if (!state.workspace || state.workspace.root !== tab.root) {
    errorOutput("Save blocked", "The selected workspace changed after this tab was opened. Switch back to the original workspace or copy the buffer elsewhere before saving.");
    return;
  }
  const content = $("codeEditor").value;
  setBusy(true, `Saving ${tab.path}…`);
  try {
    const result = await callTool("workspace_write_file", { path: tab.path, content });
    tab.savedContent = content;
    tab.dirty = tab.content !== content;
    if (state.activeTabKey === tab.key) {
      state.savedContent = tab.savedContent;
      state.dirty = tab.dirty;
    }
    renderDirty();
    renderOpenTabs();
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
    state.treeEntries = result.entries || [];
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
  const tab = activeTab();
  if (!tab || state.busy) return;
  if (!state.workspace || state.workspace.root !== tab.root) {
    errorOutput("Rename blocked", "Switch back to the workspace that owns this tab before renaming the file.");
    return;
  }
  syncActiveTabFromEditor();
  const source = tab.path;
  const destination = window.prompt("New workspace-relative path:", source);
  if (!destination || !destination.trim() || destination.trim() === source) return;
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Moving file…");
  try {
    const result = await callTool("workspace_move_path", { source, destination: destination.trim() });
    const oldKey = tab.key;
    tab.path = destination.trim().replace(/\\/g, "/");
    tab.key = tabKey(tab.path, tab.root);
    state.activeTabKey = tab.key;
    state.currentFile = tab.path;
    state.fileWorkspaceRoot = tab.root;
    state.folder = tab.path.split("/").slice(0, -1).join("/") || ".";
    $("activeFileName").textContent = tab.path.split("/").pop();
    $("breadcrumb").textContent = "ZeroScript / " + tab.path;
    $("statusFile").textContent = tab.path;
    $("languageStatus").textContent = languageForPath(tab.path);
    renderOpenTabs();
    updateHighlight();
    await refreshTree();
    writeOutput("File moved", result);
  } catch (error) {
    errorOutput("Rename / move failed", error);
  } finally {
    setBusy(false);
  }
}

async function deleteCurrentFile() {
  const tab = activeTab();
  if (!tab || state.busy) return;
  if (!state.workspace || state.workspace.root !== tab.root) {
    errorOutput("Delete blocked", "Switch back to the workspace that owns this tab before deleting the file.");
    return;
  }
  syncActiveTabFromEditor();
  const path = tab.path;
  const dirtyWarning = tab.dirty ? "\n\nThe unsaved buffer for this file will also be discarded." : "";
  if (!window.confirm(`Delete ${path}? This removes the file from disk and cannot be undone by ZeroScript.${dirtyWarning}`)) return;
  setBusy(true, "Deleting file…");
  try {
    const result = await callTool("workspace_delete_file", { path });
    const index = state.openTabs.findIndex((item) => item.key === tab.key);
    state.openTabs = state.openTabs.filter((item) => item.key !== tab.key);
    if (state.activeTabKey === tab.key) {
      state.activeTabKey = null;
      if (state.openTabs.length) {
        const next = state.openTabs[Math.min(Math.max(index, 0), state.openTabs.length - 1)];
        switchToTab(next.key);
      } else {
        state.currentFile = null;
        state.fileWorkspaceRoot = null;
        state.savedContent = "";
        state.dirty = false;
        $("codeEditor").value = "";
        showWelcome();
        renderDirty();
      }
    }
    renderOpenTabs();
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
    const dirtyTabs = state.openTabs.filter((tab) => tab.dirty);
    if (dirtyTabs.length && !window.confirm("Switch workspaces and discard unsaved edits in " + dirtyTabs.length + " open tab(s)?")) {
      writeOutput("Workspace switch cancelled", "The selected folder was not activated; all open buffers were kept.");
      return;
    }
    const activated = await callTool("workspace_set_root", { path: picked.selected_path });
    state.workspace = activated;
    state.openTabs = [];
    state.activeTabKey = null;
    state.folder = ".";
    state.currentFile = null;
    state.fileWorkspaceRoot = null;
    state.savedContent = "";
    state.dirty = false;
    $("codeEditor").value = "";
    renderOpenTabs();
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

function fuzzyScore(query, candidate) {
  const needle = query.trim().toLowerCase();
  const haystack = String(candidate || "").toLowerCase();
  if (!needle) return haystack.length / 1000;
  if (haystack === needle) return -10000;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct * 2 + haystack.length / 100;
  let cursor = -1;
  let score = 0;
  let consecutive = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, cursor + 1);
    if (next < 0) return Number.POSITIVE_INFINITY;
    consecutive = next === cursor + 1 ? consecutive + 1 : 0;
    score += next + (consecutive ? -3 : 0);
    if (next === 0 || /[\/_.-]/.test(haystack[next - 1])) score -= 2;
    cursor = next;
  }
  return score + haystack.length / 100;
}

const COMMAND_PALETTE_ITEMS = [
  { title: "Open File", detail: "Quick Open a file from the workspace", icon: "⌕", action: "quick-open", shortcut: "Ctrl+P" },
  { title: "Choose Workspace Folder", detail: "Pick and activate a local project folder", icon: "▱", action: "workspace", shortcut: "" },
  { title: "Switch Recent Workspace", detail: "Switch between previously selected project folders", icon: "⌂", action: "recent-workspaces", shortcut: "" },
  { title: "Save Current File", detail: "Save the open source file", icon: "↓", action: "save", shortcut: "Ctrl+S" },
  { title: "Save All Open Files", detail: "Save every modified tab in the active workspace", icon: "⇩", action: "save-all", shortcut: "" },
  { title: "Close Current Tab", detail: "Close the active editor tab", icon: "×", action: "close-tab", shortcut: "Ctrl+W" },
  { title: "Close Other Tabs", detail: "Close all tabs except the current one", icon: "⊟", action: "close-other-tabs", shortcut: "" },
  { title: "Close All Tabs", detail: "Close every open editor tab", icon: "×", action: "close-all-tabs", shortcut: "" },
  { title: "Search in Files", detail: "Search project text, optionally with regex", icon: "⌕", action: "search", shortcut: "Ctrl+Shift+F" },
  { title: "Show Project Overview", detail: "Inspect manifests, project type, scripts, and source inventory", icon: "◈", action: "project", shortcut: "" },
  { title: "Show Git Status", detail: "Review branch and working-tree status", icon: "⑂", action: "git-status", shortcut: "" },
  { title: "Show Unstaged Diff", detail: "Read uncommitted file changes", icon: "±", action: "git-diff", shortcut: "" },
  { title: "Show Staged Diff", detail: "Read staged file changes", icon: "±", action: "git-diff-staged", shortcut: "" },
  { title: "List Git Branches", detail: "Inspect local and remote branches", icon: "⑂", action: "git-branches", shortcut: "" },
  { title: "Show File Outline", detail: "Inspect imports, headings, and declarations in the current file", icon: "☷", action: "outline", shortcut: "" },
  { title: "Go to Line", detail: "Jump to a line in the active source file", icon: "№", action: "go-line", shortcut: "Ctrl+G" },
  { title: "Search Symbols", detail: "Find function, class, type, and variable declarations", icon: "⌘", action: "symbols", shortcut: "" },
  { title: "Create New File", detail: "Create an empty file without overwriting existing files", icon: "＋", action: "new-file", shortcut: "" },
  { title: "Create New Folder", detail: "Create a workspace-relative directory", icon: "▱", action: "new-folder", shortcut: "" },
  { title: "Run a Command", detail: "Open the argv-based command runner", icon: ">_", action: "terminal", shortcut: "" },
  { title: "Refresh Project", detail: "Reload workspace status, tree, and project metadata", icon: "↻", action: "refresh", shortcut: "" },
];

function renderModalResults() {
  const host = $("modalResults");
  const query = $("modalInput").value;
  const filtered = state.modalItems
    .map((item) => ({ item, score: fuzzyScore(query, item.title + " " + (item.detail || "") + " " + (item.path || "")) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
    .slice(0, 80)
    .map((entry) => entry.item);
  state.modalFiltered = filtered;
  state.modalIndex = Math.max(0, Math.min(state.modalIndex, filtered.length - 1));
  host.replaceChildren();
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "modal-empty";
    empty.textContent = state.modalMode === "quickOpen" ? "No matching files. Try another path fragment." : state.modalMode === "recent" ? "No saved recent projects found." : "No matching commands.";
    host.append(empty);
    return;
  }
  filtered.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "modal-result" + (index === state.modalIndex ? " selected" : "");
    button.dataset.index = String(index);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === state.modalIndex ? "true" : "false");
    const icon = document.createElement("span");
    icon.className = "modal-result-icon";
    icon.textContent = item.icon || "·";
    const copy = document.createElement("span");
    copy.className = "modal-result-copy";
    const title = document.createElement("span");
    title.className = "modal-result-title";
    title.textContent = item.title;
    const detail = document.createElement("span");
    detail.className = "modal-result-detail";
    detail.textContent = item.detail || "";
    copy.append(title, detail);
    button.append(icon, copy);
    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "modal-result-shortcut";
      shortcut.textContent = item.shortcut;
      button.append(shortcut);
    }
    button.addEventListener("mouseenter", () => {
      state.modalIndex = index;
      for (const sibling of host.querySelectorAll(".modal-result")) {
        const selected = sibling === button;
        sibling.classList.toggle("selected", selected);
        sibling.setAttribute("aria-selected", selected ? "true" : "false");
      }
    });
    button.addEventListener("click", () => activateModalItem(filtered[index]));
    host.append(button);
  });
  host.querySelector(".modal-result.selected")?.scrollIntoView({ block: "nearest" });
}

function showModal(mode, items, initialQuery = "") {
  state.modalMode = mode;
  state.modalItems = items;
  state.modalFiltered = [];
  state.modalIndex = 0;
  $("modalTitle").textContent = mode === "quickOpen" ? "Quick Open" : mode === "recent" ? "Recent Workspaces" : "Command Palette";
  $("modalSubtitle").textContent = mode === "quickOpen"
    ? "Search project files by name or path"
    : mode === "recent" ? "Switch to a project folder you previously selected"
    : "Search and run ZeroScript workspace commands";
  $("modalInput").placeholder = mode === "quickOpen" ? "Type a file name or path…" : mode === "recent" ? "Filter recent project folders…" : "Type a command…";
  $("modalInput").value = initialQuery;
  $("modalBackdrop").classList.remove("hidden");
  renderModalResults();
  $("modalInput").focus();
  $("modalInput").select();
}

function closeModal() {
  $("modalBackdrop").classList.add("hidden");
  state.modalMode = null;
  state.modalItems = [];
  state.modalFiltered = [];
  state.modalIndex = 0;
}

async function openQuickOpen() {
  if (!state.workspace || !state.workspace.configured) {
    await chooseWorkspace();
    return;
  }
  showModal("quickOpen", [{
    title: "Loading workspace files…",
    detail: "Reading the selected project tree",
    icon: "↻",
    action: "none",
  }]);
  try {
    const result = await callTool("workspace_tree", {
      path: ".", max_depth: 12, max_results: 500, include_hidden: false,
    });
    const entries = result.entries || [];
    state.treeEntries = entries;
    const items = entries.filter((entry) => entry.type === "file").map((entry) => ({
      title: entry.name,
      detail: entry.path,
      path: entry.path,
      icon: iconForFile(entry.name),
      action: "open-file",
    }));
    if (result.truncated) {
      items.push({
        title: "More than 500 project entries",
        detail: "The file list is bounded for responsiveness. Search the Explorer panel for deep directories.",
        icon: "…",
        action: "none",
      });
    }
    if (state.modalMode === "quickOpen") {
      state.modalItems = items;
      state.modalIndex = 0;
      renderModalResults();
      $("modalInput").focus();
    }
  } catch (error) {
    closeModal();
    errorOutput("Quick Open failed", error);
  }
}

function iconForFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const icons = {
    luau: "L", lua: "L", js: "JS", jsx: "JS", ts: "TS", tsx: "TS",
    py: "Py", json: "{ }", html: "◇", css: "#", md: "M", yml: "Y",
    yaml: "Y", xml: "◇", sql: "DB", png: "▧", jpg: "▧", jpeg: "▧",
    svg: "◇", toml: "T", cs: "C#", cpp: "C++", c: "C", rs: "R",
  };
  return icons[ext] || "·";
}

async function openRecentWorkspaces() {
  try {
    showModal("recent", [{
      title: "Loading recent projects…",
      detail: "Reading saved local workspace history",
      icon: "↻",
      action: "none",
    }]);
    const result = await callTool("workspace_recent_roots", {});
    const roots = result.recent_roots || [];
    const items = roots.map((entry) => ({
      title: entry.name || entry.path,
      detail: entry.path + (entry.current ? " · Active" : entry.exists ? "" : " · Folder missing"),
      path: entry.path,
      icon: entry.current ? "●" : "⌂",
      current: !!entry.current,
      exists: !!entry.exists,
      action: entry.exists && !entry.current ? "open-recent" : "none",
    }));
    if (state.modalMode === "recent") {
      state.modalItems = items;
      state.modalIndex = 0;
      renderModalResults();
      $("modalInput").focus();
    }
  } catch (error) {
    closeModal();
    errorOutput("Recent workspace lookup failed", error);
  }
}

function openCommandPalette() {
  showModal("command", COMMAND_PALETTE_ITEMS);
}

async function activateModalItem(item) {
  if (!item) return;
  closeModal();
  if (item.action === "none") return;
  if (item.action === "open-file") {
    if (!mayReplaceEditorView()) return;
    await openFile(item.path);
  } else if (item.action === "quick-open") {
    await openQuickOpen();
  } else if (item.action === "workspace") {
    await chooseWorkspace();
  } else if (item.action === "recent-workspaces") {
    await openRecentWorkspaces();
  } else if (item.action === "open-recent") {
    const dirtyTabs = state.openTabs.filter((tab) => tab.dirty);
    if (dirtyTabs.length && !window.confirm("Switch workspaces and discard unsaved edits in " + dirtyTabs.length + " open tab(s)?")) return;
    setBusy(true, "Switching workspace…");
    try {
      const result = await callTool("workspace_open_recent", { path: item.path });
      state.workspace = result;
      state.openTabs = [];
      state.activeTabKey = null;
      state.folder = ".";
      state.currentFile = null;
      state.fileWorkspaceRoot = null;
      state.savedContent = "";
      state.dirty = false;
      $("codeEditor").value = "";
      renderOpenTabs();
      showWelcome();
      renderDirty();
      updateWorkspaceHeader();
      await loadWorkspaceDetails();
      writeOutput("Workspace switched", result);
    } catch (error) {
      errorOutput("Could not switch workspace", error);
    } finally {
      setBusy(false);
      updateWorkspaceHeader();
    }
  } else if (item.action === "save") {
    await saveFile();
  } else if (item.action === "save-all") {
    await saveAllTabs();
  } else if (item.action === "close-tab") {
    if (state.activeTabKey) closeTab(state.activeTabKey);
  } else if (item.action === "close-other-tabs") {
    closeOtherTabs();
  } else if (item.action === "close-all-tabs") {
    closeAllTabs();
  } else if (item.action === "search") {
    setView("search");
    $("searchQuery").focus();
  } else if (item.action === "project") {
    setView("project");
    await loadProjectInfo();
  } else if (item.action === "git-status") {
    setView("source");
    await loadGitStatus();
  } else if (item.action === "git-diff") {
    await loadGitDiff(false);
  } else if (item.action === "git-diff-staged") {
    await loadGitDiff(true);
  } else if (item.action === "git-branches") {
    setView("source");
    await loadGitBranches();
  } else if (item.action === "outline") {
    await loadOutline();
  } else if (item.action === "go-line") {
    goToLine();
  } else if (item.action === "symbols") {
    await searchSymbols();
  } else if (item.action === "new-file") {
    await createFile();
  } else if (item.action === "new-folder") {
    await createFolder();
  } else if (item.action === "terminal") {
    setView("terminal");
  } else if (item.action === "refresh") {
    await initialize();
  }
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

async function mutateGitFile(unstage = false) {
  if (state.busy) return;
  const tab = activeTab();
  if (!tab) {
    writeOutput("Git file action", "Open a file first, then choose Stage or Unstage Current File.");
    return;
  }
  if (!state.workspace || state.workspace.root !== tab.root) {
    errorOutput("Git file action blocked", "Switch back to the workspace that owns the active tab first.");
    return;
  }
  const verb = unstage ? "Unstage" : "Stage";
  if (!window.confirm(verb + " " + tab.path + " in the local Git index? This does not create a commit or push changes.")) return;
  setBusy(true, verb + "ing " + tab.path + "…");
  try {
    const result = await callTool(unstage ? "workspace_git_unstage_file" : "workspace_git_stage_file", { path: tab.path });
    if (result.exit_code !== 0) throw new Error(result.output || "Git exited with code " + result.exit_code);
    const status = await callTool("workspace_git_status", {});
    $("gitSummary").textContent = status.output || "(No Git output)";
    writeOutput(verb + " file", result.output || verb + "d " + tab.path);
  } catch (error) {
    errorOutput(verb + " file failed", error);
  } finally {
    setBusy(false);
    renderDirty();
  }
}

async function commitStagedChanges() {
  if (state.busy) return;
  if (!state.workspace || !state.workspace.configured) {
    errorOutput("Commit blocked", "Choose a project workspace first.");
    return;
  }
  const message = $("commitMessage").value.trim();
  if (!message) {
    errorOutput("Commit blocked", "Enter a commit message before creating a commit.");
    $("commitMessage").focus();
    return;
  }
  setBusy(true, "Checking staged changes…");
  try {
    const staged = await callTool("workspace_git_diff", { staged: true });
    if (staged.exit_code !== 0) throw new Error(staged.output || "Could not read the staged Git diff.");
    if (!String(staged.output || "").trim()) {
      writeOutput("Commit", "There are no staged changes to commit.");
      return;
    }
    const preview = String(staged.output).split("\n").slice(0, 12).join("\n");
    if (!window.confirm("Create a local commit with this message?\n\n" + message + "\n\nStaged diff preview:\n" + preview + "\n\nThis commit will not be pushed to a remote.")) return;
    setBusy(true, "Creating local commit…");
    const result = await callTool("workspace_git_commit", { message });
    if (result.exit_code !== 0) throw new Error(result.output || "Git commit exited with code " + result.exit_code);
    const status = await callTool("workspace_git_status", {});
    $("gitSummary").textContent = status.output || "(No Git output)";
    $("commitMessage").value = "";
    writeOutput("Local commit created", result.output || "Commit created. No push was performed.");
  } catch (error) {
    errorOutput("Commit failed", error);
  } finally {
    setBusy(false);
    renderDirty();
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
  // Open files keep their own in-memory buffers. Switching to search, Git, or
  // project details must never discard an editor buffer.
  syncActiveTabFromEditor();
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

function renderProjectTasks(project) {
  const host = $("taskList");
  host.replaceChildren();
  const scripts = project && project.package_scripts ? project.package_scripts : {};
  const manager = project && project.package_manager;
  const names = Object.keys(scripts);
  const longRunning = /^(?:dev|start|serve|watch|preview|storybook|docs:dev|dev:.*|watch:.*)$/i;
  const preferred = names.filter((name) => /(?:^|:)(?:test|build|lint|check|typecheck|validate|verify|compile|format:check|format:verify)(?:$|:)/i.test(name) && !longRunning.test(name));
  const safeNames = (preferred.length ? preferred : names.filter((name) => !longRunning.test(name))).slice(0, 12);
  if (!manager || safeNames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = manager
      ? "No one-shot task scripts detected. Use the Command Runner for a custom project command."
      : "No package.json task scripts detected for this project.";
    host.append(empty);
    return;
  }
  const iconFor = (name) => /test/i.test(name) ? "✓" : /lint|format/i.test(name) ? "≋" : /typecheck|check|validate|verify/i.test(name) ? "◇" : /build|compile/i.test(name) ? "⚒" : "›";
  for (const name of safeNames) {
    const button = document.createElement("button");
    button.className = "task-action";
    const icon = document.createElement("span");
    icon.className = "task-icon";
    icon.textContent = iconFor(name);
    const copy = document.createElement("span");
    copy.className = "task-name";
    const label = document.createElement("span");
    label.textContent = name;
    const command = document.createElement("span");
    command.className = "task-command";
    command.textContent = `${manager} run ${name}`;
    copy.append(label, command);
    button.append(icon, copy);
    button.title = `Run the project-defined script: ${manager} run ${name}`;
    button.addEventListener("click", () => runProjectTask(manager, name));
    host.append(button);
  }
  if (names.length > safeNames.length) {
    const note = document.createElement("div");
    note.className = "empty-state";
    note.textContent = `${names.length - safeNames.length} additional package script(s) were not promoted to one-click tasks. Use the Command Runner to invoke them.`;
    host.append(note);
  }
}

async function runProjectTask(manager, name) {
  const command = manager === "bun" ? ["bun", "run", name] : [manager, "run", name];
  const display = command.join(" ");
  if (!window.confirm(`Run the project-defined script below?\n\n${display}\n\nProject scripts are executable code and may modify files or access the network.`)) return;
  setBusy(true, `Running ${name}…`);
  try {
    const result = await callTool("workspace_run_command", { command, timeout: 300 }, 315000);
    const status = result.timed_out ? "Timed out after 300 seconds" : `Exit code ${result.exit_code}`;
    writeOutput(`Task · ${name} · ${status}`, `${command.join(" ")}\n\n${result.output || "(No output)"}`, result.exit_code === 0 ? "output" : "problems");
  } catch (error) {
    errorOutput(`Task failed · ${name}`, error);
  } finally {
    setBusy(false);
  }
}

async function loadProjectInfo() {
  if (!mayReplaceEditorView()) return;
  setBusy(true, "Inspecting project…");
  try {
    const result = await callTool("workspace_project_info", {});
    state.projectInfo = result;
    renderProjectTasks(result);
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

async function searchSymbols() {
  if (!state.workspace || !state.workspace.configured) {
    writeOutput("Search Symbols", "Choose a project workspace first.");
    return;
  }
  const query = window.prompt("Symbol name or declaration text (leave empty to list likely declarations):", "");
  if (query === null) return;
  setBusy(true, "Searching project symbols…");
  try {
    const result = await callTool("workspace_symbols", {
      query: query.trim(), path: ".", max_results: 300,
    });
    setInfoMode("Symbol Search", result, "Search");
    writeOutput("Symbol Search", result);
  } catch (error) {
    errorOutput("Symbol search failed", error);
  } finally {
    setBusy(false);
  }
}

function goToLine() {
  const tab = activeTab();
  if (!tab) {
    writeOutput("Go to Line", "Open a source file first.");
    return;
  }
  if (!mayReplaceEditorView()) return;
  const total = $("codeEditor").value.split("\n").length;
  const raw = window.prompt("Go to line (1–" + total + "):", "1");
  if (raw === null) return;
  const lineNumber = Number.parseInt(raw, 10);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > total) {
    errorOutput("Go to Line", "Enter a whole line number between 1 and " + total + ".");
    return;
  }
  const lines = $("codeEditor").value.split("\n");
  const index = lines.slice(0, lineNumber - 1).join("\n").length + (lineNumber > 1 ? 1 : 0);
  setEditorMode();
  $("codeEditor").focus();
  $("codeEditor").setSelectionRange(index, index);
  updateCursorStatus();
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
  if (!window.confirm("Run this command in the selected workspace?\n\n" + JSON.stringify(command) + "\n\nCommands may modify project files, install packages, or access external services.")) return;
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
    const result = await callTool("workspace_create_file", { path: path.trim(), content: "" });
    await refreshTree();
    await openFile(path.trim());
    writeOutput("File created", result);
  } catch (error) { errorOutput("Create file failed", error); }
  finally { setBusy(false); }
}

$("chooseWorkspace").addEventListener("click", chooseWorkspace);
$("welcomeOpen").addEventListener("click", chooseWorkspace);
$("recentWorkspaces").addEventListener("click", openRecentWorkspaces);
$("refreshWorkspace").addEventListener("click", initialize);
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
  syncActiveTabFromEditor();
  updateHighlight();
  renderDirty();
});
$("codeEditor").addEventListener("keyup", updateCursorStatus);
$("codeEditor").addEventListener("click", updateCursorStatus);
$("codeEditor").addEventListener("scroll", () => {
  $("lineNumbers").scrollTop = $("codeEditor").scrollTop;
  $("syntaxHighlight").scrollTop = $("codeEditor").scrollTop;
  $("syntaxHighlight").scrollLeft = $("codeEditor").scrollLeft;
});
$("codeEditor").addEventListener("keydown", (event) => {
  const editor = $("codeEditor");
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;
    const inserted = "    ";
    editor.value = value.slice(0, start) + inserted + value.slice(end);
    editor.setSelectionRange(start + inserted.length, start + inserted.length);
    updateHighlight();
    state.dirty = editor.value !== state.savedContent;
    renderDirty();
    updateCursorStatus();
  } else if (event.key === "Enter") {
    const cursor = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf("\n", cursor - 1) + 1;
    const prefix = editor.value.slice(lineStart, cursor);
    const indent = (prefix.match(/^[ \t]*/) || [""])[0];
    const extraIndent = /(?:\{|\(|\[|:|\bthen|\bdo)\s*$/.test(prefix) ? "    " : "";
    if (indent || extraIndent) {
      event.preventDefault();
      const value = editor.value;
      const insertion = "\n" + indent + extraIndent;
      editor.value = value.slice(0, cursor) + insertion + value.slice(editor.selectionEnd);
      const next = cursor + insertion.length;
      editor.setSelectionRange(next, next);
      updateHighlight();
      state.dirty = editor.value !== state.savedContent;
      renderDirty();
      updateCursorStatus();
    }
  }
});
$("saveFile").addEventListener("click", saveFile);
$("showOutline").addEventListener("click", loadOutline);
$("showProjectInfo").addEventListener("click", loadProjectInfo);
$("searchQuery").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
$("commitMessage").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commitStagedChanges();
});
$("runSearch").addEventListener("click", runSearch);
$("loadGitStatus").addEventListener("click", loadGitStatus);
$("loadGitDiff").addEventListener("click", () => loadGitDiff(false));
$("loadStagedDiff").addEventListener("click", () => loadGitDiff(true));
$("loadGitBranches").addEventListener("click", loadGitBranches);
$("stageCurrentFile").addEventListener("click", () => mutateGitFile(false));
$("unstageCurrentFile").addEventListener("click", () => mutateGitFile(true));
$("commitStaged").addEventListener("click", commitStagedChanges);
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
$("modalInput").addEventListener("input", () => {
  state.modalIndex = 0;
  renderModalResults();
});
$("modalInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    state.modalIndex = Math.min(state.modalIndex + 1, state.modalFiltered.length - 1);
    renderModalResults();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.modalIndex = Math.max(0, state.modalIndex - 1);
    renderModalResults();
  } else if (event.key === "Enter") {
    event.preventDefault();
    activateModalItem(state.modalFiltered[state.modalIndex]);
  }
});
$("modalBackdrop").addEventListener("click", (event) => {
  if (event.target === $("modalBackdrop")) closeModal();
});

window.addEventListener("beforeunload", (event) => {
  syncActiveTabFromEditor();
  if (state.openTabs.some((tab) => tab.dirty)) {
    event.preventDefault();
    event.returnValue = "";
  }
});

document.addEventListener("keydown", (event) => {
  if (!$("modalBackdrop").classList.contains("hidden")) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (event.shiftKey) saveAllTabs();
    else saveFile();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
    event.preventDefault();
    if (state.activeTabKey) closeTab(state.activeTabKey);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
    event.preventDefault();
    goToLine();
  } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    setView("search");
    $("searchQuery").focus();
  } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    openCommandPalette();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    openQuickOpen();
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
    if ((!previousRoot || previousRoot !== nextRoot) && message.workspace.configured) {
      const dirtyTabs = state.openTabs.filter((tab) => tab.dirty);
      if (dirtyTabs.length) {
        errorOutput("Workspace changed", "The active folder changed in another ZeroScript window. Open tabs and unsaved buffers are preserved, but saving buffers from the prior folder is blocked.");
      } else {
        state.openTabs = [];
        state.activeTabKey = null;
        state.currentFile = null;
        state.fileWorkspaceRoot = null;
        state.folder = ".";
        showWelcome();
      }
      renderOpenTabs();
      renderDirty();
      loadWorkspaceDetails();
    }
  }
});

initialize().then(() => {
  if (new URLSearchParams(window.location.search).get("openFolder") === "1") {
    chooseWorkspace();
  }
});
