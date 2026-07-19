/**
 * Charge le Google Picker (apis.google.com) et ouvre un sélecteur de Spreadsheets.
 */

declare global {
  interface Window {
    gapi?: {
      load: (name: string, cb: () => void) => void;
      client?: unknown;
    };
    google?: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        ViewId: { SPREADSHEETS: string };
        Action: { PICKED: string; CANCEL: string; LOADED?: string };
        Feature: { MULTISELECT_ENABLED: string };
        Response: { ACTION: string; DOCUMENTS: string };
        Document: { ID: string; NAME: string; URL: string };
      };
    };
  }
}

type GooglePickerBuilder = {
  addView: (viewId: string) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setCallback: (cb: (data: Record<string, unknown>) => void) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

export type PickerSheetSelection = {
  id: string;
  title: string;
};

let apiJsPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureGapiPicker(): Promise<void> {
  if (!apiJsPromise) {
    apiJsPromise = (async () => {
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise<void>((resolve, reject) => {
        if (!window.gapi?.load) {
          reject(new Error('gapi indisponible'));
          return;
        }
        window.gapi.load('picker', () => resolve());
      });
    })();
  }
  await apiJsPromise;
}

function extractDocs(
  data: Record<string, unknown>,
  pickerNs: NonNullable<Window['google']>['picker'],
): Array<Record<string, unknown>> {
  const key = pickerNs.Response?.DOCUMENTS ?? 'docs';
  const raw = data[key] ?? data.docs;
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

export async function openGoogleSheetsPicker(opts: {
  accessToken: string;
  developerKey: string;
  appId: string;
}): Promise<PickerSheetSelection[]> {
  const { accessToken, developerKey, appId } = opts;
  if (!accessToken) throw new Error('Token Google manquant.');
  if (!developerKey) throw new Error('VITE_GOOGLE_PICKER_API_KEY manquante.');
  if (!appId) throw new Error('VITE_GOOGLE_CLOUD_PROJECT_NUMBER manquant.');

  await ensureGapiPicker();
  const pickerNs = window.google?.picker;
  if (!pickerNs) throw new Error('Google Picker non chargé.');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (docs: PickerSheetSelection[]) => {
      if (settled) return;
      settled = true;
      resolve(docs);
    };

    const builder = new pickerNs.PickerBuilder()
      .addView(pickerNs.ViewId.SPREADSHEETS)
      .enableFeature(pickerNs.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(accessToken)
      .setDeveloperKey(developerKey)
      .setAppId(String(appId))
      .setTitle('Sélectionner des Google Sheets')
      .setCallback((data) => {
        const actionKey = pickerNs.Response?.ACTION ?? 'action';
        const action = String(data[actionKey] ?? data.action ?? '');
        if (action === pickerNs.Action.CANCEL || action === 'cancel') {
          finish([]);
          return;
        }
        if (action === pickerNs.Action.PICKED || action === 'picked') {
          const docs = extractDocs(data, pickerNs);
          const idKey = pickerNs.Document?.ID ?? 'id';
          const nameKey = pickerNs.Document?.NAME ?? 'name';
          finish(
            docs
              .map((d) => ({
                id: String(d[idKey] ?? d.id ?? '').trim(),
                title: String(d[nameKey] ?? d.name ?? 'Sans titre').trim() || 'Sans titre',
              }))
              .filter((d) => d.id),
          );
          return;
        }
        // LOADED et autres events : ignorer (ne pas resolve([]))
      });

    try {
      builder.setOrigin(window.location.protocol + '//' + window.location.host);
    } catch {
      /* setOrigin optionnel */
    }

    builder.build().setVisible(true);
  });
}
