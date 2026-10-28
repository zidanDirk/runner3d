import { describe, expect, it } from 'vitest';
import { isAllowedServiceHost, parseRegionEndpoints, RegionEndpointError } from '../../scripts/release/kodo-endpoints.mjs';

const valid = () => ({ hosts: [{ region: 'z2', up: { domains: ['up-z2.qiniup.com', 'up-z2.qbox.me'] }, rs: { domains: ['rs-z2.qiniuapi.com', 'rs-z2.qbox.me'] }, rsf: { domains: ['rsf-z2.qiniuapi.com', 'rsf-z2.qbox.me'] } }] });
function rejected(value: unknown): RegionEndpointError {
  let caught: unknown;
  try { parseRegionEndpoints(value); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(RegionEndpointError);
  if (!(caught instanceof RegionEndpointError)) throw new Error('Expected a safe Region endpoint error');
  return caught;
}

describe('one shared Kodo Region endpoint allowlist', () => {
  it.each([
    ['up', 'up.qiniup.com'], ['up', 'upload.qiniup.com'], ['up', 'up-z2.qiniup.com'], ['up', 'upload-z2.qiniup.com'], ['up', 'up-z2.qbox.me'],
    ['rs', 'rs.qiniuapi.com'], ['rs', 'rs-z2.qiniuapi.com'], ['rs', 'rs.qiniu.com'], ['rs', 'rs-z0.qbox.me'], ['rs', 'rs-z2.qbox.me'],
    ['rsf', 'rsf.qiniuapi.com'], ['rsf', 'rsf-z2.qiniuapi.com'], ['rsf', 'rsf.qiniu.com'], ['rsf', 'rsf-z0.qbox.me'], ['rsf', 'rsf-z2.qbox.me'],
  ] as const)('accepts the confirmed %s service host %s', (service, host) => {
    expect(isAllowedServiceHost(service, host)).toBe(true);
  });

  it('preserves every confirmed primary/backup in order and adds HTTPS exactly once', () => {
    expect(parseRegionEndpoints(valid())).toEqual({
      up: ['https://up-z2.qiniup.com', 'https://up-z2.qbox.me'],
      rs: ['https://rs-z2.qiniuapi.com', 'https://rs-z2.qbox.me'],
      rsf: ['https://rsf-z2.qiniuapi.com', 'https://rsf-z2.qbox.me'],
    });
  });

  it.each(['z0', 'cn-east-2', 'z1', 'z2', 'na0', 'as0', 'ap-southeast-2', 'ap-southeast-3'])('permits the SDK-confirmed qbox region suffix %s only for its service', region => {
    expect(isAllowedServiceHost('rs', `rs-${region}.qbox.me`)).toBe(true);
    expect(isAllowedServiceHost('rsf', `rsf-${region}.qbox.me`)).toBe(true);
    expect(isAllowedServiceHost('up', `rs-${region}.qbox.me`)).toBe(false);
  });

  it('reads the SDK domains structure while ignoring unused acceleration, io, s3 and TTL metadata', () => {
    const row = valid().hosts[0]!;
    const payload = { hosts: [{ ...row, ttl: 86400, up: { ...row.up, acc_domains: ['unused-acceleration.invalid'] }, io: { domains: ['unused-io.invalid'] }, s3: { domains: ['unused-s3.invalid'] } }, { unused: true }] };
    expect(parseRegionEndpoints(payload)).toEqual(parseRegionEndpoints(valid()));
  });

  it.each([
    'attacker.invalid', 'rs-z2.qbox.me.attacker.invalid', 'evilrs-z2.qbox.me',
    'http://rs-z2.qbox.me', 'https://rs-z2.qbox.me', 'rs-z2.qbox.me:443', 'rs-z2.qbox.me:80',
    'user@rs-z2.qbox.me', 'rs-z2.qbox.me@attacker.invalid', 'rs-z2.qbox.me/', 'rs-z2.qbox.me?token=synthetic', 'rs-z2.qbox.me#fragment',
    ' rs-z2.qbox.me', 'rs-z2.qbox.me ', 'rs-z2.qbox.me.', 'rs-z2.qbox.me\nAuthorization: synthetic',
    'rs-z2.qbox.me\0', 'rs-z2.qbox.me%2F.attacker.invalid', 'рs-z2.qbox.me', 'rsf-z2.qbox.me',
    '', `rs-${'z'.repeat(250)}.qbox.me`, null, 42, {}, [],
  ])('rejects an unsafe or wrong-service rs host without URL coercion: %j', host => {
    expect(isAllowedServiceHost('rs', host)).toBe(false);
  });

  it('does not make qbox.me a general-purpose domain wildcard', () => {
    for (const host of ['qbox.me', 'example.qbox.me', 'api.qbox.me', 'uc.qbox.me', 'rs.qbox.me', 'rsf.qbox.me', 'rs-unknown.qbox.me', 'rsf-unknown.qbox.me', 'rs-z2.qbox.me.attacker.invalid']) {
      for (const service of ['up', 'rs', 'rsf'] as const) expect(isAllowedServiceHost(service, host)).toBe(false);
    }
  });

  it.each([undefined, null, [], {}, { hosts: [] }, { hosts: [null] }])('rejects invalid Region structure %j with no raw response data', input => {
    expect(rejected(input).failure).toEqual({ service: 'region', category: 'INVALID_REGION_STRUCTURE', domainClass: 'not-a-host' });
  });

  it.each([
    [null, 'INVALID_DOMAINS'], [[], 'EMPTY_DOMAINS'], ['rs-z2.qbox.me', 'INVALID_DOMAINS'],
    [Array.from({ length: 17 }, () => 'rs-z2.qbox.me'), 'TOO_MANY_DOMAINS'],
  ] as const)('classifies invalid rs domain collections without echoing them: %j', (domains, category) => {
    const value = valid(); Object.assign(value.hosts[0]!.rs, { domains });
    expect(rejected(value).failure).toEqual({ service: 'rs', category, domainClass: 'not-a-host' });
  });

  it.each([
    [null, 'NON_STRING_HOST', 'not-a-host'],
    ['http://rs-z2.qbox.me', 'URL_SCHEME', 'not-a-host'],
    ['https://rs-z2.qbox.me', 'URL_SCHEME', 'not-a-host'],
    ['user@rs-z2.qbox.me', 'CREDENTIALS', 'not-a-host'],
    ['rs-z2.qbox.me:443', 'PORT', 'not-a-host'],
    [' rs-z2.qbox.me', 'INVALID_HOST_SYNTAX', 'not-a-host'],
    ['rs-z2.qbox.me\nAuthorization: do-not-print', 'INVALID_HOST_SYNTAX', 'not-a-host'],
    [`rs-${'z'.repeat(250)}.qbox.me`, 'INVALID_HOST_SYNTAX', 'not-a-host'],
    ['rsf-z2.qbox.me', 'WRONG_SERVICE', 'qbox.me'],
    ['rs-z2.qbox.me.attacker.invalid', 'UNRECOGNIZED_DOMAIN', 'other'],
    ['rs-unknown.qbox.me', 'UNRECOGNIZED_DOMAIN', 'qbox.me'],
  ] as const)('provides a bounded rs failure category without exposing host text: %j', (host, category, domainClass) => {
    const value = valid(); Object.assign(value.hosts[0]!.rs, { domains: [host] });
    const error = rejected(value);
    expect(error.code).toBe('INVALID_REGION_ENDPOINT');
    expect(error.failure).toEqual({ service: 'rs', category, domainClass, index: 0 });
    if (typeof host === 'string') { expect(JSON.stringify(error)).not.toContain(host); expect(String(error)).not.toContain(host); }
  });

  it.each(['up', 'rs', 'rsf'] as const)('never ignores an unsafe %s backup behind a safe primary', service => {
    const value = valid(); value.hosts[0]![service].domains.push('credential-bearing-attacker.invalid');
    const error = rejected(value);
    expect(error.failure).toEqual({ service, category: 'UNRECOGNIZED_DOMAIN', domainClass: 'other', index: 2 });
    expect(JSON.stringify(error)).not.toContain('credential-bearing-attacker.invalid');
  });

  it('does not attach the Region response or secret-like domain text to errors', () => {
    const value = valid(); value.hosts[0]!.rs.domains.push('synthetic-secret-ak:synthetic-secret-sk@attacker.invalid');
    const error = rejected(value), output = JSON.stringify(error) + String(error);
    expect(error.failure).toEqual({ service: 'rs', category: 'CREDENTIALS', domainClass: 'not-a-host', index: 2 });
    for (const raw of ['synthetic-secret-ak', 'synthetic-secret-sk', 'attacker.invalid', 'hosts', 'domains']) expect(output).not.toContain(raw);
  });
});
