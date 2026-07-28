import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const mockClientId = 'scranbook-e2e-client-id';
const restoreLocalBuild = process.env.CI !== 'true' && existsSync('.env.local');

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} stopped with signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

const mockEnvironment = {
  ...process.env,
  NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID: mockClientId,
};
const playwrightArgs = process.argv.slice(2);
if (playwrightArgs[0] === '--') playwrightArgs.shift();
let exitCode = 0;

try {
  exitCode = await run('pnpm', ['build'], mockEnvironment);
  if (exitCode === 0) {
    exitCode = await run(
      'pnpm',
      ['exec', 'playwright', 'test', ...playwrightArgs],
      mockEnvironment,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  if (restoreLocalBuild) {
    console.log(
      'Restoring the local .env.local build after mocked browser tests.',
    );
    const restoreExitCode = await run('pnpm', ['build']);
    if (restoreExitCode !== 0) exitCode = restoreExitCode;
  }
}

process.exitCode = exitCode;
