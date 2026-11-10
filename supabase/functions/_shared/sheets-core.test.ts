import { describe, expect, it, vi } from 'vitest';
import { SHEET_HEADERS, SheetsApi, SheetsError } from './sheets-core';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const head = (name: keyof typeof SHEET_HEADERS) => json({ values: [SHEET_HEADERS[name]] });

describe('server-side Sheets API building blocks', () => {
  it('creates a spreadsheet without returning or logging credentials', async () => {
    const fetcher = vi.fn(async () => json({ spreadsheetId: 'sheet_123' }));
    const sheets = new SheetsApi('synthetic-secret', fetcher as unknown as typeof fetch);
    expect(await sheets.createSpreadsheet()).toBe('sheet_123');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sheets.googleapis.com/v4/spreadsheets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).properties.title).toBe('Personal Tracker — Personal Database');
    expect(url).not.toContain('secret');
  });

  it('creates only missing tabs, with frozen readable headers and filters, in one batch', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ sheets: [{ properties: { title: 'Meals', sheetId: 0 } }, { properties: { title: 'Other', sheetId: 1 } }] })).mockResolvedValueOnce(json({ replies: [] }));
    await new SheetsApi('test', fetcher as unknown as typeof fetch).ensureTabs('sheet_123');
    const requests = JSON.parse(String(fetcher.mock.calls[1][1].body)).requests;
    expect(requests.filter((x: { addSheet?: unknown }) => x.addSheet)).toHaveLength(5);
    expect(requests.some((x: { addSheet?: { properties: { title: string } } }) => x.addSheet?.properties.title === 'Meals')).toBe(false);
    expect(requests[0].addSheet.properties.gridProperties.frozenRowCount).toBe(1);
    expect(requests[1].updateCells.rows[0].values[0].userEnteredValue.stringValue).toBe('Record ID');
    expect(requests[2].setBasicFilter.filter.range.sheetId).toBe(2);
  });

  it('updates an existing record rather than appending it', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(head('Meals')).mockResolvedValueOnce(json({ values: [['Record ID'], ['meal-1']] })).mockResolvedValueOnce(json({ updatedRows: 1 }));
    const row = ['meal-1', '=not a formula', ...Array(12).fill('')];
    await new SheetsApi('test', fetcher as unknown as typeof fetch).upsert('sheet_123', 'Meals', 'meal-1', row);
    const [url, init] = fetcher.mock.calls[2];
    expect(url).toContain('A2?valueInputOption=RAW');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body).values[0][1]).toBe('=not a formula');
  });

  it('appends a new record, and retries by re-reading the ID after an ambiguous network failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(head('Transactions')).mockResolvedValueOnce(json({ values: [['Record ID']] })).mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(head('Transactions')).mockResolvedValueOnce(json({ values: [['Record ID'], ['tx-1']] })).mockResolvedValueOnce(json({ updatedRows: 1 }));
    const sheets = new SheetsApi('test', fetcher as unknown as typeof fetch);
    const row = ['tx-1', ...Array(10).fill('')];
    await expect(sheets.upsert('sheet_123', 'Transactions', 'tx-1', row)).rejects.toMatchObject({ code: 'network' });
    await sheets.upsert('sheet_123', 'Transactions', 'tx-1', row);
    expect(fetcher.mock.calls[2][0]).toContain(':append?valueInputOption=RAW');
    expect(fetcher.mock.calls[5][0]).toContain('A2?valueInputOption=RAW');
  });

  it('refuses duplicate IDs and changed headers without touching data', async () => {
    const duplicate = vi.fn().mockResolvedValueOnce(head('Meals')).mockResolvedValueOnce(json({ values: [['Record ID'], ['m'], ['m']] }));
    await expect(new SheetsApi('test', duplicate as unknown as typeof fetch).upsert('sheet_123', 'Meals', 'm', ['m', ...Array(13).fill('')])).rejects.toMatchObject({ code: 'unsafe_sheet' });
    expect(duplicate).toHaveBeenCalledTimes(2);
    const changed = vi.fn().mockResolvedValueOnce(json({ values: [['Record ID', 'changed']] }));
    await expect(new SheetsApi('test', changed as unknown as typeof fetch).upsert('sheet_123', 'Meals', 'm', ['m', ...Array(13).fill('')])).rejects.toMatchObject({ code: 'unsafe_sheet' });
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [500, 'api_error']] as const)('sanitizes HTTP %s errors', async (status, code) => {
    const sheets = new SheetsApi('synthetic-secret', (async () => json({ error: 'synthetic-secret' }, status)) as typeof fetch);
    const error = await sheets.createSpreadsheet().catch((e) => e);
    expect(error).toBeInstanceOf(SheetsError);
    expect(error.code).toBe(code);
    expect(JSON.stringify(error)).not.toContain('synthetic-secret');
    expect(error.message).not.toContain('synthetic-secret');
  });
});
