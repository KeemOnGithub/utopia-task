import {it,expect} from 'vitest';
import {formatTimestamp} from './format';
it('formats exact English KL time across UTC day rollover',()=>{expect(formatTimestamp('2026-10-23T20:19:00.000Z')).toBe('24 Oct 2026, 04:19 MYT');});
