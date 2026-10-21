import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";

export interface FileBreadcrumb {
  readonly label: string;
  readonly path: string;
  readonly kind: "project" | "directory" | "file";
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

export function fileRoutePathSegments(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return path.startsWith("/") ? ["", ...segments] : segments;
}

function isWindowsPathStyle(value: string): boolean {
  return isWindowsAbsolutePath(value) || /^[A-Za-z]:\\/.test(value);
}

function joinPath(base: string, next: string, separator: "/" | "\\"): string {
  const cleanBase = base.replace(/[\\/]+$/, "");
  if (separator === "\\") {
    return `${cleanBase}\\${next.replaceAll("/", "\\")}`;
  }
  return `${cleanBase}/${next.replace(/^\/+/, "")}`;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function resolveWorkspaceFilePath(cwd: string, relativePath: string): string {
  if (isAbsolutePath(relativePath)) {
    return relativePath;
  }

  const separator: "/" | "\\" = isWindowsPathStyle(cwd) ? "\\" : "/";
  return joinPath(cwd, relativePath, separator);
}

function normalizeRelativePath(value: string): string | null {
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

export function resolveFileLinkPath(
  workspaceRoot: string | null | undefined,
  targetPath: string,
): string | null {
  if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
    if (!workspaceRoot) return null;
    const expanded = resolvePathLinkTarget(targetPath, workspaceRoot);
    return isAbsolutePath(expanded) ? expanded : null;
  }
  return isAbsolutePath(targetPath) ? targetPath : normalizeRelativePath(targetPath);
}

export function resolveWorkspaceRelativeFilePath(
  workspaceRoot: string | null | undefined,
  targetPath: string,
): string | null {
  const resolved = resolveFileLinkPath(workspaceRoot, targetPath);
  if (resolved === null) return null;
  targetPath = resolved;
  if (!isAbsolutePath(targetPath)) return targetPath;
  if (!workspaceRoot) {
    return null;
  }

  const normalizedTarget = targetPath.replaceAll("\\", "/");
  const normalizedRoot = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  const caseInsensitive = isWindowsAbsolutePath(targetPath) || isWindowsAbsolutePath(workspaceRoot);
  const comparableTarget = caseInsensitive ? normalizedTarget.toLowerCase() : normalizedTarget;
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (!comparableTarget.startsWith(`${comparableRoot}/`)) {
    return null;
  }

  const relativePath = normalizedTarget.slice(normalizedRoot.length + 1);
  if (relativePath.split("/").includes("..")) {
    return null;
  }
  return normalizeRelativePath(relativePath);
}

/** "~", "~/..." or "~\\...": a path on the server relative to its user's home directory. */
export function isHomeRelativePath(value: string): boolean {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\");
}

/** Replaces a leading "~" with the server's home directory; other paths pass through. */
export function expandHomeRelativePath(value: string, homePath: string): string {
  if (!isHomeRelativePath(value)) return value;
  const rest = value.slice(1).replace(/^[\\/]+/, "");
  if (rest.length === 0) return homePath.replace(/(?<=.)[\\/]+$/, "");
  return joinPath(homePath, rest, isWindowsPathStyle(homePath) ? "\\" : "/");
}

/** A trailing separator (or a bare "~") marks a link target as a folder for certain. */
export function isMarkedDirectoryPath(value: string): boolean {
  return value === "~" || /[\\/]$/.test(value);
}

/** Folders usually have no extension; a path without one may be either and needs a stat. */
export function hasFileExtension(value: string): boolean {
  // A leading dot is a dotfile or dot-folder (".config"), not an extension.
  return /[^.]\.[^./\\]+$/.test(basename(value));
}

export type FileLinkTarget =
  | { readonly kind: "workspace"; readonly relativePath: string }
  | { readonly kind: "absolute"; readonly path: string };

/**
 * Where a file link points: inside the workspace (opened workspace-relative) or
 * elsewhere on the server. "~" paths need the server's home directory and
 * resolve to null until it is known.
 */
export function resolveFileLinkTarget(input: {
  readonly workspaceRoot: string | null | undefined;
  readonly path: string;
  readonly homePath: string | null;
}): FileLinkTarget | null {
  let path = input.path;
  if (isHomeRelativePath(path)) {
    if (!input.homePath) return null;
    path = expandHomeRelativePath(path, input.homePath);
  }
  const relativePath = resolveWorkspaceRelativeFilePath(input.workspaceRoot, path);
  if (relativePath) return { kind: "workspace", relativePath };
  if (!isAbsolutePath(path)) return null;
  const trimmed = path.replace(/[\\/]+$/, "");
  return { kind: "absolute", path: trimmed.length > 0 ? trimmed : path };
}

export function isVideoPreviewFile(path: string): boolean {
  return isWorkspaceVideoPreviewPath(path);
}

export function isAudioPreviewFile(path: string): boolean {
  return isWorkspaceAudioPreviewPath(path.split(/[?#]/, 1)[0] ?? "");
}

export function isSvgImagePreviewFile(path: string): boolean {
  return /\.svg$/i.test(path.split(/[?#]/, 1)[0] ?? "");
}

export function isMarkdownPreviewFile(path: string): boolean {
  return /\.(?:md|mdx)$/i.test(path.split(/[?#]/, 1)[0] ?? "");
}

export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[] {
  const parts = relativePath.split("/").filter(Boolean);
  return [
    { label: projectName, path: "", kind: "project" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
      kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
    })),
  ];
}

export function fileHeaderSubtitle(projectName: string, relativePath: string): string {
  const parentDir = relativePath.slice(
    0,
    Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"), 0),
  );
  return isAbsolutePath(relativePath)
    ? parentDir
    : [projectName, parentDir].filter(Boolean).join(" · ");
}
