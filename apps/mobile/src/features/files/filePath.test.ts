import { describe, expect, it } from "vite-plus/test";

import {
  expandHomeRelativePath,
  fileRoutePathSegments,
  hasFileExtension,
  isHomeRelativePath,
  isMarkedDirectoryPath,
  resolveFileLinkTarget,
  isSvgImagePreviewFile,
  resolveWorkspaceRelativeFilePath,
  fileHeaderSubtitle,
} from "./filePath";

describe("fileRoutePathSegments", () => {
  it("round-trips workspace-relative and host paths through the route", () => {
    expect(fileRoutePathSegments("src/main.ts")).toEqual(["src", "main.ts"]);
    expect(fileRoutePathSegments("/tmp/t3-cleanup/report.md").join("/")).toBe(
      "/tmp/t3-cleanup/report.md",
    );
  });
});

describe("resolveWorkspaceRelativeFilePath", () => {
  it("keeps normalized workspace-relative paths", () => {
    expect(resolveWorkspaceRelativeFilePath("/repo", "./src/../src/main.ts")).toBe("src/main.ts");
  });

  it("converts absolute paths inside the workspace", () => {
    expect(
      resolveWorkspaceRelativeFilePath("/Users/julius/repo", "/Users/julius/repo/src/main.ts"),
    ).toBe("src/main.ts");
    expect(resolveWorkspaceRelativeFilePath("C:\\repo", "c:\\repo\\src\\main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("rejects paths outside the workspace", () => {
    expect(resolveWorkspaceRelativeFilePath("/repo", "/other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "../other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "/repo/../outside.txt")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath(null, "/repo/main.ts")).toBeNull();
  });
});

describe("file preview types", () => {
  it("identifies SVG images that need web rendering", () => {
    expect(isSvgImagePreviewFile("assets/diagram.svg#icon")).toBe(true);
    expect(isSvgImagePreviewFile("assets/photo.png")).toBe(false);
  });
});

describe("fileHeaderSubtitle", () => {
  it("places a workspace file under its project", () => {
    expect(
      fileHeaderSubtitle("t3code", "apps/mobile/src/features/threads/fileChipMenu.test.ts"),
    ).toBe("t3code · apps/mobile/src/features/threads");
  });

  it("shows only the directory for a host file outside the workspace", () => {
    expect(fileHeaderSubtitle("t3code", "/tmp/report.md")).toBe("/tmp");
  });

  it("shows only the project for a file at the workspace root", () => {
    expect(fileHeaderSubtitle("t3code", "README.md")).toBe("t3code");
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
