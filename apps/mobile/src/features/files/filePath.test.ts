import { describe, expect, it } from "vite-plus/test";

import {
  expandHomeRelativePath,
  fileRoutePathSegments,
  hasFileExtension,
  isHomeRelativePath,
  isMarkedDirectoryPath,
  resolveFileLinkPath,
  resolveFileLinkTarget,
  resolveWorkspaceRelativeFilePath,
} from "./filePath";

describe("resolveFileLinkPath", () => {
  it.each([
    ["/home/maria/project", "~/.agents/AGENTS.md", "/home/maria/.agents/AGENTS.md"],
    ["/Users/maria/project", "~/notes.md", "/Users/maria/notes.md"],
    ["C:\\Users\\maria\\project", "~\\.agents\\AGENTS.md", "C:\\Users\\maria\\.agents\\AGENTS.md"],
  ])("expands a home link from %s", (cwd, path, expected) => {
    expect(resolveFileLinkPath(cwd, path)).toBe(expected);
    expect(fileRoutePathSegments(expected).join("/")).toBe(expected);
  });

  it("does not turn an unresolved home into a workspace path", () => {
    expect(resolveFileLinkPath("/repo", "~/notes.md")).toBeNull();
    expect(resolveFileLinkPath(null, "~/notes.md")).toBeNull();
    expect(resolveFileLinkPath("/repo", "../notes.md")).toBeNull();
  });
});

describe("resolveWorkspaceRelativeFilePath", () => {
  it("converts absolute paths inside the workspace", () => {
    expect(
      resolveWorkspaceRelativeFilePath("/Users/julius/repo", "/Users/julius/repo/src/main.ts"),
    ).toBe("src/main.ts");
    expect(resolveWorkspaceRelativeFilePath("C:\\repo", "c:\\repo\\src\\main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("recognizes home links inside the workspace", () => {
    expect(resolveWorkspaceRelativeFilePath("/home/maria/project", "~/project/src/main.ts")).toBe(
      "src/main.ts",
    );
    expect(
      resolveWorkspaceRelativeFilePath("/home/maria/project", "~/.agents/AGENTS.md"),
    ).toBeNull();
  });

  it("rejects paths outside the workspace", () => {
    expect(resolveWorkspaceRelativeFilePath("/repo", "/other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "../other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "/repo/../outside.txt")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath(null, "/repo/main.ts")).toBeNull();
  });
});

describe("home-relative links", () => {
  it("recognizes ~ paths", () => {
    expect(isHomeRelativePath("~")).toBe(true);
    expect(isHomeRelativePath("~/Claude-Journal-archive/")).toBe(true);
    expect(isHomeRelativePath("~user/x")).toBe(false);
    expect(isHomeRelativePath("src/~/x")).toBe(false);
  });

  it("expands against the server's home directory", () => {
    expect(expandHomeRelativePath("~", "/home/me")).toBe("/home/me");
    expect(expandHomeRelativePath("~/", "/home/me/")).toBe("/home/me");
    expect(expandHomeRelativePath("~/notes/a.md", "/home/me")).toBe("/home/me/notes/a.md");
    expect(expandHomeRelativePath("~\\docs", "C:\\Users\\me")).toBe("C:\\Users\\me\\docs");
    expect(expandHomeRelativePath("/etc/hosts", "/home/me")).toBe("/etc/hosts");
  });
});

describe("resolveFileLinkTarget", () => {
  it("opens a ~ path inside the workspace workspace-relative", () => {
    expect(
      resolveFileLinkTarget({
        workspaceRoot: "/home/me/repo",
        path: "~/repo/src/main.ts",
        homePath: "/home/me",
      }),
    ).toEqual({ kind: "workspace", relativePath: "src/main.ts" });
  });

  it("opens a ~ path outside the workspace as an absolute path", () => {
    expect(
      resolveFileLinkTarget({
        workspaceRoot: "/home/me/repo",
        path: "~/Claude-Journal-archive/",
        homePath: "/home/me",
      }),
    ).toEqual({ kind: "absolute", path: "/home/me/Claude-Journal-archive" });
    expect(resolveFileLinkTarget({ workspaceRoot: null, path: "~", homePath: "/home/me" })).toEqual(
      { kind: "absolute", path: "/home/me" },
    );
  });

  it("waits for the home directory before resolving ~ paths", () => {
    expect(
      resolveFileLinkTarget({ workspaceRoot: "/repo", path: "~/x.md", homePath: null }),
    ).toBeNull();
  });

  it("keeps existing workspace and absolute behavior", () => {
    expect(
      resolveFileLinkTarget({ workspaceRoot: "/repo", path: "src/a.ts", homePath: null }),
    ).toEqual({ kind: "workspace", relativePath: "src/a.ts" });
    expect(
      resolveFileLinkTarget({ workspaceRoot: "/repo", path: "/tmp/r.md", homePath: null }),
    ).toEqual({ kind: "absolute", path: "/tmp/r.md" });
    expect(
      resolveFileLinkTarget({ workspaceRoot: "/repo", path: "../out.md", homePath: null }),
    ).toBeNull();
    expect(resolveFileLinkTarget({ workspaceRoot: "/", path: "/", homePath: null })).toEqual({
      kind: "absolute",
      path: "/",
    });
  });
});

describe("folder detection", () => {
  it("treats a trailing separator or bare ~ as a folder", () => {
    expect(isMarkedDirectoryPath("~/archive/")).toBe(true);
    expect(isMarkedDirectoryPath("~")).toBe(true);
    expect(isMarkedDirectoryPath("~/archive")).toBe(false);
  });

  it("only probes paths without an extension", () => {
    expect(hasFileExtension("~/notes/a.md")).toBe(true);
    expect(hasFileExtension("~/Claude-Journal-archive")).toBe(false);
    expect(hasFileExtension("/home/me/.config")).toBe(false);
    expect(hasFileExtension("Makefile")).toBe(false);
  });
});
