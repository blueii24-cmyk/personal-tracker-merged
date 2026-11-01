import { isNative } from '@/tracker/lib/platform/native';

export type DownloadResult = 'saved' | 'shared' | 'cancelled';

const EXPORT_FILE = /^(personal-tracker-|transactions-).*\.(json|csv)$/;

/**
 * Hands a file to the user.
 * Browser: a normal download. Android app: WebView ignores blob downloads, so the file is written to the app's private
 * cache (no storage permission needed) and the system share sheet opens, where the user picks Drive, Files, email, etc.
 */
export async function downloadFile(filename: string, content: string, mime: string): Promise<DownloadResult> {
  if (isNative()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    // Earlier exports hold personal data, so clear them before writing a new one.
    try {
      const { files } = await Filesystem.readdir({ path: '', directory: Directory.Cache });
      await Promise.all(files.filter((f) => EXPORT_FILE.test(f.name)).map((f) => Filesystem.deleteFile({ path: f.name, directory: Directory.Cache }).catch(() => undefined)));
    } catch {
      /* nothing to clean */
    }
    const { uri } = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title: filename, dialogTitle: 'Save or share your export', url: uri });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return 'cancelled';
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

/** RFC 4180 CSV. Cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas. */
export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
