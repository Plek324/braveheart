const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const packagePath = path.join(projectRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const skipBump = flags.has("--no-bump");

function printHelp() {
  console.log(`Usage: npm run release -- <patch|minor|major|version|current> [--no-bump] [--no-push] [--no-git-push] [--build-only] [--dry-run]

Examples:
  npm run release -- patch
  npm run release -- minor --no-push
  npm run release -- 0.1.6
  npm run release -- current --no-bump

Options:
  --no-bump       Do not bump package.json version; use the current version instead.
  --no-push       Build the Docker images but do not push them.
  --no-git-push   Skip git push and git push --tags.
  --build-only    Build local Docker images without pushing or git pushing.
  --dry-run       Show commands without executing them.
`);
}

if (flags.has("--help") || positional.length === 0) {
  printHelp();
  process.exit(positional.length === 0 ? 1 : 0);
}

const releaseTarget = positional[0];
const repo = process.env.DOCKER_REPO || "plek243/braveheart";
const noPush = flags.has("--no-push") || flags.has("--build-only");
const noGitPush = flags.has("--no-git-push") || flags.has("--build-only");
const dryRun = flags.has("--dry-run");
const shouldBump = !skipBump && releaseTarget !== "current";

function exec(command) {
  console.log(`$ ${command}`);
  if (!dryRun) {
    execSync(command, { stdio: "inherit", cwd: projectRoot });
  }
}

function validateReleaseTarget(target) {
  const semverKeyword = /^(patch|minor|major|prepatch|preminor|premajor|prerelease)$/;
  const explicitVersion = /^\d+\.\d+\.\d+(?:[-+].*)?$/;
  return semverKeyword.test(target) || explicitVersion.test(target) || target === "current";
}

if (!validateReleaseTarget(releaseTarget)) {
  console.error(`Invalid release target: ${releaseTarget}`);
  printHelp();
  process.exit(1);
}

let version;
if (shouldBump) {
  console.log(`Bumping version ${releaseTarget} for ${pkg.name} (current version ${pkg.version})`);
  exec(`npm version ${releaseTarget}`);
  const newPkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  version = newPkg.version;
} else {
  version = pkg.version;
  console.log(`Using current version ${version} for ${pkg.name}`);
}

const imageTags = [
  `braveheart:${version}`,
  `${repo}:${version}`,
  `${repo}:latest`,
];

const buildCommand = `docker build ${imageTags.map((t) => `-t ${t}`).join(" ")} .`;
exec(buildCommand);

if (!noPush) {
  exec(`docker push ${repo}:${version}`);
  exec(`docker push ${repo}:latest`);
}

if (!noGitPush) {
  exec("git push");
  exec("git push --tags");
}

console.log(`Release complete: ${version}`);
