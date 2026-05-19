import { readFileSync } from "node:fs";
import ts from "typescript";
import { sourceLineAndColumn, sourceRepoRoot, toRelativePath, walkSourceFiles } from "./source-file-walk.mjs";

const repoRoot = sourceRepoRoot(import.meta.url);
const allowedFileNames = new Set(["constants.ts", "common.ts", "schemas.ts", "types.ts"]);

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
  issues.push(
    `${toRelativePath(repoRoot, filePath)}:${sourceLineAndColumn(sourceFile, typeNode)} ${typeNode.getText(sourceFile)}`,
  );
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

const issues = walkSourceFiles(repoRoot, { allowedFileNames }).flatMap(inspectFile).sort();

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
