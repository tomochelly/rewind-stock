// Packs the game (dist/) + server + relay into one executable using Node's single executable applications (SEA).
//   npm run build:exe                 -> release/rewind-win-x64.exe   (default)
//   npm run build:exe -- linux-x64    -> release/rewind-linux-x64     (also: darwin-arm64, darwin-x64)
// The Node binary for the target is downloaded once from nodejs.org (same version as the Node running this script,
// which SEA requires) and cached in .exe-cache/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, copyFileSync, rmSync, chmodSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';

const target = process.argv[2] || 'win-x64';
const [osName, arch] = target.split('-');
if (!['win', 'linux', 'darwin'].includes(osName) || !['x64', 'arm64'].includes(arch)) { console.error('알 수 없는 대상: ' + target); process.exit(1); }
const ROOT = resolve(import.meta.dirname, '..');
const WORK = join(ROOT, '.exe-cache'), OUT = join(ROOT, 'release');
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

console.log('1/5 게임 빌드 (vite)');
run(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build']);

console.log('2/5 서버를 파일 하나로 묶기 (esbuild)');
const serverJs = join(WORK, 'server.cjs');
await build({ entryPoints: [join(ROOT, 'server/index.mjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: serverJs, logLevel: 'warning',
  define: { 'import.meta.url': '"file:///sea/server/index.mjs"' } }); // never used inside the exe (assets come from SEA), keeps the bundle valid

console.log('3/5 게임 파일을 실행 파일 안에 넣을 준비');
const dist = join(ROOT, 'dist'), assets = {}, list = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else { const rel = '/' + relative(dist, p).split('\\').join('/'); list.push(rel); assets['dist' + rel] = p; } } };
walk(dist);
const manifest = join(WORK, 'manifest.json'); writeFileSync(manifest, JSON.stringify(list));
assets['manifest.json'] = manifest;
const blob = join(WORK, 'sea-prep.blob');
const cfg = join(WORK, 'sea-config.json');
writeFileSync(cfg, JSON.stringify({ main: serverJs, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2));
run(process.execPath, ['--experimental-sea-config', cfg]);

console.log('4/5 ' + target + '용 Node ' + process.version + ' 준비');
const exe = osName === 'win';
const nodeBin = join(WORK, 'node-' + process.version + '-' + target + (exe ? '.exe' : ''));
if (!existsSync(nodeBin)) {
  if (target === process.platform.replace('win32', 'win') + '-' + process.arch) copyFileSync(process.execPath, nodeBin);
  else if (exe) run('curl', ['-fL', '--retry', '3', '-o', nodeBin, 'https://nodejs.org/dist/' + process.version + '/win-' + arch + '/node.exe']);
  else {
    const tgz = nodeBin + '.tar.gz', dir = 'node-' + process.version + '-' + target;
    run('curl', ['-fL', '--retry', '3', '-o', tgz, 'https://nodejs.org/dist/' + process.version + '/' + dir + '.tar.gz']);
    run('tar', ['-xzf', tgz, '-C', WORK, dir + '/bin/node']);
    copyFileSync(join(WORK, dir, 'bin/node'), nodeBin); rmSync(tgz); rmSync(join(WORK, dir), { recursive: true });
  }
}

console.log('5/5 실행 파일 만들기');
const outFile = join(OUT, 'rewind-' + target + (exe ? '.exe' : ''));
rmSync(outFile, { force: true });
copyFileSync(nodeBin, outFile);
if (!exe) chmodSync(outFile, 0o755);
const args = [join(ROOT, 'node_modules/postject/dist/cli.js'), outFile, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (osName === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, args);
if (osName === 'darwin' && process.platform === 'darwin') run('codesign', ['--sign', '-', outFile]);
console.log('\n완성: ' + relative(ROOT, outFile) + ' (' + (statSync(outFile).size / 1048576).toFixed(0) + 'MB)');
