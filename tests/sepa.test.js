const { describe, it } = require('node:test');
const assert = require('node:assert');
const SEPA = require('../sepa.min.js');
const BLZ_BIC = require('../blz-bic.js');   // Offizielle BLZ->BIC Tabelle (Bundesbank)

// Spiegelt sepaText()/sepaId()/convertForSepa() aus sepa-generator.js: wandelt
// Freitext bzw. Referenzen in den SEPA-Zeichensatz um und kuerzt NUR, wenn
// erst die Umwandlung das Feld ueberlaufen laesst. War die Eingabe schon zu
// lang, bleibt sie zu lang, damit die Laengenpruefung der Library anschlaegt
// statt still abzuschneiden. painFormat bestimmt den Zeichensatz (AT: Umlaute
// bleiben erhalten); Referenzen bleiben immer im Basiszeichensatz.
function convertForSepa(value, maxLen, convert) {
  const original = (value === null || value === undefined ? '' : String(value)).trim();
  const converted = convert(original);
  if (original.length <= maxLen && converted.length > maxLen) {
    return convert(original, maxLen);
  }
  return converted;
}
function sepaText(value, maxLen, painFormat) {
  return convertForSepa(value, maxLen, (s, n) => SEPA.toSepaText(s, n, painFormat));
}
function sepaId(value, maxLen) {
  return convertForSepa(value, maxLen, SEPA.toSepaId);
}

// Spiegelt deriveBIC() aus sepa-generator.js: leitet den BIC aus einer
// deutschen IBAN ab (BLZ = Stellen 5-12), sonst '' (NOTPROVIDED-Fallback greift).
function deriveBIC(iban) {
  const clean = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^DE\d{20}$/.test(clean)) return '';
  return BLZ_BIC[clean.substr(4, 8)] || '';
}

// ---------------------------------------------------------------------------
// Valid test data – IBANs pass the mod-97 checksum used by the library.
// All data is fictional but structurally correct.
// ---------------------------------------------------------------------------

const TEST_DATA = {
  creditor: {
    name: 'Muster GmbH',
    iban: 'DE89370400440532013000',
    bic:  'COBADEFFXXX',
    id:   'DE98ZZZ09999999999',      // valid creditor-ID checksum
  },
  debtor: {
    name: 'Max Mustermann',
    iban: 'DE89370400440532013000',
    bic:  'COBADEFFXXX',
  },
  // Additional accounts for multi-transaction tests
  accounts: [
    { name: 'Anna Schmidt',    iban: 'DE75512108001245126199', bic: 'SOLADEST600' },
    { name: 'Bernd Weber',     iban: 'DE27100777770209299700', bic: 'DEUTDEFF'    },
    { name: 'Clara Fischer',   iban: 'DE02120300000000202051', bic: ''            },
  ],
};

// Sequence types and local instrumentations to iterate over
const SEQUENCE_TYPES        = ['FRST', 'RCUR', 'OOFF', 'FNAL'];
// COR1 ("Eil-Lastschrift") fehlt hier bewusst: zum 21.11.2016 abgeschafft,
// CORE hat die verkuerzte Vorlaufzeit uebernommen. Siehe Suite "Lastschrift-Art".
const LOCAL_INSTRUMENTATIONS = ['CORE', 'B2B'];

// All supported pain formats grouped by type – inkl. der oesterreichischen
// PSA-Profile, damit jede Format-Suite sie automatisch mitprueft.
const AT_CT_FORMAT = 'pain.001.001.09.austrian.005';
const AT_DD_FORMAT = 'pain.008.001.08.austrian.004';
const DD_FORMATS  = ['pain.008.001.02', 'pain.008.001.08', AT_DD_FORMAT];
const CT_FORMATS  = ['pain.001.001.03', 'pain.001.001.08', 'pain.001.001.09', AT_CT_FORMAT];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDirectDebitDoc(painFormat, opts = {}) {
  const {
    sequenceType = 'RCUR',
    localInstrumentation = 'CORE',
    transactions = [TEST_DATA.accounts[0]],
  } = opts;

  const doc = new SEPA.Document(painFormat);
  doc.grpHdr.id = 'MSG-TEST-001';
  doc.grpHdr.created = new Date('2026-01-15T10:00:00Z');
  doc.grpHdr.initiatorName = TEST_DATA.creditor.name;

  const info = doc.createPaymentInfo();
  info.collectionDate = new Date('2026-02-01');
  info.creditorName = TEST_DATA.creditor.name;
  info.creditorIBAN = TEST_DATA.creditor.iban;
  info.creditorBIC = TEST_DATA.creditor.bic;
  info.creditorId = TEST_DATA.creditor.id;
  info.sequenceType = sequenceType;
  info.localInstrumentation = localInstrumentation;

  for (const t of transactions) {
    const txn = info.createTransaction();
    txn.debtorName = t.name;
    txn.debtorIBAN = t.iban;
    txn.debtorBIC  = t.bic || '';
    txn.amount     = t.amount || 49.99;
    txn.mandateId  = t.mandateId || 'MAND-001';
    txn.mandateSignatureDate = t.mandateSignatureDate || new Date('2025-06-15');
    txn.remittanceInfo = t.remittanceInfo || 'Beitrag Januar 2026';
    info.addTransaction(txn);
  }

  doc.addPaymentInfo(info);
  return doc;
}

function createTransferDoc(painFormat, opts = {}) {
  const { transactions = [TEST_DATA.accounts[0]] } = opts;

  const doc = new SEPA.Document(painFormat);
  doc.grpHdr.id = 'MSG-TEST-002';
  doc.grpHdr.created = new Date('2026-01-15T10:00:00Z');
  doc.grpHdr.initiatorName = TEST_DATA.debtor.name;

  const info = doc.createPaymentInfo();
  info.requestedExecutionDate = new Date('2026-02-01');
  info.debtorName = TEST_DATA.debtor.name;
  info.debtorIBAN = TEST_DATA.debtor.iban;
  info.debtorBIC  = TEST_DATA.debtor.bic;

  for (const t of transactions) {
    const txn = info.createTransaction();
    txn.creditorName = t.name;
    txn.creditorIBAN = t.iban;
    txn.creditorBIC  = t.bic || '';
    txn.amount       = t.amount || 1500.00;
    txn.remittanceInfo = t.remittanceInfo || 'Gehalt Januar 2026';
    txn.end2endId    = t.end2endId || 'NOTPROVIDED';
    info.addTransaction(txn);
  }

  doc.addPaymentInfo(info);
  return doc;
}

function assertValidXML(xml, painFormat) {
  // Basic structural checks every SEPA XML must pass
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Missing XML declaration');
  // PSA-Profile nutzen den Namespace ihres ISO-Basisformats
  assert.ok(xml.includes(`xmlns="urn:iso:std:iso:20022:tech:xsd:${SEPA.basePainFormat(painFormat)}"`), `Missing namespace for ${painFormat}`);
  assert.ok(xml.includes('<GrpHdr>'), 'Missing GrpHdr element');
  assert.ok(xml.includes('<MsgId>'), 'Missing MsgId element');
  assert.ok(xml.includes('<CreDtTm>'), 'Missing CreDtTm element');
  assert.ok(xml.includes('<NbOfTxs>'), 'Missing NbOfTxs element');
  assert.ok(xml.includes('<CtrlSum>'), 'Missing CtrlSum element');
  assert.ok(xml.includes('<InitgPty>'), 'Missing InitgPty element');
  assert.ok(xml.includes('<PmtInf>'), 'Missing PmtInf element');
}

// =========================================================================
// TEST SUITES
// =========================================================================

// -------------------------------------------------------------------------
// 1. Direct Debit × pain format combinations
// -------------------------------------------------------------------------

describe('Lastschrift (Direct Debit)', () => {
  for (const fmt of DD_FORMATS) {
    describe(`Format ${fmt}`, () => {

      it('generiert valides XML mit einer Transaktion', () => {
        const doc = createDirectDebitDoc(fmt);
        const xml = doc.toString();
        assertValidXML(xml, fmt);
        assert.ok(xml.includes('<CstmrDrctDbtInitn>'), 'Missing root element');
        assert.ok(xml.includes('<PmtMtd>DD</PmtMtd>'), 'Wrong payment method');
        assert.ok(xml.includes('<NbOfTxs>1</NbOfTxs>'), 'Wrong transaction count');
        assert.ok(xml.includes('Anna Schmidt'), 'Missing debtor name');
        assert.ok(xml.includes('DE75512108001245126199'), 'Missing debtor IBAN');
        assert.ok(xml.includes('<MndtId>MAND-001</MndtId>'), 'Missing mandate ID');
      });

      it('generiert valides XML mit mehreren Transaktionen', () => {
        const doc = createDirectDebitDoc(fmt, {
          transactions: TEST_DATA.accounts.map((a, i) => ({
            ...a,
            amount: (i + 1) * 25.50,
            mandateId: `MAND-${i + 1}`,
          })),
        });
        const xml = doc.toString();
        assertValidXML(xml, fmt);
        assert.ok(xml.includes('<NbOfTxs>3</NbOfTxs>'), 'Wrong transaction count');
        // Control sum = 25.50 + 51.00 + 76.50 = 153.00
        assert.ok(xml.includes('<CtrlSum>153.00</CtrlSum>'), 'Wrong control sum');
        for (const a of TEST_DATA.accounts) {
          assert.ok(xml.includes(a.name), `Missing debtor ${a.name}`);
        }
      });

      // Test all sequence types
      for (const seq of SEQUENCE_TYPES) {
        it(`funktioniert mit Sequenztyp ${seq}`, () => {
          const doc = createDirectDebitDoc(fmt, { sequenceType: seq });
          const xml = doc.toString();
          assertValidXML(xml, fmt);
          assert.ok(xml.includes(`<SeqTp>${seq}</SeqTp>`), `Missing sequence type ${seq}`);
        });
      }

      // Test all local instrumentations
      for (const instr of LOCAL_INSTRUMENTATIONS) {
        it(`funktioniert mit Instrumentierung ${instr}`, () => {
          const doc = createDirectDebitDoc(fmt, { localInstrumentation: instr });
          const xml = doc.toString();
          assertValidXML(xml, fmt);
          assert.ok(xml.includes(`<Cd>${instr}</Cd>`), `Missing instrumentation ${instr}`);
        });
      }

      it('verwendet NOTPROVIDED wenn kein BIC angegeben', () => {
        const doc = createDirectDebitDoc(fmt, {
          transactions: [{ ...TEST_DATA.accounts[2], bic: '' }],
        });
        const xml = doc.toString();
        assertValidXML(xml, fmt);
        assert.ok(xml.includes('NOTPROVIDED'), 'Missing NOTPROVIDED fallback for empty BIC');
      });

      it('enthält korrekte Gläubiger-ID', () => {
        const doc = createDirectDebitDoc(fmt);
        const xml = doc.toString();
        assert.ok(xml.includes(TEST_DATA.creditor.id), 'Missing creditor ID');
        assert.ok(xml.includes('<Prtry>SEPA</Prtry>'), 'Missing SEPA scheme');
      });

      it('enthält korrektes Mandatsdatum', () => {
        const doc = createDirectDebitDoc(fmt, {
          transactions: [{
            ...TEST_DATA.accounts[0],
            mandateSignatureDate: new Date('2025-03-20'),
          }],
        });
        const xml = doc.toString();
        assert.ok(xml.includes('<DtOfSgntr>2025-03-20</DtOfSgntr>'), 'Wrong mandate signature date');
      });
    });
  }
});

// -------------------------------------------------------------------------
// 2. Credit Transfer × pain format combinations
// -------------------------------------------------------------------------

describe('Überweisung (Credit Transfer)', () => {
  for (const fmt of CT_FORMATS) {
    describe(`Format ${fmt}`, () => {

      it('generiert valides XML mit einer Transaktion', () => {
        const doc = createTransferDoc(fmt);
        const xml = doc.toString();
        assertValidXML(xml, fmt);
        assert.ok(xml.includes('<CstmrCdtTrfInitn>'), 'Missing root element');
        assert.ok(xml.includes('<PmtMtd>TRF</PmtMtd>'), 'Wrong payment method');
        assert.ok(xml.includes('<NbOfTxs>1</NbOfTxs>'), 'Wrong transaction count');
        assert.ok(xml.includes('Anna Schmidt'), 'Missing creditor name');
      });

      it('generiert valides XML mit mehreren Transaktionen', () => {
        const doc = createTransferDoc(fmt, {
          transactions: TEST_DATA.accounts.map((a, i) => ({
            ...a,
            amount: (i + 1) * 1000,
          })),
        });
        const xml = doc.toString();
        assertValidXML(xml, fmt);
        assert.ok(xml.includes('<NbOfTxs>3</NbOfTxs>'), 'Wrong transaction count');
        // Control sum = 1000 + 2000 + 3000 = 6000
        assert.ok(xml.includes('<CtrlSum>6000.00</CtrlSum>'), 'Wrong control sum');
      });

      it('setzt Ausführungsdatum korrekt', () => {
        const doc = createTransferDoc(fmt);
        const xml = doc.toString();
        assert.ok(xml.includes('2026-02-01'), 'Missing execution date');
      });

      it('funktioniert ohne BIC (NOTPROVIDED)', () => {
        const doc = createTransferDoc(fmt, {
          transactions: [{ ...TEST_DATA.accounts[2], bic: '' }],
        });
        const xml = doc.toString();
        assertValidXML(xml, fmt);
        if (SEPA.isAustrianFormat(fmt)) {
          // PSA: CdtrAgt erlaubt nur BICFI – ohne BIC entfaellt der Block
          assert.ok(!xml.includes('<CdtrAgt>'), 'AT: CdtrAgt muss ohne BIC fehlen');
        } else {
          assert.ok(xml.includes('<CdtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></CdtrAgt>'),
            'Missing NOTPROVIDED for empty BIC');
        }
      });

      it('enthält End-to-End-ID', () => {
        const doc = createTransferDoc(fmt, {
          transactions: [{
            ...TEST_DATA.accounts[0],
            end2endId: 'REF-2026-001',
          }],
        });
        const xml = doc.toString();
        assert.ok(xml.includes('<EndToEndId>REF-2026-001</EndToEndId>'), 'Missing end-to-end ID');
      });

      it('keine Gläubiger-ID-Validierung bei Überweisungen', () => {
        // This must NOT throw – debtorId validation was the old Bug #5
        assert.doesNotThrow(() => {
          const doc = createTransferDoc(fmt);
          doc.toString();
        }, 'Transfer should not validate debtorId');
      });
    });
  }
});

// -------------------------------------------------------------------------
// 3. Sequence type × Instrumentation matrix (DD only)
// -------------------------------------------------------------------------

describe('Lastschrift: Sequenztyp × Instrumentierung Matrix', () => {
  const fmt = 'pain.008.001.08';
  for (const seq of SEQUENCE_TYPES) {
    for (const instr of LOCAL_INSTRUMENTATIONS) {
      it(`${seq} + ${instr} generiert fehlerfreies XML`, () => {
        assert.doesNotThrow(() => {
          const doc = createDirectDebitDoc(fmt, {
            sequenceType: seq,
            localInstrumentation: instr,
          });
          const xml = doc.toString();
          assertValidXML(xml, fmt);
          assert.ok(xml.includes(`<SeqTp>${seq}</SeqTp>`));
          assert.ok(xml.includes(`<Cd>${instr}</Cd>`));
        });
      });
    }
  }
});

// -------------------------------------------------------------------------
// 4. IBAN validation
// -------------------------------------------------------------------------

describe('IBAN-Validierung', () => {
  const VALID_IBANS = [
    'DE89370400440532013000',
    'DE75512108001245126199',
    'DE27100777770209299700',
    'DE02120300000000202051',
  ];
  const INVALID_IBANS = [
    'DE00370400440532013000',   // wrong checksum
    'DE89370400440532013001',   // altered last digit
    'INVALID',                  // garbage
    'XX12345',                  // too short
  ];

  for (const iban of VALID_IBANS) {
    it(`akzeptiert gültige IBAN ${iban}`, () => {
      assert.ok(SEPA.validateIBAN(iban), `IBAN ${iban} should be valid`);
    });
  }

  for (const iban of INVALID_IBANS) {
    it(`lehnt ungültige IBAN ${iban} ab`, () => {
      assert.ok(!SEPA.validateIBAN(iban), `IBAN ${iban} should be invalid`);
    });
  }
});

// -------------------------------------------------------------------------
// 5. Creditor-ID validation
// -------------------------------------------------------------------------

describe('Gläubiger-ID-Validierung', () => {
  it('akzeptiert gültige Gläubiger-ID', () => {
    assert.ok(SEPA.validateCreditorID('DE98ZZZ09999999999'));
  });

  it('lehnt ungültige Gläubiger-ID ab', () => {
    assert.ok(!SEPA.validateCreditorID('DE00ZZZ09999999999'));
    assert.ok(!SEPA.validateCreditorID(''));
    assert.ok(!SEPA.validateCreditorID('INVALID'));
  });
});

// -------------------------------------------------------------------------
// 6. Edge cases & error handling
// -------------------------------------------------------------------------

describe('Fehlerfälle und Grenzwerte', () => {

  it('wirft Fehler bei ungültiger IBAN in Transaktion', () => {
    assert.throws(() => {
      const doc = createDirectDebitDoc('pain.008.001.08', {
        transactions: [{ ...TEST_DATA.accounts[0], iban: 'DE00000000000000000000' }],
      });
      doc.toString();
    }, /IBAN/);
  });

  it('wirft Fehler bei Betrag = 0', () => {
    assert.throws(() => {
      const doc = new SEPA.Document('pain.008.001.08');
      doc.grpHdr.id = 'MSG-TEST';
      doc.grpHdr.created = new Date();
      doc.grpHdr.initiatorName = 'Test';
      const info = doc.createPaymentInfo();
      info.collectionDate = new Date();
      info.creditorName = TEST_DATA.creditor.name;
      info.creditorIBAN = TEST_DATA.creditor.iban;
      info.creditorBIC = TEST_DATA.creditor.bic;
      info.creditorId = TEST_DATA.creditor.id;
      const txn = info.createTransaction();
      txn.debtorName = 'Test Person';
      txn.debtorIBAN = 'DE89370400440532013000';
      txn.debtorBIC = 'COBADEFFXXX';
      txn.amount = 0; // explicitly zero, no fallback
      txn.mandateId = 'M-001';
      txn.mandateSignatureDate = new Date();
      txn.remittanceInfo = 'Test';
      info.addTransaction(txn);
      doc.addPaymentInfo(info);
      doc.toString();
    }, /amount/);
  });

  it('wirft Fehler bei negativem Betrag', () => {
    assert.throws(() => {
      const doc = createDirectDebitDoc('pain.008.001.08', {
        transactions: [{ ...TEST_DATA.accounts[0], amount: -10 }],
      });
      doc.toString();
    }, /amount/);
  });

  it('akzeptiert Betrag von 0.01 EUR (Minimum)', () => {
    assert.doesNotThrow(() => {
      const doc = createDirectDebitDoc('pain.008.001.08', {
        transactions: [{ ...TEST_DATA.accounts[0], amount: 0.01 }],
      });
      const xml = doc.toString();
      assert.ok(xml.includes('0.01'));
    });
  });

  it('akzeptiert hohe Beträge', () => {
    assert.doesNotThrow(() => {
      const doc = createTransferDoc('pain.001.001.09', {
        transactions: [{ ...TEST_DATA.accounts[0], amount: 999999999.99 }],
      });
      const xml = doc.toString();
      assert.ok(xml.includes('999999999.99'));
    });
  });

  it('wirft Fehler bei ungültigem Sequenztyp', () => {
    assert.throws(() => {
      createDirectDebitDoc('pain.008.001.08', {
        sequenceType: 'INVALID',
      }).toString();
    }, /sequenceType/);
  });

  it('wirft Fehler bei ungültiger Instrumentierung', () => {
    assert.throws(() => {
      createDirectDebitDoc('pain.008.001.08', {
        localInstrumentation: 'INVALID',
      }).toString();
    }, /localInstrumentation/);
  });

  it('wirft Fehler bei ungültiger BIC-Länge', () => {
    assert.throws(() => {
      const doc = createDirectDebitDoc('pain.008.001.08', {
        transactions: [{ ...TEST_DATA.accounts[0], bic: 'ABC' }],
      });
      doc.toString();
    }, /BIC/);
  });

  it('wirft Fehler bei fehlendem Mandatsdatum (Lastschrift)', () => {
    assert.throws(() => {
      const doc = new SEPA.Document('pain.008.001.08');
      doc.grpHdr.id = 'MSG-TEST';
      doc.grpHdr.created = new Date();
      doc.grpHdr.initiatorName = 'Test';
      const info = doc.createPaymentInfo();
      info.collectionDate = new Date();
      info.creditorName = TEST_DATA.creditor.name;
      info.creditorIBAN = TEST_DATA.creditor.iban;
      info.creditorBIC = TEST_DATA.creditor.bic;
      info.creditorId = TEST_DATA.creditor.id;
      const txn = info.createTransaction();
      txn.debtorName = 'Test Person';
      txn.debtorIBAN = 'DE89370400440532013000';
      txn.amount = 10;
      txn.mandateId = 'M-001';
      // mandateSignatureDate intentionally NOT set (null)
      txn.remittanceInfo = 'Test';
      info.addTransaction(txn);
      doc.addPaymentInfo(info);
      doc.toString();
    }, /mandateSignatureDate/);
  });

  it('Verwendungszweck bis 140 Zeichen erlaubt', () => {
    const longPurpose = 'A'.repeat(140);
    assert.doesNotThrow(() => {
      const doc = createTransferDoc('pain.001.001.09', {
        transactions: [{ ...TEST_DATA.accounts[0], remittanceInfo: longPurpose }],
      });
      doc.toString();
    });
  });

  it('wirft Fehler bei Verwendungszweck über 140 Zeichen', () => {
    const tooLong = 'A'.repeat(141);
    assert.throws(() => {
      const doc = createTransferDoc('pain.001.001.09', {
        transactions: [{ ...TEST_DATA.accounts[0], remittanceInfo: tooLong }],
      });
      doc.toString();
    }, /remittanceInfo/);
  });
});

// -------------------------------------------------------------------------
// 7. Document structure – ensure addPaymentInfo works
// -------------------------------------------------------------------------

describe('Dokumentstruktur (addPaymentInfo)', () => {

  it('XML enthält PmtInf nur wenn addPaymentInfo aufgerufen wird', () => {
    const doc = new SEPA.Document('pain.001.001.09');
    doc.grpHdr.id = 'MSG-EMPTY';
    doc.grpHdr.created = new Date();
    doc.grpHdr.initiatorName = 'Test';
    // Deliberately do NOT call addPaymentInfo
    const xml = doc.toString();
    assert.ok(!xml.includes('<PmtInf>'), 'Should not contain PmtInf without addPaymentInfo');
    assert.ok(xml.includes('<NbOfTxs>0</NbOfTxs>'), 'Transaction count should be 0');
  });

  it('XML enthält PmtInf wenn addPaymentInfo aufgerufen wird', () => {
    const doc = createTransferDoc('pain.001.001.09');
    const xml = doc.toString();
    assert.ok(xml.includes('<PmtInf>'), 'Should contain PmtInf');
    assert.ok(xml.includes('<NbOfTxs>1</NbOfTxs>'), 'Transaction count should be 1');
  });
});

// -------------------------------------------------------------------------
// 8. grpHdr.created must be a Date object
// -------------------------------------------------------------------------

describe('grpHdr.created Typbehandlung', () => {

  it('Date-Objekt funktioniert korrekt', () => {
    assert.doesNotThrow(() => {
      const doc = createTransferDoc('pain.001.001.09');
      const xml = doc.toString();
      assert.ok(xml.includes('<CreDtTm>'), 'Must contain CreDtTm');
      assert.ok(xml.includes('2026-01-15T10:00:00'), 'Must contain correct ISO date');
    });
  });

  it('String statt Date wirft Fehler (alter Bug)', () => {
    assert.throws(() => {
      const doc = new SEPA.Document('pain.001.001.09');
      doc.grpHdr.id = 'MSG-TEST';
      doc.grpHdr.created = new Date().toISOString(); // Bug: String statt Date
      doc.grpHdr.initiatorName = 'Test';
      const info = doc.createPaymentInfo();
      info.requestedExecutionDate = new Date();
      info.debtorName = TEST_DATA.debtor.name;
      info.debtorIBAN = TEST_DATA.debtor.iban;
      const txn = info.createTransaction();
      txn.creditorName = 'Test';
      txn.creditorIBAN = 'DE89370400440532013000';
      txn.amount = 10;
      txn.remittanceInfo = 'Test';
      txn.end2endId = 'E2E-001';
      info.addTransaction(txn);
      doc.addPaymentInfo(info);
      doc.toString();
    }, /toISOString is not a function/);
  });
});

// -------------------------------------------------------------------------
// 9. Full integration: simulate exactly what sepa-generator.js does
// -------------------------------------------------------------------------

describe('Integration: Simulation des Generator-Flows', () => {

  it('Lastschrift-Flow pain.008.001.08 komplett', () => {
    // Simulates generateAndDownload() for direct debit
    const painFormat = 'pain.008.001.08';
    const doc = new SEPA.Document(painFormat);
    doc.grpHdr.id = 'MSG-1706789012345-abc';
    doc.grpHdr.created = new Date();                           // Fix: Date, not string
    doc.grpHdr.initiatorName = 'Verein Musterstadt e.V.';

    const info = doc.createPaymentInfo();
    info.collectionDate = new Date('2026-02-15');              // Fix: Date, not string
    info.creditorName = 'Verein Musterstadt e.V.';
    info.creditorIBAN = 'DE89370400440532013000';
    info.creditorBIC = 'COBADEFFXXX';
    info.creditorId = 'DE98ZZZ09999999999';
    info.sequenceType = 'RCUR';
    info.localInstrumentation = 'CORE';                        // Fix: correct property name

    const members = [
      { name: 'Anna Schmidt',  iban: 'DE75512108001245126199', bic: 'SOLADEST600', amount: 25.00, mandate: 'M-2025-001' },
      { name: 'Bernd Weber',   iban: 'DE27100777770209299700', bic: 'DEUTDEFF',    amount: 25.00, mandate: 'M-2025-002' },
      { name: 'Clara Fischer', iban: 'DE02120300000000202051', bic: '',             amount: 50.00, mandate: 'M-2025-003' },
    ];

    for (const m of members) {
      const txn = info.createTransaction();
      txn.debtorName = m.name;
      txn.debtorIBAN = m.iban;
      txn.debtorBIC = m.bic;
      txn.amount = m.amount;
      txn.mandateId = m.mandate;
      txn.mandateSignatureDate = new Date('2025-01-01');
      txn.remittanceInfo = 'Mitgliedsbeitrag Q1 2026';
      info.addTransaction(txn);
    }

    doc.addPaymentInfo(info);                                  // Fix: must call this

    const xml = doc.toString();
    assertValidXML(xml, painFormat);
    assert.ok(xml.includes('<CstmrDrctDbtInitn>'));
    assert.ok(xml.includes('<NbOfTxs>3</NbOfTxs>'));
    assert.ok(xml.includes('<CtrlSum>100.00</CtrlSum>'));
    assert.ok(xml.includes('<PmtMtd>DD</PmtMtd>'));
    assert.ok(xml.includes('<SeqTp>RCUR</SeqTp>'));
    assert.ok(xml.includes('<Cd>CORE</Cd>'));
    assert.ok(xml.includes('DE98ZZZ09999999999'));
    for (const m of members) {
      assert.ok(xml.includes(m.name), `Missing member ${m.name}`);
      assert.ok(xml.includes(m.iban), `Missing IBAN for ${m.name}`);
    }
  });

  it('Überweisungs-Flow pain.001.001.09 komplett', () => {
    // Simulates generateAndDownload() for credit transfer
    const painFormat = 'pain.001.001.09';
    const doc = new SEPA.Document(painFormat);
    doc.grpHdr.id = 'MSG-1706789012345-def';
    doc.grpHdr.created = new Date();
    doc.grpHdr.initiatorName = 'Lothar Vogel';

    const info = doc.createPaymentInfo();
    info.requestedExecutionDate = new Date('2026-01-07');       // Fix: correct property
    info.debtorName = 'Lothar Vogel';
    info.debtorIBAN = 'DE89370400440532013000';
    info.debtorBIC = 'COBADEFFXXX';

    const recipients = [
      { name: 'Horst Richter',     iban: 'DE75512108001245126199', amount: 1500, purpose: 'Gehalt Januar 2026' },
      { name: 'Erika Moppelhaus',  iban: 'DE27100777770209299700', amount: 2000, purpose: 'Gehalt Januar 2026' },
    ];

    for (const r of recipients) {
      const txn = info.createTransaction();
      txn.creditorName = r.name;
      txn.creditorIBAN = r.iban;
      txn.creditorBIC = '';
      txn.amount = r.amount;
      txn.remittanceInfo = r.purpose;
      txn.end2endId = 'NOTPROVIDED';
      info.addTransaction(txn);
    }

    doc.addPaymentInfo(info);

    const xml = doc.toString();
    assertValidXML(xml, painFormat);
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'));
    assert.ok(xml.includes('<NbOfTxs>2</NbOfTxs>'));
    assert.ok(xml.includes('<CtrlSum>3500.00</CtrlSum>'));
    assert.ok(xml.includes('<PmtMtd>TRF</PmtMtd>'));
    assert.ok(xml.includes('Lothar Vogel'));
    for (const r of recipients) {
      assert.ok(xml.includes(r.name), `Missing recipient ${r.name}`);
      assert.ok(xml.includes(r.purpose), `Missing purpose for ${r.name}`);
    }
  });

  it('Überweisungs-Flow pain.001.001.08 komplett', () => {
    const painFormat = 'pain.001.001.08';
    const doc = new SEPA.Document(painFormat);
    doc.grpHdr.id = 'MSG-TEST-CT08';
    doc.grpHdr.created = new Date();
    doc.grpHdr.initiatorName = 'Firma Test AG';

    const info = doc.createPaymentInfo();
    info.requestedExecutionDate = new Date('2026-03-01');
    info.debtorName = 'Firma Test AG';
    info.debtorIBAN = 'DE89370400440532013000';
    info.debtorBIC = 'COBADEFFXXX';

    const txn = info.createTransaction();
    txn.creditorName = 'Lieferant GmbH';
    txn.creditorIBAN = 'DE02120300000000202051';
    txn.creditorBIC = '';
    txn.amount = 4999.99;
    txn.remittanceInfo = 'Rechnung RE-2026-0042';
    txn.end2endId = 'RE-2026-0042';
    info.addTransaction(txn);

    doc.addPaymentInfo(info);

    const xml = doc.toString();
    assertValidXML(xml, painFormat);
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'));
    assert.ok(xml.includes('4999.99'));
    assert.ok(xml.includes('RE-2026-0042'));
  });

  it('Lastschrift-Flow pain.008.001.02 (Legacy) komplett', () => {
    const painFormat = 'pain.008.001.02';
    const doc = new SEPA.Document(painFormat);
    doc.grpHdr.id = 'MSG-TEST-DD02';
    doc.grpHdr.created = new Date();
    doc.grpHdr.initiatorName = 'Sportverein Tübingen';

    const info = doc.createPaymentInfo();
    info.collectionDate = new Date('2026-04-01');
    info.creditorName = 'Sportverein Tübingen';
    info.creditorIBAN = 'DE89370400440532013000';
    info.creditorBIC = 'COBADEFFXXX';
    info.creditorId = 'DE98ZZZ09999999999';
    info.sequenceType = 'FRST';
    info.localInstrumentation = 'B2B';

    const txn = info.createTransaction();
    txn.debtorName = 'Mitglied Eins';
    txn.debtorIBAN = 'DE75512108001245126199';
    txn.debtorBIC = 'SOLADEST600';
    txn.amount = 120.00;
    txn.mandateId = 'SV-2026-001';
    txn.mandateSignatureDate = new Date('2026-01-15');
    txn.remittanceInfo = 'Jahresbeitrag 2026';
    info.addTransaction(txn);

    doc.addPaymentInfo(info);

    const xml = doc.toString();
    assertValidXML(xml, painFormat);
    assert.ok(xml.includes('<CstmrDrctDbtInitn>'));
    assert.ok(xml.includes('<SeqTp>FRST</SeqTp>'));
    assert.ok(xml.includes('<Cd>B2B</Cd>'));
    assert.ok(xml.includes('120.00'));
  });
});

// =========================================================================
// EXCEL-IMPORT & -VERARBEITUNG
// =========================================================================
// Simuliert den Datenfluss: Excel-Zeilen → Mapping (wie in sepa-generator.js
// handleFileSelect, Zeilen 864-883) → SEPA-Library → XML-Validierung.
//
// Da sepa-generator.js Browser-Code mit DOM-Abhaengigkeiten ist, wird die
// Mapping-Logik hier 1:1 nachgebaut und getestet.
// =========================================================================

// ---------------------------------------------------------------------------
// Excel-Hilfs­funktionen
// ---------------------------------------------------------------------------

/**
 * Simuliert die Spalten-Mapping-Logik aus sepa-generator.js handleFileSelect().
 * Wandelt Excel-Zeilen (wie von XLSX.utils.sheet_to_json) in Transaktions-Objekte um.
 *
 * @param {Object[]} rows - Array von Zeilen-Objekten mit Spaltennamen als Keys
 * @param {string} paymentType - 'directDebit' oder 'transfer'
 * @returns {Object[]} Array von Transaktions-Objekten
 */
function processExcelRows(rows, paymentType) {
  // Excel-Zellen können Numbers sein – SEPA-Validierung ruft .match() auf Strings auf.
  const cellToString = v => (v === null || v === undefined) ? '' : String(v).trim();

  // Spaltenüberschriften flexibel erkennen: Keys normalisieren (lowercase,
  // Sonderzeichen/Leerzeichen entfernen), damit auch "IBAN ", "Iban" oder
  // "IBAN-Nr." gefunden werden.
  const normalizeKey = k => k.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const toNormalizedRow = row => {
    const norm = {};
    Object.keys(row).forEach(k => { norm[normalizeKey(k)] = row[k]; });
    return norm;
  };
  const getCell = (norm, aliases) => {
    for (const a of aliases) {
      if (norm[a] !== undefined && norm[a] !== null && cellToString(norm[a]) !== '') return norm[a];
    }
    return undefined;
  };

  return rows
    .map(toNormalizedRow)
    .filter(norm => Object.values(norm).some(v => cellToString(v) !== ''))
    .map(norm => {
      const t = {
        name: cellToString(getCell(norm, ['name'])),
        // IBAN/BIC uppercasen für Bank-Konformität (analog zu manuellem Pfad).
        iban: cellToString(getCell(norm, ['iban', 'ibannr'])).replace(/\s/g, '').toUpperCase(),
        bic: cellToString(getCell(norm, ['bic', 'bicswift'])).toUpperCase(),
        amount: parseFloat(getCell(norm, ['betrag', 'amount']) || 0),
        remittanceInfo: cellToString(getCell(norm, ['verwendungszweck', 'purpose'])),
      };
      if (paymentType === 'directDebit') {
        t.mandateId = cellToString(getCell(norm, ['mandatsreferenz', 'mandateid']));
        t.mandateSignatureDate = getCell(norm, ['mandatsdatum', 'mandatedate']) || '';
      } else {
        t.mandateId = cellToString(getCell(norm, ['referenz', 'reference']));
      }
      return t;
    });
}

/**
 * Vollstaendige Pipeline: Excel-Zeilen → SEPA XML-String.
 * Simuliert generateAndDownload() aus sepa-generator.js (Zeilen 991-1065).
 *
 * @param {Object[]} rows - Excel-Zeilen (wie von sheet_to_json)
 * @param {string} paymentType - 'directDebit' oder 'transfer'
 * @param {string} painFormat - Pain-Format-String
 * @returns {string} Generierter XML-String
 */
function excelToXML(rows, paymentType, painFormat) {
  const transactions = processExcelRows(rows, paymentType);

  const doc = new SEPA.Document(painFormat);
  doc.grpHdr.id = 'MSG-EXCEL-TEST';
  doc.grpHdr.created = new Date('2026-01-15T10:00:00Z');
  doc.grpHdr.initiatorName = 'Excel Test Initiator';

  const info = doc.createPaymentInfo();
  // Wie im Generator VOR den Transaktionen: addPaymentInfo setzt info.id, aus
  // der addTransaction die InstrId ableitet. Andernfalls hiesse jede InstrId
  // nur ".0", ".1", ...
  doc.addPaymentInfo(info);

  if (paymentType === 'directDebit') {
    info.collectionDate = new Date('2026-02-01');
    info.creditorName = TEST_DATA.creditor.name;
    info.creditorIBAN = TEST_DATA.creditor.iban;
    info.creditorBIC = TEST_DATA.creditor.bic;
    info.creditorId = TEST_DATA.creditor.id;
    info.sequenceType = 'RCUR';
    info.localInstrumentation = 'CORE';

    for (const t of transactions) {
      const txn = info.createTransaction();
      txn.debtorName = sepaText(t.name, 70, painFormat);
      txn.debtorIBAN = String(t.iban || '').toUpperCase();
      txn.debtorBIC = String(t.bic || '').toUpperCase() || deriveBIC(txn.debtorIBAN);
      txn.amount = parseFloat(t.amount);
      txn.mandateId = sepaId(t.mandateId, 35);
      // end2endId muss auch bei DD gesetzt werden, sonst <EndToEndId/> leer.
      txn.end2endId = sepaId(t.mandateId, 35) || 'NOTPROVIDED';
      const d = t.mandateSignatureDate ? new Date(t.mandateSignatureDate) : new Date();
      txn.mandateSignatureDate = isNaN(d.getTime()) ? new Date() : d;
      txn.remittanceInfo = sepaText(t.remittanceInfo, 140, painFormat);
      info.addTransaction(txn);
    }
  } else {
    info.requestedExecutionDate = new Date('2026-02-01');
    info.debtorName = TEST_DATA.debtor.name;
    info.debtorIBAN = TEST_DATA.debtor.iban;
    info.debtorBIC = TEST_DATA.debtor.bic;

    for (const t of transactions) {
      const txn = info.createTransaction();
      txn.creditorName = sepaText(t.name, 70, painFormat);
      txn.creditorIBAN = String(t.iban || '').toUpperCase();
      txn.creditorBIC = String(t.bic || '').toUpperCase() || deriveBIC(txn.creditorIBAN);
      txn.amount = parseFloat(t.amount);
      txn.remittanceInfo = sepaText(t.remittanceInfo, 140, painFormat);
      txn.end2endId = sepaId(t.mandateId, 35) || 'NOTPROVIDED';
      info.addTransaction(txn);
    }
  }

  // Spiegelt den Header-Replace aus generateAndDownload() wider: Im Browser
  // liefert die Lib encoding="null", weil document.xmlEncoding read-only ist.
  // In Node.js ist der Replace ein No-Op, aber der Codepfad bleibt symmetrisch.
  let xml = doc.toString();
  xml = xml.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');
  return xml;
}

// Beispiel-Zeilen wie sie die Excel-Vorlage (Template) liefern wuerde
const TEMPLATE_ROWS_DD = [
  { Name: 'Max Mustermann',  IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX', Betrag: 45.00, Verwendungszweck: 'Mitgliedsbeitrag Januar 2025', Mandatsreferenz: 'MAND-001-2025', Mandatsdatum: '2025-01-01' },
  { Name: 'Erika Musterfrau', IBAN: 'DE75512108001245126199', BIC: '',            Betrag: 30.00, Verwendungszweck: 'Mitgliedsbeitrag Januar 2025', Mandatsreferenz: 'MAND-002-2025', Mandatsdatum: '2025-01-01' },
];

const TEMPLATE_ROWS_CT = [
  { Name: 'Max Mustermann',  IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX', Betrag: 1500.00, Verwendungszweck: 'Gehalt Januar 2025', Referenz: 'REF-001' },
  { Name: 'Erika Musterfrau', IBAN: 'DE75512108001245126199', BIC: '',            Betrag: 2000.00, Verwendungszweck: 'Gehalt Januar 2025', Referenz: 'REF-002' },
];

// -------------------------------------------------------------------------
// 10. Excel-Import: Spalten-Mapping
// -------------------------------------------------------------------------

describe('Excel-Import: Spalten-Mapping', () => {

  it('erkennt deutsche Spalten bei Lastschrift', () => {
    const rows = [{
      Name: 'Anna Schmidt', IBAN: 'DE75512108001245126199', BIC: 'SOLADEST600',
      Betrag: 49.99, Verwendungszweck: 'Beitrag', Mandatsreferenz: 'MAND-001', Mandatsdatum: '2025-06-15',
    }];
    const result = processExcelRows(rows, 'directDebit');
    assert.strictEqual(result[0].name, 'Anna Schmidt');
    assert.strictEqual(result[0].iban, 'DE75512108001245126199');
    assert.strictEqual(result[0].bic, 'SOLADEST600');
    assert.strictEqual(result[0].amount, 49.99);
    assert.strictEqual(result[0].remittanceInfo, 'Beitrag');
    assert.strictEqual(result[0].mandateId, 'MAND-001');
    assert.strictEqual(result[0].mandateSignatureDate, '2025-06-15');
  });

  it('erkennt deutsche Spalten bei Überweisung', () => {
    const rows = [{
      Name: 'Bernd Weber', IBAN: 'DE27100777770209299700', BIC: 'DEUTDEFF',
      Betrag: 1500, Verwendungszweck: 'Gehalt', Referenz: 'REF-2026-001',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].name, 'Bernd Weber');
    assert.strictEqual(result[0].iban, 'DE27100777770209299700');
    assert.strictEqual(result[0].amount, 1500);
    assert.strictEqual(result[0].mandateId, 'REF-2026-001');
  });

  it('erkennt englische Spalten', () => {
    const rows = [{
      name: 'John Doe', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX',
      Amount: 100, Purpose: 'Invoice', MandateId: 'M-001', MandateDate: '2025-03-01',
    }];
    const result = processExcelRows(rows, 'directDebit');
    assert.strictEqual(result[0].name, 'John Doe');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000');
    assert.strictEqual(result[0].amount, 100);
    assert.strictEqual(result[0].remittanceInfo, 'Invoice');
    assert.strictEqual(result[0].mandateId, 'M-001');
    assert.strictEqual(result[0].mandateSignatureDate, '2025-03-01');
  });

  it('erkennt kleingeschriebene Spalten', () => {
    const rows = [{
      name: 'Test Person', iban: 'DE89370400440532013000', bic: '',
      betrag: 25.50, verwendungszweck: 'Test Zweck',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].name, 'Test Person');
    assert.strictEqual(result[0].amount, 25.50);
    assert.strictEqual(result[0].remittanceInfo, 'Test Zweck');
  });

  it('erkennt gemischte Spaltensprachen', () => {
    const rows = [{
      Name: 'Mixed Person', iban: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Amount: 75, Verwendungszweck: 'Gemischt',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].name, 'Mixed Person');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000');
    assert.strictEqual(result[0].bic, 'COBADEFFXXX');
    assert.strictEqual(result[0].amount, 75);
    assert.strictEqual(result[0].remittanceInfo, 'Gemischt');
  });

  it('Überweisung liest Referenz-Spalte statt Mandatsreferenz', () => {
    const rows = [{
      Name: 'Test', IBAN: 'DE89370400440532013000', BIC: '',
      Betrag: 100, Verwendungszweck: 'Test', Referenz: 'MY-REF', Mandatsreferenz: 'SHOULD-IGNORE',
    }];
    const result = processExcelRows(rows, 'transfer');
    // Bei Überweisung soll Referenz gelesen werden, nicht Mandatsreferenz
    assert.strictEqual(result[0].mandateId, 'MY-REF');
  });

  it('Lastschrift liest Mandatsreferenz-Spalte statt Referenz', () => {
    const rows = [{
      Name: 'Test', IBAN: 'DE89370400440532013000', BIC: '',
      Betrag: 100, Verwendungszweck: 'Test', Mandatsreferenz: 'MAND-123', Mandatsdatum: '2025-01-01',
      Referenz: 'SHOULD-IGNORE',
    }];
    const result = processExcelRows(rows, 'directDebit');
    assert.strictEqual(result[0].mandateId, 'MAND-123');
  });

  // Regression (Nutzer-Report M. Reck, Juli 2026): Header mit nachgestelltem
  // Leerzeichen oder Zusätzen wie "IBAN-Nr." führten zu leeren IBANs, weil das
  // Mapping nur exakte Keys (row.IBAN || row.iban) kannte.
  it('erkennt Header mit nachgestelltem Leerzeichen ("IBAN ")', () => {
    const rows = [{
      'Name ': 'Test Person', 'IBAN ': 'DE89370400440532013000', 'BIC ': 'COBADEFFXXX',
      'Betrag ': 10, 'Verwendungszweck ': 'Test',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].name, 'Test Person');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000');
    assert.strictEqual(result[0].bic, 'COBADEFFXXX');
    assert.strictEqual(result[0].amount, 10);
  });

  it('erkennt Header in gemischter Schreibweise ("Iban", "Bic")', () => {
    const rows = [{
      Name: 'Test', Iban: 'DE89370400440532013000', Bic: 'COBADEFFXXX', Betrag: 10,
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000');
    assert.strictEqual(result[0].bic, 'COBADEFFXXX');
  });

  it('erkennt Header mit Zusätzen ("IBAN-Nr.", "BIC/SWIFT")', () => {
    const rows = [{
      Name: 'Test', 'IBAN-Nr.': 'DE89370400440532013000', 'BIC/SWIFT': 'COBADEFFXXX', Betrag: 10,
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000');
    assert.strictEqual(result[0].bic, 'COBADEFFXXX');
  });

  it('überspringt Zeilen, die nur leere Zellen enthalten', () => {
    const rows = [
      { Name: 'Person A', IBAN: 'DE89370400440532013000', Betrag: 100 },
      { Name: '', IBAN: '   ', Betrag: null },
      { Name: 'Person B', IBAN: 'DE75512108001245126199', Betrag: 200 },
    ];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'Person A');
    assert.strictEqual(result[1].name, 'Person B');
  });

  it('liefert leere IBANs, wenn die Spalte fehlt (Basis für Import-Fehlermeldung)', () => {
    // handleFileSelect() bricht in diesem Fall mit einer Diagnose ab
    // ("Spalte IBAN wurde nicht erkannt. Gefundene Spalten: ...").
    const rows = [
      { Name: 'Person A', Kontonummer: '532013000', Betrag: 100 },
      { Name: 'Person B', Kontonummer: '245126199', Betrag: 200 },
    ];
    const result = processExcelRows(rows, 'transfer');
    assert.ok(result.every(t => t.iban === ''), 'Alle IBANs sollten leer sein');
  });
});

// -------------------------------------------------------------------------
// 11. Excel-Import: Datenverarbeitung
// -------------------------------------------------------------------------

describe('Excel-Import: Datenverarbeitung', () => {

  it('entfernt Whitespace aus IBAN', () => {
    const rows = [{
      Name: 'Test', IBAN: 'DE89 3704 0044 0532 0130 00', BIC: '', Betrag: 10, Verwendungszweck: 'Test',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000');
  });

  it('leerer BIC bei deutscher IBAN wird aus der BLZ abgeleitet (nicht NOTPROVIDED)', () => {
    // Früher: leerer BIC => <Othr>NOTPROVIDED</Othr>. Manche Bankprogramme lehnen
    // das ab (Schema erlaubt nur <BIC>). Jetzt leiten wir den BIC aus der IBAN ab.
    // DE02120300000000202051 -> BLZ 12030000 -> BYLADEM1001 (DKB).
    const rows = [{
      Name: 'Clara Fischer', IBAN: 'DE02120300000000202051', BIC: '', Betrag: 50, Verwendungszweck: 'Test',
      Referenz: 'REF-001',
    }];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    // pain.001.001.09 nutzt die 2019er-Basistypen: das Element heisst <BICFI>.
    assert.ok(xml.includes('<BICFI>BYLADEM1001</BICFI>'), 'BIC sollte aus der BLZ abgeleitet werden');
    assert.ok(!xml.includes('NOTPROVIDED'), 'Kein NOTPROVIDED-Fallback bei bekannter deutscher BLZ');
  });

  it('Betrag als String wird korrekt geparsed', () => {
    const rows = [{
      Name: 'Test', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: '45.00', Verwendungszweck: 'Test', Referenz: 'REF',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].amount, 45.00);
    assert.strictEqual(typeof result[0].amount, 'number');
  });

  it('fehlender Betrag wird zu 0 (NaN-sicher)', () => {
    const rows = [{ Name: 'Test', IBAN: 'DE89370400440532013000', BIC: '' }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].amount, 0);
  });

  it('fehlende optionale Felder werden als leere Strings gesetzt', () => {
    const rows = [{ Name: 'Nur Name', IBAN: 'DE89370400440532013000', Betrag: 10 }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].bic, '');  // (undefined || '') → ''
    assert.strictEqual(result[0].remittanceInfo, '');
    assert.strictEqual(result[0].mandateId, '');
  });

  it('verarbeitet mehrere Zeilen korrekt', () => {
    const rows = [
      { Name: 'Person A', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX', Betrag: 100, Verwendungszweck: 'A' },
      { Name: 'Person B', IBAN: 'DE75512108001245126199', BIC: 'SOLADEST600', Betrag: 200, Verwendungszweck: 'B' },
      { Name: 'Person C', IBAN: 'DE27100777770209299700', BIC: 'DEUTDEFF',    Betrag: 300, Verwendungszweck: 'C' },
    ];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].name, 'Person A');
    assert.strictEqual(result[1].name, 'Person B');
    assert.strictEqual(result[2].name, 'Person C');
    assert.strictEqual(result[0].amount + result[1].amount + result[2].amount, 600);
  });

  it('IBAN als Zahl wird korrekt zu String konvertiert', () => {
    // Excel kann IBANs als Zahlen interpretieren
    const rows = [{
      Name: 'Test', IBAN: 1234567890, BIC: '', Betrag: 10, Verwendungszweck: 'Test',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(typeof result[0].iban, 'string');
    assert.strictEqual(result[0].iban, '1234567890');
  });

  // Regression: numerische Referenzen/Mandats-IDs führten zu "t.match is not a function"
  // im SEPA-Validator, weil .match() auf Numbers nicht existiert.
  it('Referenz als Zahl wird korrekt zu String konvertiert (transfer)', () => {
    const rows = [{
      Name: 'Test', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 100, Verwendungszweck: 'Test', Referenz: 12345,
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(typeof result[0].mandateId, 'string');
    assert.strictEqual(result[0].mandateId, '12345');
  });

  it('Mandatsreferenz als Zahl wird korrekt zu String konvertiert (directDebit)', () => {
    const rows = [{
      Name: 'Test', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 100, Verwendungszweck: 'Test',
      Mandatsreferenz: 98765, Mandatsdatum: '2025-01-01',
    }];
    const result = processExcelRows(rows, 'directDebit');
    assert.strictEqual(typeof result[0].mandateId, 'string');
    assert.strictEqual(result[0].mandateId, '98765');
  });

  it('Name und Verwendungszweck als Zahl werden zu String konvertiert', () => {
    const rows = [{
      Name: 42, IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 10, Verwendungszweck: 2026,
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(typeof result[0].name, 'string');
    assert.strictEqual(result[0].name, '42');
    assert.strictEqual(typeof result[0].remittanceInfo, 'string');
    assert.strictEqual(result[0].remittanceInfo, '2026');
  });
});

// -------------------------------------------------------------------------
// 12. Excel-Import: End-to-End Pipeline
// -------------------------------------------------------------------------

describe('Excel-Import: End-to-End Pipeline', () => {

  it('Lastschrift-Vorlage erzeugt valides XML', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.08');
    assertValidXML(xml, 'pain.008.001.08');
    assert.ok(xml.includes('<CstmrDrctDbtInitn>'), 'Fehlendes Root-Element');
    assert.ok(xml.includes('<PmtMtd>DD</PmtMtd>'), 'Falsche Zahlungsmethode');
    assert.ok(xml.includes('<NbOfTxs>2</NbOfTxs>'), 'Falsche Transaktionsanzahl');
    assert.ok(xml.includes('<CtrlSum>75.00</CtrlSum>'), 'Falsche Kontrollsumme (45+30)');
    assert.ok(xml.includes('Max Mustermann'), 'Fehlender Schuldner');
    assert.ok(xml.includes('Erika Musterfrau'), 'Fehlender Schuldner');
    assert.ok(xml.includes('MAND-001-2025'), 'Fehlende Mandatsreferenz');
    assert.ok(xml.includes('MAND-002-2025'), 'Fehlende Mandatsreferenz');
  });

  it('Überweisungs-Vorlage erzeugt valides XML', () => {
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.09');
    assertValidXML(xml, 'pain.001.001.09');
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'), 'Fehlendes Root-Element');
    assert.ok(xml.includes('<PmtMtd>TRF</PmtMtd>'), 'Falsche Zahlungsmethode');
    assert.ok(xml.includes('<NbOfTxs>2</NbOfTxs>'), 'Falsche Transaktionsanzahl');
    assert.ok(xml.includes('<CtrlSum>3500.00</CtrlSum>'), 'Falsche Kontrollsumme (1500+2000)');
    assert.ok(xml.includes('Max Mustermann'), 'Fehlender Empfänger');
    assert.ok(xml.includes('Erika Musterfrau'), 'Fehlender Empfänger');
  });

  it('5+ Transaktionen mit korrekter Summe', () => {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      rows.push({
        Name: `Person ${i + 1}`,
        IBAN: TEST_DATA.accounts[i % 3].iban,
        BIC: TEST_DATA.accounts[i % 3].bic,
        Betrag: (i + 1) * 100,
        Verwendungszweck: `Zahlung ${i + 1}`,
        Referenz: `REF-${i + 1}`,
      });
    }
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    assertValidXML(xml, 'pain.001.001.09');
    assert.ok(xml.includes('<NbOfTxs>5</NbOfTxs>'), 'Falsche Transaktionsanzahl');
    // Summe: 100+200+300+400+500 = 1500
    assert.ok(xml.includes('<CtrlSum>1500.00</CtrlSum>'), 'Falsche Kontrollsumme');
  });

  it('Referenz wird als EndToEndId im XML gesetzt', () => {
    const rows = [{
      Name: 'Test Empfänger', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 500, Verwendungszweck: 'Rechnung', Referenz: 'RE-2026-0042',
    }];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    assert.ok(xml.includes('<EndToEndId>RE-2026-0042</EndToEndId>'), 'Fehlende End-to-End-ID');
  });

  it('fehlende Referenz wird als NOTPROVIDED gesetzt', () => {
    const rows = [{
      Name: 'Test Empfänger', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 500, Verwendungszweck: 'Ohne Referenz',
    }];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    assert.ok(xml.includes('<EndToEndId>NOTPROVIDED</EndToEndId>'), 'Fehlende NOTPROVIDED End-to-End-ID');
  });

  it('Mandatsdatum als String wird korrekt geparsed', () => {
    const rows = [{
      Name: 'Anna Schmidt', IBAN: 'DE75512108001245126199', BIC: 'SOLADEST600',
      Betrag: 25, Verwendungszweck: 'Beitrag', Mandatsreferenz: 'M-001', Mandatsdatum: '2025-03-20',
    }];
    const xml = excelToXML(rows, 'directDebit', 'pain.008.001.08');
    assert.ok(xml.includes('<DtOfSgntr>2025-03-20</DtOfSgntr>'), 'Falsches Mandatsdatum');
  });

  it('ungültiges Mandatsdatum nutzt Fallback (heute)', () => {
    const rows = [{
      Name: 'Anna Schmidt', IBAN: 'DE75512108001245126199', BIC: 'SOLADEST600',
      Betrag: 25, Verwendungszweck: 'Beitrag', Mandatsreferenz: 'M-001', Mandatsdatum: 'UNGUELTIG',
    }];
    // Sollte nicht werfen – ungültiges Datum führt zum Fallback auf new Date()
    assert.doesNotThrow(() => {
      const xml = excelToXML(rows, 'directDebit', 'pain.008.001.08');
      assert.ok(xml.includes('<DtOfSgntr>'), 'Mandatsdatum-Element muss vorhanden sein');
    });
  });

  it('Lastschrift-Vorlage funktioniert mit pain.008.001.02 (Legacy)', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.02');
    assertValidXML(xml, 'pain.008.001.02');
    assert.ok(xml.includes('<CstmrDrctDbtInitn>'));
    assert.ok(xml.includes('<CtrlSum>75.00</CtrlSum>'));
  });

  it('Überweisungs-Vorlage funktioniert mit pain.001.001.03', () => {
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.03');
    assertValidXML(xml, 'pain.001.001.03');
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'));
    assert.ok(xml.includes('<CtrlSum>3500.00</CtrlSum>'));
  });

  it('Überweisungs-Vorlage funktioniert mit pain.001.001.08', () => {
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.08');
    assertValidXML(xml, 'pain.001.001.08');
    assert.ok(xml.includes('<CstmrCdtTrfInitn>'));
  });

  // Regression: Bug "t.match is not a function" trat auf, wenn Excel die Referenz
  // als Number lieferte (z.B. 12345 statt "12345"). Der SEPA-Validator rief .match()
  // auf dem Number-Wert auf. Siehe sepa.min.js F() und w().
  it('numerische Referenz (Überweisung) erzeugt valides XML ohne .match-Fehler', () => {
    const rows = [{
      Name: 'Test Empfänger', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 500, Verwendungszweck: 'Rechnung', Referenz: 12345,
    }];
    let xml;
    assert.doesNotThrow(() => {
      xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    }, 'Darf nicht mit "t.match is not a function" werfen');
    assertValidXML(xml, 'pain.001.001.09');
    assert.ok(xml.includes('<EndToEndId>12345</EndToEndId>'), 'Numerische Referenz muss als EndToEndId erscheinen');
  });

  it('numerische Mandatsreferenz (Lastschrift) erzeugt valides XML ohne .match-Fehler', () => {
    const rows = [{
      Name: 'Anna Schmidt', IBAN: 'DE75512108001245126199', BIC: 'SOLADEST600',
      Betrag: 49.99, Verwendungszweck: 'Beitrag', Mandatsreferenz: 98765, Mandatsdatum: '2025-06-15',
    }];
    let xml;
    assert.doesNotThrow(() => {
      xml = excelToXML(rows, 'directDebit', 'pain.008.001.08');
    }, 'Darf nicht mit "t.match is not a function" werfen');
    assertValidXML(xml, 'pain.008.001.08');
    assert.ok(xml.includes('<MndtId>98765</MndtId>'), 'Numerische Mandatsreferenz muss als MndtId erscheinen');
  });

  // Bank-Kompatibilität: pain.008.001.02 / pain.001.001.03 enthalten NbOfTxs/CtrlSum/BtchBookg
  // im PmtInf-Block (DK-konform). Bei .08/.09 fehlen sie – manche Banken lehnen das ab.
  it('pain.008.001.02 enthält NbOfTxs/CtrlSum/BtchBookg im PmtInf-Block (DK-kompatibel)', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.02');
    const pmtInf = xml.match(/<PmtInf>[\s\S]*?<PmtTpInf>/);
    assert.ok(pmtInf, 'PmtInf-Block fehlt');
    assert.ok(pmtInf[0].includes('<BtchBookg>'), 'BtchBookg muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<NbOfTxs>2</NbOfTxs>'), 'NbOfTxs muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<CtrlSum>75.00</CtrlSum>'), 'CtrlSum muss vor PmtTpInf stehen');
  });

  it('pain.001.001.03 enthält NbOfTxs/CtrlSum/BtchBookg im PmtInf-Block (DK-kompatibel)', () => {
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.03');
    const pmtInf = xml.match(/<PmtInf>[\s\S]*?<PmtTpInf>/);
    assert.ok(pmtInf, 'PmtInf-Block fehlt');
    assert.ok(pmtInf[0].includes('<BtchBookg>'), 'BtchBookg muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<NbOfTxs>2</NbOfTxs>'), 'NbOfTxs muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<CtrlSum>3500.00</CtrlSum>'), 'CtrlSum muss vor PmtTpInf stehen');
  });

  // Regression (Fehlerprotokoll Hannoversche Volksbank, Juli 2026): Bei .08/.09
  // fehlten NbOfTxs/CtrlSum im PmtInf-Block ("Das Tag 'PmtTpInf' wird an dieser
  // Stelle nicht erwartet. Stattdessen wird das Tag 'NbOfTxs' erwartet."), weil
  // die Versionslogik in sepa.min.js nur auf === 3 statt >= 3 prüfte.
  it('pain.008.001.08 enthält NbOfTxs/CtrlSum/BtchBookg im PmtInf-Block (DK-kompatibel)', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.08');
    const pmtInf = xml.match(/<PmtInf>[\s\S]*?<PmtTpInf>/);
    assert.ok(pmtInf, 'PmtInf-Block fehlt');
    assert.ok(pmtInf[0].includes('<BtchBookg>'), 'BtchBookg muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<NbOfTxs>2</NbOfTxs>'), 'NbOfTxs muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<CtrlSum>75.00</CtrlSum>'), 'CtrlSum muss vor PmtTpInf stehen');
  });

  it('pain.001.001.09 enthält NbOfTxs/CtrlSum/BtchBookg im PmtInf-Block (DK-kompatibel)', () => {
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.09');
    const pmtInf = xml.match(/<PmtInf>[\s\S]*?<PmtTpInf>/);
    assert.ok(pmtInf, 'PmtInf-Block fehlt');
    assert.ok(pmtInf[0].includes('<BtchBookg>'), 'BtchBookg muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<NbOfTxs>2</NbOfTxs>'), 'NbOfTxs muss vor PmtTpInf stehen');
    assert.ok(pmtInf[0].includes('<CtrlSum>3500.00</CtrlSum>'), 'CtrlSum muss vor PmtTpInf stehen');
  });

  // Regression (Nutzer-Report, Juli 2026): Fünfstellige numerische Mandatsreferenz
  // aus Excel führte zu "t.match is not a function". Die Lib-Validatoren F()/w()
  // müssen Numbers auch dann verkraften, wenn ein App-Codepfad den String-Cast
  // vergisst – hier wird die Lib deshalb DIREKT mit einem Number befüllt.
  it('Lib verkraftet numerische mandateId/end2endId ohne .match-Crash', () => {
    const doc = new SEPA.Document('pain.008.001.02');
    doc.grpHdr.id = 'MSG-NUM-MANDATE';
    doc.grpHdr.created = new Date('2026-01-15T10:00:00Z');
    doc.grpHdr.initiatorName = 'Test';
    const info = doc.createPaymentInfo();
    info.collectionDate = new Date('2026-02-01');
    info.creditorName = TEST_DATA.creditor.name;
    info.creditorIBAN = TEST_DATA.creditor.iban;
    info.creditorBIC = TEST_DATA.creditor.bic;
    info.creditorId = TEST_DATA.creditor.id;
    info.sequenceType = 'RCUR';
    info.localInstrumentation = 'CORE';

    const txn = info.createTransaction();
    txn.debtorName = 'Numerik Test';
    txn.debtorIBAN = 'DE89370400440532013000';
    txn.debtorBIC = 'COBADEFFXXX';
    txn.amount = 10;
    txn.mandateId = 12345;      // Number statt String – wie aus Excel
    txn.end2endId = 12345;      // Number statt String
    txn.mandateSignatureDate = new Date('2025-01-01');
    info.addTransaction(txn);
    doc.addPaymentInfo(info);

    let xml;
    assert.doesNotThrow(() => { xml = doc.toString(); },
      'Darf nicht mit "t.match is not a function" werfen');
    assert.ok(xml.includes('<MndtId>12345</MndtId>'), 'Numerische Mandatsreferenz muss im XML stehen');
  });

  // Regression (Fehlerprotokoll "invalider Wert", Juli 2026): Bei leerem
  // Verwendungszweck erzeugte die Lib <RmtInf><Ustrd/></RmtInf> – RmtInf ist
  // optional, aber ein leeres Ustrd verletzt das Schema (minLength 1).
  it('leerer Verwendungszweck erzeugt kein leeres <Ustrd/>', () => {
    const rows = [{
      Name: 'Ohne Zweck', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 10, Mandatsreferenz: 'MAND-X', Mandatsdatum: '2025-01-01',
    }];
    const xml = excelToXML(rows, 'directDebit', 'pain.008.001.02');
    assert.ok(!xml.includes('<Ustrd/>'), 'Leeres <Ustrd/> darf nicht erzeugt werden');
    assert.ok(!xml.includes('<Ustrd></Ustrd>'), 'Leeres <Ustrd></Ustrd> darf nicht erzeugt werden');
    assert.ok(!xml.includes('<RmtInf>'), 'RmtInf soll bei leerem Verwendungszweck ganz entfallen');
  });

  it('gefüllter Verwendungszweck erscheint weiterhin als <Ustrd>', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.02');
    assert.ok(xml.includes('<Ustrd>Mitgliedsbeitrag Januar 2025</Ustrd>'), 'Verwendungszweck fehlt im XML');
  });

  // Regression (Nutzer-Report Sparkasse Hannover, Juli 2026): Im Browser sind
  // document.xmlVersion/xmlEncoding read-only – toString() erzeugte dort
  // '<?xml version="null" encoding="null"?>' und die Bank lehnte JEDES gewählte
  // pain-Format ab ("Dateiformat wird nicht unterstützt"). toString() muss die
  // internen Werte nutzen, nicht die DOM-Properties. Hier wird das
  // Browser-Verhalten simuliert, indem die DOM-Properties null liefern.
  it('XML-Deklaration bleibt korrekt, auch wenn DOM xmlVersion/xmlEncoding null liefert (Browser)', () => {
    const doc = new SEPA.Document('pain.008.001.02');
    doc.grpHdr.id = 'MSG-BROWSER-SIM';
    doc.grpHdr.created = new Date('2026-01-15T10:00:00Z');
    doc.grpHdr.initiatorName = 'Test';

    const realToXML = doc.toXML.bind(doc);
    doc.toXML = function () {
      const xmlDoc = realToXML();
      Object.defineProperty(xmlDoc, 'xmlVersion', { get: () => null });
      Object.defineProperty(xmlDoc, 'xmlEncoding', { get: () => null });
      return xmlDoc;
    };

    const xml = doc.toString();
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
      `XML-Deklaration muss version="1.0" encoding="UTF-8" enthalten, war: ${xml.substring(0, 60)}`);
    assert.ok(!xml.includes('"null"'), 'Deklaration darf kein "null" enthalten');
  });

  // Befund 1: end2endId muss auch bei DD gesetzt sein. Ohne diesen Fix
  // erzeugte die Lib <EndToEndId></EndToEndId> (leerer Pflicht-String) und
  // Banking-Software (Proficash, Volksbank) lehnte mit "invalider Wert: """ ab.
  it('DD-Transaktion enthält EndToEndId mit Wert (nicht leer)', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.02');
    assert.ok(!xml.includes('<EndToEndId></EndToEndId>'), 'EndToEndId darf NICHT leer sein');
    assert.ok(!xml.includes('<EndToEndId/>'), 'EndToEndId darf NICHT self-closing/leer sein');
    // mandateId wird als end2endId verwendet
    assert.ok(xml.includes('<EndToEndId>MAND-001-2025</EndToEndId>'), 'EndToEndId sollte mandateId enthalten');
    assert.ok(xml.includes('<EndToEndId>MAND-002-2025</EndToEndId>'), 'EndToEndId sollte mandateId enthalten');
  });

  it('DD-Transaktion ohne mandateId nutzt NOTPROVIDED-Fallback für end2endId', () => {
    // Wir testen die Helper-Funktion direkt – die Mandatsreferenz-Pflicht-Validation
    // im Generator würde diesen Fall zwar abfangen, aber der Fallback in der Lib-Übergabe
    // soll robust bleiben.
    const SEPA = require('../sepa.min.js');
    const doc = new SEPA.Document('pain.008.001.02');
    doc.grpHdr.id = 'X'; doc.grpHdr.created = new Date(); doc.grpHdr.initiatorName = 'T';
    const info = doc.createPaymentInfo();
    info.collectionDate = new Date();
    info.creditorName = TEST_DATA.creditor.name;
    info.creditorIBAN = TEST_DATA.creditor.iban;
    info.creditorBIC = TEST_DATA.creditor.bic;
    info.creditorId = TEST_DATA.creditor.id;
    info.sequenceType = 'RCUR';
    info.localInstrumentation = 'CORE';
    const txn = info.createTransaction();
    txn.debtorName = 'Test'; txn.debtorIBAN = 'DE89370400440532013000'; txn.debtorBIC = 'COBADEFFXXX';
    txn.amount = 10; txn.mandateId = 'M1'; txn.mandateSignatureDate = new Date();
    txn.end2endId = String('' || '') || 'NOTPROVIDED';
    txn.remittanceInfo = 'Test';
    info.addTransaction(txn);
    doc.addPaymentInfo(info);
    const xml = doc.toString();
    assert.ok(xml.includes('<EndToEndId>NOTPROVIDED</EndToEndId>'), 'NOTPROVIDED-Fallback erwartet');
  });

  // Befund 2: IBAN/BIC im Excel-Pfad werden zu Großbuchstaben normalisiert.
  it('IBAN in Kleinbuchstaben aus Excel wird zu UPPERCASE konvertiert', () => {
    const rows = [{
      Name: 'Test', IBAN: 'de89370400440532013000', BIC: 'cobadeffxxx',
      Betrag: 10, Verwendungszweck: 'Test',
    }];
    const result = processExcelRows(rows, 'transfer');
    assert.strictEqual(result[0].iban, 'DE89370400440532013000', 'IBAN muss uppercase sein');
    assert.strictEqual(result[0].bic, 'COBADEFFXXX', 'BIC muss uppercase sein');
  });

  it('IBAN mit gemischten Buchstaben aus Excel landet uppercase im XML', () => {
    const rows = [{
      Name: 'Test', IBAN: 'de89 3704 0044 0532 0130 00', BIC: 'CobaDeffXxx',
      Betrag: 10, Verwendungszweck: 'Test', Referenz: 'REF-1',
    }];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.03');
    assert.ok(xml.includes('<IBAN>DE89370400440532013000</IBAN>'), 'IBAN muss uppercase und ohne Leerzeichen im XML stehen');
    assert.ok(xml.includes('<BIC>COBADEFFXXX</BIC>'), 'BIC muss uppercase im XML stehen');
  });

  // Browser-Bug: Im Browser sind document.xmlVersion/xmlEncoding read-only.
  // Die Lib generiert dort encoding="null" – Banking-Software lehnt das ab
  // ("Dateiformat nicht unterstützt"). Der Generator repariert den Header
  // mit einem Regex-Replace. Hier simulieren wir den problematischen Header
  // und prüfen, dass das Replace robust ist.
  it('XML-Header-Replace korrigiert encoding="null" zu UTF-8 (Browser-Fix)', () => {
    const fixHeader = (xml) => xml.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');

    // Browser-Output (encoding=null)
    const browserXml = '<?xml version="1.0" encoding="null"?><Document><GrpHdr/></Document>';
    assert.strictEqual(
      fixHeader(browserXml),
      '<?xml version="1.0" encoding="UTF-8"?><Document><GrpHdr/></Document>',
      'encoding="null" muss zu encoding="UTF-8" werden'
    );

    // Auch version=null wird mitkorrigiert
    const bothNull = '<?xml version="null" encoding="null"?><Document/>';
    assert.strictEqual(
      fixHeader(bothNull),
      '<?xml version="1.0" encoding="UTF-8"?><Document/>',
      'Komplett kaputter Header muss ersetzt werden'
    );

    // Bereits korrekter Header bleibt korrekt (idempotent)
    const correctXml = '<?xml version="1.0" encoding="UTF-8"?><Document/>';
    assert.strictEqual(fixHeader(correctXml), correctXml, 'Idempotenz: korrekter Header darf nicht verändert werden');
  });

  it('excelToXML liefert validen XML-Header mit encoding="UTF-8"', () => {
    const xml = excelToXML(TEMPLATE_ROWS_DD, 'directDebit', 'pain.008.001.02');
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
      `XML muss mit UTF-8-Header beginnen, gefunden: "${xml.substring(0, 50)}"`);
    assert.ok(!xml.includes('encoding="null"'), 'encoding="null" darf nicht im Output stehen');
  });
});

// -------------------------------------------------------------------------
// 13. Excel-Import: Fehlerfälle
// -------------------------------------------------------------------------

describe('Excel-Import: Fehlerfälle', () => {

  it('leere Datei (0 Zeilen) ergibt leere Transaktionsliste', () => {
    const result = processExcelRows([], 'transfer');
    assert.strictEqual(result.length, 0);
    // Hinweis: Die SEPA-Library wirft keinen Fehler bei 0 Transaktionen
    // (A() prueft t && t.length, wobei t=0 falsy ist).
    // Die Validierung "keine Daten" muss im Generator selbst erfolgen.
  });

  it('ungültige IBAN in Excel-Daten wird von SEPA-Library abgefangen', () => {
    const rows = [{
      Name: 'Test Person', IBAN: 'DE00000000000000000000', BIC: '',
      Betrag: 100, Verwendungszweck: 'Test', Referenz: 'REF',
    }];
    assert.throws(() => {
      excelToXML(rows, 'transfer', 'pain.001.001.09');
    }, /IBAN/, 'Ungültige IBAN muss Fehler werfen');
  });

  it('Betrag = 0 in Excel wird von SEPA-Library abgefangen', () => {
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 0, Verwendungszweck: 'Test', Referenz: 'REF',
    }];
    assert.throws(() => {
      excelToXML(rows, 'transfer', 'pain.001.001.09');
    }, /amount/, 'Betrag 0 muss Fehler werfen');
  });

  it('negativer Betrag in Excel wird von SEPA-Library abgefangen', () => {
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: -50, Verwendungszweck: 'Test', Referenz: 'REF',
    }];
    assert.throws(() => {
      excelToXML(rows, 'transfer', 'pain.001.001.09');
    }, /amount/, 'Negativer Betrag muss Fehler werfen');
  });

  it('ungültige BIC-Länge in Excel wird von SEPA-Library abgefangen', () => {
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'ABC',
      Betrag: 100, Verwendungszweck: 'Test', Referenz: 'REF',
    }];
    assert.throws(() => {
      excelToXML(rows, 'transfer', 'pain.001.001.09');
    }, /BIC/, 'Ungültige BIC-Länge muss Fehler werfen');
  });

  it('Verwendungszweck über 140 Zeichen wird abgefangen', () => {
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 100, Verwendungszweck: 'A'.repeat(141), Referenz: 'REF',
    }];
    assert.throws(() => {
      excelToXML(rows, 'transfer', 'pain.001.001.09');
    }, /remittanceInfo/, 'Zu langer Verwendungszweck muss Fehler werfen');
  });

  it('fehlende Mandatsreferenz bei Lastschrift wird akzeptiert (leerer String)', () => {
    // Hinweis: Die SEPA-Library erlaubt leere mandateId, weil F() mit
    // "t && !t.match(...)" prueft — leerer String ist falsy und wird uebersprungen.
    // Die Validierung muss im Generator vor dem Library-Aufruf erfolgen.
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 100, Verwendungszweck: 'Test', Mandatsdatum: '2025-01-01',
    }];
    assert.doesNotThrow(() => {
      excelToXML(rows, 'directDebit', 'pain.008.001.08');
    }, 'Leere Mandatsreferenz wirft keinen Library-Fehler');
  });
});

// -------------------------------------------------------------------------
// BLZ->BIC-Ableitung (Bank-Kompatibilität)
//
// Hintergrund: Fehlt der BIC, erzeugte die Lib bisher für jede Partei
//   <FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>.
// Ältere Bankprogramme validieren gegen ein Schema, dessen <FinInstnId> nur
// <BIC> erlaubt, und lehnen jedes <Othr> ab ("no declaration found for element
// 'Othr'" / "not allowed for content model (BIC)"). Deshalb leiten wir den BIC
// bei fehlender Angabe aus der deutschen IBAN ab (BLZ = Stellen 5-12) anhand
// der offiziellen Bundesbank-Tabelle (blz-bic.js).
// -------------------------------------------------------------------------
describe('BLZ->BIC-Ableitung (Bank-Kompatibilität)', () => {

  it('Datentabelle ist geladen und plausibel groß', () => {
    assert.strictEqual(typeof BLZ_BIC, 'object');
    assert.ok(Object.keys(BLZ_BIC).length > 3000,
      `Erwartet >3000 Einträge, gefunden ${Object.keys(BLZ_BIC).length}`);
  });

  it('alle Einträge haben gültiges BLZ- und BIC-Format', () => {
    const bicRe = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
    for (const [blz, bic] of Object.entries(BLZ_BIC)) {
      assert.match(blz, /^\d{8}$/, `Ungültige BLZ: ${blz}`);
      assert.match(bic, bicRe, `Ungültiger BIC für BLZ ${blz}: ${bic}`);
      // BIC-Länderkennung (Stellen 5-6) muss zur deutschen IBAN passen (Lib-Check).
      assert.strictEqual(bic.substr(4, 2), 'DE', `BIC ${bic} nicht 'DE' an Position 5-6`);
    }
  });

  it('bekannte BLZ-Zuordnungen stimmen (Stichprobe aus der Bundesbank-Datei)', () => {
    assert.strictEqual(BLZ_BIC['37040044'], 'COBADEFFXXX'); // Commerzbank Köln
    assert.strictEqual(BLZ_BIC['12030000'], 'BYLADEM1001'); // DKB Berlin
    assert.strictEqual(BLZ_BIC['10077777'], 'NORSDE51XXX'); // norisbank
  });

  it('deriveBIC: deutsche IBAN -> BIC (auch mit Leerzeichen/Kleinbuchstaben)', () => {
    assert.strictEqual(deriveBIC('DE89370400440532013000'), 'COBADEFFXXX');
    assert.strictEqual(deriveBIC('de89 3704 0044 0532 0130 00'), 'COBADEFFXXX');
  });

  it('deriveBIC: ausländische IBAN -> "" (NOTPROVIDED-Fallback bleibt)', () => {
    assert.strictEqual(deriveBIC('GB29NWBK60161331926819'), '');
    assert.strictEqual(deriveBIC('FR7630006000011234567890189'), '');
  });

  it('deriveBIC: unbekannte/ungültige BLZ -> ""', () => {
    assert.strictEqual(deriveBIC('DE00000000000000000000'), ''); // BLZ 00000000 existiert nicht
    assert.strictEqual(deriveBIC(''), '');
    assert.strictEqual(deriveBIC(null), '');
  });

  it('Bug-Szenario: Lastschrift ohne BICs erzeugt <BIC>, kein <Othr>/NOTPROVIDED', () => {
    // Reproduziert die Fehlermeldung "element 'Othr' is not allowed for content
    // model '(BIC)'": mehrere Schuldner ohne BIC, alle deutsche IBANs.
    const rows = [
      { Name: 'Anna Schmidt', IBAN: 'DE75512108001245126199', BIC: '', Betrag: 10, Verwendungszweck: 'Beitrag', Mandatsreferenz: 'M1', Mandatsdatum: '2025-01-10' },
      { Name: 'Bernd Weber',  IBAN: 'DE27100777770209299700', BIC: '', Betrag: 11, Verwendungszweck: 'Beitrag', Mandatsreferenz: 'M2', Mandatsdatum: '2025-01-11' },
    ];
    const xml = excelToXML(rows, 'directDebit', 'pain.008.001.02');
    assertValidXML(xml, 'pain.008.001.02');
    assert.ok(!xml.includes('Othr><Id>NOTPROVIDED'), 'Kein Othr/NOTPROVIDED bei bekannten deutschen BLZ');
    assert.ok(xml.includes('<BIC>SOGEDEFFXXX</BIC>'), 'Abgeleiteter BIC für Anna fehlt');
    assert.ok(xml.includes('<BIC>NORSDE51XXX</BIC>'), 'Abgeleiteter BIC für Bernd fehlt');
  });

  it('Bug-Szenario: ausländische IBAN behält NOTPROVIDED-Fallback', () => {
    const rows = [
      { Name: 'John Smith', IBAN: 'GB29NWBK60161331926819', BIC: '', Betrag: 20, Verwendungszweck: 'Fee', Referenz: 'R1' },
    ];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    assertValidXML(xml, 'pain.001.001.09');
    assert.ok(xml.includes('<Othr><Id>NOTPROVIDED</Id></Othr>'), 'Foreign-IBAN muss NOTPROVIDED behalten');
  });
});

// -------------------------------------------------------------------------
// 14. Schema-Validierung gegen die echten XSDs
// -------------------------------------------------------------------------
//
// Die uebrigen Suiten pruefen, ob bestimmte Zeichenketten im XML vorkommen.
// Das reicht nicht: drei schema-brechende Fehler (<BIC> statt <BICFI> in den
// .08/.09-Formaten, flaches <ReqdExctnDt> statt <ReqdExctnDt><Dt>, fehlendes
// NbOfTxs im PmtInf) sind so unentdeckt in Produktion gelangt und erst durch
// Nutzer-Rueckmeldungen aufgefallen. Diese Suite validiert jedes erzeugte
// Dokument gegen das echte ISO-Schema.
//
// Die XSDs liegen in tests/xsd/ (per tools/fetch-xsd.mjs aktualisierbar).

const { execFileSync } = require('node:child_process');
const { writeFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DOMParser } = require('xmldom');

const XSD_DIR = path.join(__dirname, 'xsd');
const PSA_XSD_DIR = path.join(XSD_DIR, 'psa');

// xmllint liegt auf macOS und den meisten Linux-Distributionen bei. Fehlt es,
// wird die Suite uebersprungen statt rot zu laufen – aber sichtbar, damit
// niemand ein gruenes Testergebnis fuer eine echte Schema-Pruefung haelt.
const HAS_XMLLINT = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const SKIP_XSD = HAS_XMLLINT
  ? false
  : 'xmllint nicht gefunden – Schema-Validierung uebersprungen (macOS: vorinstalliert, Debian/Ubuntu: apt-get install libxml2-utils)';

// Formate, fuer die ein XSD vorliegt. pain.001.001.08 fehlt: die Bezugsquelle
// bietet es nicht an. Es wird weiter unten strukturell geprueft.
const XSD_FORMATS = [
  'pain.001.001.03',
  'pain.001.001.09',
  'pain.008.001.02',
  'pain.008.001.08',
  AT_CT_FORMAT,
  AT_DD_FORMAT,
];

/**
 * Prueft, ob eine Lastschrift-Art gegen das XSD des Formats validierbar ist.
 * Die lhv-Kopien sind die EPC-Core-Schemata (Typname ..._SDD_Core_C2PSP), die
 * in LclInstrm/Cd ausschliesslich CORE zulassen; B2B wird dort in der Suite
 * "Lastschrift-Art" strukturell geprueft. Das PSA-Profil deckt CORE UND B2B ab.
 */
function xsdSupportsInstrument(painFormat, instr) {
  return SEPA.isAustrianFormat(painFormat) || instr !== 'B2B';
}

const xsdTmpDir = mkdtempSync(path.join(os.tmpdir(), 'sepa-xsd-'));
let xsdFileCounter = 0;
let psaWorkDir = null;

/**
 * Liefert das PSA-Profil als Arbeitskopie OHNE <xs:assert>.
 *
 * Die PSA-Schemata sind XSD 1.1; xmllint kennt nur XSD 1.0 und bricht beim
 * Kompilieren mit "element assert: Schemas parser error" ab. Ohne die Asserts
 * kompiliert das Profil und prueft weiterhin alle Einschraenkungen aus dem
 * <xs:redefine> (Struktur, Muster, Codelisten). Die Assert-Regeln selbst
 * prueft assertPsaRules(). Die Originale in tests/xsd/psa/ bleiben unveraendert.
 */
function psaSchemaPath(painFormat) {
  if (!psaWorkDir) {
    psaWorkDir = path.join(xsdTmpDir, 'psa');
    mkdirSync(psaWorkDir);
    for (const file of readdirSync(PSA_XSD_DIR)) {
      const xsd = readFileSync(path.join(PSA_XSD_DIR, file), 'utf8')
        .replace(/<xd:assert\b[^>]*?\/>|<xd:assert\b[\s\S]*?<\/xd:assert>/g, '');
      writeFileSync(path.join(psaWorkDir, file), xsd);
    }
  }
  return path.join(psaWorkDir, `ISO.${painFormat}.xsd`);
}

/**
 * Validiert XML per xmllint gegen ein Schema.
 * @returns {string} '' wenn gueltig, sonst die vollstaendige xmllint-Ausgabe
 */
function schemaErrors(xml, painFormat, xsdPath) {
  const xmlPath = path.join(xsdTmpDir, `${painFormat}-${xsdFileCounter++}.xml`);
  writeFileSync(xmlPath, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', xsdPath, xmlPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    return '';
  } catch (e) {
    return (e.stderr ? e.stderr.toString() : '') || e.message;
  }
}

/**
 * Validiert einen XML-String gegen das XSD seines pain-Formats – bei den
 * PSA-Profilen inklusive der Assert-Regeln. Schlaegt mit der vollstaendigen
 * xmllint-Ausgabe fehl, damit die Fehlerzeile direkt lesbar ist statt nur
 * "fails to validate".
 */
function assertSchemaValid(xml, painFormat) {
  const at = SEPA.isAustrianFormat(painFormat);
  const xsdPath = at ? psaSchemaPath(painFormat) : path.join(XSD_DIR, `${painFormat}.xsd`);
  const details = schemaErrors(xml, painFormat, xsdPath);
  if (details) {
    assert.fail(`${painFormat} verletzt das Schema:\n${details}`);
  }
  if (at) {
    assertPsaRules(xml, painFormat);
  }
}

/**
 * Prueft die <xs:assert>-Regeln der PSA-Profile, die xmllint nicht auswerten
 * kann (siehe psaSchemaPath). Bewusst als explizite Liste nah am XSD, damit
 * beim naechsten PSA-Release ein Abgleich Zeile fuer Zeile moeglich ist.
 */
function assertPsaRules(xml, painFormat) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const kids = (el, name) => Array.from(el ? el.childNodes : [])
    .filter(n => n.nodeType === 1 && (!name || n.localName === name));
  const kid = (el, name) => kids(el, name)[0];
  const cents = el => Math.round(parseFloat(el.textContent) * 100);
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  const isDD = SEPA.basePainFormat(painFormat).startsWith('pain.008');
  const txName = isDD ? 'DrctDbtTxInf' : 'CdtTrfTxInf';
  const ultimate = isDD ? 'UltmtCdtr' : 'UltmtDbtr';
  const root = kids(doc.documentElement)[0];
  const grpHdr = kid(root, 'GrpHdr');
  const pmtInfs = kids(root, 'PmtInf');

  // CustomerCreditTransferInitiationV09 / CustomerDirectDebitInitiationV08
  assert.strictEqual(Number(kid(grpHdr, 'NbOfTxs').textContent),
    sum(pmtInfs.map(p => Number(kid(p, 'NbOfTxs').textContent))), 'PSA: GrpHdr/NbOfTxs = Summe PmtInf/NbOfTxs');
  assert.strictEqual(cents(kid(grpHdr, 'CtrlSum')),
    sum(pmtInfs.map(p => cents(kid(p, 'CtrlSum')))), 'PSA: GrpHdr/CtrlSum = Summe PmtInf/CtrlSum');
  const ids = pmtInfs.map(p => kid(p, 'PmtInfId').textContent);
  assert.strictEqual(new Set(ids).size, ids.length, 'PSA: PmtInfId eindeutig');
  assert.ok(pmtInfs.length < 10000, 'PSA: weniger als 10000 PmtInf');

  // PartyIdentification135_InitgPty: genau ein Kind (Nm ODER Id)
  assert.strictEqual(kids(kid(grpHdr, 'InitgPty')).length, 1, 'PSA: InitgPty hat genau ein Kind');

  for (const p of pmtInfs) {
    const txs = kids(p, txName);
    // PaymentInstruction30 / PaymentInstruction29
    assert.strictEqual(Number(kid(p, 'NbOfTxs').textContent), txs.length, 'PSA: PmtInf/NbOfTxs = Anzahl Transaktionen');
    const amount = t => cents(isDD ? kid(t, 'InstdAmt') : kid(kid(t, 'Amt'), 'InstdAmt'));
    assert.strictEqual(cents(kid(p, 'CtrlSum')), sum(txs.map(amount)), 'PSA: PmtInf/CtrlSum = Summe der Betraege');
    assert.ok(txs.length < 1000000, 'PSA: weniger als 1000000 Transaktionen je PmtInf');
    if (kid(p, 'PmtTpInf')) {
      assert.ok(txs.every(t => !kid(t, 'PmtTpInf')), 'PSA: PmtTpInf nicht zugleich auf PmtInf- und Transaktionsebene');
    } else {
      assert.ok(txs.every(t => kid(t, 'PmtTpInf')), 'PSA: ohne PmtInf/PmtTpInf braucht jede Transaktion eine');
    }
    if (kid(p, ultimate)) {
      assert.ok(txs.every(t => !kid(t, ultimate)), `PSA: ${ultimate} nicht zugleich auf beiden Ebenen`);
    }
    if (kid(p, 'ChrgBr')) {
      assert.ok(txs.every(t => !kid(t, 'ChrgBr')), 'PSA: ChrgBr nicht zugleich auf beiden Ebenen');
    }
    if (isDD) {
      const txSchemeIds = txs.filter(t => kid(kid(t, 'DrctDbtTx'), 'CdtrSchmeId')).length;
      assert.strictEqual(txSchemeIds, kid(p, 'CdtrSchmeId') ? 0 : txs.length,
        'PSA: CdtrSchmeId entweder im PmtInf oder in jeder Transaktion');
    } else if (kid(kid(p, 'ReqdExctnDt'), 'DtTm')) {
      const lcl = kid(kid(kid(p, 'PmtTpInf'), 'LclInstrm'), 'Cd');
      assert.ok(lcl && lcl.textContent === 'INST', 'PSA: ReqdExctnDt/DtTm nur bei LclInstrm INST');
    }

    for (const t of txs) {
      const rmtInf = kid(t, 'RmtInf');
      if (rmtInf) {
        assert.strictEqual(kids(rmtInf).length, 1, 'PSA: RmtInf hat genau ein Kind (Ustrd ODER Strd)');
      }
      if (isDD) {
        // MandateRelatedInformation14: AmdmntInd=true <=> genau ein AmdmntInfDtls
        const mndt = kid(kid(t, 'DrctDbtTx'), 'MndtRltdInf');
        const ind = kid(mndt, 'AmdmntInd');
        const amended = !!ind && ind.textContent === 'true';
        assert.strictEqual(kids(mndt, 'AmdmntInfDtls').length, amended ? 1 : 0, 'PSA: AmdmntInd passt zu AmdmntInfDtls');
      }
    }
  }

  // FinancialInstitutionIdentification18_*: genau ein Kind (BICFI ODER Othr);
  // PaymentTypeInformation*: mindestens ein Kind
  for (const fin of Array.from(doc.getElementsByTagName('FinInstnId'))) {
    assert.strictEqual(kids(fin).length, 1, 'PSA: FinInstnId hat genau ein Kind');
  }
  for (const pti of Array.from(doc.getElementsByTagName('PmtTpInf'))) {
    assert.ok(kids(pti).length > 0, 'PSA: PmtTpInf darf nicht leer sein');
  }
}

describe('Schema-Validierung (XSD)', { skip: SKIP_XSD }, () => {

  for (const fmt of XSD_FORMATS) {
    const isDD = fmt.startsWith('pain.008');

    it(`${fmt}: Standardfall validiert`, () => {
      const doc = isDD ? createDirectDebitDoc(fmt) : createTransferDoc(fmt);
      assertSchemaValid(doc.toString(), fmt);
    });

    it(`${fmt}: mehrere Transaktionen validieren`, () => {
      const doc = isDD
        ? createDirectDebitDoc(fmt, { transactions: TEST_DATA.accounts })
        : createTransferDoc(fmt, { transactions: TEST_DATA.accounts });
      assertSchemaValid(doc.toString(), fmt);
    });

    it(`${fmt}: ohne BIC (Othr/NOTPROVIDED) validiert`, () => {
      // Der NOTPROVIDED-Fallback muss in BEIDEN Basistyp-Generationen passen:
      // <Othr><Id> liegt in FinancialInstitutionIdentification7 wie in 18.
      const noBic = [{ name: 'Clara Fischer', iban: 'DE02120300000000202051', bic: '' }];
      const doc = isDD
        ? createDirectDebitDoc(fmt, { transactions: noBic })
        : createTransferDoc(fmt, { transactions: noBic });
      if (isDD) { doc._paymentInfo[0].creditorBIC = ''; }
      else      { doc._paymentInfo[0].debtorBIC = ''; }
      assertSchemaValid(doc.toString(), fmt);
    });

    it(`${fmt}: mit Postanschrift validiert`, () => {
      // PstlAdr wechselt zwischen PostalAddress6 und PostalAddress24 – die
      // Reihenfolge Ctry vor AdrLine muss in beiden stimmen.
      const doc = isDD ? createDirectDebitDoc(fmt) : createTransferDoc(fmt);
      const info = doc._paymentInfo[0];
      const party = isDD ? 'creditor' : 'debtor';
      info[`${party}Street`] = 'Hauptstrasse 1';
      info[`${party}City`] = 'Berlin';
      info[`${party}Country`] = 'DE';
      assertSchemaValid(doc.toString(), fmt);
    });

    it(`${fmt}: Excel-Pipeline validiert`, () => {
      const xml = isDD
        ? excelToXML(TEMPLATE_ROWS_DD, 'directDebit', fmt)
        : excelToXML(TEMPLATE_ROWS_CT, 'transfer', fmt);
      assertSchemaValid(xml, fmt);
    });

    if (isDD) {
      // Deckt die Luecke, durch die COR1 unbemerkt blieb: die
      // Sequenztyp-x-Instrumentierung-Matrix prueft nur, ob die Erzeugung
      // durchlaeuft, nicht ob das Ergebnis schema-konform ist.
      //
      // Bewusst ueber LOCAL_INSTRUMENTATIONS statt ueber eine feste Liste:
      // wird der Auswahl je ein neuer Code hinzugefuegt, wird er hier
      // automatisch gegen das Schema geprueft.
      for (const instr of LOCAL_INSTRUMENTATIONS.filter(i => xsdSupportsInstrument(fmt, i))) {
        it(`${fmt}: ${instr} validiert in allen Sequenztypen`, () => {
          for (const seq of SEQUENCE_TYPES) {
            const doc = createDirectDebitDoc(fmt, { sequenceType: seq, localInstrumentation: instr });
            assertSchemaValid(doc.toString(), fmt);
          }
        });
      }
    }

    it(`${fmt}: mit Adresse der Gegenpartei validiert`, () => {
      // Adresse auf Transaktionsebene: Dbtr bei Lastschrift, Cdtr bei
      // Ueberweisung. Bei AT strukturiert (StrtNm/TwnNm/Ctry), sonst Ctry +
      // AdrLine. Frueher las die Library hier immer die debtor*-Felder – bei
      // Ueberweisungen entstand so eine leere Adresse.
      const doc = isDD ? createDirectDebitDoc(fmt) : createTransferDoc(fmt);
      const txn = doc._paymentInfo[0]._payments[0];
      const party = isDD ? 'debtor' : 'creditor';
      txn[`${party}Street`] = 'Hauptstrasse 1';
      txn[`${party}City`] = 'Wien';
      txn[`${party}Country`] = 'AT';
      const xml = doc.toString();
      assert.ok(xml.includes(SEPA.isAustrianFormat(fmt)
        ? '<PstlAdr><StrtNm>Hauptstrasse 1</StrtNm><TwnNm>Wien</TwnNm><Ctry>AT</Ctry></PstlAdr>'
        : '<PstlAdr><Ctry>AT</Ctry><AdrLine>Hauptstrasse 1</AdrLine><AdrLine>Wien</AdrLine></PstlAdr>'),
        'Adresse der Gegenpartei fehlt oder ist falsch aufgebaut');
      assertSchemaValid(xml, fmt);
    });

    it(`${fmt}: mit Verwendungszweck-Code (Purp vor RmtInf) validiert`, () => {
      const doc = isDD ? createDirectDebitDoc(fmt) : createTransferDoc(fmt);
      doc._paymentInfo[0]._payments[0].purposeCode = isDD ? 'OTHR' : 'SALA';
      const xml = doc.toString();
      assert.ok(/<\/(Dbtr|Cdtr)Acct><Purp><Cd>[A-Z]{4}<\/Cd><\/Purp><RmtInf>/.test(xml), 'Purp muss vor RmtInf stehen');
      assertSchemaValid(xml, fmt);
    });

    it(`${fmt}: Excel-Pipeline mit Umlauten validiert`, () => {
      const rows = isDD
        ? [{ Name: 'Jörg Grün-Weiß', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX', Betrag: 12.34, Verwendungszweck: 'Beitrag für Straßenfest & Grünanlage', Mandatsreferenz: 'MAND-Ä-1', Mandatsdatum: '2025-06-15' }]
        : [{ Name: 'Jörg Grün-Weiß', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX', Betrag: 12.34, Verwendungszweck: 'Rechnung für Straßenfest & Grünanlage', Referenz: 'REF-Ä-1' }];
      const xml = excelToXML(rows, isDD ? 'directDebit' : 'transfer', fmt);
      if (SEPA.isAustrianFormat(fmt)) {
        // PSA: Freitexte behalten Umlaute und "&", Referenzen nicht (Max35Text_REF)
        assert.ok(xml.includes('<Nm>Jörg Grün-Weiß</Nm>'), 'AT: Umlaute im Namen muessen erhalten bleiben');
        assert.ok(xml.includes('für Straßenfest &amp; Grünanlage'), 'AT: Umlaute und & im Verwendungszweck muessen erhalten bleiben');
        assert.ok(xml.includes(isDD ? '<MndtId>MAND-Ae-1</MndtId>' : '<EndToEndId>REF-Ae-1</EndToEndId>'),
          'AT: Referenzen muessen im Basiszeichensatz stehen');
      } else {
        assert.ok(!/[^\x00-\x7F]/.test(xml), 'XML darf nach der Umwandlung keine Nicht-ASCII-Zeichen mehr enthalten');
      }
      assertSchemaValid(xml, fmt);
    });
  }

  // Beweist, dass xmllint das <xs:redefine> der PSA-Profile tatsaechlich
  // anwendet: dieselbe Datei, die das ISO-Schema akzeptiert, muss am
  // PSA-Profil scheitern. Ohne diese Gegenprobe koennte ein still ignoriertes
  // redefine alle AT-Tests gruen faerben.
  it('PSA-Profil greift: Standard-.09 mit Dbtr-Adresse wird abgelehnt', () => {
    const doc = createTransferDoc('pain.001.001.09');
    const info = doc._paymentInfo[0];
    info.debtorStreet = 'Ring 1';
    info.debtorCity = 'Wien';
    info.debtorCountry = 'AT';
    const xml = doc.toString();
    assertSchemaValid(xml, 'pain.001.001.09');
    assert.match(schemaErrors(xml, AT_CT_FORMAT, psaSchemaPath(AT_CT_FORMAT)), /PstlAdr.*not expected/);
  });

  it('PSA-Profil greift: Standard-.08 mit Cdtr-Adresse wird abgelehnt', () => {
    const doc = createDirectDebitDoc('pain.008.001.08');
    const info = doc._paymentInfo[0];
    info.creditorStreet = 'Ring 1';
    info.creditorCity = 'Wien';
    info.creditorCountry = 'AT';
    const xml = doc.toString();
    assertSchemaValid(xml, 'pain.008.001.08');
    assert.match(schemaErrors(xml, AT_DD_FORMAT, psaSchemaPath(AT_DD_FORMAT)), /PstlAdr.*not expected/);
  });

  it('PSA-Profil greift: CdtrAgt mit NOTPROVIDED wird abgelehnt', () => {
    const doc = createTransferDoc('pain.001.001.09', {
      transactions: [{ ...TEST_DATA.accounts[2], bic: '' }],
    });
    assert.match(schemaErrors(doc.toString(), AT_CT_FORMAT, psaSchemaPath(AT_CT_FORMAT)), /Othr.*not expected/);
  });

  // Gegenprobe fuer assertPsaRules: ein manipuliertes Dokument muss scheitern
  it('PSA-Assert-Regeln erkennen Verstoesse', () => {
    const xml = createTransferDoc(AT_CT_FORMAT, { transactions: TEST_DATA.accounts }).toString();
    assert.doesNotThrow(() => assertPsaRules(xml, AT_CT_FORMAT));
    assert.throws(() => assertPsaRules(xml.replace('<CtrlSum>4500.00</CtrlSum>', '<CtrlSum>4500.01</CtrlSum>'), AT_CT_FORMAT),
      /CtrlSum/);
    assert.throws(() => assertPsaRules(xml.replace('</InitgPty>', '<Id/></InitgPty>'), AT_CT_FORMAT),
      /InitgPty/);
    assert.throws(() => assertPsaRules(
      xml.replace('</RmtInf>', '<Strd/></RmtInf>'), AT_CT_FORMAT), /RmtInf/);
  });
});

// -------------------------------------------------------------------------
// 15. BIC vs. BICFI (formatabhaengiger Elementname)
// -------------------------------------------------------------------------
//
// Gemeldet von einem Nutzer: pain.008.001.08 wurde abgelehnt, weil die Lib
// <BIC> schrieb. Die 2019er-Basistypen (FinancialInstitutionIdentification18)
// erwarten <BICFI>. Ein globales Ersetzen waere falsch – die weiterhin
// verbreiteten Formate .02/.03 brauchen unveraendert <BIC>.

describe('BIC vs. BICFI', () => {

  it('bicTagName liefert BIC fuer die alten Basistypen', () => {
    assert.strictEqual(SEPA.bicTagName('pain.001.001.03'), 'BIC');
    assert.strictEqual(SEPA.bicTagName('pain.008.001.02'), 'BIC');
  });

  it('bicTagName liefert BICFI ab .08 – in beiden Nachrichtenfamilien', () => {
    assert.strictEqual(SEPA.bicTagName('pain.001.001.08'), 'BICFI');
    assert.strictEqual(SEPA.bicTagName('pain.001.001.09'), 'BICFI');
    assert.strictEqual(SEPA.bicTagName('pain.008.001.08'), 'BICFI');
  });

  it('bicTagName liefert BICFI auch fuer die PSA-Profile (Endung ".005"/".004")', () => {
    // Die AT-Werte enden auf die PSA-Version – ein substr(-2) ergaebe "05"/"04"
    // und damit faelschlich <BIC>
    assert.strictEqual(SEPA.bicTagName(AT_CT_FORMAT), 'BICFI');
    assert.strictEqual(SEPA.bicTagName(AT_DD_FORMAT), 'BICFI');
  });

  for (const fmt of ['pain.008.001.02', 'pain.001.001.03']) {
    it(`${fmt} schreibt <BIC> und niemals <BICFI>`, () => {
      const doc = fmt.startsWith('pain.008') ? createDirectDebitDoc(fmt) : createTransferDoc(fmt);
      const xml = doc.toString();
      assert.ok(xml.includes('<BIC>COBADEFFXXX</BIC>'), 'Erwartet <BIC> in den alten Basistypen');
      assert.ok(!xml.includes('<BICFI>'), 'BICFI existiert in diesem Schema nicht');
    });
  }

  for (const fmt of ['pain.008.001.08', 'pain.001.001.08', 'pain.001.001.09', AT_DD_FORMAT, AT_CT_FORMAT]) {
    it(`${fmt} schreibt <BICFI> und niemals <BIC>`, () => {
      const doc = fmt.startsWith('pain.008') ? createDirectDebitDoc(fmt) : createTransferDoc(fmt);
      const xml = doc.toString();
      assert.ok(xml.includes('<BICFI>COBADEFFXXX</BICFI>'), 'Erwartet <BICFI> in den 2019er-Basistypen');
      assert.ok(!/<BIC>/.test(xml), 'BIC ist in diesem Schema nicht deklariert');
    });
  }

  it('beide Parteien (PmtInf und Transaktion) verwenden denselben Tag', () => {
    const xml = createDirectDebitDoc('pain.008.001.08').toString();
    // Glaeubiger-Bank im PmtInf UND Schuldner-Bank in der Transaktion
    assert.strictEqual((xml.match(/<BICFI>/g) || []).length, 2);
  });
});

// -------------------------------------------------------------------------
// 16. ReqdExctnDt: ISODate vs. DateAndDateTime2Choice
// -------------------------------------------------------------------------
//
// Ab pain.001.001.08 ist ReqdExctnDt keine ISODate mehr, sondern eine Choice.
// Flach geschrieben lehnen Banken ab mit "Missing child element(s).
// Expected is one of ( Dt, DtTm )". Bei der Lastschrift bleibt ReqdColltnDt
// dagegen in allen Versionen eine flache ISODate.

describe('ReqdExctnDt-Struktur', () => {

  it('pain.001.001.03 schreibt das Datum flach', () => {
    const xml = createTransferDoc('pain.001.001.03').toString();
    assert.ok(xml.includes('<ReqdExctnDt>2026-02-01</ReqdExctnDt>'));
  });

  for (const fmt of ['pain.001.001.08', 'pain.001.001.09', AT_CT_FORMAT]) {
    it(`${fmt} verschachtelt das Datum in <Dt>`, () => {
      const xml = createTransferDoc(fmt).toString();
      assert.ok(xml.includes('<ReqdExctnDt><Dt>2026-02-01</Dt></ReqdExctnDt>'),
        'Erwartet <ReqdExctnDt><Dt>…</Dt></ReqdExctnDt>');
    });
  }

  for (const fmt of DD_FORMATS) {
    it(`${fmt}: ReqdColltnDt bleibt flach`, () => {
      const xml = createDirectDebitDoc(fmt).toString();
      assert.ok(xml.includes('<ReqdColltnDt>2026-02-01</ReqdColltnDt>'),
        'ReqdColltnDt ist in allen Versionen eine ISODate');
    });
  }
});

// -------------------------------------------------------------------------
// 17. SEPA-Zeichensatz (EPC217-08)
// -------------------------------------------------------------------------
//
// Gemeldet von einem Nutzer: Banken lehnen Umlaute ab, obwohl die Datei
// UTF-8-kodiert ist. Der EPC-Zeichenvorrat kennt nur
// a-z A-Z 0-9 Leerzeichen und / - ? : ( ) . , ' +

describe('SEPA-Zeichensatz (toSepaText)', () => {

  it('loest deutsche Umlaute nach Konvention auf', () => {
    assert.strictEqual(SEPA.toSepaText('Jörg Grün'), 'Joerg Gruen');
    assert.strictEqual(SEPA.toSepaText('Müller Straße'), 'Mueller Strasse');
    assert.strictEqual(SEPA.toSepaText('ÄÖÜ äöü ß'), 'AeOeUe aeoeue ss');
  });

  it('reduziert Umlaute NICHT auf den Grundbuchstaben', () => {
    // Die NFD-Zerlegung darf erst NACH der Ersetzungstabelle laufen, sonst
    // wuerde "ä" zu "a" statt zu "ae".
    assert.ok(!SEPA.toSepaText('Müller').includes('Muller'));
  });

  it('entfernt Akzente anderer Sprachen', () => {
    assert.strictEqual(SEPA.toSepaText('José Ñuñez'), 'Jose Nunez');
    assert.strictEqual(SEPA.toSepaText('Çelik Ağa'), 'Celik Aga');
    assert.strictEqual(SEPA.toSepaText('Łukasz Þór'), 'Lukasz Thor');
  });

  it('ersetzt Sonderzeichen sinnvoll statt sie zu loeschen', () => {
    assert.strictEqual(SEPA.toSepaText('Müller & Söhne'), 'Mueller + Soehne');
    assert.strictEqual(SEPA.toSepaText('Betrag 100€'), 'Betrag 100EUR');
    assert.strictEqual(SEPA.toSepaText('„Zitat“ – Ende…'), "'Zitat' - Ende...");
  });

  it('behaelt den erlaubten Zeichenvorrat unveraendert', () => {
    const allowed = "ABCabc012 /-?:().,'+";
    assert.strictEqual(SEPA.toSepaText(allowed), allowed);
  });

  it('normalisiert Whitespace (auch Zeilenumbrueche)', () => {
    assert.strictEqual(SEPA.toSepaText('  Max\n\tMustermann  '), 'Max Mustermann');
  });

  it('ist robust gegen null, undefined und Zahlen aus Excel', () => {
    assert.strictEqual(SEPA.toSepaText(null), '');
    assert.strictEqual(SEPA.toSepaText(undefined), '');
    assert.strictEqual(SEPA.toSepaText(''), '');
    assert.strictEqual(SEPA.toSepaText(12345), '12345');
  });

  it('kuerzt erst NACH der Umwandlung auf die Feldlaenge', () => {
    // 40x "ß" ergibt 80 Zeichen "s" – wuerde man vor der Umwandlung kuerzen,
    // waere das Ergebnis wieder zu lang.
    const out = SEPA.toSepaText('ß'.repeat(40), 70);
    assert.strictEqual(out.length, 70);
    assert.strictEqual(out, 's'.repeat(70));
  });

  it('laesst beim Kuerzen kein Leerzeichen am Ende stehen', () => {
    assert.strictEqual(SEPA.toSepaText('abcde fghij', 6), 'abcde');
  });

  it('ohne Laengenangabe wird nicht gekuerzt', () => {
    assert.strictEqual(SEPA.toSepaText('A'.repeat(200)).length, 200);
  });
});

describe('SEPA-Zeichensatz: oesterreichisches PSA-Profil', () => {

  it('behaelt Umlaute, ß und die PSA-Sonderzeichen', () => {
    assert.strictEqual(SEPA.toSepaText('Müller & Söhne', 70, AT_CT_FORMAT), 'Müller & Söhne');
    assert.strictEqual(SEPA.toSepaText('ÄÖÜ äöü ß', 70, AT_DD_FORMAT), 'ÄÖÜ äöü ß');
    const extra = 'Preis 100€ $5 §3 50% a!=b #1 ~x; *{y}[z] @home C:\\pfad_1 20° 2^3 <a> "q" a|b';
    assert.strictEqual(SEPA.toSepaText(extra, 140, AT_CT_FORMAT), extra);
  });

  it('wandelt Zeichen ausserhalb des PSA-Zeichensatzes weiterhin um', () => {
    assert.strictEqual(SEPA.toSepaText('José Ñuñez', 70, AT_CT_FORMAT), 'Jose Nunez');
    assert.strictEqual(SEPA.toSepaText('„Zitat“ – Ende…', 70, AT_CT_FORMAT), "'Zitat' - Ende...");
    assert.strictEqual(SEPA.toSepaText('Æsir £5', 70, AT_CT_FORMAT), 'Aesir GBP5');
  });

  it('erhaelt auch zerlegt eingegebene Umlaute (NFD, z.B. aus macOS)', () => {
    assert.strictEqual(SEPA.toSepaText('Mu\u0308ller', 70, AT_CT_FORMAT), 'Müller');
  });

  it('aendert ohne Format bzw. bei Nicht-AT-Formaten nichts am Basisverhalten', () => {
    assert.strictEqual(SEPA.toSepaText('Müller & Söhne', 70, 'pain.001.001.09'), 'Mueller + Soehne');
    assert.strictEqual(SEPA.toSepaText('Müller & Söhne'), 'Mueller + Soehne');
  });

  it('Umlaute im XML bleiben in AT erhalten, in .09 nicht', () => {
    const rows = [{
      Name: 'Jörg Grün', IBAN: 'AT483200000012345864', BIC: '',
      Betrag: 12.34, Verwendungszweck: 'Beitrag für Straßenfest', Referenz: 'REF-1',
    }];
    const at = excelToXML(rows, 'transfer', AT_CT_FORMAT);
    assert.ok(at.includes('<Nm>Jörg Grün</Nm>'));
    assert.ok(at.includes('<Ustrd>Beitrag für Straßenfest</Ustrd>'));
    const std = excelToXML(rows, 'transfer', 'pain.001.001.09');
    assert.ok(std.includes('<Nm>Joerg Gruen</Nm>'));
  });
});

describe('SEPA-Referenzen (toSepaId)', () => {

  it('entfernt "/" am Anfang und Ende und reduziert "//" (EPC-Regel fuer Referenzen)', () => {
    assert.strictEqual(SEPA.toSepaId('/RE-1/'), 'RE-1');
    assert.strictEqual(SEPA.toSepaId('RE//2026//1'), 'RE/2026/1');
    assert.strictEqual(SEPA.toSepaId(' / RE 1 / '), 'RE 1');
  });

  it('bleibt beim Basiszeichensatz – auch fuer AT-Referenzen', () => {
    assert.strictEqual(SEPA.toSepaId('MAND-Ä-1'), 'MAND-Ae-1');
    assert.strictEqual(SEPA.toSepaId('A&B'), 'A+B');
  });

  it('liefert leer, wenn nichts Gueltiges uebrig bleibt (Aufrufer setzt Fallback)', () => {
    assert.strictEqual(SEPA.toSepaId('///'), '');
    assert.strictEqual(SEPA.toSepaId(null), '');
  });

  it('kuerzt ohne "/" am Ende zu hinterlassen', () => {
    assert.strictEqual(SEPA.toSepaId('A'.repeat(34) + '/B', 35), 'A'.repeat(34));
  });

  it('ist robust gegen Zahlen aus Excel', () => {
    assert.strictEqual(SEPA.toSepaId(12345), '12345');
  });

  it('bereinigte Referenz validiert gegen das PSA-Schema', { skip: SKIP_XSD }, () => {
    const doc = createTransferDoc(AT_CT_FORMAT, {
      transactions: [{ ...TEST_DATA.accounts[0], end2endId: sepaId('//RE//Ä-1/', 35) }],
    });
    const xml = doc.toString();
    assert.ok(xml.includes('<EndToEndId>RE/Ae-1</EndToEndId>'));
    assertSchemaValid(xml, AT_CT_FORMAT);
  });
});

describe('PSA-Profile: Formatzuordnung', () => {

  it('basePainFormat liefert das ISO-Basisformat', () => {
    assert.strictEqual(SEPA.basePainFormat(AT_CT_FORMAT), 'pain.001.001.09');
    assert.strictEqual(SEPA.basePainFormat(AT_DD_FORMAT), 'pain.008.001.08');
    assert.strictEqual(SEPA.basePainFormat('pain.001.001.03'), 'pain.001.001.03');
  });

  it('isAustrianFormat erkennt nur die PSA-Profile', () => {
    assert.ok(SEPA.isAustrianFormat(AT_CT_FORMAT));
    assert.ok(SEPA.isAustrianFormat(AT_DD_FORMAT));
    assert.ok(!SEPA.isAustrianFormat('pain.001.001.09'));
    assert.ok(!SEPA.isAustrianFormat('pain.001.001.09.austrian.006.N'));
  });

  it('Namespace und Root-Element kommen vom Basisformat, schemaLocation nennt die PSA-Datei', () => {
    const ct = createTransferDoc(AT_CT_FORMAT).toString();
    assert.ok(ct.includes('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"'));
    assert.ok(ct.includes('xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09 ISO.pain.001.001.09.austrian.005.xsd"'));
    assert.ok(ct.includes('<CstmrCdtTrfInitn>'));
    const dd = createDirectDebitDoc(AT_DD_FORMAT).toString();
    assert.ok(dd.includes('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08"'));
    assert.ok(dd.includes('<CstmrDrctDbtInitn>'));
  });

  it('AT-Ueberweisung laesst die Zahler-Adresse weg, AT-Lastschrift die Glaeubiger-Adresse', () => {
    const ct = createTransferDoc(AT_CT_FORMAT);
    Object.assign(ct._paymentInfo[0], { debtorStreet: 'Ring 1', debtorCity: 'Wien', debtorCountry: 'AT' });
    assert.ok(!ct.toString().includes('<PstlAdr>'));
    const dd = createDirectDebitDoc(AT_DD_FORMAT);
    Object.assign(dd._paymentInfo[0], { creditorStreet: 'Ring 1', creditorCity: 'Wien', creditorCountry: 'AT' });
    assert.ok(!dd.toString().includes('<PstlAdr>'));
  });

  it('AT-Lastschrift behaelt NOTPROVIDED fuer fehlende BICs (dort erlaubt)', () => {
    const dd = createDirectDebitDoc(AT_DD_FORMAT, { transactions: [TEST_DATA.accounts[2]] });
    assert.ok(dd.toString().includes('<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>'));
  });

  it('AT prueft die Stadt auf 35 Zeichen (TwnNm)', () => {
    const doc = createTransferDoc(AT_CT_FORMAT);
    Object.assign(doc._paymentInfo[0]._payments[0], { creditorStreet: 'Ring 1', creditorCity: 'W'.repeat(36), creditorCountry: 'AT' });
    assert.throws(() => doc.toString(), /creditorCity/);
  });
});

describe('SEPA-Zeichensatz: Wirkung im XML', () => {

  it('Umlaute erscheinen umgewandelt im XML', () => {
    const rows = [{
      Name: 'Jörg Grün', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 12.34, Verwendungszweck: 'Beitrag für Straßenfest', Referenz: 'REF-1',
    }];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    assert.ok(xml.includes('<Nm>Joerg Gruen</Nm>'));
    assert.ok(xml.includes('<Ustrd>Beitrag fuer Strassenfest</Ustrd>'));
    assert.ok(!xml.includes('ö') && !xml.includes('ü') && !xml.includes('ß'));
  });

  it('zu langer Verwendungszweck wirft weiterhin einen Fehler (kein stilles Kuerzen)', () => {
    // Wichtig: die Umwandlung darf die bestehende Laengenpruefung nicht
    // aushebeln – sonst verschwaende Text spurlos in der Bankdatei.
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 100, Verwendungszweck: 'A'.repeat(141), Referenz: 'REF',
    }];
    assert.throws(() => excelToXML(rows, 'transfer', 'pain.001.001.09'), /remittanceInfo/);
  });

  it('ein durch die Umwandlung verlaengerter Verwendungszweck wird gekuerzt statt abgelehnt', () => {
    // 140 Zeichen Eingabe, die durch "ß" -> "ss" auf 210 waechst: Der Nutzer
    // hat die Feldgrenze eingehalten, also darf hier kein Fehler entstehen.
    const rows = [{
      Name: 'Test Person', IBAN: 'DE89370400440532013000', BIC: 'COBADEFFXXX',
      Betrag: 100, Verwendungszweck: 'ß'.repeat(70) + 'A'.repeat(70), Referenz: 'REF',
    }];
    const xml = excelToXML(rows, 'transfer', 'pain.001.001.09');
    const ustrd = xml.match(/<Ustrd>([^<]*)<\/Ustrd>/)[1];
    assert.strictEqual(ustrd.length, 140);
  });
});

// -------------------------------------------------------------------------
// 18. InstrId-Praefix und CreDtTm-Format
// -------------------------------------------------------------------------

describe('InstrId und CreDtTm', () => {

  it('InstrId wird mit der PmtInfId praefixt (nicht ".0")', () => {
    // addTransaction leitet die InstrId aus info.id ab. Wurde addPaymentInfo
    // erst nach den Transaktionen aufgerufen, war info.id noch leer und jede
    // InstrId hiess nur ".0", ".1", ...
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.09');
    assert.ok(!xml.includes('<InstrId>.'), 'InstrId darf nicht mit einem Punkt beginnen');
    assert.ok(xml.includes('<InstrId>MSG-EXCEL-TEST.0.0</InstrId>'));
    assert.ok(xml.includes('<InstrId>MSG-EXCEL-TEST.0.1</InstrId>'));
  });

  it('InstrId bleibt innerhalb von 35 Zeichen', () => {
    const xml = excelToXML(TEMPLATE_ROWS_CT, 'transfer', 'pain.001.001.09');
    for (const m of xml.matchAll(/<InstrId>([^<]*)<\/InstrId>/g)) {
      assert.ok(m[1].length <= 35, `InstrId zu lang: "${m[1]}" (${m[1].length})`);
    }
  });

  it('CreDtTm wird ohne Millisekunden geschrieben', () => {
    const xml = createTransferDoc('pain.001.001.09').toString();
    assert.ok(xml.includes('<CreDtTm>2026-01-15T10:00:00Z</CreDtTm>'),
      'Erwartet YYYY-MM-DDThh:mm:ssZ ohne Sekundenbruchteile');
  });
});

// -------------------------------------------------------------------------
// 19. Lastschrift-Art: CORE und B2B, kein COR1
// -------------------------------------------------------------------------
//
// Gemeldet von einem Nutzer: pain.008.001.08 wurde abgelehnt mit
// "Element 'Cd': [facet 'enumeration'] The value 'COR1' is not an element of
// the set". COR1 ("Eil-Lastschrift", D-1) wurde zum 21.11.2016 abgeschafft –
// seither gilt die verkuerzte Vorlaufzeit fuer CORE, und CORE hat die Funktion
// uebernommen. Die Schemata der Kreditwirtschaft kennen den Code nicht mehr.
//
// Warum das durchrutschte: Die Matrix-Suite oben erzeugt zwar COR1-Dokumente,
// prueft aber nur, ob die XML-Erzeugung fehlerfrei durchlaeuft – nicht, ob das
// Ergebnis schema-konform ist. Die XSD-Suite deckte wiederum nur den Standard-
// fall CORE ab. Beide Luecken sind jetzt geschlossen.

describe('Lastschrift-Art (LclInstrm)', () => {

  it('COR1 wird abgelehnt', () => {
    assert.throws(
      () => createDirectDebitDoc('pain.008.001.08', { localInstrumentation: 'COR1' }).toString(),
      /localInstrumentation/,
      'COR1 ist seit dem 21.11.2016 kein gueltiger Code mehr'
    );
  });

  it('COR1 wird auch im alten Format abgelehnt', () => {
    // Der Fehler betraf nicht nur .08: auch pain.008.001.02 kennt COR1 nicht
    // mehr, und dieses Format ist im Tool vorausgewaehlt.
    assert.throws(
      () => createDirectDebitDoc('pain.008.001.02', { localInstrumentation: 'COR1' }).toString(),
      /localInstrumentation/
    );
  });

  it('ein Fantasie-Code wird ebenfalls abgelehnt', () => {
    assert.throws(
      () => createDirectDebitDoc('pain.008.001.08', { localInstrumentation: 'CORE1' }).toString(),
      /localInstrumentation/
    );
  });

  for (const fmt of DD_FORMATS) {
    it(`${fmt}: CORE landet als <Cd>CORE</Cd> im XML`, () => {
      const xml = createDirectDebitDoc(fmt, { localInstrumentation: 'CORE' }).toString();
      assert.ok(xml.includes('<LclInstrm><Cd>CORE</Cd></LclInstrm>'));
    });

    it(`${fmt}: B2B bleibt verfuegbar`, () => {
      // B2B ist NICHT abgeschafft – nur COR1. Ein pauschales Aufraeumen der
      // Auswahlliste wuerde Firmenlastschriften unmoeglich machen.
      const xml = createDirectDebitDoc(fmt, { localInstrumentation: 'B2B' }).toString();
      assert.ok(xml.includes('<LclInstrm><Cd>B2B</Cd></LclInstrm>'));
    });
  }

  // Hinweis zur Schema-Pruefung von B2B:
  // Die XSDs in tests/xsd/ sind die vom EPC veroeffentlichte Core-Variante
  // (Typname ..._SDD_Core_C2PSP) und lassen in LclInstrm/Cd ausschliesslich
  // CORE zu. B2B-Dateien werden gegen das separate B2B-Schema geprueft, das
  // die Bezugsquelle nicht anbietet. B2B wird deshalb oben strukturell statt
  // per XSD abgesichert – nicht, weil der Code ungeprueft waere.
  it('die eingecheckten XSDs sind die Core-Variante (dokumentiert die Luecke oben)', () => {
    const { readFileSync } = require('node:fs');
    const xsd = readFileSync(path.join(XSD_DIR, 'pain.008.001.08.xsd'), 'utf8');
    assert.ok(xsd.includes('_SDD_Core_C2PSP'),
      'Erwartet die Core-Variante – sonst stimmt der Kommentar zur B2B-Abdeckung nicht mehr');
  });
});

// -------------------------------------------------------------------------
// 20. Migration gespeicherter Konfigurationen
// -------------------------------------------------------------------------

describe('Konfigurations-Migration', () => {

  // Spiegelt migrateLocalInstrument() aus sepa-generator.js.
  const migrateLocalInstrument = (value) => (value === 'COR1' ? 'CORE' : value);

  it('gespeichertes COR1 wird auf CORE migriert', () => {
    // Ohne Migration setzt der Restore das Auswahlfeld auf einen nicht mehr
    // existierenden Eintrag – der Wert waere leer und die XML enthielte <Cd/>.
    assert.strictEqual(migrateLocalInstrument('COR1'), 'CORE');
  });

  it('gueltige Werte bleiben unveraendert', () => {
    assert.strictEqual(migrateLocalInstrument('CORE'), 'CORE');
    assert.strictEqual(migrateLocalInstrument('B2B'), 'B2B');
  });

  it('das migrierte Ergebnis erzeugt schema-valides XML', { skip: SKIP_XSD }, () => {
    const doc = createDirectDebitDoc('pain.008.001.08', {
      localInstrumentation: migrateLocalInstrument('COR1'),
    });
    assertSchemaValid(doc.toString(), 'pain.008.001.08');
  });
});
