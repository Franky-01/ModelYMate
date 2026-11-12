import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fmt, time, day} from '../src/core.mjs';

test('reused numeric formatters preserve rounding, coercion and invalid-input behavior', () => {
  const values = [0, -0, -12.3456, 1.005, 9999999.999, 1e-12, 1e21];
  const precisions = [undefined, 0, 1, 2, 6, 20, 21, 100, '2', null, true, 2.9, NaN, -1, Infinity, 101];
  for (const digits of precisions) {
    for (const value of values) {
      let expected, error;
      try { expected = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: digits === undefined ? 1 : digits}).format(value); }
      catch (e) { error = e; }
      if (error) assert.throws(() => fmt(value, digits), {name: error.name});
      else assert.equal(fmt(value, digits), expected);
    }
  }
  for (const value of [null, undefined, '', '0', true, NaN, Infinity, -Infinity]) {
    assert.equal(fmt(value), '—');
    assert.equal(fmt(value, -1), '—', 'invalid values do not start precision validation');
  }
});

test('date display keeps missing-value behavior', () => {
  for (const value of [null, undefined, '', 'not a date', 0, new Date()]) {
    assert.equal(time(value), '—');
    assert.equal(day(value), '日期未知');
  }
});

test('cached date display follows timezone changes, DST and leap days without changing labels', () => {
  // An isolated process changes its own time zone so other date tests are unaffected.
  const moduleURL = new URL('../src/core.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import {time,day} from ${JSON.stringify(moduleURL)};
    const samples=['2026-11-12T16:00:00Z','2026-03-08T06:59:00Z','2026-03-08T07:01:00Z','2026-11-01T05:59:00Z','2026-11-01T06:01:00Z','2024-02-29T12:00:00Z','0000-02-29T12:00:00Z','0099-12-31T23:59:00Z'];
    for(const zone of ['Asia/Shanghai','America/New_York','Asia/Kathmandu','Pacific/Honolulu','UTC']){
      process.env.TZ=zone;
      for(const value of samples){
        const d=new Date(value);
        assert.equal(time(value),d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),zone+' time '+value);
        assert.equal(day(value),d.toLocaleDateString('zh-CN',{month:'short',day:'numeric'}),zone+' day '+value);
      }
    }
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {encoding:'utf8', windowsHide:true});
});
