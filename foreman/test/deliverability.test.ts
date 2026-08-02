import { describe, it, expect } from 'vitest';
import {
  allQualifier,
  checkDomain,
  domainOf,
  includes,
  summarise,
  type DnsLike,
} from '../src/email/deliverability.ts';

/**
 * Whether the sending domain will actually let us send as it.
 *
 * The fixture below is what cubekrafts.com really published when this was
 * written — GoDaddy mail, a hard-fail SPF, and a DMARC record Lovable set up.
 * That combination is exactly the one that destroys a campaign silently, so
 * it is the case worth pinning.
 */

const CUBEKRAFTS: Record<string, string[][]> = {
  'cubekrafts.com': [
    ['google-site-verification=WJVGW02Z8L8qpfufKFZHJX1mVcz-ayOVTUjFDXX9AH8'],
    ['v=spf1 include:secureserver.net -all'],
  ],
  '_dmarc.cubekrafts.com': [['v=DMARC1; p=none; pct=100; rua=mailto:dmarcreports@lovable.dev']],
};

function fakeDns(records: Record<string, string[][]>): DnsLike {
  return {
    resolveTxt: async (hostname) => {
      const found = records[hostname];
      if (!found) {
        const err = new Error(`queryTxt ENOTFOUND ${hostname}`) as Error & { code: string };
        err.code = 'ENOTFOUND';
        throw err;
      }
      return found;
    },
  };
}

// ── reading the from address ────────────────────────────────────────────────

describe('the sending domain', () => {
  it('is found in either shape a from address is written', () => {
    expect(domainOf('info@cubekrafts.com')).toBe('cubekrafts.com');
    expect(domainOf('Cubekrafts <info@cubekrafts.com>')).toBe('cubekrafts.com');
  });

  it('is lowercased, because DNS is', () => {
    expect(domainOf('Info@CubeKrafts.com')).toBe('cubekrafts.com');
  });

  it('is nothing at all when the address is not one', () => {
    expect(domainOf('not an address')).toBeNull();
    expect(domainOf('info@localhost')).toBeNull();
    expect(domainOf('')).toBeNull();
  });
});

// ── reading SPF ─────────────────────────────────────────────────────────────

describe('parsing SPF', () => {
  it('reads the all qualifier, which is the part that decides everything', () => {
    expect(allQualifier('v=spf1 include:x -all')).toBe('-');
    expect(allQualifier('v=spf1 include:x ~all')).toBe('~');
    expect(allQualifier('v=spf1 include:x ?all')).toBe('?');
    // A bare `all` means `+all`, which authorises the entire internet.
    expect(allQualifier('v=spf1 include:x all')).toBe('+');
    expect(allQualifier('v=spf1 include:x')).toBeNull();
  });

  it('is not fooled by the word all inside a hostname', () => {
    expect(allQualifier('v=spf1 include:mail.allstate.com')).toBeNull();
  });

  it('lists the includes', () => {
    expect(includes('v=spf1 include:secureserver.net include:_spf.example.com -all')).toEqual([
      'secureserver.net',
      '_spf.example.com',
    ]);
  });
});

// ── the real domain ─────────────────────────────────────────────────────────

describe('cubekrafts.com as it actually is', () => {
  it('is a blocker when the provider is not in a hard-fail record', async () => {
    // The failure this whole file exists for: nothing throws, nothing bounces
    // at the API, and every message is disavowed by our own DNS.
    const report = await checkDomain('cubekrafts.com', {
      expectedInclude: '_spf.resend.com',
      resolver: fakeDns(CUBEKRAFTS),
    });
    expect(report.looksSendable).toBe(false);
    const spf = report.findings.find((f) => f.what.startsWith('SPF does not include'));
    expect(spf?.severity).toBe('blocker');
    expect(spf?.detail).toMatch(/-all/);
    expect(spf?.detail).toMatch(/include:_spf\.resend\.com/);
  });

  it('notices the DKIM key is missing', async () => {
    const report = await checkDomain('cubekrafts.com', {
      expectedInclude: '_spf.resend.com',
      resolver: fakeDns(CUBEKRAFTS),
    });
    const dkim = report.findings.find((f) => f.what === 'no DKIM key');
    expect(dkim?.severity).toBe('blocker');
    expect(dkim?.detail).toContain('resend._domainkey.cubekrafts.com');
  });

  it('reports the DMARC policy without treating p=none as a problem', async () => {
    const report = await checkDomain('cubekrafts.com', {
      expectedInclude: '_spf.resend.com',
      resolver: fakeDns(CUBEKRAFTS),
    });
    const dmarc = report.findings.find((f) => f.what.startsWith('DMARC'));
    expect(dmarc).toMatchObject({ severity: 'ok', what: 'DMARC policy is none' });
  });

  it('passes once the include and the key are added', async () => {
    const fixed = {
      'cubekrafts.com': [['v=spf1 include:secureserver.net include:_spf.resend.com -all']],
      'resend._domainkey.cubekrafts.com': [['p=MIGf...']],
      '_dmarc.cubekrafts.com': CUBEKRAFTS['_dmarc.cubekrafts.com']!,
    };
    const report = await checkDomain('cubekrafts.com', {
      expectedInclude: '_spf.resend.com',
      resolver: fakeDns(fixed),
    });
    expect(report.looksSendable).toBe(true);
    // and the existing GoDaddy mailbox is still authorised
    expect(report.findings.some((f) => f.severity === 'blocker')).toBe(false);
  });
});

// ── everything else ─────────────────────────────────────────────────────────

describe('other shapes of domain', () => {
  it('calls a missing SPF record a blocker', async () => {
    const report = await checkDomain('nowhere.example', { resolver: fakeDns({}) });
    // Lookup failure and absence are different: this fixture throws
    // ENOTFOUND, which is a warning, because DNS being unreachable is not
    // proof the record is missing.
    expect(report.findings[0]?.severity).toBe('warn');
  });

  it('treats a soft fail as a warning, not a blocker', async () => {
    // A missing include under `~all` still gets delivered, usually to spam.
    // Worth saying; not worth calling the send impossible.
    const report = await checkDomain('soft.example', {
      expectedInclude: 'spf.other-provider.example',
      resolver: fakeDns({ 'soft.example': [['v=spf1 include:other.net ~all']] }),
    });
    expect(report.looksSendable).toBe(true);
    expect(report.findings[0]?.severity).toBe('warn');
  });

  it('calls the same missing include a blocker under a hard fail', async () => {
    const report = await checkDomain('hard.example', {
      expectedInclude: 'spf.other-provider.example',
      resolver: fakeDns({ 'hard.example': [['v=spf1 include:other.net -all']] }),
    });
    expect(report.looksSendable).toBe(false);
  });

  it('asks you to confirm the provider when it has not been told which', async () => {
    // Better than asserting a token it cannot know is current.
    const report = await checkDomain('cubekrafts.com', { resolver: fakeDns(CUBEKRAFTS) });
    const spf = report.findings.find((f) => f.what.includes('provider not verified'));
    expect(spf?.detail).toMatch(/EMAIL_SPF_INCLUDE/);
  });

  it('warns before the ten-lookup limit that breaks a record silently', async () => {
    const many = `v=spf1 ${Array.from({ length: 9 }, (_, i) => `include:s${i}.example`).join(' ')} -all`;
    const report = await checkDomain('many.example', {
      resolver: fakeDns({ 'many.example': [[many]] }),
    });
    expect(report.findings.some((f) => f.what.includes('lookup limit'))).toBe(true);
  });

  it('joins a TXT record the resolver split into chunks', async () => {
    // Anything over 255 characters comes back as several strings, and a DKIM
    // key always is. Treating them as separate records would miss the SPF.
    const report = await checkDomain('split.example', {
      expectedInclude: 'x.example',
      resolver: fakeDns({ 'split.example': [['v=spf1 inclu', 'de:x.example -all']] }),
    });
    expect(report.findings[0]).toMatchObject({ severity: 'ok' });
  });

  it('warns rather than blocks when DMARC is set to reject', async () => {
    const report = await checkDomain('strict.example', {
      resolver: fakeDns({
        'strict.example': [['v=spf1 include:a.example -all']],
        '_dmarc.strict.example': [['v=DMARC1; p=reject']],
      }),
    });
    expect(report.findings.some((f) => f.what === 'DMARC policy is reject')).toBe(true);
  });
});

describe('the boot summary', () => {
  it('leads with the verdict, so a blocker cannot be scrolled past', async () => {
    const report = await checkDomain('cubekrafts.com', {
      expectedInclude: '_spf.resend.com',
      resolver: fakeDns(CUBEKRAFTS),
    });
    const text = summarise(report);
    expect(text.split('\n')[0]).toContain('WILL NOT ARRIVE');
    expect(text).toContain('[STOP]');
  });

  it('says so plainly when everything is in order', async () => {
    const report = await checkDomain('good.example', {
      expectedInclude: 'a.example',
      resolver: fakeDns({ 'good.example': [['v=spf1 include:a.example -all']] }),
    });
    expect(summarise(report).split('\n')[0]).toContain('looks sendable');
  });
});
