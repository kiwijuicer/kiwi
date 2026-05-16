import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps", "packages"];
const allowedFileNames = new Set(["constants.ts", "common.ts", "schemas.ts", "types.ts"]);

function isSourceFile(filePath) {
  return /\.(ts|tsx|mts|cts)$/.test(filePath) && !filePath.endsWith(".d.ts") && !filePath.endsWith(".test.ts");
}

function shouldSkipPath(filePath) {
  return (
    filePath.includes(`${path.sep}dist${path.sep}`) ||
    filePath.includes(`${path.sep}node_modules${path.sep}`) ||
    filePath.includes(`${path.sep}.kiwi${path.sep}`) ||
    filePath.includes(`${path.sep}coverage${path.sep}`) ||
    filePath.includes(`${path.sep}__tests__${path.sep}`) ||
    allowedFileNames.has(path.basename(filePath))
  );
}

function walk(dirPath, files = []) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (shouldSkipPath(fullPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && isSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function lineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return `${position.line + 1}:${position.character + 1}`;
}

function isStringLiteralType(node) {
  return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal);
}

function containsStringLiteralUnion(node) {
  if (!ts.isUnionTypeNode(node)) {
    return false;
  }

  return node.types.some(isStringLiteralType);
}

function inspectTypeNode(typeNode, sourceFile, filePath, issues) {
  if (!typeNode || !containsStringLiteralUnion(typeNode)) {
    return;
  }
  issues.push(`${relativePath(filePath)}:${lineAndColumn(sourceFile, typeNode)} ${typeNode.getText(sourceFile)}`);
}

function inspectFile(filePath) {
  const sourceText = readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const issues = [];

  function visit(node) {
    if (ts.isTypeAliasDeclaration(node)) {
      inspectTypeNode(node.type, sourceFile, filePath, issues);
    }
    if (ts.isPropertySignature(node)) {
      inspectTypeNode(node.type, sourceFile, filePath, issues);
    }
    if (ts.isParameter(node) && node.type) {
      inspectTypeNode(node.type, sourceFile, filePath, issues);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return issues;
}

const issues = sourceRoots
  .flatMap((root) => walk(path.join(repoRoot, root)))
  .flatMap(inspectFile)
  .sort();

if (issues.length > 0) {
  console.error(`Found ${issues.length} hardcoded string-union type(s). Move values to constants/contracts.`);
  for (const issue of issues.slice(0, 80)) {
    console.error(issue);
  }
  if (issues.length > 80) {
    console.error(`... and ${issues.length - 80} more`);
  }
  process.exit(1);
}

console.log("String value gate passed.");
