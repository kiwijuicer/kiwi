import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "config", "oop-structure-baseline.json");
const sourceRoots = ["apps", "packages"];
const maxLooseTopLevelFunctions = 4;
const writeBaseline = process.argv.includes("--write-baseline");

function toRelativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function isSourceFile(filePath) {
  return /\.(ts|tsx|mts|cts)$/.test(filePath) && !filePath.endsWith(".d.ts") && !filePath.endsWith(".test.ts");
}

function shouldSkipPath(filePath) {
  return (
    filePath.includes(`${path.sep}dist${path.sep}`) ||
    filePath.includes(`${path.sep}node_modules${path.sep}`) ||
    filePath.includes(`${path.sep}.kiwi${path.sep}`) ||
    filePath.includes(`${path.sep}coverage${path.sep}`) ||
    filePath.includes(`${path.sep}__tests__${path.sep}`)
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

function declarationName(name) {
  if (!name) {
    return "<anonymous>";
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return name.getText();
}

function isFunctionInitializer(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function objectFunctionMemberCount(objectLiteral) {
  let count = 0;

  for (const property of objectLiteral.properties) {
    if (ts.isMethodDeclaration(property)) {
      count += 1;
      continue;
    }
    if (ts.isPropertyAssignment(property) && isFunctionInitializer(property.initializer)) {
      count += 1;
    }
  }

  return count;
}

function analyzeFile(filePath) {
  const sourceText = readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const looseFunctions = [];
  let classCount = 0;
  let objectContainerCount = 0;

  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement)) {
      classCount += 1;
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.body) {
      looseFunctions.push(declarationName(statement.name));
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const name = declarationName(declaration.name);
      const initializer = declaration.initializer;

      if (!initializer) {
        continue;
      }
      if (isFunctionInitializer(initializer)) {
        looseFunctions.push(name);
        continue;
      }
      if (ts.isObjectLiteralExpression(initializer) && objectFunctionMemberCount(initializer) >= 2) {
        objectContainerCount += 1;
      }
    }
  }

  return {
    file: toRelativePath(filePath),
    looseTopLevelFunctions: looseFunctions.length,
    cohesiveContainers: classCount + objectContainerCount,
    functions: looseFunctions.sort(),
  };
}

function isOopStructureIssue(analysis) {
  return analysis.looseTopLevelFunctions > maxLooseTopLevelFunctions && analysis.cohesiveContainers === 0;
}

function currentIssues() {
  return sourceRoots
    .flatMap((root) => walk(path.join(repoRoot, root)))
    .map(analyzeFile)
    .filter(isOopStructureIssue)
    .sort((left, right) => left.file.localeCompare(right.file));
}

function writeIssueBaseline(issues) {
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        maxLooseTopLevelFunctions,
        files: Object.fromEntries(
          issues.map((issue) => [
            issue.file,
            {
              looseTopLevelFunctions: issue.looseTopLevelFunctions,
              cohesiveContainers: issue.cohesiveContainers,
              functions: issue.functions,
            },
          ]),
        ),
      },
      null,
      2,
    ) + "\n",
  );
}

function readBaseline() {
  if (!existsSync(baselinePath)) {
    console.error(`Missing OOP structure baseline at ${baselinePath}.`);
    console.error("Generate baseline once: pnpm lint:oop:init");
    process.exit(1);
  }

  return JSON.parse(readFileSync(baselinePath, "utf-8"));
}

function newOrWorseIssues(issues, baseline) {
  const baselineFiles = baseline.files ?? {};

  return issues.filter((issue) => {
    const baselineIssue = baselineFiles[issue.file];

    return !baselineIssue || issue.looseTopLevelFunctions > baselineIssue.looseTopLevelFunctions;
  });
}

const issues = currentIssues();

if (writeBaseline) {
  writeIssueBaseline(issues);
  console.log(`Wrote OOP structure baseline with ${issues.length} file(s) to ${baselinePath}`);
  process.exit(0);
}

const baseline = readBaseline();
const offenders = newOrWorseIssues(issues, baseline);

if (offenders.length > 0) {
  console.error(`Found ${offenders.length} new or worse OOP structure issue(s).`);
  for (const issue of offenders.slice(0, 40)) {
    console.error(
      `${issue.file}: ${issue.looseTopLevelFunctions} loose top-level functions, ` +
        `${issue.cohesiveContainers} class/object containers. Group related behavior or split the module.`,
    );
  }
  if (offenders.length > 40) {
    console.error(`... and ${offenders.length - 40} more`);
  }
  process.exit(1);
}

console.log("OOP structure gate passed.");
