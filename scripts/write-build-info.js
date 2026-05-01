const fs = require(`fs`);
const path = require(`path`);
const { execSync } = require(`child_process`);

const rootDir = path.resolve(__dirname, `..`);
const outputPaths = [
    path.resolve(rootDir, `.env.development.local`),
    path.resolve(rootDir, `.env.production.local`),
];

function runCommand(command) {
    try {
        return execSync(command, {
            cwd: rootDir,
            encoding: `utf8`,
            stdio: [`ignore`, `pipe`, `ignore`],
        }).trim();
    } catch (_) {
        return ``;
    }
}

const shortHash = runCommand(`git rev-parse --short HEAD`) || `unknown`;
const fullHash = runCommand(`git rev-parse HEAD`) || `unknown`;
const branch = runCommand(`git rev-parse --abbrev-ref HEAD`) || `unknown`;
const workingTreeStatus = runCommand(`git status --porcelain`);
const dirtyState = workingTreeStatus ? `dirty` : `clean`;
const branchLabel = branch && branch !== `HEAD` ? `${branch}@` : ``;
const buildLabel = `${branchLabel}${shortHash}${dirtyState === `dirty` ? `*` : ``}`;

const buildInfoVariables = {
    REACT_APP_BUILD_REVISION: shortHash,
    REACT_APP_BUILD_FULL_REVISION: fullHash,
    REACT_APP_BUILD_BRANCH: branch,
    REACT_APP_BUILD_WORKTREE_STATE: dirtyState,
    REACT_APP_BUILD_LABEL: buildLabel,
};

function upsertEnvLines(currentContents, valuesByKey) {
    const lines = currentContents ? currentContents.split(/\r?\n/) : [];
    const nextLines = [...lines];
    const keys = Object.keys(valuesByKey);
    const replacedKeys = new Set();

    keys.forEach((key) => {
        const matchIndex = nextLines.findIndex((line) => line.startsWith(`${key}=`));
        const nextLine = `${key}=${valuesByKey[key]}`;
        if (matchIndex >= 0) {
            nextLines[matchIndex] = nextLine;
            replacedKeys.add(key);
        }
    });

    keys.forEach((key) => {
        if (replacedKeys.has(key)) return;
        nextLines.push(`${key}=${valuesByKey[key]}`);
    });

    return nextLines.filter((line, index, allLines) => {
        if (index === allLines.length - 1) return true;
        return line !== `` || allLines[index + 1] !== ``;
    }).join(`\n`) + `\n`;
}

let updatedCount = 0;
outputPaths.forEach((outputPath) => {
    let currentContents = ``;
    if (fs.existsSync(outputPath)) {
        currentContents = fs.readFileSync(outputPath, `utf8`);
    }
    const nextContents = upsertEnvLines(currentContents, buildInfoVariables);
    if (currentContents === nextContents) return;
    fs.writeFileSync(outputPath, nextContents, `utf8`);
    updatedCount++;
});

if (updatedCount > 0) {
    console.log(`Updated build info (${updatedCount} env file${updatedCount > 1 ? `s` : ``}): ${buildLabel}`);
} else {
    console.log(`Build info unchanged: ${buildLabel}`);
}
