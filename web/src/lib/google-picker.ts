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
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
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
  setCallback: (cb: (data: GooglePickerResponse) => void) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

type GooglePickerResponse = {
  action: string;
  docs?: Array<Record<string, string>>;
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
    const builder = new pickerNs.PickerBuilder()
      .addView(pickerNs.ViewId.SPREADSHEETS)
      .enableFeature(pickerNs.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(accessToken)
      .setDeveloperKey(developerKey)
      .setAppId(appId)
      .setTitle('Sélectionner des Google Sheets')
      .setCallback((data) => {
        if (data.action === pickerNs.Action.CANCEL) {
          resolve([]);
          return;
        }
        if (data.action === pickerNs.Action.PICKED) {
          const docs = data.docs ?? [];
          resolve(
            docs
              .map((d) => ({
                id: String(d[pickerNs.Document.ID] ?? d.id ?? '').trim(),
                title: String(d[pickerNs.Document.NAME] ?? d.name ?? 'Sans titre').trim(),
              }))
              .filter((d) => d.id),
          );
          return;
        }
        resolve([]);
      });

    builder.build().setVisible(true);
  });
}
