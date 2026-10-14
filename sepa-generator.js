/**
 * SEPA-XML Generator - Anwendungslogik
 *
 * Dieses Skript steuert die gesamte Benutzeroberflaeche des SEPA-XML Generators:
 *   - Zahlungsart-Auswahl (Lastschrift / Ueberweisung)
 *   - Eingabemethode (Excel-Upload / Manuelle Eingabe)
 *   - Echtzeit-Validierung aller Formularfelder
 *   - Excel-Datei-Import (via SheetJS/XLSX)
 *   - SEPA-XML-Generierung und Download (via sepa.min.js)
 *   - Konfigurationsverwaltung (localStorage + JSON-Datei)
 *
 * Abhaengigkeiten:
 *   - sepa.min.js (SEPA-Bibliothek fuer XML-Erzeugung)
 *   - XLSX (SheetJS - Excel-Datei-Parsing, via CDN)
 *
 * Architektur:
 *   Alles laeuft innerhalb eines DOMContentLoaded-Event-Handlers.
 *   Keine globalen Variablen ausser window.removeTransaction (fuer onclick in HTML).
 *
 * @file sepa-generator.js
 * @requires sepa.min.js
 * @requires xlsx.full.min.js
 */

// ============================================================
// Initialisierung nach DOM-Laden
// ============================================================

document.addEventListener('DOMContentLoaded', function() {

    // ============================================================
    // DOM-Referenzen: Allgemeine UI-Elemente
    // ============================================================

    /** Datei-Upload-Input fuer Excel-Dateien */
    const fileInput = document.getElementById('excelFile');
    /** Anzeige des ausgewaehlten Dateinamens */
    const fileName = document.getElementById('fileName');
    /** Container fuer die Transaktions-Vorschautabelle */
    const previewSection = document.getElementById('previewSection');
    /** <tbody> der Vorschautabelle */
    const previewBody = document.getElementById('previewBody');
    /** Zusammenfassung (Anzahl Transaktionen, Gesamtbetrag) */
    const summary = document.getElementById('summary');
    /** Button: SEPA-XML generieren und herunterladen */
    const generateBtn = document.getElementById('generateBtn');
    /** Button: Alle Transaktionen zuruecksetzen */
    const resetBtn = document.getElementById('resetBtn');
    /** Container fuer Fehlermeldungen */
    const errorSection = document.getElementById('errorSection');
    /** Text-Element fuer die Fehlermeldung */
    const errorMessage = document.getElementById('errorMessage');

    // ============================================================
    // DOM-Referenzen: Zahlungsart-Auswahl
    // ============================================================

    /** Button: SEPA-Lastschrift (Geld einziehen) */
    const directDebitBtn = document.getElementById('directDebitBtn');
    /** Button: SEPA-Ueberweisung (Geld senden) */
    const transferBtn = document.getElementById('transferBtn');
    /** Container: Lastschrift-spezifische Einstellungen (Glaeubigeor-Daten) */
    const directDebitSettings = document.getElementById('directDebitSettings');
    /** Container: Ueberweisungs-spezifische Einstellungen (Auftraggeber-Daten) */
    const transferSettings = document.getElementById('transferSettings');
    /** Info-Box: Hinweise fuer Lastschrift-Excel-Format */
    const directDebitInfo = document.getElementById('directDebitInfo');
    /** Info-Box: Hinweise fuer Ueberweisungs-Excel-Format */
    const transferInfo = document.getElementById('transferInfo');

    // ============================================================
    // DOM-Referenzen: Eingabemethode-Tabs
    // ============================================================

    /** Tab-Button: Excel-Upload */
    const excelTab = document.getElementById('excelTab');
    /** Tab-Button: Manuelle Eingabe */
    const manualTab = document.getElementById('manualTab');
    /** Content-Container: Excel-Upload-Bereich */
    const excelInputMethod = document.getElementById('excelInputMethod');
    /** Content-Container: Manuelles Eingabeformular */
    const manualInputMethod = document.getElementById('manualInputMethod');

    // ============================================================
    // DOM-Referenzen: Manuelle Eingabefelder
    // ============================================================

    /** Empfaenger/Schuldner-Name */
    const manualName = document.getElementById('manualName');
    /** Empfaenger/Schuldner-IBAN */
    const manualIBAN = document.getElementById('manualIBAN');
    /** Empfaenger/Schuldner-BIC (optional) */
    const manualBIC = document.getElementById('manualBIC');
    /** Betrag in EUR */
    const manualAmount = document.getElementById('manualAmount');
    /** Verwendungszweck */
    const manualRemittance = document.getElementById('manualRemittance');
    /** Mandatsreferenz (Lastschrift) oder Referenz (Ueberweisung) */
    const manualReference = document.getElementById('manualReference');
    /** Label fuer das Referenzfeld (aendert sich je nach Zahlungsart) */
    const manualReferenceLabel = document.getElementById('manualReferenceLabel');
    /** Button: Einzelne Zahlung zur Liste hinzufuegen */
    const addManualEntry = document.getElementById('addManualEntry');

    // ============================================================
    // DOM-Referenzen: Konfigurationsfelder
    // ============================================================

    /** Dropdown: Pain-Format-Auswahl (z.B. pain.008.001.08) */
    const painFormatSelect = document.getElementById('painFormat');
    /** Initiator-Name (Ersteller der SEPA-Datei) */
    const initiatorNameInput = document.getElementById('initiatorName');
    /** Ausfuehrungsdatum (optional, Standard: heute) */
    const executionDateInput = document.getElementById('executionDate');
    /** Glaeubigeor-Name (nur Lastschrift) */
    const creditorNameInput = document.getElementById('creditorName');
    /** Glaeubigeor-IBAN (nur Lastschrift) */
    const creditorIBANInput = document.getElementById('creditorIBAN');
    /** Glaeubigeor-BIC (nur Lastschrift, optional) */
    const creditorBICInput = document.getElementById('creditorBIC');
    /** Glaeubigeor-ID (nur Lastschrift, z.B. DE98ZZZ09999999999) */
    const creditorIdInput = document.getElementById('creditorId');
    /** Sequenztyp: FRST/RCUR/OOFF/FNAL (nur Lastschrift) */
    const sequenceTypeSelect = document.getElementById('sequenceType');
    /** Instrumentierung: CORE/B2B (nur Lastschrift) */
    const localInstrumentationSelect = document.getElementById('localInstrumentation');
    /** Auftraggeber-Name (nur Ueberweisung) */
    const debtorNameInput = document.getElementById('debtorName');
    /** Auftraggeber-IBAN (nur Ueberweisung) */
    const debtorIBANInput = document.getElementById('debtorIBAN');
    /** Auftraggeber-BIC (nur Ueberweisung, optional) */
    const debtorBICInput = document.getElementById('debtorBIC');
    /** Button: Excel-Vorlage herunterladen */
    const downloadTemplateBtn = document.getElementById('downloadTemplate');

    // ============================================================
    // Anwendungsstatus
    // ============================================================

    /** Liste aller aktuellen Transaktionen (aus Excel oder manueller Eingabe) */
    let currentTransactions = [];

    /** Aktuelle Zahlungsart: 'directDebit' (Lastschrift) oder 'transfer' (Ueberweisung) */
    let currentPaymentType = 'directDebit';

    // ============================================================
    // Initialisierung: Gespeicherte Konfiguration laden
    // ============================================================

    // Konfiguration aus dem localStorage wiederherstellen (wenn vorhanden)
    loadConfigFromStorage();

    // Validierung aller vorausgefuellten Felder nach kurzem Delay
    // (damit die DOM-Elemente vollstaendig aktualisiert sind)
    setTimeout(() => {
        validateAllFields();
    }, 100);

    // ============================================================
    // Event-Listener: Zahlungsart-Auswahl
    // ============================================================

    directDebitBtn.addEventListener('click', () => switchPaymentType('directDebit'));
    transferBtn.addEventListener('click', () => switchPaymentType('transfer'));

    // ============================================================
    // Event-Listener: Eingabemethode-Tabs
    // ============================================================

    excelTab.addEventListener('click', () => switchInputMethod('excel'));
    manualTab.addEventListener('click', () => switchInputMethod('manual'));

    // ============================================================
    // Event-Listener: Datei-Upload
    // ============================================================

    fileInput.addEventListener('change', handleFileSelect);

    // ============================================================
    // Event-Listener: Manuelle Eingabe
    // ============================================================

    addManualEntry.addEventListener('click', addManualTransaction);

    // ============================================================
    // Event-Listener: Aktions-Buttons
    // ============================================================

    generateBtn.addEventListener('click', generateAndDownload);
    resetBtn.addEventListener('click', resetApp);
    downloadTemplateBtn.addEventListener('click', downloadExcelTemplate);

    // ============================================================
    // Event-Listener: Echtzeit-Feldvalidierung
    // ============================================================

    // IBAN-Felder: Mod-97-Pruefziffernvalidierung bei jeder Eingabe
    manualIBAN.addEventListener('input', validateIBAN);
    creditorIBANInput.addEventListener('input', validateIBAN);
    debtorIBANInput.addEventListener('input', validateIBAN);

    // BIC-Felder: Format-Validierung (8 oder 11 Zeichen, [A-Z]{6}[A-Z0-9]{2,5})
    manualBIC.addEventListener('input', validateBIC);
    creditorBICInput.addEventListener('input', validateBIC);
    debtorBICInput.addEventListener('input', validateBIC);

    // Betrags-Validierung (0.01 - 999.999.999,99 EUR)
    manualAmount.addEventListener('input', validateAmount);

    // Name-Validierung (2-70 Zeichen)
    manualName.addEventListener('input', validateName);
    creditorNameInput.addEventListener('input', validateName);
    debtorNameInput.addEventListener('input', validateName);
    initiatorNameInput.addEventListener('input', validateName);

    // Verwendungszweck (max. 140 Zeichen)
    manualRemittance.addEventListener('input', validateRemittance);

    // Referenz/Mandatsreferenz (max. 35 Zeichen, Pflicht bei Lastschrift)
    manualReference.addEventListener('input', validateReference);

    // Glaeubigeor-ID-Validierung (Format + Mod-97)
    creditorIdInput.addEventListener('input', validateCreditorId);

    // Datums-Validierung (muss in der Zukunft liegen)
    executionDateInput.addEventListener('input', validateDate);

    // Select-Felder: Visuelles Feedback bei Auswahl
    painFormatSelect.addEventListener('change', validateSelect);
    sequenceTypeSelect.addEventListener('change', validateSelect);
    localInstrumentationSelect.addEventListener('change', validateSelect);

    // ============================================================
    // Event-Listener: FAQ-Akkordeon
    // ============================================================

    document.querySelectorAll('.faq-question').forEach(question => {
        question.addEventListener('click', function() {
            const item = this.closest('.faq-item');
            const wasActive = item.classList.contains('active');

            // Alle anderen FAQ-Eintraege schliessen (nur einer gleichzeitig offen)
            document.querySelectorAll('.faq-item').forEach(otherItem => {
                if (otherItem !== item) {
                    otherItem.classList.remove('active');
                }
            });

            // Aktuellen Eintrag togglen
            item.classList.toggle('active', !wasActive);
        });
    });

    // ============================================================
    // Event-Listener: Auto-Save bei Feldaenderungen
    // ============================================================
    // Jede Aenderung an Konfigurationsfeldern wird automatisch
    // im localStorage gespeichert (fuer Wiederherstellen beim naechsten Besuch)

    [painFormatSelect, initiatorNameInput, executionDateInput, creditorNameInput,
     creditorIBANInput, creditorBICInput, creditorIdInput, sequenceTypeSelect,
     localInstrumentationSelect, debtorNameInput, debtorIBANInput, debtorBICInput].forEach(el => {
        if (el) el.addEventListener('change', saveConfigToStorage);
    });

    // ============================================================
    // Event-Listener: Konfigurationsdatei-Verwaltung
    // ============================================================

    /** Verstecktes File-Input fuer JSON-Config-Upload */
    const configFileInput = document.getElementById('configFileInput');
    /** Button: Konfiguration laden */
    const loadConfigBtn = document.getElementById('loadConfig');
    /** Button: Konfiguration als JSON speichern */
    const saveConfigBtn = document.getElementById('saveConfig');

    // Konfiguration als JSON-Datei herunterladen
    if (saveConfigBtn) {
        saveConfigBtn.addEventListener('click', saveConfigToFile);
    }

    // Konfiguration aus JSON-Datei laden
    if (loadConfigBtn && configFileInput) {
        // Klick auf "Laden"-Button oeffnet den versteckten File-Input
        loadConfigBtn.addEventListener('click', () => {
            configFileInput.click();
        });

        // Wenn eine Datei ausgewaehlt wurde: JSON parsen und in Formularfelder laden
        configFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(event) {
                try {
                    const config = JSON.parse(event.target.result);

                    // Zahlungsart wiederherstellen (falls in Config vorhanden)
                    if (config.paymentType) switchPaymentType(config.paymentType);

                    // Alle Felder aus der Config-Datei in die Formularfelder uebertragen
                    if (config.initiatorName) initiatorNameInput.value = config.initiatorName;
                    if (config.executionDate) executionDateInput.value = config.executionDate;
                    if (config.creditorName) creditorNameInput.value = config.creditorName;
                    if (config.creditorIBAN) creditorIBANInput.value = config.creditorIBAN;
                    if (config.creditorBIC) creditorBICInput.value = config.creditorBIC;
                    if (config.creditorId) creditorIdInput.value = config.creditorId;
                    if (config.sequenceType) sequenceTypeSelect.value = config.sequenceType;
                    if (config.localInstrumentation) localInstrumentationSelect.value = migrateLocalInstrument(config.localInstrumentation);
                    if (config.debtorName) debtorNameInput.value = config.debtorName;
                    if (config.debtorIBAN) debtorIBANInput.value = config.debtorIBAN;
                    if (config.debtorBIC) debtorBICInput.value = config.debtorBIC;
                    if (config.painFormat) painFormatSelect.value = config.painFormat;

                    // Geladene Werte auch im localStorage sichern
                    saveConfigToStorage();

                    showSuccess('Konfiguration erfolgreich geladen!');

                    // File-Input zuruecksetzen (damit dieselbe Datei erneut geladen werden kann)
                    configFileInput.value = '';
                } catch (error) {
                    showError('Fehler beim Laden der Konfigurationsdatei: ' + error.message);
                }
            };
            reader.readAsText(file);
        });
    }

    // ============================================================
    // Zahlungsart-Umschaltung
    // ============================================================

    /**
     * Wechselt zwischen Lastschrift und Ueberweisung.
     * Aktualisiert die UI (Buttons, Einstellungen, Pain-Format-Optionen)
     * und setzt die Transaktionsliste zurueck.
     *
     * @param {string} type - 'directDebit' oder 'transfer'
     */
    function switchPaymentType(type) {
        currentPaymentType = type;

        // Aktiven Button hervorheben
        directDebitBtn.classList.toggle('active', type === 'directDebit');
        transferBtn.classList.toggle('active', type === 'transfer');

        // Zahlungsart-spezifische Einstellungen ein-/ausblenden
        directDebitSettings.style.display = type === 'directDebit' ? 'block' : 'none';
        transferSettings.style.display = type === 'transfer' ? 'block' : 'none';

        // Info-Boxen (Excel-Spalten-Hinweise) ein-/ausblenden
        if (directDebitInfo) directDebitInfo.style.display = type === 'directDebit' ? 'block' : 'none';
        if (transferInfo) transferInfo.style.display = type === 'transfer' ? 'block' : 'none';

        // Label des Referenzfeldes anpassen:
        // Lastschrift: "Mandatsreferenz *" (Pflichtfeld)
        // Ueberweisung: "Referenz" (optional)
        if (type === 'directDebit') {
            manualReferenceLabel.textContent = 'Mandatsreferenz *';
            manualReference.placeholder = 'MAND-001-2025';
        } else {
            manualReferenceLabel.textContent = 'Referenz';
            manualReference.placeholder = 'Optional';
            manualReference.removeAttribute('required');
        }

        // Pain-Format-Dropdown mit passenden Optionen befuellen
        updatePainFormatOptions(type);

        // Transaktionsliste zuruecksetzen (da Formate unterschiedlich sind)
        currentTransactions = [];
        updatePreview();
    }

    // ============================================================
    // Eingabemethode-Umschaltung
    // ============================================================

    /**
     * Wechselt zwischen Excel-Upload und manueller Eingabe.
     *
     * @param {string} method - 'excel' oder 'manual'
     */
    function switchInputMethod(method) {
        excelTab.classList.toggle('active', method === 'excel');
        manualTab.classList.toggle('active', method === 'manual');
        excelInputMethod.classList.toggle('active', method === 'excel');
        manualInputMethod.classList.toggle('active', method === 'manual');
    }

    // ============================================================
    // Pain-Format-Optionen
    // ============================================================

    /**
     * Aktualisiert die Pain-Format-Dropdown-Optionen basierend auf der Zahlungsart.
     *
     * Lastschrift (pain.008):
     *   - pain.008.001.02 (aeltere Version)
     *   - pain.008.001.08 (empfohlen)
     *
     * Ueberweisung (pain.001):
     *   - pain.001.001.03 (aeltere Version)
     *   - pain.001.001.08 (neuere Version)
     *   - pain.001.001.09 (empfohlen)
     *
     * Dazu je ein oesterreichisches PSA-Profil (pain.008.001.08.austrian.004,
     * pain.001.001.09.austrian.005): gleicher Namespace wie das ISO-Basisformat,
     * aber mit den Einschraenkungen der Payment Services Austria.
     *
     * @param {string} type - 'directDebit' oder 'transfer'
     */
    function updatePainFormatOptions(type) {
        // Default weiterhin auf .02/.03: Alle angebotenen Formate erzeugen
        // inzwischen schema-valides XML (per XSD in tests/xsd/ abgesichert),
        // aber die Bank-SEITE unterstuetzt .08/.09 noch nicht flaechendeckend –
        // die Umstellung der deutschen Kreditwirtschaft laeuft. .02/.03 wird
        // dagegen ueberall akzeptiert und bleibt deshalb die sichere Vorauswahl.
        const options = type === 'directDebit' ? [
            { value: 'pain.008.001.02', text: 'pain.008.001.02 (Bank-kompatibel - EMPFOHLEN) ⭐', selected: true },
            { value: 'pain.008.001.08', text: 'pain.008.001.08 (Neueres ISO-Schema - nicht alle Banken)' },
            { value: 'pain.008.001.08.austrian.004', text: 'pain.008.001.08 – Österreich (PSA austrian.004)' }
        ] : [
            { value: 'pain.001.001.03', text: 'pain.001.001.03 (Bank-kompatibel - EMPFOHLEN) ⭐', selected: true },
            { value: 'pain.001.001.08', text: 'pain.001.001.08 (Neueres ISO-Schema)' },
            { value: 'pain.001.001.09', text: 'pain.001.001.09 (Neuestes ISO-Schema - nicht alle Banken)' },
            { value: 'pain.001.001.09.austrian.005', text: 'pain.001.001.09 – Österreich (PSA austrian.005)' }
        ];

        // Dropdown leeren und mit neuen Optionen befuellen
        painFormatSelect.innerHTML = '';
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (opt.selected) option.selected = true;
            painFormatSelect.appendChild(option);
        });
    }

    // ============================================================
    // Validierungsfunktionen
    // ============================================================
    // Jede Funktion wird bei 'input'/'change' Events aufgerufen und
    // zeigt visuelles Feedback (gruen/rot + Nachricht) am jeweiligen Feld.

    /**
     * Validiert eine IBAN: Format-Pruefung und Laengen-Check.
     * Format: 2 Buchstaben (Laendercode) + 2 Ziffern (Pruefziffer) + 1-30 alphanumerische Zeichen
     * Laenge: 15-34 Zeichen
     *
     * Hinweis: Die echte Mod-97-Pruefziffer wird in sepa.min.js bei der XML-Generierung geprueft.
     * Hier erfolgt nur eine Vorpruefung fuer sofortiges UI-Feedback.
     *
     * @param {Event} e - Input-Event mit e.target als Eingabefeld
     */
    function validateIBAN(e) {
        const input = e.target;
        const iban = input.value.replace(/\s/g, '').toUpperCase();

        // Leeres Feld: Validierungsstatus zuruecksetzen
        if (iban.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        // IBAN-Format pruefen (Basis-Regex + Laengencheck)
        const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/;
        const isValid = ibanRegex.test(iban) && iban.length >= 15 && iban.length <= 34;

        if (isValid) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, '✓ Gültige IBAN', 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Ungültige IBAN (Format: DE89370400440532013000)', 'error');
        }
    }

    /**
     * Validiert einen BIC (Bank Identifier Code).
     * Format: 6 Buchstaben + 2 alphanumerische Zeichen + optional 3 alphanumerische Zeichen
     * Laenge: 8 oder 11 Zeichen
     *
     * @param {Event} e - Input-Event
     */
    function validateBIC(e) {
        const input = e.target;
        const bic = input.value.trim().toUpperCase();

        if (bic.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        const bicRegex = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
        const isValid = bicRegex.test(bic);

        if (isValid) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, '✓ Gültiger BIC', 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Ungültiger BIC (8 oder 11 Zeichen)', 'error');
        }
    }

    /**
     * Validiert einen Betrag.
     * Erlaubt: 0.01 bis 999.999.999,99 EUR
     *
     * @param {Event} e - Input-Event
     */
    function validateAmount(e) {
        const input = e.target;
        const amount = parseFloat(input.value);

        if (input.value.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        if (!isNaN(amount) && amount >= 0.01 && amount <= 999999999.99) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, `✓ ${amount.toFixed(2)} EUR`, 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Betrag muss zwischen 0.01 und 999,999,999.99 EUR liegen', 'error');
        }
    }

    /**
     * Validiert Namensfelder (2-70 Zeichen, SEPA-konform).
     *
     * @param {Event} e - Input-Event
     */
    function validateName(e) {
        const input = e.target;
        const name = input.value.trim();

        if (name.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        if (name.length >= 2 && name.length <= 70) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, '✓ Gültig', 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Name muss 2-70 Zeichen lang sein', 'error');
        }
    }

    /**
     * Validiert den Verwendungszweck (max. 140 Zeichen lt. SEPA-Standard).
     *
     * @param {Event} e - Input-Event
     */
    function validateRemittance(e) {
        const input = e.target;
        const text = input.value.trim();

        if (text.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        if (text.length >= 1 && text.length <= 140) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, `✓ ${text.length}/140 Zeichen`, 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Verwendungszweck darf maximal 140 Zeichen haben', 'error');
        }
    }

    /**
     * Validiert die Referenz bzw. Mandatsreferenz.
     * Bei Lastschrift: Pflichtfeld (1-35 Zeichen)
     * Bei Ueberweisung: Optional (0-35 Zeichen)
     *
     * @param {Event} e - Input-Event
     */
    function validateReference(e) {
        const input = e.target;
        const ref = input.value.trim();

        // Bei Ueberweisung ist das Feld optional - leeres Feld ist ok
        if (ref.length === 0 && currentPaymentType !== 'directDebit') {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        if (ref.length >= 1 && ref.length <= 35) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, '✓ Gültig', 'success');
        } else if (ref.length > 35) {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Maximal 35 Zeichen', 'error');
        } else if (currentPaymentType === 'directDebit') {
            // Bei Lastschrift: Leeres Feld ist ein Fehler
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Pflichtfeld für Lastschriften', 'error');
        }
    }

    /**
     * Validiert die Glaeubigeor-Identifikationsnummer.
     * Format: 2 Buchstaben (Land) + 2 Ziffern (Pruefziffer) + 3 alphanumerisch + 11 Ziffern
     * Beispiel: DE98ZZZ09999999999
     *
     * @param {Event} e - Input-Event
     */
    function validateCreditorId(e) {
        const input = e.target;
        const id = input.value.trim().toUpperCase();

        if (id.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        // Deutsches Glaeubigeor-ID-Format
        const creditorIdRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[0-9]{11}$/;
        const isValid = creditorIdRegex.test(id);

        if (isValid) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            showValidationMessage(input, '✓ Gültige Gläubiger-ID', 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Format: DE98ZZZ09999999999', 'error');
        }
    }

    /**
     * Validiert das Ausfuehrungsdatum (muss in der Zukunft liegen).
     * Zeigt die Differenz in Tagen zum heutigen Datum an.
     *
     * @param {Event} e - Input-Event
     */
    function validateDate(e) {
        const input = e.target;
        const dateValue = input.value;

        if (dateValue.length === 0) {
            input.classList.remove('valid', 'invalid');
            removeValidationMessage(input);
            return;
        }

        const selectedDate = new Date(dateValue);
        const today = new Date();
        today.setHours(0, 0, 0, 0);  // Nur Datum vergleichen, ohne Uhrzeit

        if (selectedDate >= today) {
            input.classList.remove('invalid');
            input.classList.add('valid');
            const daysDiff = Math.ceil((selectedDate - today) / (1000 * 60 * 60 * 24));
            showValidationMessage(input, `✓ In ${daysDiff} Tag${daysDiff !== 1 ? 'en' : ''}`, 'success');
        } else {
            input.classList.remove('valid');
            input.classList.add('invalid');
            showValidationMessage(input, '✗ Datum muss in der Zukunft liegen', 'error');
        }
    }

    /**
     * Validiert Select-Felder (visuelles Feedback bei gueliger Auswahl).
     *
     * @param {Event} e - Change-Event
     */
    function validateSelect(e) {
        const select = e.target;

        if (select.value && select.value !== '') {
            select.classList.remove('invalid');
            select.classList.add('valid');
        } else {
            select.classList.remove('valid');
            select.classList.add('invalid');
        }
    }

    // ============================================================
    // Validierungs-UI-Hilfsfunktionen
    // ============================================================

    /**
     * Zeigt eine Validierungsnachricht unterhalb eines Eingabefeldes an.
     *
     * @param {HTMLElement} input - Das Eingabefeld
     * @param {string} message - Nachrichtentext
     * @param {string} type - 'success' (gruen) oder 'error' (rot)
     */
    function showValidationMessage(input, message, type) {
        // Vorherige Nachricht entfernen
        removeValidationMessage(input);

        const msgDiv = document.createElement('div');
        msgDiv.className = `validation-message ${type}`;
        msgDiv.textContent = message;
        msgDiv.dataset.validationFor = input.id || input.name;

        input.parentElement.appendChild(msgDiv);
    }

    /**
     * Entfernt die Validierungsnachricht unter einem Eingabefeld.
     *
     * @param {HTMLElement} input - Das Eingabefeld
     */
    function removeValidationMessage(input) {
        const existingMsg = input.parentElement.querySelector('.validation-message');
        if (existingMsg) {
            existingMsg.remove();
        }
    }

    /**
     * Validiert alle Formularfelder (wird nach dem Laden der Konfiguration aufgerufen).
     * Simuliert Input-Events fuer alle vorausgefuellten Felder.
     */
    function validateAllFields() {
        // IBAN-Felder
        if (manualIBAN.value) validateIBAN({ target: manualIBAN });
        if (creditorIBANInput.value) validateIBAN({ target: creditorIBANInput });
        if (debtorIBANInput.value) validateIBAN({ target: debtorIBANInput });

        // BIC-Felder
        if (manualBIC.value) validateBIC({ target: manualBIC });
        if (creditorBICInput.value) validateBIC({ target: creditorBICInput });
        if (debtorBICInput.value) validateBIC({ target: debtorBICInput });

        // Name-Felder
        if (manualName.value) validateName({ target: manualName });
        if (creditorNameInput.value) validateName({ target: creditorNameInput });
        if (debtorNameInput.value) validateName({ target: debtorNameInput });
        if (initiatorNameInput.value) validateName({ target: initiatorNameInput });

        // Betrag
        if (manualAmount.value) validateAmount({ target: manualAmount });

        // Text-Felder
        if (manualRemittance.value) validateRemittance({ target: manualRemittance });
        if (manualReference.value) validateReference({ target: manualReference });
        if (creditorIdInput.value) validateCreditorId({ target: creditorIdInput });

        // Datum
        if (executionDateInput.value) validateDate({ target: executionDateInput });

        // Select-Felder
        if (painFormatSelect.value) validateSelect({ target: painFormatSelect });
        if (sequenceTypeSelect.value) validateSelect({ target: sequenceTypeSelect });
        if (localInstrumentationSelect.value) validateSelect({ target: localInstrumentationSelect });
    }

    // ============================================================
    // Manuelle Transaktions-Eingabe
    // ============================================================

    /**
     * Fuegt eine manuell eingegebene Transaktion zur Liste hinzu.
     * Validiert die Pflichtfelder, erstellt ein Transaktions-Objekt,
     * leert das Formular und aktualisiert die Vorschau.
     */
    function addManualTransaction() {
        // Pflichtfelder pruefen
        if (!manualName.value || !manualIBAN.value || !manualAmount.value || !manualRemittance.value) {
            showError('Bitte füllen Sie alle Pflichtfelder aus!');
            return;
        }

        // Bei Lastschrift ist die Mandatsreferenz Pflicht
        if (currentPaymentType === 'directDebit' && !manualReference.value) {
            showError('Mandatsreferenz ist erforderlich für Lastschriften!');
            return;
        }

        // Transaktions-Objekt erstellen
        const transaction = {
            name: manualName.value.trim(),
            iban: manualIBAN.value.replace(/\s/g, '').toUpperCase(),
            bic: manualBIC.value.trim().toUpperCase() || '',
            amount: parseFloat(manualAmount.value),
            remittanceInfo: manualRemittance.value.trim(),
            mandateId: manualReference.value.trim() || '',
            // Mandats-Unterschriftsdatum: Heutiges Datum als Standard
            mandateSignatureDate: new Date().toISOString().split('T')[0]
        };

        // Zur Transaktionsliste hinzufuegen
        currentTransactions.push(transaction);

        // Formular leeren
        manualName.value = '';
        manualIBAN.value = '';
        manualBIC.value = '';
        manualAmount.value = '';
        manualRemittance.value = '';
        manualReference.value = '';

        // Validierungsstatus und -nachrichten zuruecksetzen
        [manualName, manualIBAN, manualBIC, manualAmount, manualRemittance, manualReference].forEach(field => {
            field.classList.remove('valid', 'invalid');
            removeValidationMessage(field);
        });

        // Vorschautabelle aktualisieren
        updatePreview();

        // Erfolgs-Feedback anzeigen
        showSuccess(`✓ Zahlung hinzugefügt! Insgesamt: ${currentTransactions.length}`);
    }

    // ============================================================
    // Excel-Datei-Import
    // ============================================================

    /**
     * Verarbeitet eine hochgeladene Excel-Datei (.xlsx/.xls).
     * Liest die erste Tabelle, erkennt die Spalten flexibel (deutsch/englisch, gross/klein)
     * und wandelt die Zeilen in Transaktions-Objekte um.
     *
     * Erwartete Spalten Lastschrift: Name, IBAN, BIC, Betrag, Verwendungszweck, Mandatsreferenz, Mandatsdatum
     * Erwartete Spalten Ueberweisung: Name, IBAN, BIC, Betrag, Verwendungszweck, Referenz
     *
     * @param {Event} e - Change-Event des File-Inputs
     */
    async function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        fileName.textContent = `📄 ${file.name}`;
        hideError();

        try {
            // Excel-Datei als ArrayBuffer lesen und mit XLSX parsen
            // cellDates:true → Excel-Datumsseriennummern werden zu JS Date-Objekten,
            // damit new Date(...) sie korrekt verarbeitet (ohne diese Option würde
            // z.B. 45658 als Millisekunden seit 1970 interpretiert).
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet);

            if (rows.length === 0) {
                throw new Error('Die Excel-Datei enthält keine Daten.');
            }

            // Excel-Zellen können Numbers sein (z.B. Referenz "12345") – SEPA-Validierung
            // erwartet Strings und ruft .match() auf, was auf Numbers crasht.
            const cellToString = v => (v === null || v === undefined) ? '' : String(v).trim();

            // Spaltenüberschriften flexibel erkennen: Keys normalisieren (lowercase,
            // Sonderzeichen/Leerzeichen entfernen), damit auch "IBAN ", "Iban" oder
            // "IBAN-Nr." gefunden werden. Nutzer-Excels weichen hier oft minimal ab –
            // ein nachgestelltes Leerzeichen im Header führte sonst zu leeren IBANs.
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

            // Zeilen in Transaktions-Objekte umwandeln (leere Zeilen überspringen)
            const transactions = rows
                .map(toNormalizedRow)
                .filter(norm => Object.values(norm).some(v => cellToString(v) !== ''))
                .map(norm => {
                    const transaction = {
                        name: cellToString(getCell(norm, ['name'])),
                        // IBAN/BIC uppercasen analog zum manuellen Pfad (addManualTransaction):
                        // Banken erwarten formal Großbuchstaben im XML-Output.
                        iban: cellToString(getCell(norm, ['iban', 'ibannr'])).replace(/\s/g, '').toUpperCase(),
                        bic: cellToString(getCell(norm, ['bic', 'bicswift'])).toUpperCase(),
                        amount: parseFloat(getCell(norm, ['betrag', 'amount']) || 0),
                        remittanceInfo: cellToString(getCell(norm, ['verwendungszweck', 'purpose']))
                    };

                    // Lastschrift: Mandatsinformationen aus zusaetzlichen Spalten lesen
                    if (currentPaymentType === 'directDebit') {
                        transaction.mandateId = cellToString(getCell(norm, ['mandatsreferenz', 'mandateid']));
                        // Rohwert beibehalten (Date-Objekt oder String) – new Date(...) verarbeitet beides.
                        transaction.mandateSignatureDate = getCell(norm, ['mandatsdatum', 'mandatedate']) || '';
                    } else {
                        // Ueberweisung: Referenz aus optionaler Spalte lesen
                        transaction.mandateId = cellToString(getCell(norm, ['referenz', 'reference']));
                    }

                    return transaction;
                });

            if (transactions.length === 0) {
                throw new Error('Die Excel-Datei enthält keine Daten.');
            }

            // Import-Validierung: Wenn KEINE Zeile eine IBAN bzw. einen Namen hat,
            // wurde die Spalte nicht erkannt – konkrete Diagnose statt stiller Import,
            // sonst landet der Nutzer später bei irreführenden Formular-Fehlermeldungen.
            const foundColumns = Object.keys(rows[0]).map(k => `"${k}"`).join(', ');
            const expectedColumns = currentPaymentType === 'directDebit'
                ? 'Name, IBAN, BIC, Betrag, Verwendungszweck, Mandatsreferenz, Mandatsdatum'
                : 'Name, IBAN, BIC, Betrag, Verwendungszweck, Referenz';
            const columnHint = `Gefundene Spalten: ${foundColumns}. Erwartete Überschriften (Zeile 1 des ersten Arbeitsblatts, Groß-/Kleinschreibung egal): ${expectedColumns}. Das Zellformat (Text/Zahl/Standard) spielt keine Rolle.`;

            if (transactions.every(t => !t.iban)) {
                throw new Error(`Spalte "IBAN" wurde nicht erkannt. ${columnHint}`);
            }
            if (transactions.every(t => !t.name)) {
                throw new Error(`Spalte "Name" wurde nicht erkannt. ${columnHint}`);
            }

            currentTransactions = transactions;

            // Vorschautabelle aktualisieren
            updatePreview();

            // Einzelne lückenhafte Zeilen: Import zulassen, aber konkret warnen.
            // +2 = Excel-Zeilennummer (Zeile 1 ist die Kopfzeile).
            const incompleteRows = transactions
                .map((t, i) => (!t.iban || !t.name) ? i + 2 : null)
                .filter(n => n !== null);
            if (incompleteRows.length > 0) {
                showError(`⚠️ In Excel-Zeile ${incompleteRows.join(', ')} fehlt Name oder IBAN. Die übrigen Zeilen wurden importiert – bitte fehlende Angaben ergänzen und erneut hochladen (oder die Zeilen in der Vorschau entfernen).`);
            } else {
                showSuccess(`✓ ${transactions.length} Transaktionen aus der Excel-Datei importiert.`);
            }

        } catch (error) {
            showError(`Fehler beim Lesen der Datei: ${error.message}`);
            console.error(error);
        }
    }

    // ============================================================
    // Vorschautabelle
    // ============================================================

    /**
     * Aktualisiert die Vorschautabelle mit allen aktuellen Transaktionen.
     * Zeigt Zusammenfassung (Anzahl, Gesamtbetrag) und eine Tabelle mit
     * allen Transaktionen inkl. Loeschen-Button.
     */
    function updatePreview() {
        // Keine Transaktionen: Vorschau ausblenden
        if (currentTransactions.length === 0) {
            previewSection.style.display = 'none';
            return;
        }

        previewSection.style.display = 'block';

        // Zusammenfassung berechnen und anzeigen
        const totalAmount = currentTransactions.reduce((sum, t) => sum + t.amount, 0);
        const count = currentTransactions.length;
        summary.textContent = `📊 Gefunden: ${count} Transaktionen | Gesamtbetrag: ${formatCurrency(totalAmount)}`;

        // Tabellenzeilen erstellen
        previewBody.innerHTML = '';
        currentTransactions.forEach((t, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td><strong>${escapeHtml(t.name)}</strong></td>
                <td><code>${escapeHtml(t.iban)}</code></td>
                <td class="amount">${formatCurrency(t.amount)}</td>
                <td>${escapeHtml(t.remittanceInfo)}</td>
                ${currentPaymentType === 'directDebit' ? `<td>${escapeHtml(t.mandateId)}</td>` : ''}
                <td>
                    <button class="btn-remove" onclick="removeTransaction(${index})" title="Entfernen">
                        🗑️
                    </button>
                </td>
            `;
            previewBody.appendChild(row);
        });
    }

    /**
     * Globale Funktion zum Entfernen einer Transaktion aus der Liste.
     * Wird ueber onclick-Attribut in den Tabellenzeilen aufgerufen.
     *
     * @param {number} index - Index der zu entfernenden Transaktion
     */
    window.removeTransaction = function(index) {
        currentTransactions.splice(index, 1);
        updatePreview();
    };

    // ============================================================
    // SEPA-XML-Generierung und Download
    // ============================================================

    /**
     * Generiert eine SEPA-XML-Datei und loeut den Browser-Download aus.
     *
     * Ablauf:
     *   1. Konfigurationsfelder validieren (Pflichtfelder pruefen)
     *   2. SEPA.Document erstellen (mit gewaehltem Pain-Format)
     *   3. GroupHeader konfigurieren (ID, Erstellungszeitpunkt, Initiator)
     *   4. PaymentInfo erstellen und konfigurieren:
     *      - Lastschrift: Glaeubigeor-Daten, Sequenztyp, Instrumentierung, Einzugsdatum
     *      - Ueberweisung: Auftraggeber-Daten, Ausfuehrungsdatum
     *   5. Transaktionen erstellen und hinzufuegen
     *   6. PaymentInfo zum Dokument hinzufuegen
     *   7. XML-String generieren (doc.toString())
     *   8. Als Blob herunterladen
     */
    function generateAndDownload() {
        // === Schritt 1: Validierung ===

        if (currentTransactions.length === 0) {
            showError('Bitte fügen Sie zuerst Transaktionen hinzu!');
            return;
        }

        // Pflichtfelder pruefen (je nach Zahlungsart)
        if (!initiatorNameInput.value) {
            showError('Bitte geben Sie den Initiator-Namen ein!');
            return;
        }

        // pain-Format ist Single-Source-of-Truth: Die Lib leitet method/_type
        // intern daraus ab. currentPaymentType (UI-Variable) kann theoretisch
        // davon abweichen (z.B. nach manuellem Format-Wechsel), deshalb basieren
        // wir Validation und Lib-Konfiguration auf dem painFormat.
        const painFormat = painFormatSelect.value;
        const isDirectDebit = painFormat.indexOf('pain.008') === 0;

        if (isDirectDebit) {
            if (!creditorNameInput.value || !creditorIBANInput.value || !creditorIdInput.value) {
                showError('Bitte füllen Sie im Abschnitt „Empfänger-Daten (Gläubiger)" Ihren Namen, Ihre IBAN und Ihre Gläubiger-ID aus. Das sind Ihre eigenen Daten im Formular oben – sie kommen nicht aus der Excel-Datei.');
                return;
            }
            // Mandatsreferenz ist bei Lastschrift Pflicht – ohne Wert wird die XML
            // mit leerem <MndtId/> erzeugt und von Bank-Software (z.B. Proficash,
            // Hannoversche Volksbank) wegen "invaliden Wert" abgelehnt. Geprueft
            // wird der bereinigte Wert: "///" bliebe sonst als leere ID uebrig.
            const missingMandate = currentTransactions.findIndex(t => !SEPA.toSepaId(t.mandateId));
            if (missingMandate !== -1) {
                showError(`Mandatsreferenz fehlt für Transaktion ${missingMandate + 1} (${currentTransactions[missingMandate].name || 'ohne Namen'}). Bei Lastschriften ist die Mandatsreferenz Pflicht – bitte Excel-Spalte "Mandatsreferenz" befüllen.`);
                return;
            }
            // Mandatsreferenz darf 35 Zeichen nicht überschreiten (Max35Text).
            // Die Library prüft die Länge hier NICHT – ohne diesen Guard entstünde
            // eine XML, die erst die Bank mit einer kryptischen Schema-Meldung
            // ablehnt. Gemessen wird nach der Zeichensatz-Umwandlung, weil
            // "ß" → "ss" die Referenz verlängern kann.
            const longMandate = currentTransactions.findIndex(
                t => SEPA.toSepaId(t.mandateId).length > 35
            );
            if (longMandate !== -1) {
                showError(`Die Mandatsreferenz für Transaktion ${longMandate + 1} (${currentTransactions[longMandate].name || 'ohne Namen'}) ist zu lang: maximal 35 Zeichen sind erlaubt. Bitte in der Excel-Spalte „Mandatsreferenz" kürzen.`);
                return;
            }
            // Mandatsdatum (Unterschriftsdatum) darf nicht NACH dem Fälligkeits-/
            // Einzugsdatum liegen: ein Mandat muss vor dem Einzug unterschrieben
            // sein. Sonst lehnt die Bank die Datei ab mit "ungültiger Wert beim
            // Element DtOfSgntr". Wir fangen das ab, bevor die Datei entsteht.
            const collInput = executionDateInput.value ? new Date(executionDateInput.value) : null;
            const collDate = (collInput && !isNaN(collInput.getTime())) ? collInput : new Date();
            const collStr = collDate.toISOString().substr(0, 10);
            const badDates = [];
            currentTransactions.forEach((t, i) => {
                if (!t.mandateSignatureDate) return;              // ohne Angabe => Fallback heute (unkritisch)
                const d = new Date(t.mandateSignatureDate);
                if (isNaN(d.getTime())) return;                   // ungültiges Datum => Lib-Fallback greift
                const sigStr = d.toISOString().substr(0, 10);
                if (sigStr > collStr) badDates.push(`Zeile ${i + 1} (${t.name || 'ohne Namen'}): ${sigStr}`);
            });
            if (badDates.length) {
                showError(`Das Mandatsdatum (Unterschriftsdatum) darf nicht nach dem Ausführungs-/Fälligkeitsdatum (${collStr}) liegen – ein SEPA-Mandat muss vor dem Einzug unterschrieben sein. Bitte korrigieren Sie folgende Zeilen (Spalte „Mandatsdatum"): ${badDates.join('; ')}`);
                return;
            }
        } else {
            if (!debtorNameInput.value || !debtorIBANInput.value) {
                showError('Bitte füllen Sie im Abschnitt „Auftraggeber-Daten" Ihren Namen und Ihre IBAN aus. Das sind Ihre eigenen Kontodaten (Zahler) im Formular oben – sie kommen nicht aus der Excel-Datei.');
                return;
            }
        }

        try {
            // Protokoll der Zeichensatz-Umwandlungen fuer diesen Lauf zuruecksetzen
            sepaTextChanges = [];

            // === Schritt 2: SEPA-Dokument erstellen ===
            const doc = new SEPA.Document(painFormat);

            // === Schritt 3: GroupHeader konfigurieren ===
            doc.grpHdr.id = generateMessageId();       // Eindeutige Nachrichten-ID
            doc.grpHdr.created = new Date();            // Erstellungszeitpunkt (muss Date-Objekt sein!)
            doc.grpHdr.initiatorName = sepaText(initiatorNameInput.value, 70, painFormat);

            // === Schritt 4: PaymentInfo erstellen und konfigurieren ===
            const info = doc.createPaymentInfo();

            // Bewusst HIER (und nicht erst am Ende): addPaymentInfo setzt die
            // PmtInfId aus der MsgId zusammen, und addTransaction leitet daraus
            // die InstrId ab. Erst nach den Transaktionen aufgerufen war info.id
            // noch leer und jede InstrId hiess ".0", ".1", ...
            doc.addPaymentInfo(info);

            // Ausfuehrungsdatum setzen. Wir setzen BEIDE Felder unabhängig vom
            // pain-Format, damit die Lib-Validierung robust ist – egal ob sie
            // collectionDate (Lastschrift) oder requestedExecutionDate
            // (Ueberweisung) prueft. Verhindert "invalid date null".
            const inputDate = executionDateInput.value ? new Date(executionDateInput.value) : null;
            const executionDate = (inputDate && !isNaN(inputDate.getTime())) ? inputDate : new Date();
            info.collectionDate = executionDate;
            info.requestedExecutionDate = executionDate;

            if (isDirectDebit) {
                // --- Lastschrift-Konfiguration ---
                info.creditorName = sepaText(creditorNameInput.value, 70, painFormat);
                info.creditorIBAN = creditorIBANInput.value.replace(/\s/g, '').toUpperCase();
                // BIC aus Eingabe oder – falls leer – aus der IBAN ableiten (siehe deriveBIC).
                info.creditorBIC = creditorBICInput.value
                    ? creditorBICInput.value.trim().toUpperCase()
                    : deriveBIC(info.creditorIBAN);
                info.creditorId = creditorIdInput.value.trim().toUpperCase();
                info.sequenceType = sequenceTypeSelect.value;             // FRST/RCUR/OOFF/FNAL
                info.localInstrumentation = localInstrumentationSelect.value;  // CORE oder B2B

                // === Schritt 5a: Lastschrift-Transaktionen hinzufuegen ===
                currentTransactions.forEach(t => {
                    const transaction = info.createTransaction();
                    transaction.debtorName = sepaText(t.name, 70, painFormat);         // Schuldner-Name
                    transaction.debtorIBAN = String(t.iban || '').toUpperCase();  // Schuldner-IBAN (uppercase fuer Bank-Konformitaet)
                    // BIC aus Excel oder – falls leer – aus der IBAN ableiten (siehe deriveBIC).
                    transaction.debtorBIC = String(t.bic || '').toUpperCase() || deriveBIC(transaction.debtorIBAN);
                    transaction.amount = parseFloat(t.amount);             // Betrag in EUR
                    transaction.mandateId = sepaId(t.mandateId, 35);     // Mandatsreferenz
                    // Ende-zu-Ende-Referenz: mandateId weiterverwenden mit Fallback.
                    // Ohne diese Zeile bleibt end2endId "" (Lib-Default) und das XML
                    // enthaelt <EndToEndId></EndToEndId> – Banken lehnen den leeren
                    // Wert ab ("Datei enthaelt folgenden invaliden Wert: ").
                    transaction.end2endId = sepaId(t.mandateId, 35) || 'NOTPROVIDED';

                    // Mandats-Unterschriftsdatum: Aus Eingabe oder Fallback auf heute
                    const d = t.mandateSignatureDate ? new Date(t.mandateSignatureDate) : new Date();
                    transaction.mandateSignatureDate = isNaN(d.getTime()) ? new Date() : d;

                    transaction.remittanceInfo = sepaText(t.remittanceInfo, 140, painFormat);  // Verwendungszweck

                    info.addTransaction(transaction);
                });
            } else {
                // --- Ueberweisungs-Konfiguration ---
                info.debtorName = sepaText(debtorNameInput.value, 70, painFormat);
                info.debtorIBAN = debtorIBANInput.value.replace(/\s/g, '').toUpperCase();
                // BIC aus Eingabe oder – falls leer – aus der IBAN ableiten (siehe deriveBIC).
                info.debtorBIC = debtorBICInput.value
                    ? debtorBICInput.value.trim().toUpperCase()
                    : deriveBIC(info.debtorIBAN);

                // === Schritt 5b: Ueberweisungs-Transaktionen hinzufuegen ===
                currentTransactions.forEach(t => {
                    const transaction = info.createTransaction();
                    transaction.creditorName = sepaText(t.name, 70, painFormat);       // Empfaenger-Name
                    transaction.creditorIBAN = String(t.iban || '').toUpperCase();  // Empfaenger-IBAN (uppercase)
                    // BIC aus Excel oder – falls leer – aus der IBAN ableiten (siehe deriveBIC).
                    transaction.creditorBIC = String(t.bic || '').toUpperCase() || deriveBIC(transaction.creditorIBAN);
                    transaction.amount = parseFloat(t.amount);             // Betrag in EUR
                    transaction.remittanceInfo = sepaText(t.remittanceInfo, 140, painFormat);  // Verwendungszweck
                    // Ende-zu-Ende-Referenz: Nutzer-Referenz oder Fallback "NOTPROVIDED"
                    transaction.end2endId = sepaId(t.mandateId, 35) || 'NOTPROVIDED';

                    info.addTransaction(transaction);
                });
            }

            // === Schritt 6: (entfaellt – addPaymentInfo passiert oben, vor den
            // Transaktionen, damit die InstrId korrekt praefixt wird) ===

            // === Schritt 7: XML-String generieren ===
            // Hinweis: doc.toString() liest xmlVersion/xmlEncoding vom DOM-Document.
            // Im Browser sind diese Properties read-only und ergeben encoding="null"
            // im Header (in Node.js / @xmldom funktioniert das Setzen, deshalb fangen
            // unsere Tests den Bug nicht). Banking-Software (z.B. die der HypoVereinsbank)
            // lehnt encoding="null" mit "Dateiformat nicht unterstützt" ab.
            // Wir ersetzen den XML-Header deterministisch durch UTF-8.
            let xml = doc.toString();
            xml = xml.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');

            // === Schritt 8: Download ausloesen ===
            const blob = new Blob([xml], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Dateiname: YYYY-MM-DD_SEPA_Lastschrift.xml bzw. _Überweisung.xml
            const date = new Date().toISOString().split('T')[0];
            const type = isDirectDebit ? 'Lastschrift' : 'Überweisung';
            a.download = `${date}_SEPA_${type}.xml`;

            // Unsichtbaren Link erstellen, klicken und aufraeuamen
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showSuccess('✓ SEPA-XML-Datei erfolgreich erstellt und heruntergeladen!');

            // Wenn Text umgeschrieben wurde, den Nutzer darueber informieren –
            // sonst wirkt "Mueller" statt "Müller" in der Datei wie ein Fehler.
            if (sepaTextChanges.length) {
                const examples = sepaTextChanges
                    .slice(0, 3)
                    .map(c => `„${c.from}" → „${c.to}"`)
                    .join(', ');
                const more = sepaTextChanges.length > 3
                    ? ` (und ${sepaTextChanges.length - 3} weitere)`
                    : '';
                // AT erlaubt Umlaute in Freitexten – dort betrifft die Umwandlung nur
                // Referenzen und Zeichen ausserhalb des PSA-Zeichensatzes.
                const reason = SEPA.isAustrianFormat(painFormat)
                    ? 'Referenzen und nicht zugelassene Zeichen wurden an den PSA-Zeichensatz angepasst'
                    : 'Umlaute und Sonderzeichen wurden in den SEPA-Zeichensatz umgewandelt';
                const why = SEPA.isAustrianFormat(painFormat)
                    ? 'Referenzen erlauben auch in Österreich keine Umlaute.'
                    : 'Das ist gewollt – viele Banken lehnen Umlaute ab.';
                showSuccess(`ℹ️ ${reason}: ${examples}${more}. ${why}`, 'info');
            }

        } catch (error) {
            showError(`Fehler beim Generieren der XML: ${error.message}`);
            console.error(error);
        }
    }

    // ============================================================
    // Excel-Vorlage-Download
    // ============================================================

    /**
     * Erstellt eine Excel-Vorlage mit Beispieldaten und loeut den Download aus.
     * Die Vorlage enthaelt die erwarteten Spaltennamen und 2 Beispielzeilen.
     *
     * Lastschrift-Vorlage: Name, IBAN, BIC, Betrag, Verwendungszweck, Mandatsreferenz, Mandatsdatum
     * Ueberweisungs-Vorlage: Name, IBAN, BIC, Betrag, Verwendungszweck, Referenz
     */
    function downloadExcelTemplate() {
        const wb = XLSX.utils.book_new();

        // Beispieldaten je nach Zahlungsart
        let data;
        if (currentPaymentType === 'directDebit') {
            data = [
                ['Name', 'IBAN', 'BIC', 'Betrag', 'Verwendungszweck', 'Mandatsreferenz', 'Mandatsdatum'],
                ['Max Mustermann', 'DE89370400440532013000', 'COBADEFFXXX', 45.00, 'Mitgliedsbeitrag Januar 2025', 'MAND-001-2025', '2025-01-01'],
                ['Erika Musterfrau', 'DE89370400440532013001', '', 30.00, 'Mitgliedsbeitrag Januar 2025', 'MAND-002-2025', '2025-01-01']
            ];
        } else {
            data = [
                ['Name', 'IBAN', 'BIC', 'Betrag', 'Verwendungszweck', 'Referenz'],
                ['Max Mustermann', 'DE89370400440532013000', 'COBADEFFXXX', 1500.00, 'Gehalt Januar 2025', 'REF-001'],
                ['Erika Musterfrau', 'DE89370400440532013001', '', 2000.00, 'Gehalt Januar 2025', 'REF-002']
            ];
        }

        const ws = XLSX.utils.aoa_to_sheet(data);

        // Spaltenbreiten fuer bessere Lesbarkeit
        ws['!cols'] = [
            { wch: 25 },  // Name
            { wch: 30 },  // IBAN
            { wch: 15 },  // BIC
            { wch: 10 },  // Betrag
            { wch: 35 },  // Verwendungszweck
            { wch: 20 },  // Mandatsreferenz/Referenz
            { wch: 15 }   // Mandatsdatum (nur Lastschrift)
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Transaktionen');

        // Dateiname: SEPA_Lastschrift_Vorlage.xlsx bzw. SEPA_Überweisung_Vorlage.xlsx
        const type = currentPaymentType === 'directDebit' ? 'Lastschrift' : 'Überweisung';
        XLSX.writeFile(wb, `SEPA_${type}_Vorlage.xlsx`);

        showSuccess('✓ Excel-Vorlage heruntergeladen! Füllen Sie diese aus und laden Sie sie wieder hoch.');
    }

    // ============================================================
    // Zuruecksetzen
    // ============================================================

    /**
     * Setzt die Anwendung zurueck: Loescht alle Transaktionen und den Datei-Upload.
     * Erfordert eine Bestaetigung durch den Benutzer.
     */
    function resetApp() {
        if (!confirm('Möchten Sie wirklich alle Transaktionen löschen und von vorne beginnen?')) {
            return;
        }

        currentTransactions = [];
        fileInput.value = '';
        fileName.textContent = '';
        updatePreview();
        hideError();
    }

    // ============================================================
    // Konfigurationsverwaltung: localStorage
    // ============================================================

    /**
     * Speichert die aktuelle Konfiguration im localStorage des Browsers.
     * Wird bei jeder Feldaenderung automatisch aufgerufen (Auto-Save).
     *
     * Gespeicherte Felder: Zahlungsart, Pain-Format, Initiator, Datum,
     * Glaeubigeor-Daten, Sequenztyp, Instrumentierung, Auftraggeber-Daten.
     */
    function saveConfigToStorage() {
        const config = {
            paymentType: currentPaymentType,
            painFormat: painFormatSelect.value,
            initiatorName: initiatorNameInput.value,
            executionDate: executionDateInput.value,
            creditorName: creditorNameInput.value,
            creditorIBAN: creditorIBANInput.value,
            creditorBIC: creditorBICInput.value,
            creditorId: creditorIdInput.value,
            sequenceType: sequenceTypeSelect.value,
            localInstrumentation: localInstrumentationSelect.value,
            debtorName: debtorNameInput.value,
            debtorIBAN: debtorIBANInput.value,
            debtorBIC: debtorBICInput.value
        };

        try {
            localStorage.setItem('sepaConfig', JSON.stringify(config));
        } catch (e) {
            // localStorage kann voll sein oder im privaten Modus blockiert
            console.warn('Could not save config to localStorage:', e);
        }
    }

    // ============================================================
    // Konfigurationsverwaltung: JSON-Datei
    // ============================================================

    /**
     * Speichert die aktuelle Konfiguration als JSON-Datei (Download).
     * Die Datei kann spaeter wieder geladen werden, auch auf anderen Geraeten.
     *
     * Dateiname: sepa-config-YYYY-MM-DD.json
     */
    function saveConfigToFile() {
        const config = {
            paymentType: currentPaymentType,
            painFormat: painFormatSelect.value,
            initiatorName: initiatorNameInput.value,
            executionDate: executionDateInput.value,
            creditorName: creditorNameInput.value,
            creditorIBAN: creditorIBANInput.value,
            creditorBIC: creditorBICInput.value,
            creditorId: creditorIdInput.value,
            sequenceType: sequenceTypeSelect.value,
            localInstrumentation: localInstrumentationSelect.value,
            debtorName: debtorNameInput.value,
            debtorIBAN: debtorIBANInput.value,
            debtorBIC: debtorBICInput.value
        };

        // JSON mit Einrueckung fuer Lesbarkeit formatieren
        const jsonString = JSON.stringify(config, null, 2);

        // JSON-Datei als Download ausloesen
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sepa-config-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showSuccess('Konfiguration erfolgreich als Datei gespeichert!');
    }

    /**
     * Laedt die Konfiguration aus dem localStorage und befuellt die Formularfelder.
     * Wird beim Seitenstart aufgerufen, um die letzte Konfiguration wiederherzustellen.
     */
    function loadConfigFromStorage() {
        try {
            const savedConfig = localStorage.getItem('sepaConfig');
            if (!savedConfig) return;

            const config = JSON.parse(savedConfig);

            // Zahlungsart wiederherstellen (loeut auch UI-Aktualisierung aus)
            if (config.paymentType) switchPaymentType(config.paymentType);

            // Alle Felder befuellen (nur wenn Wert vorhanden)
            if (config.painFormat) painFormatSelect.value = config.painFormat;
            if (config.initiatorName) initiatorNameInput.value = config.initiatorName;
            if (config.executionDate) executionDateInput.value = config.executionDate;
            if (config.creditorName) creditorNameInput.value = config.creditorName;
            if (config.creditorIBAN) creditorIBANInput.value = config.creditorIBAN;
            if (config.creditorBIC) creditorBICInput.value = config.creditorBIC;
            if (config.creditorId) creditorIdInput.value = config.creditorId;
            if (config.sequenceType) sequenceTypeSelect.value = config.sequenceType;
            if (config.localInstrumentation) localInstrumentationSelect.value = migrateLocalInstrument(config.localInstrumentation);
            if (config.debtorName) debtorNameInput.value = config.debtorName;
            if (config.debtorIBAN) debtorIBANInput.value = config.debtorIBAN;
            if (config.debtorBIC) debtorBICInput.value = config.debtorBIC;

        } catch (e) {
            console.warn('Could not load config from localStorage:', e);
        }
    }

    // ============================================================
    // Benachrichtigungen (Erfolg/Fehler)
    // ============================================================

    /**
     * Zeigt eine Fehlermeldung im Error-Banner an und scrollt dorthin.
     *
     * @param {string} message - Fehlermeldungstext
     */
    function showError(message) {
        errorSection.style.display = 'block';
        errorMessage.textContent = message;
        errorSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /**
     * Versteckt die Fehlermeldung.
     */
    function hideError() {
        errorSection.style.display = 'none';
    }

    /**
     * Zeigt eine temporaere Erfolgsmeldung als Toast-Notification an.
     * Die Nachricht erscheint oben rechts und verschwindet nach 3 Sekunden.
     *
     * @param {string} message - Erfolgsmeldungstext
     */
    function showSuccess(message, variant) {
        const isInfo = variant === 'info';

        // Bereits sichtbare Toasts nach unten ausweichen lassen, damit sich
        // Erfolgs- und Hinweismeldung nicht ueberdecken.
        const stacked = document.querySelectorAll('[data-toast]').length;

        const successDiv = document.createElement('div');
        successDiv.setAttribute('data-toast', '');
        successDiv.style.cssText = `
            position: fixed;
            top: ${20 + stacked * 96}px;
            right: 20px;
            max-width: min(420px, calc(100vw - 40px));
            background: ${isInfo
                ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                : 'linear-gradient(135deg, #10b981, #059669)'};
            color: white;
            padding: 1.5rem 2rem;
            border-radius: 12px;
            box-shadow: 0 8px 24px ${isInfo ? 'rgba(59, 130, 246, 0.4)' : 'rgba(16, 185, 129, 0.4)'};
            z-index: 10000;
            font-weight: 600;
            font-size: 1.05rem;
            line-height: 1.4;
            animation: slideIn 0.3s ease;
        `;
        successDiv.textContent = message;
        document.body.appendChild(successDiv);

        // Hinweise stehen laenger, weil sie mehr Text zum Lesen enthalten.
        setTimeout(() => {
            successDiv.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => successDiv.remove(), 300);
        }, isInfo ? 9000 : 3000);
    }

    // ============================================================
    // Hilfsfunktionen
    // ============================================================

    /**
     * Generiert eine eindeutige Nachrichten-ID fuer den SEPA GroupHeader.
     * Format: MSG-{timestamp}-{random}
     *
     * @returns {string} Eindeutige ID (z.B. "MSG-1706180400000-a1b2c3d4e")
     */
    function generateMessageId() {
        return 'MSG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Leitet den BIC aus einer deutschen IBAN ab (Bankleitzahl = Stellen 5-12).
     *
     * Hintergrund: Seit 2016 ist der BIC im SEPA-Raum optional. Ohne BIC erzeugt
     * die Lib <FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>. Manche
     * (aeltere) Bankprogramme validieren aber gegen ein Schema, dessen
     * <FinInstnId> nur <BIC> erlaubt, und lehnen dann jedes <Othr> ab
     * ("no declaration found for element 'Othr'"). Damit Nutzer keinen BIC
     * eintippen muessen, ermitteln wir ihn aus der IBAN.
     *
     * Die Zuordnung stammt aus der offiziellen Bankleitzahlendatei der Deutschen
     * Bundesbank (blz-bic.js, per <script> geladen). Fehlt die Tabelle oder ist
     * die BLZ unbekannt/die IBAN nicht deutsch, wird '' zurueckgegeben – dann
     * bleibt es beim NOTPROVIDED-Fallback der Lib (schadet SEPA-konformen Banken
     * nicht).
     *
     * @param {string} iban - IBAN (mit oder ohne Leerzeichen)
     * @returns {string} Abgeleiteter BIC (8 oder 11 Zeichen) oder ''
     */
    function deriveBIC(iban) {
        const clean = String(iban || '').replace(/\s/g, '').toUpperCase();
        // Nur deutsche IBANs (DE + 2 Pruefziffern + 8 BLZ + 10 Konto = 22 Zeichen)
        if (!/^DE\d{20}$/.test(clean)) return '';
        const table = (typeof window !== 'undefined' && window.SEPA_BLZ_BIC) || {};
        return table[clean.substr(4, 8)] || '';
    }

    /**
     * Migriert gespeicherte Konfigurationen auf gueltige Lastschrift-Arten.
     *
     * COR1 ("Eil-Lastschrift") wurde zum 21.11.2016 abgeschafft; CORE hat die
     * verkuerzte Vorlaufzeit uebernommen. Die Option ist deshalb aus dem
     * Auswahlfeld entfernt. Ohne diese Migration wuerde ein alter Wert aus dem
     * localStorage oder einer exportierten Konfigurationsdatei das Auswahlfeld
     * auf einen nicht existierenden Eintrag setzen – der Wert waere dann leer
     * und die XML enthielte ein leeres <Cd/>.
     *
     * @param {string} value - Gespeicherter Wert
     * @returns {string} Gueltiger Wert (CORE oder B2B)
     */
    function migrateLocalInstrument(value) {
        return value === 'COR1' ? 'CORE' : value;
    }

    /**
     * Sammelt waehrend einer Generierung alle Felder, die durch die
     * Zeichensatz-Umwandlung veraendert wurden – damit der Nutzer nicht
     * raetselt, warum in der XML ploetzlich "Mueller" statt "Müller" steht.
     * Wird zu Beginn von generateAndDownload() geleert.
     */
    let sepaTextChanges = [];

    /**
     * Wandelt Freitext in den SEPA-Zeichensatz (EPC217-08) um und kuerzt ihn
     * auf die Feldlaenge. Delegiert an SEPA.toSepaText() aus sepa.min.js, damit
     * Browser und Tests dieselbe Implementierung verwenden.
     *
     * Hintergrund: Die XML ist zwar UTF-8-kodiert, viele Bankprogramme
     * akzeptieren aber nur den EPC-Zeichenvorrat und lehnen Umlaute ab bzw.
     * ersetzen sie still durch Fragezeichen. Umlaute werden deshalb nach
     * deutscher Konvention aufgeloest (ä→ae, ö→oe, ü→ue, ß→ss).
     *
     * Ausnahme Oesterreich: Mit einem PSA-Format bleiben Umlaute und die
     * weiteren dort erlaubten Zeichen (€ & @ ...) erhalten – die PSA-Schemata
     * sehen sie ausdruecklich vor.
     *
     * Bewusst NUR fuer Freitext (Namen, Verwendungszweck) – Referenzen laufen
     * ueber sepaId(), und IBAN, BIC, Glaeubiger-ID oder Datumsfelder gar nicht:
     * die sind bereits auf A-Z/0-9 beschraenkt und wuerden durch eine
     * Umwandlung nur riskieren, ihre Pruefziffer zu verlieren.
     *
     * @param {*} value - Eingabewert (auch Zahlen aus Excel-Importen)
     * @param {number} maxLen - Maximale Feldlaenge (70 Nm, 140 Ustrd)
     * @param {string} painFormat - Gewaehltes Format (bestimmt den Zeichensatz)
     * @returns {string} Text im SEPA-Zeichensatz
     */
    function sepaText(value, maxLen, painFormat) {
        return convertForSepa(value, maxLen, (s, n) => SEPA.toSepaText(s, n, painFormat));
    }

    /**
     * Wandelt eine Referenz (EndToEndId, Mandatsreferenz) in eine SEPA-konforme
     * ID um: immer Basiszeichensatz – auch in Oesterreich, dort erlaubt der Typ
     * Max35Text_REF keine Umlaute –, kein "/" am Anfang/Ende, kein "//".
     *
     * @param {*} value - Eingabewert (auch Zahlen aus Excel-Importen)
     * @param {number} maxLen - Maximale Laenge (35)
     * @returns {string} Bereinigte ID (leer, wenn nichts uebrig bleibt)
     */
    function sepaId(value, maxLen) {
        return convertForSepa(value, maxLen, SEPA.toSepaId);
    }

    /**
     * Gemeinsamer Ablauf von sepaText()/sepaId(): umwandeln, ggf. kuerzen,
     * Aenderung fuer den Hinweis nach dem Download protokollieren.
     *
     * @param {*} value - Eingabewert
     * @param {number} maxLen - Maximale Feldlaenge
     * @param {function(string, number=): string} convert - Umwandlung aus sepa.min.js
     * @returns {string} Umgewandelter Wert
     */
    function convertForSepa(value, maxLen, convert) {
        const original = (value === null || value === undefined ? '' : String(value)).trim();
        let converted = convert(original);

        // Nur kuerzen, wenn erst die Umwandlung das Feld ueberlaufen laesst
        // ("ß" → "ss", "€" → "EUR" verlaengern den Text). War die Eingabe schon
        // zu lang, bleibt sie zu lang – dann schlaegt die Laengenpruefung der
        // Library an und der Nutzer bekommt eine Fehlermeldung, statt dass
        // seine Daten still abgeschnitten werden.
        if (original.length <= maxLen && converted.length > maxLen) {
            converted = convert(original, maxLen);
        }

        if (original && converted !== original) {
            sepaTextChanges.push({ from: original, to: converted });
        }
        return converted;
    }

    /**
     * Formatiert einen Betrag als Euro-Waehrungsstring (deutsches Format).
     * Beispiel: 1234.56 → "1.234,56 €"
     *
     * @param {number} amount - Betrag
     * @returns {string} Formatierter Waehrungsstring
     */
    function formatCurrency(amount) {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    }

    /**
     * Escaped HTML-Sonderzeichen in einem Text (XSS-Schutz).
     * Verwendet ein temporaeres DOM-Element fuer sicheres Escaping.
     *
     * @param {string} text - Zu escapender Text
     * @returns {string} HTML-sicherer Text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});

// ============================================================
// Dynamische CSS-Animationen fuer Erfolgs-Benachrichtigungen
// ============================================================
// Diese Styles werden dynamisch zum <head> hinzugefuegt, da sie
// nur fuer die JavaScript-generierten Toast-Notifications benoetigt werden.

const style = document.createElement('style');
style.textContent = `
    /* Slide-In Animation: Toast-Notification kommt von rechts herein */
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    /* Slide-Out Animation: Toast-Notification gleitet nach rechts heraus */
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }

    /* Loeschen-Button in der Vorschautabelle */
    .btn-remove {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 1.2rem;
        padding: 0.5rem;
        transition: transform 0.2s ease;
    }

    .btn-remove:hover {
        transform: scale(1.2);
    }
`;
document.head.appendChild(style);
