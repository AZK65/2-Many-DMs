import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

if (process.platform !== 'darwin') process.exit(0);
const directory = path.join(process.env.DATA_DIR || process.cwd(), '.local/bin');
const source = path.join(process.cwd(), 'scripts/x-pin-keychain.swift');
const binary = path.join(directory, 'x-pin-keychain');
const digest = createHash('sha256').update(await readFile(source)).digest('hex');
await mkdir(directory, { recursive: true, mode: 0o700 });
if (await readFile(binary + '.sha256', 'utf8').catch(() => '') !== digest || !(await readFile(binary).catch(() => null))) {
  const temporary = binary + '.build-' + process.pid;
  await promisify(execFile)('/usr/bin/swiftc', ['-O', source, '-o', temporary], { timeout: 120_000 });
  await chmod(temporary, 0o700);
  await rename(temporary, binary);
  await writeFile(binary + '.sha256', digest, { mode: 0o600 });
}
