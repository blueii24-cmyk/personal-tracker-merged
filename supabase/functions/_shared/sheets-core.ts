/** Server-side Google Sheets building blocks. Not wired to a deployed function or the UI yet.
 * Access tokens are supplied by the server, never persisted or returned by this module.
 */
export const SHEET_HEADERS = {
  Meals: ['Record ID', 'Date', 'Time', 'Meal type', 'Food name', 'Quantity', 'Unit', 'Calories', 'Protein', 'Nutrition source', 'Notes', 'Created at', 'Last updated', 'Record status'],
  Transactions: ['Record ID', 'Date', 'Type (income/expense)', 'Amount', 'Currency', 'Category', 'Description', 'Payment details', 'Created at', 'Last updated', 'Record status'],
  'Weight & Bulking': ['Record ID', 'Date', 'Weight', 'Weight unit', 'Notes', 'Created at', 'Last updated', 'Record status'],
  'Calendar Events': ['Record ID', 'Title', 'Description', 'Start date', 'End date', 'Start time', 'End time', 'Category', 'Origin', 'Last updated', 'Record status'],
  'Health Metrics': ['Record ID', 'Data type', 'Measurement', 'Unit', 'Recorded at', 'Source', 'Last updated'],
  'Sync Log': ['Timestamp', 'Record ID', 'Record category', 'Operation', 'Sync result', 'Error details'],
} as const;
export type SheetName = keyof typeof SHEET_HEADERS;
export type Cell = string | number | boolean | null;
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsError extends Error {
  constructor(public readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'network' | 'api_error' | 'invalid_response' | 'unsafe_sheet', public readonly status?: number) {
    super(`Google Sheets: ${code}`);
  }
}

function sheetRequests(title: SheetName, sheetId: number) {
  const headers = SHEET_HEADERS[title];
  return [
    { addSheet: { properties: { sheetId, title, gridProperties: { frozenRowCount: 1 } } } },
    { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: headers.map((header) => ({ userEnteredValue: { stringValue: header }, userEnteredFormat: { textFormat: { bold: true } } })) }], fields: 'userEnteredValue,userEnteredFormat.textFormat.bold' } },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: headers.length } } } },
  ];
}

function idPath(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SheetsError('unsafe_sheet');
  return `${API}/${id}`;
}

/** Thin API adapter. Call only after explicit Google consent, on a trusted server. */
export class SheetsApi {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async request(url: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method, headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', cache: 'no-store',
      });
    } catch { throw new SheetsError('network'); }
    if (!res.ok) {
      const code = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'api_error';
      throw new SheetsError(code, res.status);
    }
    try {
      const value: unknown = await res.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch { throw new SheetsError('invalid_response'); }
  }

  /** Create only on explicit user action. An ambiguous create failure must not be blindly retried. */
  async createSpreadsheet(): Promise<string> {
    const result = await this.request(API, 'POST', { properties: { title: 'Personal Tracker — Personal Database' } });
    if (typeof result.spreadsheetId !== 'string') throw new SheetsError('invalid_response');
    idPath(result.spreadsheetId);
    return result.spreadsheetId;
  }

  /** Add missing tabs and their headers/filters atomically. Existing tabs are never altered. */
  async ensureTabs(id: string): Promise<void> {
    const base = idPath(id);
    const meta = await this.request(`${base}?fields=sheets.properties(sheetId,title)`);
    if (!Array.isArray(meta.sheets)) throw new SheetsError('invalid_response');
    const present = new Set<string>();
    const used = new Set<number>();
    for (const sheet of meta.sheets) {
      const p = sheet?.properties;
      if (!p || typeof p.title !== 'string' || !Number.isInteger(p.sheetId) || p.sheetId < 0) throw new SheetsError('invalid_response');
      present.add(p.title); used.add(p.sheetId);
    }
    const requests: unknown[] = [];
    let next = 0;
    for (const title of Object.keys(SHEET_HEADERS) as SheetName[]) {
      if (present.has(title)) continue;
      while (used.has(next)) next++;
      used.add(next);
      requests.push(...sheetRequests(title, next++));
    }
    if (requests.length) await this.request(`${base}:batchUpdate`, 'POST', { requests });
  }

  /**
   * Write a single row by stable record ID, in RAW mode to prevent formula injection.
   * Reject altered headers and duplicates instead of choosing an arbitrary row. A retry
   * re-reads IDs before appending; concurrent writers still need an external lock.
   */
  async upsert(id: string, tab: Exclude<SheetName, 'Sync Log'>, recordId: string, row: Cell[]): Promise<void> {
    const headers = SHEET_HEADERS[tab];
    if (!recordId || row.length !== headers.length || row[0] !== recordId) throw new SheetsError('unsafe_sheet');
    const base = idPath(id);
    const heading = await this.request(`${base}/values/${encodeURIComponent(`'${tab}'!1:1`)}`);
    const first = Array.isArray(heading.values) ? heading.values[0] : null;
    if (!Array.isArray(first) || headers.some((value, index) => first[index] !== value)) throw new SheetsError('unsafe_sheet');
    const range = encodeURIComponent(`'${tab}'!A:A`);
    const result = await this.request(`${base}/values/${range}`);
    if (result.values !== undefined && !Array.isArray(result.values)) throw new SheetsError('invalid_response');
    const values = (result.values ?? []) as unknown[];
    if (!values.every(Array.isArray)) throw new SheetsError('invalid_response');
    if ((values[0] as unknown[] | undefined)?.[0] !== headers[0]) throw new SheetsError('unsafe_sheet');
    const matches: number[] = [];
    values.forEach((v, i) => { if (i > 0 && (v as unknown[])[0] === recordId) matches.push(i + 1); });
    if (matches.length > 1) throw new SheetsError('unsafe_sheet');
    const body = { majorDimension: 'ROWS', values: [row.map((v) => v ?? '')] };
    if (matches.length) {
      const rowRange = encodeURIComponent(`'${tab}'!A${matches[0]}`);
      await this.request(`${base}/values/${rowRange}?valueInputOption=RAW`, 'PUT', body);
    } else {
      await this.request(`${base}/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', body);
    }
  }
}
