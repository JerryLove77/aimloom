import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const cli = fileURLToPath(new URL('../cli/generate.ts', import.meta.url));
const green = '0;s;1;P;c;1;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aimloom-crosshair-cli-')); });
afterEach(async () => { await rm(directory, {recursive:true,force:true}); });
function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args],
    { cwd: repo, encoding: 'utf8', timeout: 10000 });
}

describe('local crosshair CLI', () => {
  it('generates a transparent green PNG from an external code', async () => {
    const output = join(directory, 'green.png');
    const result = run('--code', green, '--output', output);
    expect(result.status, result.stderr).toBe(0);
    const png = PNG.sync.read(await readFile(output));
    expect([png.width,png.height]).toEqual([128,128]);
    expect([...png.data.subarray(0,4)]).toEqual([0,0,0,0]);
    expect([...png.data.subarray((63*128+66)*4, (63*128+66)*4+4)]).toEqual([0,255,0,255]);
    expect(result.stdout).toContain('128');
  });

  it('generates SVG using the same raster canvas', async () => {
    const output = join(directory, 'green.svg');
    expect(run('--code',green,'--size','64','--scale','2','--output',output).status).toBe(0);
    const svg = await readFile(output,'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/width="64"/);
    expect(svg).not.toContain('<script');
  });

  it('imports an actual PNG and preserves pixels without editing the source', async () => {
    const source = join(directory,'input.png'), output=join(directory,'copy.png');
    const png = new PNG({width:1,height:1});
    png.data = Buffer.from([30,60,90,120]);
    const original = PNG.sync.write(png);
    await writeFile(source,original);
    const result = run('--input',source,'--output',output);
    expect(result.status,result.stderr).toBe(0);
    expect([...PNG.sync.read(await readFile(output)).data]).toEqual([30,60,90,120]);
    expect(await readFile(source)).toEqual(original);
  });

  it('refuses to overwrite any existing output', async () => {
    const output=join(directory,'keep.png');
    await writeFile(output,'original user data');
    const result=run('--code',green,'--output',output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OUTPUT_EXISTS');
    expect(await readFile(output,'utf8')).toBe('original user data');
  });

  it.each([
    ['--code','invalid'],
    ['--code',green,'--scale','NaN'],
    ['--code',green,'--size','100000000'],
    ['--code',green,'--profile','sniper'],
    ['--code',green,'--input','file.png'],
    ['--code',green,'--unknown','1'],
    ['--code',green,'--code',green],
  ])('rejects invalid arguments/input without creating output (%j)', async (...args) => {
    const output=join(directory,'absent.png');
    const result=run(...args,'--output',output);
    expect(result.status).not.toBe(0);
    await expect(access(output)).rejects.toThrow();
  });

  it('does not silently resize imported PNGs', async () => {
    const source=join(directory,'input.png'), output=join(directory,'absent.png');
    const png=new PNG({width:1,height:1});
    await writeFile(source,PNG.sync.write(png));
    const result=run('--input',source,'--size','128','--output',output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('INVALID_VALUE');
    await expect(access(output)).rejects.toThrow();
  });

  it('prints help without requesting input or creating files', () => {
    const result=run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--code');
    expect(result.stdout).toContain('--input');
  });
});
