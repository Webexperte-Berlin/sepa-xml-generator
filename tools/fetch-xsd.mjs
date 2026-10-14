#!/usr/bin/env node
/**
 * fetch-xsd.mjs — laedt die ISO-20022-Schemadateien nach tests/xsd/ und
 * korrigiert einen bekannten Defekt der Bezugsquelle.
 *
 * Warum: Die Testsuite hat lange nur geprueft, ob bestimmte Zeichenketten im
 * erzeugten XML vorkommen. Drei schema-brechende Fehler (<BIC> statt <BICFI>
 * in den .08/.09-Formaten, flaches <ReqdExctnDt> statt <ReqdExctnDt><Dt>,
 * fehlendes NbOfTxs im PmtInf) sind so unentdeckt in Produktion gelangt und
 * erst durch Nutzer-Rueckmeldungen aufgefallen. Seither validieren die Tests
 * jedes erzeugte Dokument gegen das echte Schema.
 *
 * AKTUALISIERUNG:
 *   node tools/fetch-xsd.mjs
 * Ergebnis: tests/xsd/*.xsd (im Repo eingecheckt, damit die Tests ohne
 * Netzzugriff laufen).
 *
 * BEZUGSQUELLE: partners.lhv.ee spiegelt die ISO-Originale. Die ISO selbst
 * bietet die Schemata nur als ZIP hinter einer Katalogseite an, die sich nicht
 * stabil verlinken laesst.
 *
 * BEKANNTER DEFEKT DER QUELLE (wird hier korrigiert):
 *   ServiceLevel8Choice ist dort als <xs:sequence> mit optionalem <Cd> und
 *   PFLICHT-<Prtry> deklariert. Im ISO-Original ist es eine <xs:choice>.
 *   Unkorrigiert meldet jede korrekte SEPA-Datei faelschlich
 *   "Element 'SvcLvl': Missing child element(s). Expected is ( Prtry )".
 *
 * NICHT VERFUEGBAR: pain.001.001.08 wird von der Quelle nicht angeboten.
 * Dieses Format wird in den Tests strukturell statt per XSD geprueft.
 *
 * OESTERREICH (PSA): Die Payment Services Austria veroeffentlicht ihre
 * Profile als ZIP mit drei Dateien (Profil + eigene Fassung des ISO-Basis-
 * schemas + Codelisten). Sie landen UNVERAENDERT in tests/xsd/psa/ – eigenes
 * Verzeichnis, weil das Profil das Basisschema per <xs:redefine> relativ
 * einbindet und die PSA-Fassung nicht mit der lhv-Kopie identisch ist.
 * Die Profile sind XSD 1.1 (<xs:assert>); das kann xmllint nicht. Die Tests
 * entfernen die Asserts deshalb erst zur Laufzeit in einer Arbeitskopie und
 * pruefen deren Regeln separat (siehe assertPsaRules in tests/sepa.test.js).
 *
 * Download per curl statt fetch: Der PSA-Server liefert eine unvollstaendige
 * Zertifikatskette, Node bricht mit UNABLE_TO_VERIFY_LEAF_SIGNATURE ab.
 * curl und unzip liegen – wie xmllint – auf macOS und Linux bei.
 */
import { writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tests', 'xsd');
const psaDir = join(outDir, 'psa');

const PSA_BASE = 'https://zv.psa.at/de/download/xml/kunde-bank/rb-2023/xml-schemata-2/';
const PSA_ZIPS = [
  {
    url: PSA_BASE + '485-iso-pain-001-001-09-austrian-005-zip/file.html',
    files: ['ISO.pain.001.001.09.austrian.005.xsd', 'pain.001.001.09.xsd', 'pain.001.codelists.xsd'],
  },
  {
    url: PSA_BASE + '488-iso-pain-008-001-08-austrian-004-zip/file.html',
    files: ['ISO.pain.008.001.08.austrian.004.xsd', 'pain.008.001.08.xsd', 'pain.008.codelists.xsd'],
  },
];

const BASE = 'https://partners.lhv.ee/assets/files/XSD/';
const FILES = [
  'pain.001.001.03.xsd',
  'pain.001.001.09.xsd',
  'pain.008.001.02.xsd',
  'pain.008.001.08.xsd',
  'supl.001.001.01.xsd',   // von pain.001.001.09 per <xs:import> referenziert
];

/**
 * Stellt ServiceLevel8Choice als echte Choice wieder her (siehe Kopfkommentar).
 * Greift nur innerhalb der so benannten complexTypes, damit keine anderen
 * Sequenzen des Schemas beruehrt werden.
 */
function repairServiceLevelChoice(xsd) {
  return xsd.replace(
    /(<xs:complexType name="ServiceLevel8Choice[^"]*">[\s\S]*?)<xs:sequence>([\s\S]*?)<\/xs:sequence>/g,
    (_, head, body) => `${head}<xs:choice>${body}</xs:choice>`
  );
}

mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const res = await fetch(BASE + file);
  if (!res.ok) {
    console.error(`FEHLER: ${file} -> HTTP ${res.status}`);
    process.exit(1);
  }
  const raw = await res.text();
  const repaired = repairServiceLevelChoice(raw);
  writeFileSync(join(outDir, file), repaired);
  const note = repaired === raw ? '' : ' (ServiceLevel8Choice korrigiert)';
  console.log(`${file}: ${repaired.length} Zeichen${note}`);
}

mkdirSync(psaDir, { recursive: true });

for (const { url, files } of PSA_ZIPS) {
  const work = mkdtempSync(join(tmpdir(), 'psa-xsd-'));
  try {
    const zip = join(work, 'schema.zip');
    execFileSync('curl', ['-sSfL', '-o', zip, url], { stdio: 'inherit' });
    execFileSync('unzip', ['-q', '-o', zip, ...files, '-d', work], { stdio: 'inherit' });
    for (const file of files) {
      copyFileSync(join(work, file), join(psaDir, file));
      console.log(`psa/${file}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\nFertig. Ziel: ${outDir}`);
