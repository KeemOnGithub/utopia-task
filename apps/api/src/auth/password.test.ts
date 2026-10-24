import { describe,it,expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { hashPassword,verifyPassword,validPassword,needsRehash,dummyHash } from './password.js';
import { normalizeEmail,loginCredentials } from './validation.js';
import { generateToken,hashToken,validToken } from './session.js';
import { canonicalIp } from './rate-limit.js';
describe('password and credential policy',()=>{
  it('counts Unicode code points, accepts whitespace and rejects malformed surrogates',()=>{
    expect(validPassword('😀'.repeat(8))).toBe(true);expect(validPassword(' '.repeat(8))).toBe(true);
    expect(validPassword('😀'.repeat(128))).toBe(true);expect(validPassword('😀'.repeat(129))).toBe(false);
    expect(validPassword('1234567')).toBe(false);expect(validPassword('12345678\uD800')).toBe(false);expect(validPassword('\uDC0012345678')).toBe(false);
  });
  it('hashes and verifies with the approved Argon2id policy',async()=>{
    const start=performance.now();const hash=await hashPassword('  demo password 😀  ');const elapsed=performance.now()-start;
    console.info(`Argon2id 64MiB/t3/p1 hash benchmark: ${Math.round(elapsed)}ms`);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);expect(needsRehash(hash)).toBe(false);
    expect(await verifyPassword(hash,'  demo password 😀  ')).toBe(true);expect(await verifyPassword(hash,'demo password 😀')).toBe(false);
    expect(await verifyPassword(dummyHash,'not the dummy password')).toBe(false);
  });
  it('normalizes email without provider rewrites and rejects unknown fields',()=>{
    expect(normalizeEmail(' DEMO+tag@Example.TEST ')).toBe('demo+tag@example.test');expect(normalizeEmail('é@example.test')).toBe(null);
    expect(normalizeEmail('a..b@example.test')).toBe(null);expect(normalizeEmail('.a@example.test')).toBe(null);expect(normalizeEmail(`${'a'.repeat(65)}@example.test`)).toBe(null);
    expect(()=>loginCredentials({email:'a@example.test',password:'password',role:'admin'})).toThrow();
  });
  it('generates opaque canonical session tokens and hashes only raw tokens',()=>{
    const token=generateToken();expect(token).toHaveLength(43);expect(validToken(token)).toBe(true);expect(hashToken(token)).toHaveLength(32);
    expect(validToken(token+'=')).toBe(false);expect(validToken('x'.repeat(43))).toBe(false);
  });
  it('canonicalizes mapped IPv4 and equivalent IPv6',()=>{
    expect(canonicalIp('::ffff:192.0.2.1')).toBe(canonicalIp('192.0.2.1'));
    expect(canonicalIp('2001:db8::1')).toBe(canonicalIp('2001:0db8:0:0:0:0:0:1'));
  });
  it('rejects excess concurrent password work without queueing',async()=>{
    const active=Array.from({length:4},()=>verifyPassword(dummyHash,'synthetic password'));
    await expect(verifyPassword(dummyHash,'synthetic password')).rejects.toMatchObject({status:503,code:'SERVICE_UNAVAILABLE'});
    expect(await Promise.all(active)).toEqual([false,false,false,false]);
  });
});
