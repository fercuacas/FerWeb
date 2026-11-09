const assert = require('node:assert/strict');
const fs = require('node:fs');

switch (process.argv[2]) {
  case 'guard': {
    const workflow = '.github/workflows/p12.yml';
    const original = fs.readFileSync(workflow, 'utf8');
    const denied = (error) => ['EACCES', 'EPERM', 'EROFS'].includes(error.code);
    assert.throws(() => fs.writeFileSync(workflow, 'modified'), denied);
    assert.throws(() => fs.chmodSync(workflow, 0o666), denied);
    assert.throws(() => fs.renameSync('.github', 'moved-workflows'), denied);
    assert.throws(() => fs.writeFileSync('.github/new.yml', 'new'), denied);
    assert.throws(() => fs.writeFileSync('.codex/hooks.json', '{}'), denied);
    assert.throws(() => fs.unlinkSync('.npmrc'), denied);
    fs.symlinkSync('/workspace/.github', 'p12-alias');
    try {
      assert.throws(() => fs.writeFileSync('p12-alias/workflows/p12.yml', 'modified'), denied);
    } finally {
      fs.unlinkSync('p12-alias');
    }
    assert.equal(fs.readFileSync(workflow, 'utf8'), original);
    assert.equal(fs.existsSync('moved-workflows'), false);
    console.log('P12_DENIAL_CONFIRMED');
    break;
  }
  case 'alias':
    fs.mkdirSync('.GITHUB/workflows', { recursive: true });
    fs.writeFileSync('.GITHUB/workflows/alias.yml', 'name: blocked alias\n');
    break;
  case 'empty':
    fs.writeFileSync('tests/add.test.cjs', "require('node:test').skip('disabled', () => {});\n");
    break;
  case 'slow':
    fs.writeFileSync(
      'tests/add.test.cjs',
      "require('node:test')('slow', () => new Promise(() => setInterval(() => {}, 1000)));\n",
    );
    break;
  default:
    process.exitCode = 1;
}
