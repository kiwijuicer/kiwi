import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function sourceRepoRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

export function toRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

export function sourceLineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return `${position.line + 1}:${position.character + 1}`;
}

function isSourceFile(filePath) {
  return /\.(ts|tsx|mts|cts)$/.test(filePath) && !filePath.endsWith(".d.ts") && !filePath.endsWith(".test.ts");
}

function shouldSkipPath(filePath, allowedFileNames) {
  return (
    filePath.includes(`${path.sep}dist${path.sep}`) ||
    filePath.includes(`${path.sep}node_modules${path.sep}`) ||
    filePath.includes(`${path.sep}.kiwi${path.sep}`) ||
    filePath.includes(`${path.sep}coverage${path.sep}`) ||
    filePath.includes(`${path.sep}__tests__${path.sep}`) ||
    allowedFileNames.has(path.basename(filePath))
  );
}

function walk(dirPath, allowedFileNames, files = []) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (shouldSkipPath(fullPath, allowedFileNames)) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(fullPath, allowedFileNames, files);
      continue;
    }
    if (entry.isFile() && isSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

export function walkSourceFiles(repoRoot, options = {}) {
  const sourceRoots = options.sourceRoots ?? ["apps", "packages"];
  const allowedFileNames = options.allowedFileNames ?? new Set();

  return sourceRoots.flatMap((root) => walk(path.join(repoRoot, root), allowedFileNames));
}
